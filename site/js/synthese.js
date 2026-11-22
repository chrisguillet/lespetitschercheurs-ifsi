/* Synthèse : chiffres clés, répartitions, nuage de mots-clés et carte des nationalités des auteurs.
   Script classique : partage la portée globale avec les autres fichiers de js/ (ordre de chargement : voir index.html). */
"use strict";
/* ---------- Synthèse ---------- */

const sansAccents = s => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[-'’]/g, " ");

// Pays reconnus dans le champ libre « nationalité » : [nom, latitude, longitude, débuts de mots (sans accent, minuscules)].
const PAYS = [
  ["France", 46.6, 2.3, "francais", "france", "franco"], ["États-Unis", 39, -98, "americ", "etats uni", "usa"],
  ["Royaume-Uni", 54, -2, "britanni", "anglais", "angleterre", "royaume uni", "ecossai", "ecosse", "gallois", "pays de galles", "uk"],
  ["Canada", 56, -96, "canad", "quebec"], ["Belgique", 50.6, 4.6, "belg"], ["Suisse", 46.8, 8.2, "suiss"], ["Allemagne", 51, 10, "allemand", "allemagne"],
  ["Espagne", 40, -3.7, "espagn"], ["Italie", 42.8, 12.5, "ital"], ["Portugal", 39.5, -8, "portug"], ["Pays-Bas", 52.2, 5.3, "neerland", "hollan", "pays bas"],
  ["Luxembourg", 49.8, 6.1, "luxembourg"], ["Irlande", 53.2, -8, "irland"], ["Suède", 62, 15, "sued"], ["Norvège", 64.5, 11, "norveg"], ["Danemark", 56, 9.5, "danois", "danemark"],
  ["Finlande", 64, 26, "finland", "finnois"], ["Islande", 64.9, -18, "island"], ["Autriche", 47.5, 14.5, "autrich"], ["Pologne", 52, 19, "polon", "pologne"],
  ["Tchéquie", 49.8, 15.5, "tcheq", "tchequ"], ["Hongrie", 47, 19.5, "hongr"], ["Roumanie", 46, 25, "roumain", "roumanie"], ["Grèce", 39, 22, "grec", "grece"],
  ["Turquie", 39, 35, "turc", "turquie"], ["Russie", 60, 95, "russ"], ["Ukraine", 49, 32, "ukrain"], ["Israël", 31.4, 35, "israel"], ["Liban", 33.9, 35.9, "liban"],
  ["Jordanie", 31, 36, "jordan"], ["Syrie", 35, 38, "syri"], ["Palestine", 31.9, 35.2, "palestin"], ["Arabie saoudite", 24, 45, "saoudi", "arabie"], ["Émirats arabes unis", 24, 54, "emirat"],
  ["Qatar", 25.3, 51.2, "qatar"], ["Iran", 32.5, 54, "iran"], ["Irak", 33, 44, "irak"], ["Égypte", 26.5, 30, "egypt"], ["Maroc", 31.8, -7, "maroc"], ["Algérie", 28, 2.6, "alger"],
  ["Tunisie", 34, 9.5, "tunis"], ["Sénégal", 14.5, -14.5, "senegal"], ["Côte d’Ivoire", 7.6, -5.5, "ivoir"], ["Cameroun", 5.7, 12.7, "camerou"], ["Nigeria", 9.1, 8.7, "nigeri"],
  ["Ghana", 7.9, -1.1, "ghan"], ["Mali", 17, -4, "mali"], ["Burkina Faso", 12.3, -1.5, "burkin"], ["Bénin", 9.3, 2.3, "benin"], ["Kenya", 0.5, 38, "keny"],
  ["Éthiopie", 9, 39.6, "ethiop"], ["RD Congo / Congo", -2.9, 23.6, "congo"], ["Afrique du Sud", -29, 24, "sud africain", "afrique du sud"], ["Madagascar", -19, 46.7, "malgache", "madagascar"],
  ["Maurice", -20.3, 57.6, "maurici"], ["Inde", 22, 79, "indien", "inde"], ["Pakistan", 30, 70, "pakistan"], ["Bangladesh", 23.7, 90.4, "banglad"], ["Chine", 35, 103, "chin"],
  ["Japon", 36, 138, "japon"], ["Corée du Sud", 36.5, 128, "coree"], ["Taïwan", 23.7, 121, "taiwan"], ["Thaïlande", 15, 101, "thai"], ["Vietnam", 16, 107.5, "vietnam"],
  ["Philippines", 12.9, 122, "philippin"], ["Indonésie", -2, 118, "indones"], ["Malaisie", 4, 102, "malais"], ["Singapour", 1.35, 103.8, "singapou"],
  ["Australie", -25, 134, "austral"], ["Nouvelle-Zélande", -41, 174, "zeland"], ["Brésil", -10, -52, "bresil"], ["Argentine", -34, -64, "argentin"], ["Chili", -33, -71, "chili"],
  ["Colombie", 4, -73, "colomb"], ["Mexique", 23.5, -102, "mexic"], ["Pérou", -9.5, -75, "perou", "peruvi"], ["Cuba", 21.5, -79.5, "cuba"], ["Haïti", 19, -72.5, "haiti"]
].map(([nom, lat, lon, ...debuts]) => ({ nom, lat, lon, re: new RegExp("(^|[^a-z])(" + debuts.join("|") + ")") }));

// Pays cités dans une nationalité saisie librement ; une même fiche ne compte qu'une fois par pays.
function paysDe(texte) {
  const t = sansAccents(texte);
  return t.trim() ? PAYS.filter(p => p.re.test(t)) : [];
}

// Vues au choix (mémorisées) : mots-clés en nuage ou en liste ; nationalités en carte ou en liste.
const SV = { mots: "nuage", nation: "carte" };
try { const v = JSON.parse(localStorage.getItem("lpc_synthvue") || "{}"); if (v.mots === "liste") SV.mots = "liste"; if (v.nation === "liste") SV.nation = "liste"; } catch (e) { /* ignoré */ }
const vueSwitch = (cle, options, imprimable) => imprimable ? "" : `<span class="kwsw" role="group" aria-label="Affichage">${options.map(([v, l]) =>
  `<button type="button" class="kwl ${SV[cle] === v ? "on" : ""}" data-sv="${cle}:${v}" aria-pressed="${SV[cle] === v}">${l}</button>`).join("")}</span>`;
const lignesBarres = entrees => { const max = Math.max(...entrees.map(e => e[1])); return entrees.map(([lib, n]) =>
  `<div class="bar"><span class="bl" title="${esc(lib)}">${esc(lib)}</span><div class="bt"><div class="bf" style="width:${Math.round(n / max * 100)}%;background:var(--pri)"></div></div><span class="bn">${n}</span></div>`).join(""); };

function nuageMotsCles(listes, imprimable) {
  const c = compter(listes.flatMap(l => l), 60);
  if (!c.length) return "";
  const entete = `<h3>Mots-clés les plus fréquents ${vueSwitch("mots", [["nuage", "Nuage"], ["liste", "Liste"]], imprimable)} ${imprimable ? "" : kwSwitch()}</h3>`;
  if (SV.mots === "liste") return `<div class="card nuage">${entete}${lignesBarres(c.slice(0, 15))}</div>`;
  const max = Math.max(...c.map(e => e[1])), min = Math.min(...c.map(e => e[1]));
  const COULEURS = ["#2f5fd0", "#7c3aed", "#0d9488", "#d97706", "#be185d", "#0369a1"];
  // Les mots les plus fréquents au centre, les rares sur les bords ; un léger décalage vertical propre à chaque mot donne l'allure d'un nuage.
  const centre = [];
  c.slice().sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "fr")).forEach((e, i) => { if (i % 2) centre.push(e); else centre.unshift(e); });
  const mots = centre.map(([mot, n], i) => {
    const t = max === min ? 0.5 : Math.sqrt((n - min) / (max - min));
    const h = [...mot].reduce((s, ch) => (s * 31 + ch.charCodeAt(0)) % 997, 7), dy = (h % 21) - 10;
    return `<button type="button" class="nuagemot" data-nuage="${esc(mot)}" style="font-size:${(13 + t * 19).toFixed(1)}px;color:${COULEURS[(i * 7 + mot.length) % COULEURS.length]};opacity:${(0.62 + t * 0.38).toFixed(2)};transform:translateY(${dy}px)" title="${n} fiche${n > 1 ? "s" : ""} : cliquer pour filtrer le tableau">${esc(mot)}</button>`;
  }).join(" ");
  return `<div class="card nuage">${entete}<div class="nuagebox">${mots}</div></div>`;
}

