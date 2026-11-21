<?php
declare(strict_types=1);

namespace Lpc;

/**
 * Chat de groupe et de promo, dans la base du chat. Deux salons par groupe : « groupe » (ses membres et ses administrateurs) et
 * « promo » (toutes les personnes qui lisent la promo). Limites : 5 messages par personne sur 2 minutes glissantes, 500 caractères,
 * 1000 messages par salon, 7 jours de conservation. Interrogation régulière côté client (pas de temps réel).
 */
final class Chat
{
    public const RAFALE = 5;
    public const FENETRE_S = 120;
    public const TEXTE_MAX = 500;
    public const MAX = 1000;
    public const JOURS = 7;
    public const AFFICHES = 100;

    /**
     * Messages du salon demandé (les `limite` derniers), nombre de nouveaux messages d'autrui dans chaque salon depuis `vu`,
     * et délai restant avant de pouvoir écrire.
     *
     * @param array<string,mixed> $req
     * @return array<string,mixed>
     */
    public static function lister(Contexte $c, array $req): array
    {
        $type = ($req['type'] ?? null) === 'promo' ? 'promo' : 'groupe';
        $canal = self::canal($c, $type, $req['groupe_id'] ?? null);
        $limite = min(max((int) ($req['limite'] ?? 0) ?: self::AFFICHES, 1), self::MAX);
        $coupe = self::coupure();
        $chat = $c->db->chat();
        $uid = (int) $c->user->id;

        $vu = is_array($req['vu'] ?? null) ? $req['vu'] : [];
        $nouveaux = [];
        foreach (['groupe', 'promo'] as $t) {
            try {
                $cle = self::canal($c, $t, $req['groupe_id'] ?? null);
            } catch (Erreur) {
                $nouveaux[$t] = 0;
                continue;
            }
            $depuis = max($coupe, self::dateVue($vu[$t] ?? null));
            $st = $chat->prepare('SELECT COUNT(*) FROM chat_messages WHERE canal = ? AND auteur_id <> ? AND cree_le > ?');
            $st->execute([$cle, $uid, $depuis]);
            $nouveaux[$t] = (int) $st->fetchColumn();
        }

        $st = $chat->prepare('SELECT COUNT(*) FROM chat_messages WHERE canal = ? AND cree_le >= ?');
        $st->execute([$canal, $coupe]);
        $total = (int) $st->fetchColumn();
        $st = $chat->prepare('SELECT id, auteur_id, auteur_nom, cree_le, texte FROM chat_messages WHERE canal = ? AND cree_le >= ? ORDER BY id DESC LIMIT ' . $limite);
        $st->execute([$canal, $coupe]);
        $lignes = array_reverse($st->fetchAll());

        $auteurs = [];
        $ids = array_values(array_unique(array_map(static fn (array $m): int => (int) $m['auteur_id'], $lignes)));
        if ($ids !== []) {
            $s = $c->db->principale()->prepare('SELECT id, prenom, nom, pseudo, couleur FROM utilisateurs WHERE id IN (' . Lectures::marques(count($ids)) . ')');
            $s->execute($ids);
            foreach ($s->fetchAll() as $u) {
                $auteurs[(int) $u['id']] = $u;
            }
        }
        $messages = [];
        foreach ($lignes as $m) {
            $u = $auteurs[(int) $m['auteur_id']] ?? null;
            $messages[] = ['id' => (string) $m['id'], 'auteur' => $u === null ? (string) $m['auteur_nom'] : Membres::affiche($u),
                'couleur' => $u === null ? Config::COULEUR_DEFAUT : (string) $u['couleur'], 'date' => Temps::iso((string) $m['cree_le']),
                'texte' => (string) $m['texte'], 'moi' => (int) $m['auteur_id'] === $uid];
        }
        return ['ok' => true, 'total' => $total, 'restant' => self::attente($chat, $uid), 'nouveaux' => $nouveaux, 'messages' => $messages];
    }

