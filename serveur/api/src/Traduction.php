<?php
declare(strict_types=1);

namespace Lpc;

/**
 * Traduction français -> anglais des mots-clés, avec un indice de fiabilité. Les termes courants des sciences infirmières sont
 * traduits par une liste maison (fiabilité « haute »). Les autres passent par un service externe facultatif (DeepL, clé dans
 * config.php sous deepl_cle) : la traduction aller est retraduite en français et comparée au terme d'origine pour juger la fiabilité.
 * Sans service configuré, ces termes reviennent sans traduction, signalés comme tels.
 */
final class Traduction
{
    public const MAX_CARACTERES = 600;
    public const MAX_TERMES = 30;

    /** Clés déjà normalisées (voir Lectures::normaliser). */
    private const GLOSSAIRE = [
        'soins infirmiers' => 'nursing care', 'sciences infirmieres' => 'nursing science', 'science infirmiere' => 'nursing science',
        'relation soignant soigne' => 'nurse-patient relationship', 'relation de soin' => 'care relationship',
        'relation d aide' => 'helping relationship', 'vecu' => 'lived experience', 'patient' => 'patient',
        'etudiant en soins infirmiers' => 'nursing student', 'etudiants en soins infirmiers' => 'nursing students',
        'stage' => 'clinical placement', 'formation initiale' => 'initial training', 'pratique reflexive' => 'reflective practice',
        'raisonnement clinique' => 'clinical reasoning', 'ethique' => 'ethics', 'dignite' => 'dignity', 'empathie' => 'empathy',
        'douleur' => 'pain', 'fin de vie' => 'end of life', 'soins palliatifs' => 'palliative care', 'qualite de vie' => 'quality of life',
        'education therapeutique' => 'therapeutic patient education', 'bientraitance' => 'good care practices',
        'maltraitance' => 'mistreatment', 'burn out' => 'burnout', 'burnout' => 'burnout', 'stress' => 'stress',
        'sante mentale' => 'mental health', 'psychiatrie' => 'psychiatry', 'personne agee' => 'older adult',
        'personnes agees' => 'older adults', 'geriatrie' => 'geriatrics', 'pediatrie' => 'paediatrics', 'autonomie' => 'autonomy',
        'consentement' => 'consent', 'communication' => 'communication', 'humanisation des soins' => 'humanization of care',
        'posture professionnelle' => 'professional stance', 'identite professionnelle' => 'professional identity',
        'competences' => 'competencies', 'tutorat' => 'mentoring', 'hopital' => 'hospital', 'infirmier' => 'nurse',
        'infirmiere' => 'nurse', 'aide soignant' => 'nursing assistant', 'cadre de sante' => 'nurse manager',
        'prevention' => 'prevention', 'promotion de la sante' => 'health promotion', 'sante publique' => 'public health',
        'hygiene' => 'hygiene', 'securite des patients' => 'patient safety', 'erreur medicamenteuse' => 'medication error',
        'charge de travail' => 'workload', 'qualite des soins' => 'quality of care', 'prise en charge' => 'care management',
        'accompagnement' => 'support', 'collaboration interprofessionnelle' => 'interprofessional collaboration',
        'travail en equipe' => 'teamwork', 'sentiment d efficacite personnelle' => 'self-efficacy',
    ];
    private const MOTS_VIDES = ['le', 'la', 'les', 'l', 'un', 'une', 'des', 'de', 'du', 'd', 'et', 'en', 'au', 'aux'];