// Pays cités par les articles (une fois par article et par pays) et nationalités non reconnues.
function repartitionPays(arts) {
  const parPays = new Map(), inconnues = new Map();
  arts.forEach(i => {
    const texte = String(i.nation || "").trim();
    if (!texte) return;
    const trouves = paysDe(texte);
    if (!trouves.length) { inconnues.set(texte, (inconnues.get(texte) || 0) + 1); return; }
    trouves.forEach(p => parPays.set(p, (parPays.get(p) || 0) + 1));
  });
  return { parPays, inconnues };
}

function carteNationalites(arts, imprimable) {
  const { parPays, inconnues } = repartitionPays(arts);
  if (!parPays.size && !inconnues.size) return "";
  const entete = `<h3>Nationalité des auteurs ${vueSwitch("nation", [["carte", "Carte"], ["liste", "Liste"]], imprimable)}</h3>`;
  if (SV.nation === "liste") return `<div class="card carte">${entete}${lignesBarres(compter(arts.map(i => i.nation), 15))}</div>`;
  const liste = [...parPays.entries()].sort((a, b) => b[1] - a[1] || a[0].nom.localeCompare(b[0].nom, "fr"));
  const max = liste.length ? liste[0][1] : 1;
  const bulles = liste.map(([p, n]) => `<circle cx="${(p.lon + 180).toFixed(1)}" cy="${(90 - p.lat).toFixed(1)}" r="${(2 + 7 * Math.sqrt(n / max)).toFixed(2)}" class="bulle"><title>${esc(p.nom)} : ${n} article${n > 1 ? "s" : ""}</title></circle>`).join("");
  const legende = liste.map(([p, n]) => `<span class="chip fixe">${esc(p.nom)} <b>${n}</b></span>`).join(" ");
  const non = inconnues.size ? `<div class="meta" style="margin-top:6px">Non placées sur la carte : ${[...inconnues.entries()].map(([k, n]) => `${esc(k)} (${n})`).join(", ")}.</div>` : "";
  return `<div class="card carte">${entete}<div class="cartewrap">
    <svg viewBox="0 5 360 143" role="img" aria-label="Carte du monde : nationalité des auteurs des articles" class="carteSvg"><path d="${MONDE_TERRES}" class="terres"/>${bulles}</svg>
    <div class="cartelegende">${legende}${non}</div></div></div>`;
}

