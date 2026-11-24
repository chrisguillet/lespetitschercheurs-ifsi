/* Compte rendu de réunion : aperçu à l'écran, puis impression ou enregistrement en PDF.
   Script classique : partage la portée globale avec les autres fichiers de js/ (ordre de chargement : voir index.html). */
"use strict";
/* ---------- Compte rendu de réunion : aperçu, impression, PDF ---------- */

const CR = { ouvert: false, id: "", type: "reunion", focus: null };   // type : « reunion » (compte rendu) ou « fiche » (fiche de lecture)

const crReunion = () => reunionsAll.find(r => r.id === CR.id);
const crGroupe = r => groupes.find(g => g.id === r.groupe_id) || {};

// La page telle qu'elle sera imprimée : même contenu à l'écran (aperçu) et sur papier.
function crPage(r) {
  const g = crGroupe(r);
  const sect = (t, v) => String(v || "").trim() ? `<section class="crsect"><h3>${esc(t)}</h3><div class="crtxt">${esc(v)}</div></section>` : "";
  return `<article class="crpage">
    <div class="crhead"><div class="crsup">${esc([g.etablissement, g.promo, g.nom].filter(Boolean).join(" · "))}</div>
      <h2>Compte rendu de réunion</h2>
      <div class="crsous">${esc(fmtD(r.date))}${r.titre ? " · " + esc(r.titre) : ""}</div></div>
    ${r.participants ? `<section class="crsect"><h3>Participants</h3><div class="crtxt">${esc(r.participants)}</div></section>` : ""}
    ${sect("Objectifs", r.objectifs)}${sect("Ce qui a été vu", r.vu)}${sect("Ce qui est attendu", r.attendu)}${crBlocSuite(r)}
    ${[r.objectifs, r.vu, r.attendu, r.suite].some(v => String(v || "").trim()) || (r.taches || []).length ? "" : '<div class="meta">Ce compte rendu est vide.</div>'}
    <footer class="crpied">Saisi par ${esc(r.par || "—")}${r.modifie_par ? ` · modifié par ${esc(r.modifie_par)}` : ""} · édité le ${esc(fmtD(new Date().toISOString()))}</footer>
  </article>${crAnnexes(r)}`;
}

// ---------- Annexes : les pièces jointes, à la suite du compte rendu (images affichées, PDF signalés) ----------
const CR_IMG = new Map();   // id de la pièce jointe → data URL de l'image (chargée une fois)
const crEstImage = f => /^image\//.test(f.type || "");

function crAnnexes(r) {
  const f = r.fichiers || []; if (!f.length) return "";
  return `<article class="crpage crannexes"><div class="crhead"><h2>Annexes</h2></div>
    ${f.map((x, i) => `<figure class="crannexe"><figcaption><b>Annexe ${i + 1}</b> · ${esc(x.nom)}</figcaption>
      ${!crEstImage(x) ? '<div class="meta">Document PDF : à ouvrir depuis le compte rendu (📎).</div>'
        : CR_IMG.has(x.id) ? `<img src="${CR_IMG.get(x.id)}" alt="${esc(x.nom)}">` : '<div class="meta">Chargement de l’image…</div>'}</figure>`).join("")}</article>`;
}

// Charge les images des pièces jointes qui ne le sont pas encore ; renvoie true si au moins une a été chargée.
async function crChargerImages(r) {
  const manquantes = (r.fichiers || []).filter(x => crEstImage(x) && !CR_IMG.has(x.id));
  for (const x of manquantes) {
    try { const d = await api("reunion_fichier_lire", { id: x.id }); CR_IMG.set(x.id, "data:" + d.type + ";base64," + d.data); }
    catch (e) { if (e.code === "unauthorized") { sessionError(e); return false; } }
  }
  return manquantes.length > 0;
}

const crDimensions = src => new Promise(ok => { const i = new Image(); i.onload = () => ok([i.naturalWidth, i.naturalHeight]); i.onerror = () => ok(null); i.src = src; });

// Étapes pour la suite (tâches, personnes, liens par tâche), liens du compte rendu et pièces jointes, pour l'aperçu et l'impression.
function crBlocSuite(r) {
  const t = r.taches || [], l = r.liens || [], f = r.fichiers || [];
  if (!t.length && !l.length && !f.length && !String(r.suite || "").trim()) return "";
  const taches = t.map(x => `<li>${x.fait ? "☑" : "☐"} ${esc(x.texte)}${x.personnes.length ? " — " + esc(x.personnes.map(p => p.prenom).join(", ")) : ""}
    ${x.liens.map(lien => `<div class="crlien">↳ ${esc(lien.libelle)} : ${esc(lien.description)}</div>`).join("")}</li>`).join("");
  const liens = l.map(lien => `<li>${esc(lien.libelle)} : ${esc(lien.description)}</li>`).join("");
  const pj = f.map((x, i) => esc(x.nom) + " (annexe " + (i + 1) + ")").join(", ");
  return `<section class="crsect"><h3>Étapes pour la suite</h3>
    ${t.length ? `<ul>${taches}</ul>` : ""}${String(r.suite || "").trim() ? `<div class="crtxt">${esc(r.suite)}</div>` : ""}
    ${liens ? `<h4>Liens</h4><ul>${liens}</ul>` : ""}${pj ? `<div class="crtxt"><b>Pièces jointes :</b> ${pj}</div>` : ""}</section>`;
}

