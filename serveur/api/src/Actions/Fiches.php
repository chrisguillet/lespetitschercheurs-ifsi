<?php
declare(strict_types=1);

namespace Lpc\Actions;

use Lpc\Commentaires;
use Lpc\Contexte;
use Lpc\Donnees;
use Lpc\Lectures;

/**
 * Fiches de lecture, articles, propositions de correction, historique et commentaires.
 * Les réponses ne renvoient que les sections touchées (marquées « partiel »), comme l'ancien serveur.
 */
final class Fiches
{
    private const SEC_LECTURES = ['lectures', 'propositions'];
    private const SEC_COMMENTAIRES = ['commentaires', 'lus'];
    private const SEC_SUPPRESSION = ['lectures', 'propositions', 'commentaires', 'lus', 'fichiers'];

    /** @param array<string,mixed> $req @return array<string,mixed> */
    public static function add(Contexte $c, array $req): array
    {
        $id = Lectures::ajouter($c, $req['data'] ?? null);
        return ['ok' => true, 'id' => $id] + Donnees::choisies($c, self::SEC_LECTURES);
    }

    /** @param array<string,mixed> $req @return array<string,mixed> */
    public static function update(Contexte $c, array $req): array
    {
        Lectures::modifier($c, self::texte($req['id'] ?? null), $req['data'] ?? null);
        return ['ok' => true] + Donnees::choisies($c, self::SEC_LECTURES);
    }

    /** @param array<string,mixed> $req @return array<string,mixed> */
    public static function articleUpdate(Contexte $c, array $req): array
    {
        Lectures::modifierArticle($c, self::texte($req['article_id'] ?? null), $req['data'] ?? null);
        return ['ok' => true] + Donnees::choisies($c, self::SEC_LECTURES);
    }

    /** @param array<string,mixed> $req @return array<string,mixed> */
    public static function delete(Contexte $c, array $req): array
    {
        Lectures::supprimer($c, self::texte($req['id'] ?? null));
        return ['ok' => true] + Donnees::choisies($c, self::SEC_SUPPRESSION);
    }

    /** @param array<string,mixed> $req @return array<string,mixed> */
    public static function historyGet(Contexte $c, array $req): array
    {
        return ['ok' => true, 'historique' => Lectures::historique($c, self::texte($req['kind'] ?? null), self::texte($req['id'] ?? null))];
    }

    /** @param array<string,mixed> $req @return array<string,mixed> */
    public static function articleVote(Contexte $c, array $req): array
    {
        Lectures::voter($c, self::texte($req['id'] ?? null), ($req['vote'] ?? null) === true);
        return ['ok' => true] + Donnees::choisies($c, self::SEC_LECTURES);
    }

    /** @param array<string,mixed> $req @return array<string,mixed> */
    public static function articleCancel(Contexte $c, array $req): array
    {
        Lectures::annulerProposition($c, self::texte($req['id'] ?? null));
        return ['ok' => true] + Donnees::choisies($c, self::SEC_LECTURES);
    }

    /** @param array<string,mixed> $req @return array<string,mixed> */
    public static function commentAdd(Contexte $c, array $req): array
    {
        $id = Commentaires::ajouter($c, self::texte($req['lecture_id'] ?? null), $req['texte'] ?? null, $req['portee'] ?? null);
        return ['ok' => true, 'id' => $id] + Donnees::choisies($c, self::SEC_COMMENTAIRES);
    }

    /** @param array<string,mixed> $req @return array<string,mixed> */
    public static function commentUpdate(Contexte $c, array $req): array
    {
        Commentaires::modifier($c, self::texte($req['id'] ?? null), $req['texte'] ?? null);
        return ['ok' => true] + Donnees::choisies($c, self::SEC_COMMENTAIRES);
    }

    /** @param array<string,mixed> $req @return array<string,mixed> */
    public static function commentDelete(Contexte $c, array $req): array
    {
        Commentaires::supprimer($c, self::texte($req['id'] ?? null));
        return ['ok' => true] + Donnees::choisies($c, self::SEC_COMMENTAIRES);
    }

    /** @param array<string,mixed> $req @return array<string,mixed> */
    public static function commentsRead(Contexte $c, array $req): array
    {
        Commentaires::marquerLus($c, $req['ids'] ?? null, ($req['tous'] ?? null) === true);
        return ['ok' => true] + Donnees::choisies($c, self::SEC_COMMENTAIRES);
    }

    /** @param array<string,mixed> $req @return array<string,mixed> */
    public static function commentsUnread(Contexte $c, array $req): array
    {
        Commentaires::marquerNonLus($c, $req['ids'] ?? null);
        return ['ok' => true] + Donnees::choisies($c, self::SEC_COMMENTAIRES);
    }

    private static function texte(mixed $v): string
    {
        return is_string($v) ? $v : (is_int($v) ? (string) $v : '');
    }
}
