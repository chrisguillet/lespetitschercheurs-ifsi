/* Charte de fonctionnement du groupe (onglet de gestion de projet) : des règles numérotées, chacune avec un titre et une description.
   Rédigée par les membres du groupe (ajout, modification, ordre, suppression) ; lue par les formateurs. Aperçu, impression et PDF.
   Script classique : portée globale partagée avec js/. Chargé après suivi.js et compterendu.js. */
"use strict";

let chForm = null;   // { id } pendant la saisie (id vide : nouvelle règle) ; la liste n'est pas reconstruite pendant ce temps

// Idées de règles proposées quand la charte est vide : un clic préremplit le formulaire.
const CH_IDEES = [
  ["⏰", "Ponctualité", "On arrive à l’heure aux réunions ; on prévient le groupe au plus tôt en cas de retard ou d’absence."],
  ["💬", "Communication", "On répond aux messages du groupe sous 48 h et on partage les informations utiles à tous."],
  ["🧩", "Répartition des tâches", "Chaque tâche a un ou plusieurs responsables et une échéance, notées dans le compte rendu de réunion."],
  ["📅", "Respect des échéances", "Si une échéance ne peut pas être tenue, on le signale avant la date pour réorganiser le travail."],
  ["🤝", "Bienveillance", "On s’écoute, on critique les idées et non les personnes, et on s’entraide en cas de difficulté."],
  ["🗳️", "Prise de décision", "Les décisions importantes se prennent ensemble ; à défaut de consensus, à la majorité des membres présents."],
];

const chGroupe = () => groupeCourant();
const chRegles = g => reglesAll.filter(r => g && r.groupe_id === g.id).sort((a, b) => a.ordre - b.ordre || String(a.cree_le).localeCompare(String(b.cree_le)));
const chPeutEcrire = g => !!g && canWrite() && groupes.some(x => x.id === g.id);

function renderCharte() {
  const box = $("regles"); if (!box) return;
  const g = chGroupe();
  if (!g) { box.innerHTML = ""; $("regleform").innerHTML = ""; return; }
  const ecrit = chPeutEcrire(g);
  $("addregle").classList.toggle("hidden", !ecrit);
  if (chForm) return;   // saisie en cours : on ne reconstruit pas sous les doigts
  const l = chRegles(g);
  if (!l.length) {
    box.innerHTML = `<div class="ct-vide"><div class="ct-videico" aria-hidden="true">🤝</div>
      <div><b>Votre charte est encore vide.</b><div class="meta">Quelques règles posées dès le début évitent bien des tensions : horaires, communication, partage du travail, décisions…</div></div>
      ${ecrit ? `<div class="ct-idees"><span class="meta">Pour démarrer, choisissez une idée (modifiable) :</span>
        ${CH_IDEES.map((x, i) => `<button type="button" class="ct-idee" data-chidee="${i}">${x[0]} ${esc(x[1])}</button>`).join("")}</div>` : ""}</div>`;
    return;
  }
  box.innerHTML = `<div class="ct-bar"><span class="meta">Groupe <b>${esc(g.nom)}</b> · ${l.length} règle${l.length > 1 ? "s" : ""}</span>
      <button type="button" class="btn sm sec" data-chapercu title="Aperçu avant impression ou enregistrement en PDF">📄 Aperçu / PDF</button></div>
    <ol class="ct-liste">${l.map((r, i) => chRegleHtml(r, i, l.length, ecrit)).join("")}</ol>`;
}

function chRegleHtml(r, i, n, ecrit) {
  const outils = ecrit && r.modifiable ? `<div class="ct-outils">
      <button type="button" class="btn sm sec" data-chmove="${esc(r.id)}" data-sens="-1" ${i === 0 ? "disabled" : ""} aria-label="Monter la règle ${i + 1}" title="Monter">↑</button>
      <button type="button" class="btn sm sec" data-chmove="${esc(r.id)}" data-sens="1" ${i === n - 1 ? "disabled" : ""} aria-label="Descendre la règle ${i + 1}" title="Descendre">↓</button>
      <button type="button" class="btn sm sec" data-ched="${esc(r.id)}" aria-label="Modifier la règle ${i + 1}" title="Modifier">✏️</button>
      <button type="button" class="btn sm sec del" data-chdel="${esc(r.id)}" aria-label="Supprimer la règle ${i + 1}" title="Supprimer">🗑</button></div>` : "";
  return `<li class="ct-regle" id="regle_${esc(r.id)}"><span class="ct-num" aria-hidden="true">${i + 1}</span>
    <div class="ct-corps"><div class="ct-tete"><h3 class="ct-titre">${esc(r.titre)}</h3>${outils}</div>
      ${String(r.description || "").trim() ? `<div class="ct-desc">${esc(r.description)}</div>` : ""}
      <div class="ct-par">proposée par ${esc(r.par)}${r.modifie_par ? ` · modifiée par ${esc(r.modifie_par)}` : ""}</div></div></li>`;
}

