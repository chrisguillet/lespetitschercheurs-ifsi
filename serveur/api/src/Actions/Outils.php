<?php
declare(strict_types=1);

namespace Lpc\Actions;

use Lpc\Chat;
use Lpc\Contexte;
use Lpc\Donnees;
use Lpc\Feedback;
use Lpc\Fichiers;
use Lpc\Lectures;
use Lpc\Notes;
use Lpc\Suivi;
use Lpc\SuiviPieces;
use Lpc\SuiviTaches;
use Lpc\Traduction;

/** Outils du groupe et de la personne : suivi de projet, glossaire, pièces jointes, notes, retours, chat, traduction. */
final class Outils
{
    // ---------- Suivi de projet et glossaire ----------

    /** Pièce jointe d'un compte rendu (5 au plus, images réduites). @param array<string,mixed> $req @return array<string,mixed> */
    public static function reunionFichierAjouter(Contexte $c, array $req): array
    {
        SuiviPieces::ajouter($c, self::texte($req['reunion_id'] ?? null), $req['nom'] ?? null, $req['contenu'] ?? null);
        return ['ok' => true] + Donnees::choisies($c, ['reunions']);
    }

    /** @param array<string,mixed> $req @return array<string,mixed> */
    public static function reunionFichierLire(Contexte $c, array $req): array
    {
        return ['ok' => true] + SuiviPieces::lire($c, self::texte($req['id'] ?? null));
    }

    /** @param array<string,mixed> $req @return array<string,mixed> */
    public static function reunionFichierSupprimer(Contexte $c, array $req): array
    {
        SuiviPieces::supprimer($c, self::texte($req['id'] ?? null));
        return ['ok' => true] + Donnees::choisies($c, ['reunions']);
    }

    /** Tâche d'un compte rendu. @param array<string,mixed> $req @return array<string,mixed> */
    public static function tacheSave(Contexte $c, array $req): array
    {
        SuiviTaches::enregistrerTache($c, self::texte($req['reunion_id'] ?? null), $req['id'] ?? null, $req['data'] ?? null);
        return ['ok' => true] + Donnees::choisies($c, ['reunions']);
    }

    /** @param array<string,mixed> $req @return array<string,mixed> */
    public static function tacheDelete(Contexte $c, array $req): array
    {
        SuiviTaches::supprimerTache($c, $req['id'] ?? null);
        return ['ok' => true] + Donnees::choisies($c, ['reunions']);
    }

    /** Lien posé sur une tâche (tache_id) ou directement sur le compte rendu. @param array<string,mixed> $req @return array<string,mixed> */
    public static function lienSave(Contexte $c, array $req): array
    {
        SuiviTaches::enregistrerLien($c, self::texte($req['reunion_id'] ?? null), $req['tache_id'] ?? null, $req['id'] ?? null, $req['data'] ?? null);
        return ['ok' => true] + Donnees::choisies($c, ['reunions']);
    }

    /** @param array<string,mixed> $req @return array<string,mixed> */
    public static function lienDelete(Contexte $c, array $req): array
    {
        SuiviTaches::supprimerLien($c, $req['id'] ?? null);
        return ['ok' => true] + Donnees::choisies($c, ['reunions']);
    }

    /** @param array<string,mixed> $req @return array<string,mixed> */
    public static function reunionSave(Contexte $c, array $req): array
    {
        return self::sauver($c, 'reunion', $req, ['reunions', 'jalons']);
    }

    /** @param array<string,mixed> $req @return array<string,mixed> */
    public static function reunionDelete(Contexte $c, array $req): array
    {
        return self::retirer($c, 'reunion', $req, ['reunions', 'jalons']);
    }

    /** @param array<string,mixed> $req @return array<string,mixed> */
    public static function jalonSave(Contexte $c, array $req): array
    {
        return self::sauver($c, 'jalon', $req, ['reunions', 'jalons']);
    }

    /** @param array<string,mixed> $req @return array<string,mixed> */
    public static function jalonDelete(Contexte $c, array $req): array
    {
        return self::retirer($c, 'jalon', $req, ['reunions', 'jalons']);
    }

    /** @param array<string,mixed> $req @return array<string,mixed> */
    public static function termeSave(Contexte $c, array $req): array
    {
        return self::sauver($c, 'terme', $req, ['termes']);
    }

    /** @param array<string,mixed> $req @return array<string,mixed> */
    public static function termeDelete(Contexte $c, array $req): array
    {
        return self::retirer($c, 'terme', $req, ['termes']);
    }

