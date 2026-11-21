"use strict";
/*
 * Construction d'une référence APA (7e éd.) à partir des champs de la fiche : auteur(s), date de parution,
 * titre et type. La revue, le volume, les pages et le DOI ne sont pas saisis dans l'application : pour les
 * articles, la référence est donc partielle et marquée « incomplet ».
 * Fonctions pures, utilisables dans le navigateur (window.LydiaApa) et dans les tests Node.
 */
(function (root) {
  const PARTICULES = new Set(["de", "du", "des", "la", "le", "les", "van", "von", "der", "den", "di", "da", "dos", "el", "al"]);
  const MOTS_ORGA = /(^|\s)(haute|haut|autorité|ministère|organisation|association|société|fédération|institut|agence|conseil|ordre|commission|université|centre|direction|collège|syndicat|observatoire)(\s|$)/i;
  const MAJ = "A-ZÀ-ÖØ-Ý";
  const RE_INITIALES = new RegExp("^[" + MAJ + "]\\.?(-?[" + MAJ + "]\\.?)*$");
  const TYPES_ARTICLE = ["Article scientifique", "Article de recherche", "Revue de littérature", "Article professionnel"];
  const TYPES_ITALIQUE = ["Thèse / mémoire", "Rapport / recommandation HAS", "Autre"];

  const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const maj1 = m => m.charAt(0).toUpperCase() + m.slice(1).toLowerCase();

  // « DUPONT » -> « Dupont », « MARTIN-DUPONT » -> « Martin-Dupont » ; la casse mixte est conservée.
  function casse(nom) {
    if (nom.length < 2 || nom !== nom.toUpperCase()) return nom;
    return nom.split(" ").map(w => w.split("-").map(maj1).join("-")).join(" ");
  }

  // « Marie » -> « M. », « Jean-Pierre » -> « J.-P. », « Marie Claire » -> « M. C. »
  function initiales(prenoms) {
    return prenoms.split(/\s+/).filter(Boolean)
      .map(p => p.split("-").filter(Boolean).map(x => x.charAt(0).toUpperCase() + ".").join("-")).join(" ");
  }

  // Des initiales portent un point (« M. », « M.-J. ») ou font au plus deux lettres (« MJ ») ;
  // « MARIE » est un prénom écrit en majuscules.
  function estInitiales(txt) {
    const t = txt.replace(/\s+/g, "");
    return RE_INITIALES.test(t) && (t.includes(".") || t.replace(/-/g, "").length <= 2);
  }

  // « MJ » / « M.J. » / « M. J. » / « M.-J. » -> « M. J. » / « M.-J. »
  function depuisInitiales(txt) {
    return txt.replace(/[.\s]/g, "").split("-").map(part => part.split("").map(c => c + ".").join(" ")).join("-");
  }

  function parseAuteur(brut) {
    const t = String(brut || "").trim().replace(/\s+/g, " ");
    if (!t) return "";
    if (MOTS_ORGA.test(t)) return t;                                   // organisation : tel quel
    if (t.includes(",")) {                                             // « Nom, Prénom »
      const [nom, ...reste] = t.split(",");
      const pr = reste.join(" ").trim();
      return pr ? `${casse(nom.trim())}, ${estInitiales(pr) ? depuisInitiales(pr) : initiales(pr.replace(/\./g, " ").trim())}` : casse(nom.trim());
    }
    const mots = t.split(" ");
    if (mots.length === 1) return t;                                   // nom seul ou sigle (OMS, HAS) : tel quel
    const dernier = mots[mots.length - 1];
    if (estInitiales(dernier)) {           // « Dupont M. »
      return `${casse(mots.slice(0, -1).join(" "))}, ${depuisInitiales(dernier)}`;
    }
    let n = 0;                                                         // « DUPONT Marie »
    while (n < mots.length - 1 && mots[n].length > 1 && mots[n] === mots[n].toUpperCase() && !PARTICULES.has(mots[n].toLowerCase())) n++;
    if (n > 0) return `${casse(mots.slice(0, n).join(" "))}, ${initiales(mots.slice(n).join(" "))}`;
    let i = mots.length - 1;                                           // « Prénom [de] Nom »
    while (i > 1 && PARTICULES.has(mots[i - 1].toLowerCase())) i--;
    return `${mots.slice(i).join(" ")}, ${initiales(mots.slice(0, i).join(" "))}`;
  }

  function listeAuteurs(brut) {
    let s = String(brut || "").replace(/\r?\n/g, ";").replace(/\s+(et|and|&)\s+/gi, ";");
    if (s.includes(";")) return s.split(";").map(x => x.trim()).filter(Boolean);
    const jetons = s.split(",").map(x => x.trim()).filter(Boolean);
    // « Dupont, Marie, Martin, Jean » : paires nom/prénom ; « Marie Dupont, Jean Martin » : auteurs distincts.
    const paires = jetons.length >= 2 && jetons.length % 2 === 0
      && jetons.every((x, k) => (k % 2 === 0 ? true : x.split(/\s+/).length === 1));
    if (paires) { const l = []; for (let k = 0; k < jetons.length; k += 2) l.push(jetons[k] + ", " + jetons[k + 1]); return l; }
    return jetons.length > 1 && jetons.every(x => x.split(/\s+/).length >= 2) ? jetons : [s.trim()].filter(Boolean);
  }

  function formaterAuteurs(l) {
    const n = l.length;
    if (n === 0) return "";
    if (n === 1) return l[0];
    if (n <= 20) return l.slice(0, -1).join(", ") + ", & " + l[n - 1];
    return l.slice(0, 19).join(", ") + ", … " + l[n - 1];
  }

  function lienDoi(v) {
    const t = String(v || "").trim();
    if (!t) return "";
    if (/^https?:\/\//i.test(t)) return t;
    if (/^doi\.org\//i.test(t)) return "https://" + t;
    if (/^(doi:\s*)?10\.\d{4,9}\//i.test(t)) return "https://doi.org/" + t.replace(/^doi:\s*/i, "");
    return t;
  }

  function apa(f) {
    const annee = (/^(\d{4})/.exec(f.parution || "") || [])[1] || "s. d.";
    const titre = String(f.titre || "").trim().replace(/[.\s]+$/, "");
    const source = String(f.source || "").trim().replace(/[.,\s]+$/, "");
    const volume = String(f.volume || "").trim(), numero = String(f.numero || "").trim();
    const pages = String(f.pages || "").trim().replace(/\s*[-–—]\s*/g, "–");
    const lien = lienDoi(f.doi);
    const article = TYPES_ARTICLE.indexOf(f.type) >= 0;
    const these = f.type === "Thèse / mémoire";
    const ital = TYPES_ITALIQUE.indexOf(f.type) >= 0;
    const fin = /[?!]$/.test(titre) ? "" : ".";
    const auteurs = formaterAuteurs(listeAuteurs(f.auteur).map(a => parseAuteur(a)).filter(Boolean));

    // Titre (+ crochet pour une thèse, avec l'établissement s'il est connu).
    const crochet = these ? " [Thèse / mémoire" + (source ? ", " + source : "") + "]" : "";
    const titreT = titre + crochet + fin;
    const titreH = (ital ? "<i>" + esc(titre) + "</i>" : esc(titre)) + esc(crochet) + fin;

    // Suite : revue (italique), volume (italique), (numéro), pages ; ou éditeur ; puis DOI / URL.
    let suiteT = "", suiteH = "";
    if (article && source) {
      suiteT = " " + source; suiteH = " <i>" + esc(source) + "</i>";
      if (volume) { suiteT += ", " + volume; suiteH += ", <i>" + esc(volume) + "</i>"; }
      if (numero) { suiteT += "(" + numero + ")"; suiteH += "(" + esc(numero) + ")"; }
      if (pages) { suiteT += ", " + pages; suiteH += ", " + esc(pages); }
      suiteT += "."; suiteH += ".";
    } else if (!article && !these && source) {
      suiteT = " " + source + "."; suiteH = " " + esc(source) + ".";
    }
    if (lien) { suiteT += " " + lien; suiteH += " " + esc(lien); }

    let res;
    if (auteurs) {
      const tete = auteurs + (auteurs.endsWith(".") ? "" : ".") + " (" + annee + "). ";
      res = { text: tete + titreT + suiteT, html: esc(tete) + titreH + suiteH };
    } else {                                                           // sans auteur : le titre passe en tête
      const tete = " (" + annee + ").";
      res = { text: titreT + tete + suiteT, html: titreH + esc(tete) + suiteH };
    }
    res.incomplet = article && (!source || !pages);
    res.auteurs = auteurs; res.annee = annee;
    return res;
  }

  // Date de parution saisie librement -> "AAAA", "AAAA-MM" ou "AAAA-MM-JJ" ; "" si vide ; null si non reconnue.
  const MOIS = ["jan", "fev", "mar", "avr", "mai", "juin", "juil", "aou", "sep", "oct", "nov", "dec"];
  function normaliserDate(txt) {
    const t = String(txt == null ? "" : txt).trim();
    if (!t) return "";
    const p2 = n => String(n).padStart(2, "0");
    const ok = (a, m, j) => a >= 1800 && a <= 2100 && (m === undefined || (m >= 1 && m <= 12)) && (j === undefined || (j >= 1 && j <= 31));
    let m;
    if ((m = /^(\d{4})$/.exec(t))) return ok(+m[1]) ? m[1] : null;
    if ((m = /^(\d{4})[-/](\d{1,2})$/.exec(t))) return ok(+m[1], +m[2]) ? m[1] + "-" + p2(m[2]) : null;
    if ((m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(t))) return ok(+m[1], +m[2], +m[3]) ? m[1] + "-" + p2(m[2]) + "-" + p2(m[3]) : null;
    if ((m = /^(\d{1,2})[/.-](\d{4})$/.exec(t))) return ok(+m[2], +m[1]) ? m[2] + "-" + p2(m[1]) : null;
    if ((m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(t))) return ok(+m[3], +m[2], +m[1]) ? m[3] + "-" + p2(m[2]) + "-" + p2(m[1]) : null;
    const sans = t.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
    if ((m = /^(?:(\d{1,2})(?:er)?\s+)?([a-z]+)\.?\s+(\d{4})$/.exec(sans))) {
      const mois = MOIS.findIndex(x => m[2].startsWith(x)) + 1;
      if (!mois || (m[2] === "ju" )) return null;
      const j = m[1] ? +m[1] : undefined;
      if (!ok(+m[3], mois, j)) return null;
      return m[3] + "-" + p2(mois) + (j ? "-" + p2(j) : "");
    }
    return null;
  }

  // Clé de tri alphabétique d'une bibliographie APA : auteurs (ou titre sans auteur), année, titre.
  const sansAccent = t => String(t || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  function cleTri(f) {
    const r = apa(f);
    return sansAccent(r.auteurs || f.titre) + "|" + r.annee + "|" + sansAccent(f.titre);
  }

  // Trie des fiches et ajoute a, b, c… à l'année quand auteurs et année sont identiques (règle APA).
  function bibliographie(fiches) {
    const l = fiches.map(f => ({ f, r: apa(f), cle: cleTri(f) })).sort((a, b) => a.cle.localeCompare(b.cle));
    const groupes = {};
    l.forEach(x => { if (x.r.auteurs) (groupes[x.r.auteurs + "|" + x.r.annee] = groupes[x.r.auteurs + "|" + x.r.annee] || []).push(x); });
    Object.keys(groupes).forEach(k => {
      const g = groupes[k];
      if (g.length < 2) return;
      g.forEach((x, i) => {
        const lettre = String.fromCharCode(97 + (i % 26));
        const an = "(" + x.r.annee + ")";
        x.r = { ...x.r, text: x.r.text.replace(an, "(" + x.r.annee + lettre + ")"), html: x.r.html.replace(an, "(" + x.r.annee + lettre + ")") };
      });
    });
    return l.map(x => ({ id: x.f.id, ...x.r }));
  }

  const api = { apa, normaliserDate, cleTri, bibliographie, parseAuteur, listeAuteurs, formaterAuteurs };
  if (typeof module !== "undefined" && module.exports) module.exports = api; else root.LydiaApa = api;
})(typeof window !== "undefined" ? window : globalThis);