// Formulaire : à la place de la règle modifiée, ou en tête pour une nouvelle règle.
function ouvrirRegleForm(id, modele) {
  const g = chGroupe(); if (!chPeutEcrire(g)) return;
  fermerRegleForm(false);
  chForm = { id: id || "" };
  const r = reglesAll.find(x => x.id === id) || { titre: modele ? modele[1] : "", description: modele ? modele[2] : "" };
  const html = `<div class="ct-form"><div><label for="ch_titre">Titre de la règle</label><input id="ch_titre" maxlength="200" value="${esc(r.titre)}" placeholder="ex. Ponctualité"></div>
    <div><label for="ch_desc">Description <span class="meta">(ce que le groupe s’engage à faire)</span></label><textarea id="ch_desc" maxlength="2500" rows="3" placeholder="ex. On arrive à l’heure aux réunions ; on prévient en cas de retard.">${esc(r.description)}</textarea></div>
    <div class="savebar"><div id="cherr" class="err" role="alert"></div><button class="btn" id="chsave" type="button">${id ? "Enregistrer la règle" : "Ajouter la règle"}</button> <button class="btn sec" id="chcancel" type="button">Annuler</button></div></div>`;
  const li = id && $("regle_" + id);
  if (li) { li.classList.add("ct-edition"); li.querySelector(".ct-corps").innerHTML = html; }
  else $("regleform").innerHTML = html;
  $("chsave").onclick = () => enregistrerRegle(g.id, id);
  $("chcancel").onclick = () => fermerRegleForm(true);
  $("ch_titre").addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); enregistrerRegle(g.id, id); } });
  $("ch_titre").focus();
  if (modele) $("ch_titre").select();
}

function fermerRegleForm(redessiner) {
  const avait = !!chForm;
  chForm = null; $("regleform").innerHTML = "";
  if (avait && redessiner) renderCharte();
}

async function enregistrerRegle(gid, id) {
  const data = { titre: $("ch_titre").value.trim(), description: $("ch_desc").value.trim() };
  if (!data.titre) { $("cherr").textContent = "Donnez un titre à la règle."; $("ch_titre").focus(); return; }
  try {
    const res = await enCours("Enregistrement…", () => api("regle_save", { groupe_id: gid, id: id || undefined, data }));
    chForm = null; $("regleform").innerHTML = "";
    applyResult(res);
    renderCharte();
  } catch (e) {
    if (e.code === "unauthorized") sessionError(e); else $("cherr").textContent = e.code === "limit" ? e.message : "Enregistrement impossible : " + e.message;
  }
}

async function deplacerRegle(id, sens) {
  try { applyResult(await enCours("Déplacement…", () => api("regle_move", { id, sens }))); renderCharte(); }
  catch (e) { if (e.code === "unauthorized") sessionError(e); else alert("Déplacement impossible : " + e.message); }
}

async function supprimerRegle(id) {
  const r = reglesAll.find(x => x.id === id);
  if (!confirm("Supprimer la règle « " + ((r && r.titre) || "") + " » de la charte ?")) return;
  try { applyResult(await enCours("Suppression…", () => api("regle_delete", { id }))); renderCharte(); }
  catch (e) { if (e.code === "unauthorized") sessionError(e); else alert("Suppression impossible : " + e.message); }
}

// ---------- Aperçu, impression et PDF (même fenêtre que les comptes rendus) ----------