    // ---------- Pièces jointes ----------

    /** @param array<string,mixed> $req @return array<string,mixed> */
    public static function fileAdd(Contexte $c, array $req): array
    {
        Fichiers::ajouter($c, self::texte($req['article_id'] ?? null), $req['nom'] ?? null, $req['data'] ?? null);
        return ['ok' => true] + Donnees::choisies($c, ['fichiers']);
    }

    /** @param array<string,mixed> $req @return array<string,mixed> */
    public static function fileGet(Contexte $c, array $req): array
    {
        return ['ok' => true] + Fichiers::lire($c, self::texte($req['id'] ?? null));
    }

    /** @param array<string,mixed> $req @return array<string,mixed> */
    public static function fileDelete(Contexte $c, array $req): array
    {
        Fichiers::supprimer($c, self::texte($req['id'] ?? null));
        return ['ok' => true] + Donnees::choisies($c, ['fichiers']);
    }

    // ---------- Notes personnelles ----------

    /** @param array<string,mixed> $req @return array<string,mixed> */
    public static function notesList(Contexte $c, array $req): array
    {
        return ['ok' => true, 'notes' => Notes::de($c)];
    }

    /** @param array<string,mixed> $req @return array<string,mixed> */
    public static function noteSave(Contexte $c, array $req): array
    {
        Notes::enregistrer($c, $req['data'] ?? null);
        return ['ok' => true, 'notes' => Notes::de($c)];
    }

    /** @param array<string,mixed> $req @return array<string,mixed> */
    public static function noteDelete(Contexte $c, array $req): array
    {
        Notes::supprimer($c, self::texte($req['id'] ?? null));
        return ['ok' => true, 'notes' => Notes::de($c)];
    }

    // ---------- Retours sur l'outil ----------

    /** @param array<string,mixed> $req @return array<string,mixed> */
    public static function feedbackList(Contexte $c, array $req): array
    {
        return ['ok' => true] + Feedback::pourClient($c);
    }

    /** @param array<string,mixed> $req @return array<string,mixed> */
    public static function feedbackSave(Contexte $c, array $req): array
    {
        Feedback::enregistrer($c, $req['id'] ?? null, $req['data'] ?? null);
        return ['ok' => true] + Feedback::pourClient($c);
    }

    /** Statut de suivi d'un retour (administrateur général). @param array<string,mixed> $req @return array<string,mixed> */
    public static function feedbackStatut(Contexte $c, array $req): array
    {
        $data = \Lpc\Valide::donnees($req);
        return ['ok' => true, 'feedbacks' => Feedback::changerStatut($c, $data['id'] ?? null, $data['statut'] ?? null)];
    }

    // ---------- Chat ----------

    /** @param array<string,mixed> $req @return array<string,mixed> */
    public static function chatList(Contexte $c, array $req): array
    {
        return Chat::lister($c, $req);
    }

    /** @param array<string,mixed> $req @return array<string,mixed> */
    public static function chatSend(Contexte $c, array $req): array
    {
        Chat::envoyer($c, $req);
        return Chat::lister($c, $req);
    }

    /** @param array<string,mixed> $req @return array<string,mixed> */
    public static function chatDelete(Contexte $c, array $req): array
    {
        Chat::supprimer($c, self::texte($req['id'] ?? null));
        return Chat::lister($c, $req);
    }

    // ---------- Traduction ----------

    /** @param array<string,mixed> $req @return array<string,mixed> */
    public static function translate(Contexte $c, array $req): array
    {
        Lectures::exigerEtudiant($c);
        $cle = $c->config->get('deepl_cle');
        $service = is_string($cle) && $cle !== '' ? Traduction::deepl($cle, (string) $c->config->get('deepl_url', 'https://api-free.deepl.com/v2/translate')) : null;
        $limite = (int) $c->config->get('deepl_limite', 45000);   // caractères par mois envoyés au service (marge sous le quota réel)
        $r = Traduction::traduireAvecDictionnaire($req['texte'] ?? null, $service, $c->db->principale(), $limite);
        $rep = ['ok' => true, 'items' => $r['items'], 'quota' => $r['quota']];
        if ($r['quota']) {
            $rep['avertissement'] = 'Le traducteur automatique est limité pour ce mois : les termes déjà connus sont traduits, les autres sont à saisir à la main. Il reprendra le mois prochain.';
        }
        return $rep;
    }

