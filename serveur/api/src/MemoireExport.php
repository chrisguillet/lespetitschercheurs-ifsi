<?php
declare(strict_types=1);

namespace Lpc;

/**
 * Export du mémoire aux normes de la maquette : DOCX (Word) et ODT (OpenDocument, format libre).
 * Un fichier DOCX ou ODT est une archive ZIP de fichiers XML : l'archive est écrite ici sans extension (en mode « stocké »),
 * ce qui évite toute dépendance supplémentaire chez l'hébergeur.
 * Marges : gauche 3 cm, droite 2,5 cm, haut 2,5 cm, bas 3 cm. Times New Roman noir, corps 12, titres 16 et 14, interligne 1,5, justifié.
 */
final class MemoireExport
{
    /** Archive ZIP « stockée » : entrées (chemin => contenu), sans compression. */
    public static function zip(array $fichiers): string
    {
        $corps = '';
        $central = '';
        $decalage = 0;
        $date = 0x0000;   // heure 00:00
        $jour = 0x5D76;   // 2026-11-22 (date DOS fixe)
        foreach ($fichiers as $nom => $contenu) {
            $crc = crc32($contenu) & 0xFFFFFFFF;
            $taille = strlen($contenu);
            $entete = pack('VvvvvvVVVvv', 0x04034b50, 20, 0, 0, $date, $jour, $crc, $taille, $taille, strlen($nom), 0) . $nom;
            $corps .= $entete . $contenu;
            $central .= pack('VvvvvvvVVVvvvvvVV', 0x02014b50, 20, 20, 0, 0, $date, $jour, $crc, $taille, $taille, strlen($nom), 0, 0, 0, 0, 0, $decalage) . $nom;
            $decalage += strlen($entete) + $taille;
        }
        $fin = pack('VvvvvVVv', 0x06054b50, 0, 0, count($fichiers), count($fichiers), strlen($central), $decalage, 0);
        return $corps . $central . $fin;
    }

    private static function x(string $t): string
    {
        return htmlspecialchars($t, ENT_XML1 | ENT_QUOTES, 'UTF-8');
    }

    /** Texte saisi (marques **gras** et *italique*) -> suite de paires [texte, gras, italique]. @return list<array{0:string,1:bool,2:bool}> */
    public static function segments(string $texte): array
    {
        $out = [];
        $parts = preg_split('/(\*\*[^*]+\*\*|\*[^*]+\*)/u', $texte, -1, PREG_SPLIT_DELIM_CAPTURE | PREG_SPLIT_NO_EMPTY) ?: [];
        foreach ($parts as $p) {
            if (str_starts_with($p, '**') && str_ends_with($p, '**') && strlen($p) > 4) {
                $out[] = [substr($p, 2, -2), true, false];
            } elseif (str_starts_with($p, '*') && str_ends_with($p, '*') && strlen($p) > 2) {
                $out[] = [substr($p, 1, -1), false, true];
            } else {
                $out[] = [$p, false, false];
            }
        }
        return $out;
    }

    // ---------- DOCX ----------

    /** Paragraphe Word : style, alignement, retrait, et runs (gras, italique). @param list<array{0:string,1:bool,2:bool}> $segs */
    private static function pDocx(string $style, array $segs, string $jc = 'both', string $extra = ''): string
    {
        $runs = '';
        foreach ($segs as [$t, $g, $i]) {
            $rpr = ($g ? '<w:b/>' : '') . ($i ? '<w:i/>' : '');
            $runs .= '<w:r>' . ($rpr !== '' ? "<w:rPr>$rpr</w:rPr>" : '') . '<w:t xml:space="preserve">' . self::x($t) . '</w:t></w:r>';
        }
        return '<w:p><w:pPr><w:pStyle w:val="' . $style . '"/>' . $extra . '<w:jc w:val="' . $jc . '"/></w:pPr>' . $runs . '</w:p>';
    }