    /** @param array<string,mixed> $req */
    public static function envoyer(Contexte $c, array $req): void
    {
        $type = ($req['type'] ?? null) === 'promo' ? 'promo' : 'groupe';
        $canal = self::canal($c, $type, $req['groupe_id'] ?? null);
        $texte = is_scalar($req['texte'] ?? null) ? (string) $req['texte'] : '';
        $texte = trim((string) preg_replace("/\n{3,}/", "\n\n", (string) preg_replace("/\r\n?/", "\n", $texte)));
        if ($texte === '') {
            throw new Erreur('invalid', 'Message vide');
        }
        if (mb_strlen($texte) > self::TEXTE_MAX) {
            throw new Erreur('invalid', 'Message trop long (' . self::TEXTE_MAX . ' caractères maximum)');
        }
        $chat = $c->db->chat();
        $uid = (int) $c->user->id;
        $attente = self::attente($chat, $uid);
        if ($attente > 0) {
            throw new Erreur('rate', 'Limite atteinte (' . self::RAFALE . ' messages sur 2 minutes) : encore ' . $attente . ' s');
        }
        $chat->prepare('INSERT INTO chat_messages (canal, auteur_id, auteur_nom, cree_le, texte) VALUES (?, ?, ?, ?, ?)')
            ->execute([$canal, $uid, $c->user->affichage(), Temps::maintenant(), $texte]);
        // Nettoyage : messages trop anciens, puis excédent du salon (les plus anciens d'abord).
        $chat->prepare('DELETE FROM chat_messages WHERE cree_le < ?')->execute([self::coupure()]);
        $chat->prepare(
            'DELETE FROM chat_messages WHERE canal = ? AND id <= (SELECT id FROM (SELECT id FROM chat_messages WHERE canal = ? ORDER BY id DESC LIMIT 1 OFFSET ' . self::MAX . ') t)'
        )->execute([$canal, $canal]);
    }

    /** Chacun retire ses messages ; un administrateur du groupe ou de la promo du salon peut retirer n'importe lequel. */
    public static function supprimer(Contexte $c, string $id): void
    {
        $chat = $c->db->chat();
        $st = $chat->prepare('SELECT id, canal, auteur_id FROM chat_messages WHERE id = ?');
        $st->execute([(int) $id]);
        $m = $st->fetch();
        if ($m === false) {
            throw new Erreur('not_found', 'Message introuvable');
        }
        $d = $c->droits();
        $cible = substr((string) $m['canal'], 2);
        $admin = $d->estAdmin() || (str_starts_with((string) $m['canal'], 'g:') ? $d->peutAdministrerGroupe($cible) : $d->peutAdministrerPromo($cible));
        if ((int) $m['auteur_id'] !== $c->user->id && !$admin) {
            throw new Erreur('forbidden', 'Vous ne pouvez retirer que vos messages');
        }
        $chat->prepare('DELETE FROM chat_messages WHERE id = ?')->execute([$m['id']]);
    }

    // ---------- Interne ----------

    /** Clé du salon demandé (« groupe » ou « promo » d'un groupe), ou erreur d'accès. */
    private static function canal(Contexte $c, string $type, mixed $groupeId): string
    {
        $gid = is_string($groupeId) ? $groupeId : '';
        $promo = $gid === '' ? null : $c->droits()->promoDeGroupe($gid);
        if ($promo === null) {
            throw new Erreur('not_found', 'Groupe introuvable');
        }
        if ($type === 'promo') {
            if (!in_array($promo, Lectures::promosLecture($c), true)) {
                throw new Erreur('forbidden', 'Vous ne faites pas partie de cette promo');
            }
            return 'p:' . $promo;
        }
        if (!Membres::estMembre($c->db->principale(), $gid, (int) $c->user->id) && !$c->droits()->peutAdministrerGroupe($gid)) {
            throw new Erreur('forbidden', 'Vous ne faites pas partie de ce groupe');
        }
        return 'g:' . $gid;
    }

    private static function coupure(): string
    {
        return Temps::depuis(-self::JOURS * 86400);
    }

    /** Date de base correspondant à une date ISO envoyée par le client (« vu »), « 0000… » si absente ou illisible. */
    private static function dateVue(mixed $iso): string
    {
        if (!is_string($iso) || $iso === '') {
            return '1970-01-01 00:00:00';
        }
        try {
            return (new \DateTimeImmutable($iso))->setTimezone(new \DateTimeZone('UTC'))->format('Y-m-d H:i:s');
        } catch (\Throwable) {
            return '1970-01-01 00:00:00';
        }
    }

    /**
     * Secondes à attendre avant de pouvoir écrire : 0 tant que la personne a envoyé moins de RAFALE messages sur les FENETRE_S dernières
     * secondes (fenêtre glissante, tous salons confondus).
     */
    private static function attente(\PDO $chat, int $uid): int
    {
        $st = $chat->prepare('SELECT cree_le FROM chat_messages WHERE auteur_id = ? AND cree_le > ? ORDER BY cree_le DESC, id DESC LIMIT ' . self::RAFALE);
        $st->execute([$uid, Temps::depuis(-self::FENETRE_S)]);
        $recents = $st->fetchAll(\PDO::FETCH_COLUMN);
        if (count($recents) < self::RAFALE) {
            return 0;
        }
        $t = \DateTimeImmutable::createFromFormat('Y-m-d H:i:s', (string) $recents[self::RAFALE - 1], new \DateTimeZone('UTC'));
        return $t === false ? 1 : max(1, (int) ceil(self::FENETRE_S - (time() - $t->getTimestamp())));
    }
}