// ----- Mots-clés qui vont ensemble : paires présentes dans une même fiche -----
function pairesMotsCles(listes) {
  const paires = new Map(), noms = new Map();
  listes.forEach(l => {
    const cles = [...new Map(l.map(m => [cleTitre(m), m])).entries()].filter(([k]) => k);
    cles.forEach(([k, m]) => { if (!noms.has(k)) noms.set(k, m); });
    for (let a = 0; a < cles.length; a++) for (let b = a + 1; b < cles.length; b++) {
      const [x, y] = [cles[a][0], cles[b][0]].sort(), id = x + "\u0001" + y;
      paires.set(id, (paires.get(id) || 0) + 1);
    }
  });
  const top = [...paires.entries()].filter(([, n]) => n >= 2).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([id, n]) => { const [x, y] = id.split("\u0001"); return [noms.get(x), noms.get(y), n]; });
  if (!top.length) return { html: "", lignes: [], top: [] };
  const max = top[0][2];
  const html = `<div class="card"><h3>Mots-clés qui vont ensemble <span class="meta">(cités dans les mêmes fiches ; cliquer pour filtrer le tableau)</span></h3>${top.map(([a, b, n]) =>
    `<div class="bar"><button type="button" class="bl lnk" data-paire="${esc(a)}|${esc(b)}" title="Filtrer sur ces deux mots-clés (les deux à la fois)">${esc(a)} + ${esc(b)}</button><div class="bt"><div class="bf" style="width:${Math.round(n / max * 100)}%;background:var(--pri)"></div></div><span class="bn">${n}</span></div>`).join("")}</div>`;
  return { html, lignes: top.map(([a, b, n]) => ["Mots-clés associés", a + " + " + b, n]), top };
}