    /**
     * @param array<string,string> $entete titre, ue, referent, auteurs, date, promo, nom_pied
     * @param list<array{type:string,texte:string}> $blocs
     */
    public static function docx(array $entete, array $blocs): string
    {
        $cm = static fn (float $c): int => (int) round($c * 567);   // 1 cm = 567 twips
        $couv = '';
        for ($i = 0; $i < 3; $i++) {
            $couv .= self::pDocx('Normal', [], 'center');
        }
        $couv .= self::pDocx('Couverture', [['INSTITUT DE FORMATION EN SOINS INFIRMIERS', false, false]], 'center');
        $couv .= self::pDocx('Couverture', [['SAINT-NAZAIRE', false, false]], 'center');
        $couv .= self::pDocx('Normal', [], 'center') . self::pDocx('Normal', [], 'center') . self::pDocx('Normal', [], 'center');
        if ($entete['ue'] !== '') {
            $couv .= self::pDocx('Couverture', [[$entete['ue'], false, false]], 'center');
        }
        $couv .= self::pDocx('Couverture', [[mb_strtoupper($entete['titre'] !== '' ? $entete['titre'] : 'TITRE DU TRAVAIL'), true, false]], 'center');
        $couv .= self::pDocx('Normal', [], 'center') . self::pDocx('Normal', [], 'center') . self::pDocx('Normal', [], 'center');
        $couv .= self::pDocx('Couverture', [[$entete['auteurs'] !== '' ? $entete['auteurs'] : 'NOM – Prénom de l’étudiant(e)', false, false]], 'center');
        $couv .= self::pDocx('Couverture', [[$entete['promo'], false, false]], 'center');
        $couv .= self::pDocx('Normal', [], 'center') . self::pDocx('Normal', [], 'center') . self::pDocx('Normal', [], 'center') . self::pDocx('Normal', [], 'center');
        $couv .= self::pDocx('Couverture', [['Référent pédagogique : ' . $entete['referent'], false, false]], 'left');
        $couv .= self::pDocx('Couverture', [['Date : ' . $entete['date'], false, false]], 'left');
        $couv .= '<w:p><w:r><w:br w:type="page"/></w:r></w:p>';

        $corps = '';
        foreach ($blocs as $b) {
            $segs = self::segments($b['texte']);
            $corps .= match ($b['type']) {
                'titre1' => self::pDocx('Titre1', $segs, 'left'),
                'titre2' => self::pDocx('Titre2', $segs, 'left'),
                'citation' => self::pDocx('Citation', $segs),
                'reference' => self::pDocx('Reference', $segs),
                default => self::pDocx('Corps', $segs),
            };
        }
        $sect = '<w:sectPr><w:footerReference w:type="default" r:id="rIdPied"/><w:footerReference w:type="first" r:id="rIdPiedVide"/>'
            . '<w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="' . $cm(2.5) . '" w:right="' . $cm(2.5) . '" w:bottom="' . $cm(3) . '" w:left="' . $cm(3) . '" w:header="709" w:footer="709" w:gutter="0"/><w:titlePg/></w:sectPr>';
        $doc = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            . '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
            . '<w:body>' . $couv . $corps . $sect . '</w:body></w:document>';
        $pied = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:ftr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:p><w:pPr><w:pStyle w:val="Pied"/><w:jc w:val="center"/></w:pPr>'
            . '<w:r><w:t xml:space="preserve">' . self::x($entete['nom_pied']) . ' – Page </w:t></w:r>'
            . '<w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve"> PAGE </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:t>2</w:t></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r></w:p></w:ftr>';
        $piedVide = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:ftr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:p/></w:ftr>';
        $styles = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
            . '<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman" w:cs="Times New Roman"/><w:color w:val="000000"/><w:sz w:val="24"/><w:lang w:val="fr-FR"/></w:rPr></w:rPrDefault>'
            . '<w:pPrDefault><w:pPr><w:spacing w:after="120" w:line="360" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>'
            . '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>'
            . '<w:style w:type="paragraph" w:styleId="Corps"><w:name w:val="Corps de texte"/><w:basedOn w:val="Normal"/><w:pPr><w:ind w:firstLine="709"/><w:jc w:val="both"/></w:pPr></w:style>'
            . '<w:style w:type="paragraph" w:styleId="Titre1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:next w:val="Corps"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="360" w:after="180" w:line="360" w:lineRule="auto"/><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:b/><w:sz w:val="32"/></w:rPr></w:style>'
            . '<w:style w:type="paragraph" w:styleId="Titre2"><w:name w:val="heading 2"/><w:basedOn w:val="Normal"/><w:next w:val="Corps"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="240" w:after="120" w:line="360" w:lineRule="auto"/><w:outlineLvl w:val="1"/></w:pPr><w:rPr><w:b/><w:sz w:val="28"/></w:rPr></w:style>'
            . '<w:style w:type="paragraph" w:styleId="Citation"><w:name w:val="Quote"/><w:basedOn w:val="Normal"/><w:pPr><w:ind w:left="851" w:right="851"/><w:jc w:val="both"/></w:pPr></w:style>'
            . '<w:style w:type="paragraph" w:styleId="Reference"><w:name w:val="Référence"/><w:basedOn w:val="Normal"/><w:pPr><w:ind w:left="709" w:hanging="709"/><w:jc w:val="both"/></w:pPr></w:style>'
            . '<w:style w:type="paragraph" w:styleId="Couverture"><w:name w:val="Couverture"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:line="360" w:lineRule="auto"/></w:pPr><w:rPr><w:sz w:val="28"/></w:rPr></w:style>'
            . '<w:style w:type="paragraph" w:styleId="Pied"><w:name w:val="footer"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:line="240" w:lineRule="auto" w:after="0"/></w:pPr><w:rPr><w:sz w:val="18"/></w:rPr></w:style>'
            . '</w:styles>';
        $rels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
            . '<Relationship Id="rIdStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>'
            . '<Relationship Id="rIdPied" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footer1.xml"/>'
            . '<Relationship Id="rIdPiedVide" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footer2.xml"/></Relationships>';
        $types = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
            . '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>'
            . '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>'
            . '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>'
            . '<Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/>'
            . '<Override PartName="/word/footer2.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/></Types>';
        $racine = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
            . '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>';
        return self::zip([
            '[Content_Types].xml' => $types,
            '_rels/.rels' => $racine,
            'word/document.xml' => $doc,
            'word/_rels/document.xml.rels' => $rels,
            'word/styles.xml' => $styles,
            'word/footer1.xml' => $pied,
            'word/footer2.xml' => $piedVide,
        ]);
    }