    /** Règles d'activation du chat visibles de la personne (administrateurs). @param array<string,mixed> $req @return array<string,mixed> */
    public static function chatRegles(Contexte $c, array $req): array
    {
        return ['ok' => true, 'regles' => \Lpc\ChatRegles::pourAdmin($c)];
    }

    /** Meilleurs scores de la personne aux mini-jeux. @param array<string,mixed> $req @return array<string,mixed> */
    public static function jeuxScores(Contexte $c, array $req): array
    {
        return ['ok' => true, 'scores' => \Lpc\Jeux::pourClient($c)];
    }

    /** Enregistre un score s'il bat le meilleur. @param array<string,mixed> $req @return array<string,mixed> */
    public static function jeuScore(Contexte $c, array $req): array
    {
        \Lpc\Jeux::enregistrer($c, $req['data'] ?? null);
        return ['ok' => true, 'scores' => \Lpc\Jeux::pourClient($c)];
    }

    /** Comptes de test du bac à sable (administrateur général). @param array<string,mixed> $req @return array<string,mixed> */
    public static function bacSableEtat(Contexte $c, array $req): array
    {
        return ['ok' => true] + \Lpc\BacASable::etat($c);
    }

    /** Recrée le bac à sable : comptes de test, structure et données d'exemple. @param array<string,mixed> $req @return array<string,mixed> */
    public static function bacSableReinit(Contexte $c, array $req): array
    {
        \Lpc\BacASable::reinitialiser($c);
        $pdo = $c->db->principale();
        $pdo->prepare('INSERT INTO journal_admin (acteur_id, action, cible, detail, cree_le) VALUES (?, ?, ?, ?, ?)')
            ->execute([$c->user->id, 'bac_sable_reinit', 'bac_a_sable', '', \Lpc\Temps::maintenant()]);
        return ['ok' => true] + \Lpc\BacASable::etat($c);
    }

    /** Mémoire du groupe. @param array<string,mixed> $req @return array<string,mixed> */
    public static function memoireGet(Contexte $c, array $req): array
    {
        return ['ok' => true, 'memoire' => \Lpc\Memoire::pourclient($c, is_string($req['groupe_id'] ?? null) ? $req['groupe_id'] : '')];
    }

    /** modifie l'en-tête du mémoire. @param array<string,mixed> $req @return array<string,mixed> */
    public static function memoireentete(Contexte $c, array $req): array
    {
        $gid = is_string($req['groupe_id'] ?? null) ? $req['groupe_id'] : '';
        \Lpc\Memoire::enregistrerentete($c, $gid, $req['data'] ?? null);
        return ['ok' => true, 'memoire' => \Lpc\Memoire::pourclient($c, $gid)];
    }

    /** ajoute ou modifie un bloc du mémoire. @param array<string,mixed> $req @return array<string,mixed> */
    public static function memoirebloc(Contexte $c, array $req): array
    {
        $gid = is_string($req['groupe_id'] ?? null) ? $req['groupe_id'] : '';
        \Lpc\Memoire::enregistrerbloc($c, $gid, $req['id'] ?? null, $req['data'] ?? null);
        return ['ok' => true, 'memoire' => \Lpc\Memoire::pourclient($c, $gid)];
    }

    /** supprime un bloc du mémoire. @param array<string,mixed> $req @return array<string,mixed> */
    public static function memoireblocsupprimer(Contexte $c, array $req): array
    {
        $gid = is_string($req['groupe_id'] ?? null) ? $req['groupe_id'] : '';
        \Lpc\Memoire::supprimerbloc($c, $gid, $req['id'] ?? null);
        return ['ok' => true, 'memoire' => \Lpc\Memoire::pourclient($c, $gid)];
    }

    /** nouvel ordre des blocs. @param array<string,mixed> $req @return array<string,mixed> */
    public static function memoireordre(Contexte $c, array $req): array
    {
        $gid = is_string($req['groupe_id'] ?? null) ? $req['groupe_id'] : '';
        \Lpc\Memoire::reordonner($c, $gid, $req['ids'] ?? null);
        return ['ok' => true, 'memoire' => \Lpc\Memoire::pourclient($c, $gid)];
    }

    /** Export du mémoire en DOCX ou ODT. @param array<string,mixed> $req @return array<string,mixed> */
    public static function memoireExport(Contexte $c, array $req): array
    {
        $gid = is_string($req['groupe_id'] ?? null) ? $req['groupe_id'] : '';
        $format = is_string($req['format'] ?? null) ? $req['format'] : '';
        return ['ok' => true] + \Lpc\Memoire::exporter($c, $gid, $format);
    }

