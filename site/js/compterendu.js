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
    ${sect("Ce qui a été vu", r.vu)}${sect("Ce qui est attendu", r.attendu)}${crBlocSuite(r)}
    ${[r.vu, r.attendu, r.suite].some(v => String(v || "").trim()) || (r.taches || []).length ? "" : '<div class="meta">Ce compte rendu est vide.</div>'}
    <footer class="crpied">Saisi par ${esc(r.par || "—")}${r.modifie_par ? ` · modifié par ${esc(r.modifie_par)}` : ""} · édité le ${esc(fmtD(new Date().toISOString()))}</footer>
  </article>`;
}

// Étapes pour la suite (tâches, personnes, liens par tâche), liens du compte rendu et pièces jointes, pour l'aperçu et l'impression.
function crBlocSuite(r) {
  const t = r.taches || [], l = r.liens || [], f = r.fichiers || [];
  if (!t.length && !l.length && !f.length && !String(r.suite || "").trim()) return "";
  const taches = t.map(x => `<li>${x.fait ? "☑" : "☐"} ${esc(x.texte)}${x.personnes.length ? " — " + esc(x.personnes.map(p => p.prenom).join(", ")) : ""}
    ${x.liens.map(lien => `<div class="crlien">↳ ${esc(lien.libelle)} : ${esc(lien.description)}</div>`).join("")}</li>`).join("");
  const liens = l.map(lien => `<li>${esc(lien.libelle)} : ${esc(lien.description)}</li>`).join("");
  const pj = f.map(x => esc(x.nom)).join(", ");
  return `<section class="crsect"><h3>Étapes pour la suite</h3>
    ${t.length ? `<ul>${taches}</ul>` : ""}${String(r.suite || "").trim() ? `<div class="crtxt">${esc(r.suite)}</div>` : ""}
    ${liens ? `<h4>Liens</h4><ul>${liens}</ul>` : ""}${pj ? `<div class="crtxt"><b>Pièces jointes :</b> ${pj}</div>` : ""}</section>`;
}

function ouvrirCompteRendu(id, type = "reunion") {
  if (!$("crmodal")) return;
  CR.ouvert = true; CR.id = id; CR.type = type; CR.focus = document.activeElement;
  const html = crPageCourante(); if (!html) return fermerCompteRendu();
  $("crtitle").textContent = type === "fiche" ? "📄 Aperçu de la fiche de lecture" : type === "synthese" ? "📄 Aperçu de la synthèse" : "📄 Aperçu du compte rendu";
  $("crbody").innerHTML = html;
  $("crmodal").classList.remove("hidden"); document.body.classList.add("modalopen");
  $("crprint").focus();
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
function imprimerCompteRendu() {
  const html = crPageCourante(); if (!html) return;
  let z = $("crprintzone");
  if (!z) { z = document.createElement("div"); z.id = "crprintzone"; document.body.appendChild(z); }
  z.innerHTML = html;
  document.body.classList.add("imprime-cr");
  const fin = () => { document.body.classList.remove("imprime-cr"); z.innerHTML = ""; window.removeEventListener("afterprint", fin); };
  window.addEventListener("afterprint", fin);
  window.print();
}

function pdfCompteRendu() {
  const r = crReunion(); if (!r) return;
  if (!window.jspdf) { alert("Module PDF non chargé."); return; }
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
  bloc("Participants", r.participants); bloc("Ce qui a été vu", r.vu); bloc("Ce qui est attendu", r.attendu);
  const taches = (r.taches || []).map(x => (x.fait ? "[x] " : "[ ] ") + x.texte + (x.personnes.length ? " (" + x.personnes.map(p => p.prenom).join(", ") + ")" : "")
    + x.liens.map(lien => "\n      ↳ " + lien.libelle + " : " + lien.description).join("")).join("\n");
  bloc("Étapes pour la suite", [taches, r.suite].filter(v => String(v || "").trim()).join("\n"));
  bloc("Liens", (r.liens || []).map(lien => "• " + lien.libelle + " : " + lien.description).join("\n"));
  bloc("Pièces jointes", (r.fichiers || []).map(f => f.nom).join(", "));
  y += 2; ecrire("Saisi par " + (r.par || "—") + (r.modifie_par ? " · modifié par " + r.modifie_par : "") + " · édité le " + fmtD(new Date().toISOString()), 8, false, 120);
  const nom = cleTitre(r.titre || "reunion").replace(/[^a-z0-9]+/g, "-").slice(0, 40) || "reunion";
  doc.save("compte-rendu-" + (r.date || stamp()) + "-" + nom + ".pdf");
}

$("crclose")?.addEventListener("click", fermerCompteRendu);
$("crprint")?.addEventListener("click", imprimerCompteRendu);
$("crpdf")?.addEventListener("click", () => CR.type === "fiche" ? exportFichePdf(CR.id) : CR.type === "synthese" ? pdfSynthese() : pdfCompteRendu());
$("crmodal")?.addEventListener("click", e => { if (e.target === $("crmodal")) fermerCompteRendu(); });
$("crmodal")?.addEventListener("keydown", e => { if (e.key === "Escape") fermerCompteRendu(); });

// Fiche de lecture : même aperçu, même choix imprimer / PDF.
const ficheDeApercu = () => itemsAll.find(x => x.id === CR.id);
function fichePage(i) {
  const sect = (t, v) => `<section class="crsect"><h3>${esc(t)}</h3><div class="crtxt">${esc(String(v || "").trim() || "—")}</div></section>`;
  const auteurs = auteursDe(i).map(a => "Auteur : " + (a.nom || "-") + " — métier : " + (a.qualite || "-") + " ; nationalité : " + (a.nation || "-"));
  const article = ["Parution : " + (fmtD(i.parution) || "-"), ...(auteurs.length ? auteurs : ["Auteur : -"]), "Type : " + (i.type || "-")].join("\n");
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
  if (CR.type === "fiche") { const i = ficheDeApercu(); return i ? fichePage(i) : ""; }
  const r = crReunion(); return r ? crPage(r) : "";
}