    // ---------- ODT ----------

    /** @param list<array{0:string,1:bool,2:bool}> $segs */
    private static function pOdt(string $style, array $segs): string
    {
        $out = '';
        foreach ($segs as [$t, $g, $i]) {
            $s = $g && $i ? 'T-GI' : ($g ? 'T-G' : ($i ? 'T-I' : ''));
            $txt = self::x($t);
            $out .= $s !== '' ? '<text:span text:style-name="' . $s . '">' . $txt . '</text:span>' : $txt;
        }
        return '<text:p text:style-name="' . $style . '">' . $out . '</text:p>';
    }

    /**
     * @param array<string,string> $entete titre, ue, referent, auteurs, date, promo, nom_pied
     * @param list<array{type:string,texte:string}> $blocs
     */
    public static function odt(array $entete, array $blocs): string
    {
        $vide = static fn (): string => '<text:p text:style-name="Couv"/>';
        $couv = '<text:p text:style-name="CouvDebut"/>' . str_repeat($vide(), 2) . self::pOdt('Couv', [[ 'INSTITUT DE FORMATION EN SOINS INFIRMIERS', false, false]]) . self::pOdt('Couv', [['SAINT-NAZAIRE', false, false]])
            . str_repeat($vide(), 3);
        if ($entete['ue'] !== '') {
            $couv .= self::pOdt('Couv', [[$entete['ue'], false, false]]);
        }
        $couv .= self::pOdt('CouvGras', [[$entete['titre'] !== '' ? mb_strtoupper($entete['titre']) : 'TITRE DU TRAVAIL', true, false]]) . str_repeat($vide(), 3)
            . self::pOdt('Couv', [[$entete['auteurs'] !== '' ? $entete['auteurs'] : 'NOM – Prénom de l’étudiant(e)', false, false]])
            . self::pOdt('Couv', [[$entete['promo'], false, false]]) . str_repeat($vide(), 4)
            . self::pOdt('CouvGauche', [['Référent pédagogique : ' . $entete['referent'], false, false]])
            . self::pOdt('CouvGauche', [['Date : ' . $entete['date'], false, false]])
            . '<text:p text:style-name="Saut"/>';
        $corps = '';
        foreach ($blocs as $b) {
            $segs = self::segments($b['texte']);
            $corps .= match ($b['type']) {
                'titre1' => self::pOdt('Titre1', $segs),
                'titre2' => self::pOdt('Titre2', $segs),
                'citation' => self::pOdt('Citation', $segs),
                'reference' => self::pOdt('Reference', $segs),
                default => self::pOdt('Corps', $segs),
            };
        }
        $entete_xml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            . '<office:document-content xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" xmlns:fo="urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0" office:version="1.2">'
            . '<office:automatic-styles>'
            . '<style:style style:name="T-G" style:family="text"><style:text-properties fo:font-weight="bold"/></style:style>'
            . '<style:style style:name="T-I" style:family="text"><style:text-properties fo:font-style="italic"/></style:style>'
            . '<style:style style:name="T-GI" style:family="text"><style:text-properties fo:font-weight="bold" fo:font-style="italic"/></style:style>'
            . '</office:automatic-styles><office:body><office:text>' . $couv . $corps . '</office:text></office:body></office:document-content>';
        $styles = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            . '<office:document-styles xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" xmlns:fo="urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0" office:version="1.2">'
            . '<office:font-face-decls><style:font-face style:name="Times New Roman" svg:font-family="\'Times New Roman\'" xmlns:svg="urn:oasis:names:tc:opendocument:xmlns:svg-compatible:1.0"/></office:font-face-decls>'
            . '<office:styles>'
            . '<style:default-style style:family="paragraph"><style:paragraph-properties fo:line-height="150%" fo:text-align="justify"/><style:text-properties style:font-name="Times New Roman" fo:font-size="12pt" fo:color="#000000" fo:language="fr" fo:country="FR"/></style:default-style>'
            . '<style:style style:name="Corps" style:family="paragraph" style:display-name="Corps de texte"><style:paragraph-properties fo:text-indent="1.25cm" fo:margin-bottom="0.2cm"/></style:style>'
            . '<style:style style:name="Titre1" style:family="paragraph" style:display-name="Titre 1"><style:paragraph-properties fo:text-align="start" fo:margin-top="0.6cm" fo:margin-bottom="0.3cm" fo:keep-with-next="always"/><style:text-properties fo:font-size="16pt" fo:font-weight="bold"/></style:style>'
            . '<style:style style:name="Titre2" style:family="paragraph" style:display-name="Titre 2"><style:paragraph-properties fo:text-align="start" fo:margin-top="0.4cm" fo:margin-bottom="0.2cm" fo:keep-with-next="always"/><style:text-properties fo:font-size="14pt" fo:font-weight="bold"/></style:style>'
            . '<style:style style:name="Citation" style:family="paragraph"><style:paragraph-properties fo:margin-left="1.5cm" fo:margin-right="1.5cm"/></style:style>'
            . '<style:style style:name="Reference" style:family="paragraph"><style:paragraph-properties fo:margin-left="1.25cm" fo:text-indent="-1.25cm"/></style:style>'
            . '<style:style style:name="Couv" style:family="paragraph"><style:paragraph-properties fo:text-align="center" fo:line-height="150%"/><style:text-properties fo:font-size="14pt"/></style:style>'
            . '<style:style style:name="CouvGras" style:family="paragraph"><style:paragraph-properties fo:text-align="center"/><style:text-properties fo:font-size="14pt" fo:font-weight="bold"/></style:style>'
            . '<style:style style:name="CouvGauche" style:family="paragraph"><style:paragraph-properties fo:text-align="start"/></style:style>'
            . '<style:style style:name="CouvDebut" style:family="paragraph" style:master-page-name="Couverture"><style:paragraph-properties fo:text-align="center"/></style:style><style:style style:name="Saut" style:family="paragraph" style:master-page-name="Standard"><style:paragraph-properties fo:break-before="page"/></style:style>'
            . '</office:styles><office:automatic-styles>'
            . '<style:page-layout style:name="PL1"><style:page-layout-properties fo:page-width="21cm" fo:page-height="29.7cm" fo:margin-top="2.5cm" fo:margin-bottom="3cm" fo:margin-left="3cm" fo:margin-right="2.5cm"/>'
            . '<style:header-style/><style:footer-style><style:header-footer-properties fo:min-height="0.5cm" fo:margin-top="0.4cm"/></style:footer-style></style:page-layout>'
            . '</office:automatic-styles><office:master-styles><style:master-page style:name="Couverture" style:page-layout-name="PL1"/><style:master-page style:name="Standard" style:page-layout-name="PL1">'
            . '<style:footer><text:p text:style-name="Pied"><text:span>' . self::x($entete['nom_pied']) . ' – Page </text:span><text:page-number text:select-page="current">2</text:page-number></text:p></style:footer>'
            . '</style:master-page></office:master-styles></office:document-styles>';
        $manifeste = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0" manifest:version="1.2">'
            . '<manifest:file-entry manifest:full-path="/" manifest:media-type="application/vnd.oasis.opendocument.text"/>'
            . '<manifest:file-entry manifest:full-path="content.xml" manifest:media-type="text/xml"/>'
            . '<manifest:file-entry manifest:full-path="styles.xml" manifest:media-type="text/xml"/></manifest:manifest>';
        return self::zip([
            'mimetype' => 'application/vnd.oasis.opendocument.text',
            'META-INF/manifest.xml' => $manifeste,
            'content.xml' => $entete_xml,
            'styles.xml' => $styles,
        ]);
    }
}