function chartePage() {
  const g = chGroupe(); if (!g) return "";
  const l = chRegles(g);
  const membres = (g.membres || []).map(m => m.prenom).filter(Boolean);
  return `<article class="crpage ct-page">
    <div class="crhead"><div class="crsup">${esc([g.etablissement, g.promo, g.nom].filter(Boolean).join(" · "))}</div>
      <h2>Charte de fonctionnement</h2>
      <div class="crsous">Groupe ${esc(g.nom)} · ${l.length} règle${l.length > 1 ? "s" : ""}</div></div>
    ${l.length ? `<ol class="ct-pliste">${l.map(r => `<li><b>${esc(r.titre)}</b>${String(r.description || "").trim() ? `<div class="crtxt">${esc(r.description)}</div>` : ""}</li>`).join("")}</ol>`
      : '<div class="meta">Aucune règle pour l’instant.</div>'}
    ${membres.length ? `<section class="crsect"><h3>Les membres du groupe s’engagent à respecter cette charte</h3>
      <div class="ct-sign">${membres.map(p => `<div><span>${esc(p)}</span><i>Signature</i></div>`).join("")}</div></section>` : ""}
    <footer class="crpied">Édité le ${esc(fmtD(new Date().toISOString()))}</footer></article>`;
}

function pdfCharte() {
  const g = chGroupe(); if (!g) return;
  if (!window.jspdf) { alert("Module PDF non chargé."); return; }
  const doc = new window.jspdf.jsPDF({ unit: "mm", format: "a4" });
  const larg = 172; let y = 18;
  const saut = h => { if (y + h > 282) { doc.addPage(); y = 18; } };
  const ecrire = (texte, taille, gras, couleur, x = 15, l = larg) => {
    doc.setFont("helvetica", gras ? "bold" : "normal"); doc.setFontSize(taille); doc.setTextColor(couleur || 20);
    doc.splitTextToSize(String(texte), l).forEach(t => { saut(taille * 0.5); doc.text(t, x, y); y += taille * 0.5 + 1.2; });
  };
  ecrire([g.etablissement, g.promo, g.nom].filter(Boolean).join(" · "), 9, false, 110);
  y += 1; ecrire("Charte de fonctionnement", 18, true); ecrire("Groupe " + g.nom, 11, false, 70);
  doc.setDrawColor(47, 95, 208); doc.setLineWidth(0.6); doc.line(15, y, 195, y); y += 8;
  chRegles(g).forEach((r, i) => {
    saut(14);
    doc.setFillColor(47, 95, 208); doc.circle(19, y - 1.4, 3.6, "F");
    doc.setFont("helvetica", "bold"); doc.setFontSize(10); doc.setTextColor(255); doc.text(String(i + 1), 19, y, { align: "center" });
    ecrire(r.titre, 12, true, 20, 26, larg - 11);
    if (String(r.description || "").trim()) { y += 0.5; ecrire(r.description, 10, false, 50, 26, larg - 11); }
    y += 4;
  });
  const membres = (g.membres || []).map(m => m.prenom).filter(Boolean);
  if (membres.length) {
    y += 4; saut(30); ecrire("Les membres du groupe s'engagent à respecter cette charte", 11, true, 47);
    y += 2;
    membres.forEach((p, i) => {
      const col = i % 2, x = 15 + col * 92;
      if (col === 0) saut(22);
      doc.setFont("helvetica", "normal"); doc.setFontSize(10); doc.setTextColor(20); doc.text(p, x, y);
      doc.setDrawColor(170); doc.setLineWidth(0.2); doc.line(x, y + 12, x + 80, y + 12);
      doc.setFontSize(8); doc.setTextColor(130); doc.text("Signature", x, y + 16);
      if (col === 1 || i === membres.length - 1) y += 22;
    });
  }
  y += 2; saut(8); ecrire("Édité le " + fmtD(new Date().toISOString()), 8, false, 120);
  doc.save("charte-" + (cleTitre(g.nom || "groupe").replace(/[^a-z0-9]+/g, "-").slice(0, 40) || "groupe") + "-" + stamp() + ".pdf");
}

$("addregle")?.addEventListener("click", () => ouvrirRegleForm(""));
$("charte")?.addEventListener("click", e => {
  const b = e.target.closest("button"); if (!b || b.disabled) return;
  const d = b.dataset;
  if (d.ct-idee !== undefined) return ouvrirRegleForm("", CH_IDEES[+d.ct-idee]);
  if (d.chapercu !== undefined) return ouvrirCompteRendu("", "charte");
  if (d.ched) return ouvrirRegleForm(d.ched);
  if (d.chdel) return supprimerRegle(d.chdel);
  if (d.chmove) return deplacerRegle(d.chmove, Number(d.sens));
});