// ----- Assemblage -----
function donneesSynthese(imprimable) {
  const arts = parArticle(items);
  const annees = new Map();
  arts.forEach(i => { const a = (/^(\d{4})/.exec(i.parution || "") || [])[1]; if (a) annees.set(a, (annees.get(a) || 0) + 1); });
  const parAnnee = [...annees.entries()].sort((a, b) => a[0].localeCompare(b[0])).slice(-12);
  const kpi = (n, t) => `<div class="kpi"><b>${n}</b>${t}</div>`;
  const motsDe = i => (kwLang !== "en" ? motsListe(i.mots) : []).concat(kwLang !== "fr" ? motsListe(i.kw) : []);
  const listesMots = items.map(motsDe);
  const pa = pairesMotsCles(listesMots);
  const html = `<div class="kpis">${kpi(items.length, "lectures")}${kpi(items.filter(i => i.statut === "Terminée").length, "terminées")}${kpi(items.filter(i => i.statut === "En cours").length, "en cours")}${items.some(i => i.statut === "À lire") ? kpi(items.filter(i => i.statut === "À lire").length, "à lire") : ""}${kpi(comments.length, "commentaires")}</div>
   <div class="synth2">${nuageMotsCles(listesMots, imprimable)}${carteNationalites(arts, imprimable)}</div>
   <div class="synth">
   ${barres("Types d’articles", compter(arts.map(i => i.type), 8), "var(--pri)")}
   ${barres("Qualité des auteurs (plusieurs possibles par lecture)", compter(arts.flatMap(i => metiersListe(i.qualite)), 8), "var(--pri)")}
   ${barres("Années de parution", parAnnee, "var(--pri)")}
   ${barres("Revues et sources les plus citées", compter(arts.map(i => i.source), 8), "var(--pri)")}
   ${pa.html}
   </div>`;
  const lignes = [["Rubrique", "Élément", "Nombre"], ["Chiffres clés", "Lectures", items.length], ["Chiffres clés", "Terminées", items.filter(i => i.statut === "Terminée").length], ["Chiffres clés", "Commentaires", comments.length]]
    .concat(compter(listesMots.flatMap(l => l), 60).map(([m, n]) => ["Mots-clés", m, n]))
    .concat(compter(arts.map(i => i.nation), 60).map(([m, n]) => ["Nationalité des auteurs", m, n]))
    .concat(compter(arts.map(i => i.type), 20).map(([m, n]) => ["Types d’articles", m, n]))
    .concat(compter(arts.flatMap(i => metiersListe(i.qualite)), 20).map(([m, n]) => ["Qualité des auteurs", m, n]))
    .concat(parAnnee.map(([m, n]) => ["Années de parution", m, n]), compter(arts.map(i => i.source), 20).map(([m, n]) => ["Revues et sources", m, n]), pa.lignes);
  return { html, lignes };
}

function renderSynth() {
  if (!items.length) { $("synthbox").innerHTML = '<div class="card empty">Pas encore de données à synthétiser.</div>'; return; }
  $("synthbox").innerHTML = `<div class="grow" style="margin-bottom:10px"><button type="button" class="btn sm sec" id="synthexp" title="Aperçu de la synthèse, puis impression ou enregistrement en PDF">🖨 Aperçu / PDF</button><button type="button" class="btn sm sec" id="synthcsv" title="Les chiffres de cette synthèse, pour un tableur">Chiffres (CSV)</button></div>` + donneesSynthese(false).html;
}

