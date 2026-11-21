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

function nuageMotsCles(listes) {
  const c = compter(listes.flatMap(l => l), 60);
  if (!c.length) return "";
  const max = Math.max(...c.map(e => e[1])), min = Math.min(...c.map(e => e[1]));
  const COULEURS = ["#2f5fd0", "#7c3aed", "#0d9488", "#d97706", "#be185d", "#0369a1"];
  const mots = c.slice().sort((a, b) => a[0].localeCompare(b[0], "fr")).map(([mot, n], i) => {
    const t = max === min ? 0.5 : Math.sqrt((n - min) / (max - min));
    return `<button type="button" class="nuagemot" data-nuage="${esc(mot)}" style="font-size:${(13 + t * 23).toFixed(1)}px;color:${COULEURS[(i * 7 + mot.length) % COULEURS.length]};opacity:${(0.6 + t * 0.4).toFixed(2)}" title="${n} fiche${n > 1 ? "s" : ""} : cliquer pour filtrer le tableau">${esc(mot)}</button>`;
  }).join(" ");
  return `<div class="card nuage"><h3>Mots-clés les plus fréquents <span class="meta">(plus c’est gros, plus c’est fréquent)</span> ${kwSwitch()}</h3><div class="nuagebox">${mots}</div></div>`;
}

function carteNationalites(arts) {
  const parPays = new Map(), inconnues = new Map();
  arts.forEach(i => {
    const texte = String(i.nation || "").trim();
    if (!texte) return;
    const trouves = paysDe(texte);
    if (!trouves.length) { const k = texte; inconnues.set(k, (inconnues.get(k) || 0) + 1); return; }
    trouves.forEach(p => parPays.set(p, (parPays.get(p) || 0) + 1));
  });
  if (!parPays.size && !inconnues.size) return "";
  const liste = [...parPays.entries()].sort((a, b) => b[1] - a[1] || a[0].nom.localeCompare(b[0].nom, "fr"));
  const max = liste.length ? liste[0][1] : 1;
  const bulles = liste.map(([p, n]) => `<circle cx="${(p.lon + 180).toFixed(1)}" cy="${(90 - p.lat).toFixed(1)}" r="${(2 + 7 * Math.sqrt(n / max)).toFixed(2)}" class="bulle"><title>${esc(p.nom)} : ${n} article${n > 1 ? "s" : ""}</title></circle>`).join("");
  const legende = liste.map(([p, n]) => `<span class="chip fixe">${esc(p.nom)} <b>${n}</b></span>`).join(" ");
  const non = inconnues.size ? `<div class="meta" style="margin-top:6px">Non placées sur la carte : ${[...inconnues.entries()].map(([k, n]) => `${esc(k)} (${n})`).join(", ")}.</div>` : "";
  return `<div class="card carte"><h3>Nationalité des auteurs <span class="meta">(un point par pays, d’autant plus gros qu’il y a d’articles)</span></h3>
    <svg viewBox="0 5 360 143" role="img" aria-label="Carte du monde : nationalité des auteurs des articles" class="carteSvg"><path d="${MONDE_TERRES}" class="terres"/>${bulles}</svg>
    <div>${legende}</div>${non}</div>`;
}

function renderSynth() {
  if (!items.length) { $("synthbox").innerHTML = '<div class="card empty">Pas encore de données à synthétiser.</div>'; return; }
  const fin = items.filter(i => i.statut === "Terminée").length;
  const annees = new Map();
  const arts = parArticle(items);
  arts.forEach(i => { const a = (/^(\d{4})/.exec(i.parution || "") || [])[1]; if (a) annees.set(a, (annees.get(a) || 0) + 1); });
  const parAnnee = [...annees.entries()].sort((a, b) => a[0].localeCompare(b[0])).slice(-12);
  const kpi = (n, t) => `<div class="kpi"><b>${n}</b>${t}</div>`;
  // Mots-clés selon la langue choisie dans le tableau (FR par défaut).
  const motsDe = i => (kwLang !== "en" ? motsListe(i.mots) : []).concat(kwLang !== "fr" ? motsListe(i.kw) : []);
  const parEtudiant = ctx.vue === "promo" ? "" : barres("Lectures par étudiant", students().map(s => [s.prenom, items.filter(i => i.etudiant === s.prenom).length, s.couleur]), "var(--pri)");
  $("synthbox").innerHTML = `<div class="kpis">${kpi(items.length, "lectures")}${kpi(fin, "terminées")}${kpi(items.filter(i => i.statut === "En cours").length, "en cours")}${items.some(i => i.statut === "À lire") ? kpi(items.filter(i => i.statut === "À lire").length, "à lire") : ""}${kpi(comments.length, "commentaires")}</div>
   ${nuageMotsCles(items.map(motsDe))}
   ${carteNationalites(arts)}
   <div class="synth">
   ${parEtudiant}
   ${barres("Types d’articles", compter(arts.map(i => i.type), 8), "var(--pri)")}
   ${barres("Qualité des auteurs (plusieurs possibles par lecture)", compter(arts.flatMap(i => metiersListe(i.qualite)), 8), "var(--pri)")}
   ${barres("Années de parution", parAnnee, "var(--pri)")}
   ${barres("Revues et sources les plus citées", compter(arts.map(i => i.source), 8), "var(--pri)")}
   </div>`;
}

// Un mot du nuage : on retourne au tableau, filtré sur ce mot-clé.
$("synthbox").addEventListener("click", e => {
  const b = e.target.closest("[data-nuage]");
  if (!b) return;
  setTab("all");
  const mot = b.dataset.nuage;
  if (!F.kw.includes(cleTitre(mot))) filtrerMotCle(mot);
});
