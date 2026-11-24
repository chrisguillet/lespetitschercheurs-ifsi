<?php
declare(strict_types=1);

namespace Lpc;

/**
 * « Quelqu'un est en train d'écrire » sur un compte rendu de réunion. Le client signale sa saisie pendant qu'on tape et reçoit,
 * dans la même réponse, le prénom des autres membres du groupe qui saisissent sur le même compte rendu. Les signaux n'ont de valeur
 * que quelques secondes (base du chat, rien n'est conservé au-delà).
 */
final class Saisie
{
    public const VALIDITE_S = 8;
    private const PURGE_S = 120;

    /**
     * @param array<string,mixed> $req groupe_id, cible (id du compte rendu, ou « nouveau »), ecrit (vrai tant que la personne tape)
     * @return array<string,mixed>
     */
    public static function signaler(Contexte $c, array $req): array
    {
        Lectures::exigerEtudiant($c);
        $gid = is_string($req['groupe_id'] ?? null) ? $req['groupe_id'] : '';
        $objet = is_string($req['cible'] ?? null) ? $req['cible'] : '';
        $uid = (int) $c->user->id;
        if ($gid === '' || preg_match('/^[A-Za-z0-9-]{1,36}$/', $objet) !== 1 || !Membres::estMembre($c->db->principale(), $gid, $uid)) {
            throw new Erreur('forbidden', 'Vous ne faites pas partie de ce groupe');
        }
        $cible = $gid . ':' . $objet;
        $chat = $c->db->chat();
        $now = Temps::maintenant();
        if (($req['ecrit'] ?? false) === true) {
            $st = $chat->prepare('UPDATE saisies SET vu_le = ? WHERE utilisateur_id = ? AND cible = ?');
            $st->execute([$now, $uid, $cible]);
            if ($st->rowCount() === 0) {
                $chat->prepare('INSERT IGNORE INTO saisies (utilisateur_id, cible, vu_le) VALUES (?, ?, ?)')->execute([$uid, $cible, $now]);
            }
            $chat->prepare('DELETE FROM saisies WHERE vu_le < ?')->execute([gmdate('Y-m-d H:i:s', time() - self::PURGE_S)]);
        } else {
            $chat->prepare('DELETE FROM saisies WHERE utilisateur_id = ? AND cible = ?')->execute([$uid, $cible]);
        }
        $st = $chat->prepare('SELECT utilisateur_id FROM saisies WHERE cible = ? AND utilisateur_id <> ? AND vu_le >= ?');
        $st->execute([$cible, $uid, gmdate('Y-m-d H:i:s', time() - self::VALIDITE_S)]);
        $ids = array_map('intval', $st->fetchAll(\PDO::FETCH_COLUMN));
        $noms = [];
        if ($ids !== []) {
            $s = $c->db->principale()->prepare('SELECT prenom, nom, pseudo FROM utilisateurs WHERE id IN (' . Lectures::marques(count($ids)) . ') ORDER BY prenom');
            $s->execute($ids);
            foreach ($s->fetchAll() as $u) {
                $noms[] = Membres::affiche($u);
            }
        }
        return ['ok' => true, 'ecrivent' => $noms];
    }
}