// Aperçu imprimable (même fenêtre que le compte rendu) : thème clair, sans boutons.
function synthesePage() {
  const g = groupeCourant() || {};
  const portee = ctx.vue === "promo" ? "toute la promo" : "groupe « " + (g.nom || "") + " »";
  return `<article class="crpage crsynth"><div class="crhead"><div class="crsup">${esc([g.etablissement, g.promo].filter(Boolean).join(" · "))}</div>
    <h2>Synthèse des lectures</h2><div class="crsous">${esc(portee)} · édité le ${esc(fmtD(new Date().toISOString()))}</div></div>${donneesSynthese(true).html}</article>`;
}
function exporterSynthesesCsv() {
  telecharger(new Blob(["﻿" + versCsv(donneesSynthese(true).lignes[0], donneesSynthese(true).lignes.slice(1))], { type: "text/csv;charset=utf-8" }), "synthese-lectures-" + stamp() + ".csv");
}

$("synthbox").addEventListener("click", e => {
  if (e.target.closest("#synthexp")) return ouvrirCompteRendu("", "synthese");
  if (e.target.closest("#synthcsv")) return exporterSynthesesCsv();
  const sv = e.target.closest("[data-sv]");
  if (sv) {
    const [cle, v] = sv.dataset.sv.split(":");
    SV[cle] = v;
    try { localStorage.setItem("lpc_synthvue", JSON.stringify(SV)); } catch (x) { /* ignoré */ }
    return renderSynth();
  }
  // Un mot du nuage, ou une paire de mots-clés : on retourne au tableau, filtré.
  const paire = e.target.closest("[data-paire]");
  if (paire) {
    const [a, b] = paire.dataset.paire.split("|");
    setTab("all");
    F.kw = [cleTitre(a), cleTitre(b)]; F.kwLabels = { [cleTitre(a)]: a, [cleTitre(b)]: b }; F.mode.kw = "et";
    renderFilters(true); renderTable();
    return;
  }
  const b = e.target.closest("[data-nuage]");
  if (!b) return;
  setTab("all");
  const mot = b.dataset.nuage;
  if (!F.kw.includes(cleTitre(mot))) filtrerMotCle(mot);
});

