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
use Lpc\Traduction;

/** Outils du groupe et de la personne : suivi de projet, glossaire, pièces jointes, notes, retours, chat, traduction. */
final class Outils
{
    // ---------- Suivi de projet et glossaire ----------

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
        return ['ok' => true, 'items' => Traduction::traduire($req['texte'] ?? null, $service)];
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