    /**
     * @param null|callable(list<string>,string,string):list<string> $service traduit une liste de termes (de, vers) ; null = glossaire seul
     * @return list<array{fr:string,en:string,niveau:string,raison:string}>
     */
    public static function traduire(mixed $texte, ?callable $service): array
    {
        $brut = is_scalar($texte) ? (string) $texte : '';
        if (mb_strlen($brut) > self::MAX_CARACTERES) {
            throw new Erreur('invalid', 'Texte trop long pour la traduction');
        }
        $vus = [];
        $termes = [];
        foreach (preg_split('/[,;\n]+/', $brut) ?: [] as $t) {
            $t = trim($t);
            $k = Lectures::normaliser($t);
            if ($t !== '' && $k !== '' && !isset($vus[$k])) {
                $vus[$k] = true;
                $termes[] = $t;
            }
        }
        if ($termes === []) {
            throw new Erreur('invalid', 'Aucun mot-clé à traduire');
        }
        if (count($termes) > self::MAX_TERMES) {
            throw new Erreur('invalid', 'Trop de mots-clés (' . self::MAX_TERMES . ' maximum)');
        }

        $aTraduire = array_values(array_filter($termes, static fn (string $t): bool => !isset(self::GLOSSAIRE[Lectures::normaliser($t)])));
        $aller = [];
        $retour = [];
        if ($aTraduire !== [] && $service !== null) {
            try {
                $aller = $service($aTraduire, 'fr', 'en');
                $retour = $service($aller, 'en', 'fr');
            } catch (\Throwable $e) {
                error_log('Traduction indisponible : ' . $e->getMessage());
                $aller = [];
                $retour = [];
            }
        }
        $parTerme = [];
        foreach ($aTraduire as $i => $t) {
            $parTerme[Lectures::normaliser($t)] = ['en' => trim((string) ($aller[$i] ?? '')), 'fr2' => trim((string) ($retour[$i] ?? ''))];
        }

        $out = [];
        foreach ($termes as $t) {
            $k = Lectures::normaliser($t);
            if (isset(self::GLOSSAIRE[$k])) {
                $out[] = ['fr' => $t, 'en' => self::GLOSSAIRE[$k], 'niveau' => 'haute', 'raison' => 'terme du glossaire de sciences infirmières'];
                continue;
            }
            $r = $parTerme[$k] ?? ['en' => '', 'fr2' => ''];
            if ($r['en'] === '') {
                $out[] = ['fr' => $t, 'en' => '', 'niveau' => 'faible', 'raison' => $service === null
                    ? 'aucun service de traduction configuré : seuls les termes courants du glossaire sont traduits' : 'aucune traduction obtenue'];
                continue;
            }
            if (mb_strtolower($r['en']) === mb_strtolower($t)) {
                $out[] = ['fr' => $t, 'en' => $r['en'], 'niveau' => 'moyenne', 'raison' => 'identique au français (sigle, nom propre ou emprunt ?)'];
                continue;
            }
            $sim = self::similitude($t, $r['fr2']);
            if ($sim >= 0.99) {
                $out[] = ['fr' => $t, 'en' => $r['en'], 'niveau' => 'haute', 'raison' => 'la retraduction en français redonne le même terme'];
            } elseif ($sim >= 0.5) {
                $out[] = ['fr' => $t, 'en' => $r['en'], 'niveau' => 'moyenne', 'raison' => 'retraduction proche (« ' . $r['fr2'] . ' ») : vérifier le sens'];
            } else {
                $out[] = ['fr' => $t, 'en' => $r['en'], 'niveau' => 'faible', 'raison' => 'la retraduction (« ' . $r['fr2'] . ' ») s’écarte du terme : à vérifier'];
            }
        }
        return $out;
    }

    /**
     * Service DeepL (offre gratuite ou payante, selon l'adresse). @return callable(list<string>,string,string):list<string>
     */
    public static function deepl(string $cle, string $url = 'https://api-free.deepl.com/v2/translate'): callable
    {
        return static function (array $termes, string $de, string $vers) use ($cle, $url): array {
            $corps = 'source_lang=' . strtoupper($de) . '&target_lang=' . (strtoupper($vers) === 'EN' ? 'EN-GB' : strtoupper($vers));
            foreach ($termes as $t) {
                $corps .= '&text=' . rawurlencode($t);
            }
            $ch = curl_init($url);
            curl_setopt_array($ch, [
                CURLOPT_POST => true, CURLOPT_POSTFIELDS => $corps, CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 10, CURLOPT_CONNECTTIMEOUT => 3,
                CURLOPT_HTTPHEADER => ['Authorization: DeepL-Auth-Key ' . $cle, 'Content-Type: application/x-www-form-urlencoded'],
            ]);
            $rep = curl_exec($ch);
            $code = (int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
            if (!is_string($rep) || $code !== 200) {
                throw new \RuntimeException('DeepL : réponse ' . $code);
            }
            $json = json_decode($rep, true);
            $tr = is_array($json['translations'] ?? null) ? array_map(static fn (array $x): string => (string) ($x['text'] ?? ''), $json['translations']) : [];
            if (count($tr) !== count($termes)) {
                throw new \RuntimeException('DeepL : nombre de traductions inattendu');
            }
            return $tr;
        };
    }

    /** Proximité de deux termes (1 = mêmes mots, à l'accord et aux mots vides près). */
    private static function similitude(string $a, string $b): float
    {
        $x = self::jetons($a);
        $y = self::jetons($b);
        if ($x === [] || $y === []) {
            return 0.0;
        }
        $communs = count(array_filter($x, static fn (string $m): bool => in_array($m, $y, true)));
        return $communs / (count($x) + count($y) - $communs);
    }

    /** @return list<string> */
    private static function jetons(string $t): array
    {
        $out = [];
        foreach (explode(' ', Lectures::normaliser($t)) as $m) {
            if ($m !== '' && !in_array($m, self::MOTS_VIDES, true)) {
                $out[] = mb_strlen($m) > 3 ? (string) preg_replace('/(s|x)$/', '', $m) : $m;
            }
        }
        return $out;
    }
}