// ----- PDF vectoriel de la synthèse (jsPDF) : mêmes données que l'écran, dessinées à la main (texte, barres, carte). -----
function pdfSynthese() {
  if (!window.jspdf) { alert("Module PDF non chargé."); return; }
  if (!items.length) return;
  const doc = new window.jspdf.jsPDF({ unit: "mm", format: "a4" });
  const M = 15, L = 180, BAS = 285, BLEU = [47, 95, 208];
  let y = 16;
  const place = h => { if (y + h > BAS) { doc.addPage(); y = 16; } };
  const texte = (t, x, yy, taille, gras, coul, al) => { doc.setFont("helvetica", gras ? "bold" : "normal"); doc.setFontSize(taille); doc.setTextColor(...(coul || [25, 30, 40])); doc.text(String(t), x, yy, al ? { align: al } : undefined); };
  const hex = h => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];

  const g = groupeCourant() || {};
  const arts = parArticle(items);
  const motsDe = i => (kwLang !== "en" ? motsListe(i.mots) : []).concat(kwLang !== "fr" ? motsListe(i.kw) : []);
  const listes = items.map(motsDe);

  // En-tête
  texte([g.etablissement, g.promo].filter(Boolean).join(" · "), M, y, 9, false, [110, 118, 130]); y += 7;
  texte("Synthèse des lectures", M, y, 18, true); y += 6;
  texte((ctx.vue === "promo" ? "toute la promo" : "groupe « " + (g.nom || "") + " »") + " · édité le " + fmtD(new Date().toISOString()), M, y, 10, false, [70, 78, 92]); y += 3;
  doc.setDrawColor(...BLEU); doc.setLineWidth(0.6); doc.line(M, y, M + L, y); y += 8;

  // Chiffres clés
  const kp = [[items.length, "lectures"], [items.filter(i => i.statut === "Terminée").length, "terminées"], [items.filter(i => i.statut === "En cours").length, "en cours"]];
  if (items.some(i => i.statut === "À lire")) kp.push([items.filter(i => i.statut === "À lire").length, "à lire"]);
  kp.push([comments.length, "commentaires"]);
  const lk = (L - (kp.length - 1) * 4) / kp.length;
  kp.forEach(([n, t], i) => { const x = M + i * (lk + 4); doc.setDrawColor(208, 213, 221); doc.setLineWidth(0.3); doc.roundedRect(x, y, lk, 16, 2, 2); texte(n, x + 4, y + 8, 15, true); texte(t, x + 4, y + 13.5, 8.5, false, [90, 98, 112]); });
  y += 24;

  // Mots-clés : nuage (les plus fréquents au centre de chaque ligne, taille selon la fréquence)
  const c = compter(listes.flatMap(l => l), 40);
  if (c.length) {
    place(40); texte("Mots-clés les plus fréquents", M, y, 11, true); y += 7;
    const max = Math.max(...c.map(e => e[1])), min = Math.min(...c.map(e => e[1]));
    const COUL = ["#2f5fd0", "#7c3aed", "#0d9488", "#d97706", "#be185d", "#0369a1"].map(hex);
    const mots = c.slice().sort((a, b) => a[0].localeCompare(b[0], "fr")).map(([m, n], i) => {
      const t = max === min ? 0.5 : Math.sqrt((n - min) / (max - min)), taille = 9 + t * 11;
      doc.setFont("helvetica", "bold"); doc.setFontSize(taille);
      return { m, taille, w: doc.getTextWidth(m), coul: COUL[(i * 7 + m.length) % COUL.length] };
    });
    const lignes = []; let cur = [], largeur = 0;
    mots.forEach(w => { if (largeur + w.w > L && cur.length) { lignes.push(cur); cur = []; largeur = 0; } cur.push(w); largeur += w.w + 5; });
    if (cur.length) lignes.push(cur);
    lignes.forEach(l => {
      const h = Math.max(...l.map(w => w.taille)) * 0.42, tot = l.reduce((n, w) => n + w.w, 0) + (l.length - 1) * 5;
      place(h + 3); let x = M + (L - tot) / 2;
      l.forEach(w => { texte(w.m, x, y + h, w.taille, true, w.coul); x += w.w + 5; });
      y += h + 3;
    });
    y += 5;
  }

  // Carte des nationalités : fonds de carte tracé en vecteur, un disque par pays
  const { parPays, inconnues } = repartitionPays(arts);
  if (parPays.size || inconnues.size) {
    const ech = L / 360, hc = 143 * ech;
    place(hc + 22); texte("Nationalité des auteurs", M, y, 11, true); y += 4;
    const oy = y - 5 * ech;
    doc.setFillColor(238, 242, 250); doc.rect(M, y, L, hc, "F");
    doc.setFillColor(214, 220, 232);
    MONDE_TERRES.split("Z").filter(Boolean).forEach(r => {
      const pts = r.replace(/^M/, "").split("L").map(p => p.split(" ").map(Number));
      if (pts.length < 3) return;
      const v = []; for (let k = 1; k < pts.length; k++) v.push([(pts[k][0] - pts[k - 1][0]) * ech, (pts[k][1] - pts[k - 1][1]) * ech]);
      const x0 = M + pts[0][0] * ech, y0 = oy + pts[0][1] * ech;
      doc.saveGraphicsState(); doc.rect(M, y, L, hc, null); doc.clip(); doc.discardPath();
      doc.lines(v, x0, y0, [1, 1], "F", true);
      doc.restoreGraphicsState();
    });
    const liste = [...parPays.entries()].sort((a, b) => b[1] - a[1]);
    const mx = liste.length ? liste[0][1] : 1;
    doc.setFillColor(...BLEU); doc.setDrawColor(...BLEU); doc.setLineWidth(0.3);
    doc.saveGraphicsState(); doc.setGState(new doc.GState({ opacity: 0.55 }));
    liste.forEach(([p, n]) => doc.circle(M + (p.lon + 180) * ech, oy + (90 - p.lat) * ech, (2 + 7 * Math.sqrt(n / mx)) * ech, "FD"));
    doc.restoreGraphicsState();
    y += hc + 5;
    const leg = liste.map(([p, n]) => p.nom + " " + n).join("  ·  ") + (inconnues.size ? "   —   non placées : " + [...inconnues.entries()].map(([k, n]) => k + " (" + n + ")").join(", ") : "");
    doc.setFont("helvetica", "normal"); doc.setFontSize(8.5);
    doc.splitTextToSize(leg, L).forEach(l => { place(5); texte(l, M, y, 8.5, false, [70, 78, 92]); y += 4.2; });
    y += 5;
  }

  // Graphiques en barres : deux colonnes (la dernière rubrique, seule, occupe la largeur)
  const annees = new Map();
  arts.forEach(i => { const a = (/^(\d{4})/.exec(i.parution || "") || [])[1]; if (a) annees.set(a, (annees.get(a) || 0) + 1); });
  const rubriques = [
    ["Types d’articles", compter(arts.map(i => i.type), 8)],
    ["Qualité des auteurs", compter(arts.flatMap(i => metiersListe(i.qualite)), 8)],
    ["Années de parution", [...annees.entries()].sort((a, b) => a[0].localeCompare(b[0])).slice(-12)],
    ["Revues et sources les plus citées", compter(arts.map(i => i.source), 8)]
  ].filter(r => r[1].length);
  const barres2 = (titre, e, x, yy, larg) => {
    texte(titre, x, yy, 10, true); yy += 5;
    const mx = Math.max(...e.map(v => v[1])), lw = larg * 0.5;
    e.forEach(([lib, n]) => {
      const lignes = doc.splitTextToSize(String(lib), lw - 2).slice(0, 2);
      texte(lignes.join("\n"), x, yy + 3, 8.5, false, [30, 36, 48]);
      const bw = Math.max(1.5, (larg - lw - 8) * n / mx);
      doc.setFillColor(...BLEU); doc.roundedRect(x + lw, yy, bw, 4, 1, 1, "F"); texte(n, x + lw + bw + 1.5, yy + 3.2, 8, false, [90, 98, 112]);
      yy += Math.max(6, lignes.length * 4 + 2);
    });
    return yy;
  };
  for (let i = 0; i < rubriques.length; i += 2) {
    const a = rubriques[i], b = rubriques[i + 1];
    const hA = a[1].length * 7 + 8, hB = b ? b[1].length * 7 + 8 : 0;
    place(Math.max(hA, hB));
    if (b) { const ya = barres2(a[0], a[1], M, y, L / 2 - 6), yb = barres2(b[0], b[1], M + L / 2 + 6, y, L / 2 - 6); y = Math.max(ya, yb) + 6; }
    else { y = barres2(a[0], a[1], M, y, L) + 6; }
  }

  // Mots-clés qui vont ensemble
  const top = pairesMotsCles(listes).top;
  if (top.length) {
    place(top.length * 6 + 10);
    texte("Mots-clés qui vont ensemble (cités dans les mêmes fiches)", M, y, 10, true); y += 5;
    const mx = top[0][2];
    top.forEach(([a, b, n]) => {
      texte(a + " + " + b, M, y + 3, 8.5, false, [30, 36, 48]);
      const bw = Math.max(1.5, 70 * n / mx); doc.setFillColor(...BLEU); doc.roundedRect(M + 100, y, bw, 4, 1, 1, "F"); texte(n, M + 100 + bw + 1.5, y + 3.2, 8, false, [90, 98, 112]);
      y += 6;
    });
  }
  doc.save("synthese-lectures-" + stamp() + ".pdf");
}
