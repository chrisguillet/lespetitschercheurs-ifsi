<?php
declare(strict_types=1);

namespace Lpc;

/**
 * Préremplissage d'une fiche à partir d'un DOI, grâce à l'API publique de Crossref.
 * La requête part du serveur : le navigateur de la personne n'est pas en contact avec Crossref, et seul le DOI est transmis
 * (ni adresse, ni nom, ni contenu de fiche).
 */
final class Doi
{
    private const AGENT = 'LesPetitsChercheurs/1.0 (+https://lespetitschercheurs.qocot.eu)';
    private const AUTEURS_MAX = 30;

    /** « https://doi.org/10.1000/xyz », « doi:10.1000/xyz » ou « 10.1000/xyz » => « 10.1000/xyz » ; null si ce n'est pas un DOI. */
    public static function normaliser(string $saisie): ?string
    {
        $d = trim($saisie);
        $d = (string) preg_replace('#^(?:https?://(?:dx\.)?doi\.org/|doi:\s*)#i', '', $d);
        $d = rawurldecode(trim($d));
        $d = rtrim($d, " .,;)");
        return preg_match('#^10\.\d{4,9}/[^\s<>"]{1,200}$#', $d) === 1 ? $d : null;
    }

    /**
     * Interroge Crossref. $http : (méthode, url, en-têtes, corps) => {code, corps}, remplaçable dans les tests.
     *
     * @param null|callable(string,string,array<int,string>,?string):array{code:int,corps:string} $http
     * @return array<string,string> champs prêts pour la fiche
     */
    public static function chercher(string $saisie, ?callable $http = null): array
    {
        $doi = self::normaliser($saisie);
        if ($doi === null) {
            throw new Erreur('invalid', 'Ce n’est pas un DOI (forme attendue : 10.1016/j.exemple.2020.01.001 ou lien doi.org)');
        }
        $http ??= [GoogleApi::class, 'requete'];
        try {
            $rep = $http('GET', 'https://api.crossref.org/works/' . rawurlencode($doi), ['User-Agent: ' . self::AGENT, 'Accept: application/json'], null);
        } catch (\Throwable) {
            throw new Erreur('server', 'Crossref est injoignable pour le moment : saisissez la fiche à la main ou réessayez plus tard');
        }
        if ($rep['code'] === 404) {
            throw new Erreur('not_found', 'DOI introuvable chez Crossref : vérifiez-le (certains documents n’ont pas de DOI)');
        }
        if ($rep['code'] !== 200) {
            throw new Erreur('server', 'Crossref est injoignable pour le moment : saisissez la fiche à la main ou réessayez plus tard');
        }
        $j = json_decode($rep['corps'], true);
        if (!is_array($j) || !isset($j['message']) || !is_array($j['message'])) {
            throw new Erreur('server', 'Réponse de Crossref illisible');
        }
        return self::depuisCrossref($j['message'], $doi);
    }

    /**
     * Champs de la fiche d'après une notice Crossref. La qualité et la nationalité de l'auteur ne sont pas connues de Crossref :
     * elles restent à saisir.
     *
     * @param array<string,mixed> $m
     * @return array<string,string>
     */
    public static function depuisCrossref(array $m, string $doi): array
    {
        $texte = static fn (mixed $v): string => trim((string) preg_replace('/\s+/u', ' ', html_entity_decode(strip_tags((string) (is_array($v) ? ($v[0] ?? '') : $v)), ENT_QUOTES | ENT_HTML5, 'UTF-8')));
        $titre = $texte($m['title'] ?? '');
        if (!empty($m['subtitle']) && is_array($m['subtitle']) && $texte($m['subtitle']) !== '' && !str_contains($titre, $texte($m['subtitle']))) {
            $titre .= ' : ' . $texte($m['subtitle']);
        }
        $auteurs = [];
        foreach (is_array($m['author'] ?? null) ? $m['author'] : [] as $a) {
            if (!is_array($a)) {
                continue;
            }
            $nom = trim((string) ($a['family'] ?? $a['name'] ?? ''));
            $pre = trim((string) ($a['given'] ?? ''));
            if ($nom !== '') {
                $auteurs[] = $pre === '' ? $nom : $nom . ', ' . $pre;
            }
            if (count($auteurs) >= self::AUTEURS_MAX) {
                break;
            }
        }
        $annee = '';
        foreach (['issued', 'published-print', 'published-online', 'created'] as $cle) {
            $p = $m[$cle]['date-parts'][0][0] ?? null;
            if (is_int($p) && $p > 1000) {
                $annee = (string) $p;
                break;
            }
        }
        $type = match ((string) ($m['type'] ?? '')) {
            'journal-article' => 'Article scientifique',
            'dissertation' => 'Thèse / mémoire',
            default => 'Autre',
        };
        $champs = [
            'titre' => $titre,
            'auteur' => implode(' ; ', $auteurs),
            'parution' => $annee,
            'source' => $texte($m['container-title'] ?? ($m['publisher'] ?? '')),
            'volume' => $texte($m['volume'] ?? ''),
            'numero' => $texte($m['issue'] ?? ''),
            'pages' => $texte($m['page'] ?? ''),
            'doi' => $doi,
            'type' => $type,
        ];
        $largeurs = ['titre' => 500, 'source' => 500, 'volume' => 40, 'numero' => 40, 'pages' => 40];
        foreach ($largeurs as $k => $max) {
            $champs[$k] = mb_substr($champs[$k], 0, $max);
        }
        return array_filter($champs, static fn (string $v): bool => $v !== '');
    }
}