    /** propose (ou modifie) une lecture à une promo : formateurs et administrateurs. @param array<string,mixed> $req @return array<string,mixed> */
    public static function suggestionSave(Contexte $c, array $req): array
    {
        \Lpc\Suggestions::enregistrer($c, $req['id'] ?? null, $req['data'] ?? null);
        return ['ok' => true] + Donnees::choisies($c, ['suggestions']);
    }

    /** @param array<string,mixed> $req @return array<string,mixed> */
    public static function suggestionDelete(Contexte $c, array $req): array
    {
        \Lpc\Suggestions::supprimer($c, $req['id'] ?? null);
        return ['ok' => true] + Donnees::choisies($c, ['suggestions']);
    }

    /** La personne a ouvert ces suggestions (l'alerte s'efface pour elle). @param array<string,mixed> $req @return array<string,mixed> */
    public static function suggestionVues(Contexte $c, array $req): array
    {
        \Lpc\Suggestions::marquerVues($c, $req['ids'] ?? null);
        return ['ok' => true] + Donnees::choisies($c, ['suggestions']);
    }

    /** Fixe une règle d'activation du chat : portée general, promo ou groupe ; valeur actif, inactif ou herite. @param array<string,mixed> $req @return array<string,mixed> */
    public static function chatRegleSet(Contexte $c, array $req): array
    {
        $d = \Lpc\Valide::donnees($req);
        \Lpc\ChatRegles::definir($c, (string) ($d['portee'] ?? ''), (string) ($d['cible'] ?? ''), (string) ($d['valeur'] ?? ''));
        return ['ok' => true, 'regles' => \Lpc\ChatRegles::pourAdmin($c)] + Donnees::toutes($c);
    }

    /** Doublons d'articles (administrateurs). @param array<string,mixed> $req @return array<string,mixed> */
    public static function doublonsList(Contexte $c, array $req): array
    {
        return ['ok' => true, 'clusters' => \Lpc\Doublons::grappes($c)];
    }

    /** Fusion de doublons dans un article principal. @param array<string,mixed> $req @return array<string,mixed> */
    public static function articleMerge(Contexte $c, array $req): array
    {
        $d = \Lpc\Valide::donnees($req);
        $bilan = \Lpc\Doublons::fusionner($c, (string) ($d['principal'] ?? ''), is_array($d['doublons'] ?? null) ? $d['doublons'] : []);
        return ['ok' => true, 'bilan' => $bilan, 'clusters' => \Lpc\Doublons::grappes($c)];
    }

    /** « Ce ne sont pas des doublons ». @param array<string,mixed> $req @return array<string,mixed> */
    public static function doublonsIgnore(Contexte $c, array $req): array
    {
        $d = \Lpc\Valide::donnees($req);
        \Lpc\Doublons::ignorer($c, is_array($d['ids'] ?? null) ? $d['ids'] : []);
        return ['ok' => true, 'clusters' => \Lpc\Doublons::grappes($c)];
    }

    /** Préremplissage d'une fiche par DOI (Crossref, interrogé depuis le serveur). @param array<string,mixed> $req @return array<string,mixed> */
    public static function doiLookup(Contexte $c, array $req): array
    {
        if (\Lpc\Suggestions::promosOuProposer($c) === []) {   // étudiantes pour leurs fiches, formateurs et administrateurs pour leurs suggestions
            Lectures::exigerEtudiant($c);
        }
        return ['ok' => true, 'champs' => \Lpc\Doi::chercher(is_scalar($req['doi'] ?? null) ? (string) $req['doi'] : ''), 'source' => 'Crossref'];
    }

    // ---------- Interne ----------

    /**
     * @param array<string,mixed> $req
     * @param list<string> $sections
     * @return array<string,mixed>
     */
    private static function sauver(Contexte $c, string $type, array $req, array $sections): array
    {
        Suivi::enregistrer($c, $type, $req['groupe_id'] ?? null, $req['id'] ?? null, $req['data'] ?? null);
        return ['ok' => true] + Donnees::choisies($c, $sections);
    }

    /**
     * @param array<string,mixed> $req
     * @param list<string> $sections
     * @return array<string,mixed>
     */
    private static function retirer(Contexte $c, string $type, array $req, array $sections): array
    {
        Suivi::supprimer($c, $type, self::texte($req['id'] ?? null));
        return ['ok' => true] + Donnees::choisies($c, $sections);
    }

    private static function texte(mixed $v): string
    {
        return is_string($v) ? $v : (is_int($v) ? (string) $v : '');
    }
}