function ouvrirCompteRendu(id, type = "reunion") {
  if (!$("crmodal")) return;
  CR.ouvert = true; CR.id = id; CR.type = type; CR.focus = document.activeElement;
  const html = crPageCourante(); if (!html) return fermerCompteRendu();
  $("crtitle").textContent = type === "fiche" ? "📄 Aperçu de la fiche de lecture" : type === "synthese" ? "📄 Aperçu de la synthèse" : type === "charte" ? "📄 Aperçu de la charte" : "📄 Aperçu du compte rendu";
  $("crbody").innerHTML = (type === "fiche" ? ficheActionsHtml(id) : "") + html;
  $("crmodal").classList.remove("hidden"); document.body.classList.add("modalopen");
  $("crprint").focus();
  // Les images en annexe arrivent ensuite : l'aperçu est redessiné une fois chargées.
  const r = type === "reunion" ? crReunion() : null;
  if (r) crChargerImages(r).then(n => { if (n && CR.ouvert && CR.id === id) $("crbody").innerHTML = crPageCourante(); });
}
function fermerCompteRendu() {
  if (!CR.ouvert) return;
  CR.ouvert = false;
  $("crmodal").classList.add("hidden");
  if (!cmId && !GM.ouvert && !FB.ouvert && !PR.ouvert) document.body.classList.remove("modalopen");
  $("crbody").innerHTML = "";
  if (CR.focus && CR.focus.isConnected && CR.focus.focus) { try { CR.focus.focus({ preventScroll: true }); } catch (e) { /* ignoré */ } }
}

// Impression : la page est copiée dans un élément à part, seul visible à l'impression (voir style.css).
async function imprimerCompteRendu() {
  if (CR.type === "reunion" && crReunion()) await enCours("Chargement des annexes…", () => crChargerImages(crReunion()));
  const html = crPageCourante(); if (!html) return;
  let z = $("crprintzone");
  if (!z) { z = document.createElement("div"); z.id = "crprintzone"; document.body.appendChild(z); }
  z.innerHTML = html;
  document.body.classList.add("imprime-cr");
  const fin = () => { document.body.classList.remove("imprime-cr"); z.innerHTML = ""; window.removeEventListener("afterprint", fin); };
  window.addEventListener("afterprint", fin);
  window.print();
}

async function pdfCompteRendu() {
  const r = crReunion(); if (!r) return;
  if (!window.jspdf) { alert("Module PDF non chargé."); return; }
  await enCours("Chargement des annexes…", () => crChargerImages(r));
  const g = crGroupe(r);
  const doc = new window.jspdf.jsPDF({ unit: "mm", format: "a4" });
  const larg = 180; let y = 18;
  const ecrire = (texte, taille, gras, couleur) => {
    doc.setFont("helvetica", gras ? "bold" : "normal"); doc.setFontSize(taille); doc.setTextColor(couleur || 20);
    const lignes = doc.splitTextToSize(String(texte), larg);
    lignes.forEach(l => { if (y > 280) { doc.addPage(); y = 18; } doc.text(l, 15, y); y += taille * 0.5 + 1.2; });
  };
  ecrire([g.etablissement, g.promo, g.nom].filter(Boolean).join(" · "), 9, false, 110);
  y += 1; ecrire("Compte rendu de réunion", 17, true); y += 1;
  ecrire(fmtD(r.date) + (r.titre ? " · " + r.titre : ""), 11, false, 70); y += 4;
  const bloc = (titre, texte) => { if (!String(texte || "").trim()) return; ecrire(titre, 11, true); y += 0.5; ecrire(texte, 10, false); y += 4; };
  bloc("Participants", r.participants); bloc("Objectifs", r.objectifs); bloc("Ce qui a été vu", r.vu); bloc("Ce qui est attendu", r.attendu);
  const taches = (r.taches || []).map(x => (x.fait ? "[x] " : "[ ] ") + x.texte + (x.personnes.length ? " (" + x.personnes.map(p => p.prenom).join(", ") + ")" : "")
    + x.liens.map(lien => "\n      ↳ " + lien.libelle + " : " + lien.description).join("")).join("\n");
  bloc("Étapes pour la suite", [taches, r.suite].filter(v => String(v || "").trim()).join("\n"));
  bloc("Liens", (r.liens || []).map(lien => "• " + lien.libelle + " : " + lien.description).join("\n"));
  bloc("Pièces jointes", (r.fichiers || []).map((f, i) => f.nom + " (annexe " + (i + 1) + ")").join(", "));
  y += 2; ecrire("Saisi par " + (r.par || "—") + (r.modifie_par ? " · modifié par " + r.modifie_par : "") + " · édité le " + fmtD(new Date().toISOString()), 8, false, 120);
  // Annexes : une page par pièce jointe, l'image ajustée à la page (190 × 255 mm au plus).
  const fichiers = r.fichiers || [];
  for (let i = 0; i < fichiers.length; i++) {
    const f = fichiers[i];
    doc.addPage(); y = 18;
    ecrire("Annexe " + (i + 1) + " · " + f.nom, 12, true); y += 2;
    const src = CR_IMG.get(f.id);
    const dim = src ? await crDimensions(src) : null;
    if (!src || !dim) { ecrire(crEstImage(f) ? "Image indisponible." : "Document PDF joint au compte rendu, à ouvrir depuis l’outil.", 10, false, 90); continue; }
    const k = Math.min(180 / dim[0], (280 - y) / dim[1]);
    try { doc.addImage(src, /png/i.test(f.type) ? "PNG" : "JPEG", 15, y, dim[0] * k, dim[1] * k); }
    catch (e) { ecrire("Image illisible.", 10, false, 90); }
  }
  const nom = cleTitre(r.titre || "reunion").replace(/[^a-z0-9]+/g, "-").slice(0, 40) || "reunion";
  doc.save("compte-rendu-" + (r.date || stamp()) + "-" + nom + ".pdf");
}

$("crclose")?.addEventListener("click", fermerCompteRendu);
$("crprint")?.addEventListener("click", imprimerCompteRendu);
$("crpdf")?.addEventListener("click", () => CR.type === "fiche" ? exportFichePdf(CR.id) : CR.type === "synthese" ? pdfSynthese() : CR.type === "charte" ? pdfCharte() : pdfCompteRendu());
$("crmodal")?.addEventListener("click", e => { if (e.target === $("crmodal")) fermerCompteRendu(); });
$("crmodal")?.addEventListener("keydown", e => { if (e.key === "Escape") fermerCompteRendu(); });

// Actions d'une fiche, au-dessus de son aperçu (pas imprimées) : commenter, et pour la sienne, modifier et voir ses versions.
function ficheActionsHtml(id) {
  const i = itemsAll.find(x => x.id === id); if (!i) return "";
  const n = comments.filter(x => x.lecture_id === i.id).length, u = nbNonLus(i.id);
  const edit = canWrite() && i.mine && i.modifiable
    ? `<button type="button" class="btn sm" data-fae="${esc(i.id)}">✏️ Modifier ma fiche</button><button type="button" class="btn sm sec" data-fah="${esc(i.id)}" title="Versions précédentes de ma fiche">🕘 Versions</button>` : "";
  return `<div class="cracts">${edit}<button type="button" class="btn sm ${edit ? "sec" : ""}" data-fac="${esc(i.id)}">💬 ${canComment() ? "Commenter" : "Commentaires"} (${n})${u ? ` · <b>${u} nouveau${u > 1 ? "x" : ""}</b>` : ""}</button></div>`;
}
$("crbody")?.addEventListener("click", e => {
  const b = e.target.closest("button"); if (!b) return;
  const d = b.dataset;
  if (d.fac) { fermerCompteRendu(); ouvrirDiscussion(d.fac); }
  else if (d.fae) { fermerCompteRendu(); startEdit(d.fae, false); }
  else if (d.fah) { fermerCompteRendu(); ouvrirHistorique("lecture", d.fah); }
});

// Fiche de lecture : même aperçu, même choix imprimer / PDF.
const ficheDeApercu = () => itemsAll.find(x => x.id === CR.id);
function fichePage(i) {
  const sect = (t, v) => `<section class="crsect"><h3>${esc(t)}</h3><div class="crtxt">${esc(String(v || "").trim() || "—")}</div></section>`;
  const article = ["Parution : " + (fmtD(i.parution) || "-"), ...auteursLignes(i), "Type : " + (i.type || "-")].join("\n");
  return `<article class="crpage">
    <div class="crhead"><div class="crsup">${esc(i.groupe || "")}</div>
      <h2>${esc(i.titre || "Sans titre")}</h2>
      <div class="crsous">Fiche de ${esc(i.etudiant)} (${esc(stInfo(i.statut).lib.toLowerCase())}) · saisie le ${esc(fmtD(i.ajoute))}</div></div>
    <section class="crsect"><h3>Référence APA</h3><div class="crtxt">${esc(LydiaApa.apa(i).text)}</div></section>
    ${sect("Article", article)}${sect("Mots-clés", i.mots)}${sect("Keywords", i.kw)}${sect("Concepts en sciences infirmières", i.concepts)}
    ${sect("Objet / sujet principal", i.objet)}${sect("Opinion de l’auteur", i.opinion)}${sect("Controverse", i.controverse)}${sect("Libre", i.libre)}
    <footer class="crpied">Édité le ${esc(fmtD(new Date().toISOString()))}</footer>
  </article>`;
}
function crPageCourante() {
  if (CR.type === "synthese") return synthesePage();
  if (CR.type === "charte") return chartePage();
  if (CR.type === "fiche") { const i = ficheDeApercu(); return i ? fichePage(i) : ""; }
  const r = crReunion(); return r ? crPage(r) : "";
}
