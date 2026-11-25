/* Détail de chaque compte rendu dans l'onglet Suivi : tâches (avec personnes), liens (articles, fiches, blocs du mémoire, avec la raison du lien)
   et pièces jointes (5 au plus ; les images sont réduites avant l'envoi, puis à 300 Ko côté serveur).
   Script classique : portée globale partagée avec js/. Chargé après suivi.js et compterendu.js. */
"use strict";

const CR_PIECES_MAX = 20;
const CR_IMAGE_SEUIL = 2 * 1024 * 1024;   // au-delà, une photo est réduite dans le navigateur avant l'envoi
const CR_FICHIER_MAX = 5 * 1024 * 1024;   // taille maximale d'une pièce jointe (comme le serveur)
const CR_LIENS = { mem: [] };              // blocs du mémoire chargés pour le choix d’un lien

// Sur téléphone ou tablette : bouton qui ouvre directement l'appareil photo (capture) ; la photo est ajoutée dès qu'elle est prise.
// Écran tactile (téléphone, tablette, y compris un iPad qui se présente comme un Mac) : le bouton photo est proposé.
const crTactile = () => (navigator.maxTouchPoints || 0) > 0 || !!(window.matchMedia && matchMedia("(any-pointer: coarse)").matches);
const crBoutonPhoto = attrs => crTactile() ? ` <button type="button" class="btn sm sec" ${attrs.bouton}>📷 Prendre une photo</button><input type="file" hidden ${attrs.champ} accept="image/*" capture="environment">` : "";
// Les photos de l'appareil arrivent souvent sous le nom « image.jpg » : on leur donne un nom daté.
function crNomPhoto(file) {
  const d = new Date(), p = n => String(n).padStart(2, "0");
  return "photo-" + d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + "-" + p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds()) + ".jpg";
}

const crTaille = n => (n < 1024 * 1024 ? Math.round(n / 1024) + " Ko" : (n / 1024 / 1024).toFixed(1) + " Mo");

// Liens d'une liste (tâche ou compte rendu).
function liensHtml(liens, ecrit) {
  if (!liens || !liens.length) return "";
  return `<ul class="crliens">${liens.map(l => `<li>🔗 <b>${esc(l.libelle)}</b> — ${esc(l.description)} <span class="meta">(${esc(l.par)})</span>
    ${ecrit ? `<button type="button" class="btn sm sec del" data-ldel="${esc(l.id)}" aria-label="Retirer le lien">✕</button>` : ""}</li>`).join("")}</ul>`;
}

// Une tâche : case « fait », personnes, liens, et des outils (personnes, lien, suppression).
function tacheHtml(t, r, membres, ecrit) {
  const pers = t.personnes.map(p => `<span class="chip">${esc(p.prenom)}</span>`).join(" ");
  return `<li class="crtache">
    <div class="tools"><label class="chk"><input type="checkbox" data-tfait="${esc(t.id)}" ${t.fait ? "checked" : ""} ${ecrit ? "" : "disabled"}> <span class="${t.fait ? "meta" : ""}">${esc(t.texte)}</span></label> ${pers}
      <input type="date" data-techeance="${esc(t.id)}" value="${esc(t.echeance || "")}" title="Échéance : la tâche apparaît alors dans le calendrier" aria-label="Échéance de la tâche" ${ecrit ? "" : "disabled"}>
      ${ecrit ? `<button type="button" class="btn sm sec" data-tpers="${esc(t.id)}" aria-expanded="false" title="Personnes concernées">👥</button>
      <button type="button" class="btn sm sec" data-lnew="${esc(t.id)}" data-rid="${esc(r.id)}" title="Lier un article, une fiche ou un bloc du mémoire">🔗 Lier</button>
      <button type="button" class="btn sm sec del" data-tdel="${esc(t.id)}" aria-label="Supprimer la tâche">🗑</button>` : ""}</div>
    ${ecrit ? `<div class="crtpers hidden" id="tp_${esc(t.id)}">${membres.map(m => `<label class="chk"><input type="checkbox" data-tp="${esc(t.id)}" value="${esc(m.pid)}" ${t.personnes.some(p => p.pid === m.pid) ? "checked" : ""}> ${esc(m.prenom)}</label>`).join("")}</div>` : ""}
    ${liensHtml(t.liens, ecrit)}
    <div id="lf_${esc(r.id)}_${esc(t.id)}"></div>
  </li>`;
}

// Bloc « Tâches, liens et pièces jointes » d'un compte rendu, à la place de l'ancienne étape « pour la suite ».
function reunionDetailHtml(x) {
  const ecrit = !!x.modifiable;
  const taches = x.taches || [], liens = x.liens || [], pieces = x.fichiers || [];
  const membres = (groupeCourant() || {}).membres || [];
  return `<div class="crdetail">
    ${String(x.suite || "").trim() ? `<div class="sect"><b>Étapes (ancien format)</b><div style="white-space:pre-wrap">${esc(x.suite)}</div></div>` : ""}
    <div class="sect"><b>Tâches pour la suite</b>
      ${taches.length ? `<ul class="crtaches">${taches.map(t => tacheHtml(t, x, membres, ecrit)).join("")}</ul>` : '<div class="meta">Aucune tâche pour l’instant.</div>'}
      ${ecrit ? `<button type="button" class="btn sm sec" data-tf-open="${esc(x.id)}">＋ Ajouter une tâche</button><div id="tf_${esc(x.id)}"></div>` : ""}
    </div>
    <div class="sect"><b>Liens de la réunion</b> <span class="meta">(un article, une fiche ou un bloc du mémoire, et pourquoi)</span>
      ${liens.length ? liensHtml(liens, ecrit) : '<div class="meta">Aucun lien pour l’instant.</div>'}
      ${ecrit ? `<button type="button" class="btn sm sec" data-lnew="" data-rid="${esc(x.id)}">🔗 Ajouter un lien</button><div id="lf_${esc(x.id)}_"></div>` : ""}
    </div>
    <div class="sect"><b>Pièces jointes</b> <span class="meta">(${pieces.length}/${CR_PIECES_MAX} ; images réduites à 300 Ko)</span>
      ${pieces.length ? `<ul class="crpieces">${pieces.map(f => `<li><button type="button" class="btn sm sec" data-fdl="${esc(f.id)}" title="Voir la pièce jointe">📎 ${esc(f.nom)}</button> <span class="meta">${esc(crTaille(f.taille))} · ${esc(f.par)}</span>
        ${ecrit ? ` <button type="button" class="btn sm sec del" data-fdel="${esc(f.id)}" aria-label="Supprimer la pièce jointe">🗑</button>` : ""}</li>`).join("")}</ul>` : '<div class="meta">Aucune pièce jointe.</div>'}
      ${ecrit && pieces.length < CR_PIECES_MAX ? `<button type="button" class="btn sm sec" data-fadd="${esc(x.id)}">＋ Joindre un fichier</button><input type="file" hidden data-fin="${esc(x.id)}" accept="application/pdf,image/png,image/jpeg">${crBoutonPhoto({ bouton: `data-fcam="${esc(x.id)}"`, champ: `data-fcin="${esc(x.id)}"` })}` : ""}
    </div></div>`;
}

// Retrouve une tâche et son compte rendu.
function crTacheDe(tid) {
  for (const r of reunionsAll) {
    const t = (r.taches || []).find(x => x.id === tid);
    if (t) return { r, t };
  }
  return null;
}

// Enregistre une tâche (création si pas d’identifiant). Le serveur remplace les personnes par la liste reçue.
async function enregistrerTache(rid, tid, data) {
  const r = reunionsAll.find(x => x.id === rid); if (!r) return;
  try { applyResult(await enCours("Enregistrement…", () => api("tache_save", { groupe_id: r.groupe_id, reunion_id: rid, id: tid || undefined, data }))); }
  catch (e) { if (e.code === "unauthorized") sessionError(e); else alert("Enregistrement impossible : " + e.message); }
}

async function supprimerTache(tid) {
  try { applyResult(await enCours("Suppression…", () => api("tache_delete", { id: tid }))); }
  catch (e) { if (e.code === "unauthorized") sessionError(e); else alert("Suppression impossible : " + e.message); }
}

// Choix d’un lien : type (fiche ou bloc du mémoire) et élément ; le texte « pourquoi » est obligatoire.
async function ouvrirLienForm(rid, tid) {
  const zone = $("lf_" + rid + "_" + (tid || ""));
  if (!zone) return;
  zone.innerHTML = `<div class="card crlform" data-rid="${esc(rid)}" data-tid="${esc(tid || "")}" style="margin-top:8px">
    <div class="grid"><div><label>Type</label><select data-lt><option value="fiche">Article (fiche de lecture)</option><option value="bloc_memoire">Bloc du mémoire</option></select></div>
    <div><label>Élément</label><select data-li></select></div></div>
    <label>Pourquoi ce lien ? <input data-ld maxlength="300" placeholder="ex. Source de la partie sur l’autonomie"></label>
    <div class="savebar"><div class="err" data-lerr role="alert"></div><button type="button" class="btn sm" data-lsave>Lier</button> <button type="button" class="btn sm sec" data-lcancel>Annuler</button></div></div>`;
  remplirChoixLien(zone);
  const g = groupeCourant() || {};
  if (!MEM.data || MEM.gid !== g.id) {
    try { MEM.data = (await api("memoire_get", { groupe_id: g.id })).memoire; MEM.gid = g.id; remplirChoixLien(zone); }
    catch (e) { if (e.code === "unauthorized") return sessionError(e); }
  }
}

// Remplit la liste des éléments selon le type choisi.
function remplirChoixLien(zone) {
  const g = groupeCourant() || {};
  const type = zone.querySelector("[data-lt]").value;
  const li = zone.querySelector("[data-li]");
  if (type === "fiche") {
    const fiches = itemsAll.filter(i => i.groupe_id === g.id);
    li.innerHTML = fiches.length ? fiches.map(i => `<option value="${esc(i.id)}">${esc(i.titre || "Sans titre")}${i.auteur ? " (" + esc(i.auteur) + ")" : ""}</option>`).join("") : '<option value="">Aucune fiche dans ce groupe</option>';
  } else {
    const blocs = (MEM.data && MEM.gid === g.id ? MEM.data.blocs : []).filter(b => b.texte.trim());
    li.innerHTML = blocs.length ? blocs.map(b => `<option value="${esc(b.id)}">${esc(b.texte.replace(/\*\*|\*|\^\[|\]/g, "").trim().slice(0, 80))}</option>`).join("") : '<option value="">Aucun bloc de texte dans le mémoire</option>';
  }
}

// Enregistre le lien posé sur un compte rendu ou sur une tâche.
async function enregistrerLien(zone) {
  const rid = zone.dataset.rid, tid = zone.dataset.tid || "";
  const enAttente = rid === "";   // nouveau compte rendu : le lien est gardé jusqu'à l'enregistrement
  const r = enAttente ? { groupe_id: (groupeCourant() || {}).id } : reunionsAll.find(x => x.id === rid);
  if (!r) return;
  const cible = zone.querySelector("[data-li]").value, description = zone.querySelector("[data-ld]").value.trim();
  const err = zone.querySelector("[data-lerr]");
  if (!cible) { err.textContent = "Choisissez un élément à lier."; return; }
  if (!description) { err.textContent = "Indiquez pourquoi ce lien est utile."; return; }
  const cible_type = zone.querySelector("[data-lt]").value;
  if (enAttente) {
    const choix = zone.querySelector("[data-li]").selectedOptions[0];
    const lien = { cible_type, cible_id: cible, description, libelle: choix ? choix.textContent : cible };
    // « p<i> » désigne la tâche en attente d'indice i ; sinon le lien est sur le compte rendu.
    if (zone.dataset.tid && zone.dataset.tid[0] === "p") crEnAttente.taches[Number(zone.dataset.tid.slice(1))].liens.push(lien);
    else crEnAttente.liens.push(lien);
    zone.innerHTML = "";
    crAttenteRafraichir();
    return;
  }
  try {
    applyResult(await enCours("Enregistrement…", () => api("lien_save", { groupe_id: r.groupe_id, reunion_id: rid, tache_id: tid || undefined, data: { cible_type, cible_id: cible, description } })));
  } catch (e) { if (e.code === "unauthorized") sessionError(e); else err.textContent = "Enregistrement impossible : " + e.message; }
}

// Pièce jointe gardée pour le nouveau compte rendu ; le serveur contrôle le format et la taille à l'enregistrement.
async function ajouterPieceEnAttente(file, reduire = false) {
  if (crEnAttente.fichiers.length >= CR_PIECES_MAX) { alert("Vingt pièces jointes au plus par compte rendu."); return; }
  if (!/^image\//.test(file.type) && file.size > CR_FICHIER_MAX) { alert("Fichier trop volumineux (5 Mo maximum)."); return; }
  try {
    const contenu = await crContenuFichier(file, reduire);
    crEnAttente.fichiers.push({ nom: file.name, contenu });
    crAttenteRafraichir();
  } catch (e) { alert("Fichier illisible : " + e.message); }
}

async function supprimerLien(lid) {
  try { applyResult(await enCours("Suppression…", () => api("lien_delete", { id: lid }))); }
  catch (e) { if (e.code === "unauthorized") sessionError(e); else alert("Suppression impossible : " + e.message); }
}

// Lecture d'un fichier en base64 (sans l'en-tête data:).
function crLireBase64(blob) {
  return new Promise((ok, ko) => {
    const r = new FileReader();
    r.onload = () => ok(String(r.result).split(",")[1] || "");
    r.onerror = () => ko(new Error("lecture impossible"));
    r.readAsDataURL(blob);
  });
}

// Une photo lourde est réduite ici (1600 px, JPEG) avant l'envoi ; le serveur la ramène ensuite à 300 Ko au plus.
// Une photo prise avec l'appareil (reduire = true) est toujours réduite, quelle que soit sa taille.
async function crContenuFichier(file, reduire = false) {
  if (!/^image\//.test(file.type) || (!reduire && file.size <= CR_IMAGE_SEUIL)) return crLireBase64(file);
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((ok, ko) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => ko(new Error("image illisible")); i.src = url; });
    const f = Math.min(1, 1600 / Math.max(img.width, img.height));
    const c = document.createElement("canvas");
    c.width = Math.round(img.width * f); c.height = Math.round(img.height * f);
    const ctx = c.getContext("2d"); ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, c.width, c.height); ctx.drawImage(img, 0, 0, c.width, c.height);
    const blob = await new Promise(ok => c.toBlob(ok, "image/jpeg", 0.85));
    return crLireBase64(blob);
  } finally { URL.revokeObjectURL(url); }
}

async function ajouterPiece(rid, file, reduire = false) {
  try {
    const contenu = await crContenuFichier(file, reduire);
    applyResult(await enCours("Envoi du fichier…", () => api("reunion_fichier_ajouter", { reunion_id: rid, nom: file.name, contenu })));
  } catch (e) { if (e.code === "unauthorized") sessionError(e); else alert("Envoi impossible : " + e.message); }
}

// Aperçu d'une pièce jointe dans une fenêtre : l'image, ou le PDF dans un cadre ; on peut aussi la télécharger.
let crPjUrl = "";
function crPieceDe(fid) {
  for (const r of reunionsAll) { const f = (r.fichiers || []).find(x => x.id === fid); if (f) return f; }
  return null;
}
async function apercuPiece(fid) {
  const f = crPieceDe(fid); if (!f) return;
  let src = CR_IMG.get(fid);
  try {
    if (!src || !crEstImage(f)) {
      const d = await enCours("Ouverture de la pièce jointe…", () => api("reunion_fichier_lire", { id: fid }));
      const octets = Uint8Array.from(atob(d.data), c => c.charCodeAt(0));
      if (crEstImage(f)) { src = "data:" + d.type + ";base64," + d.data; CR_IMG.set(fid, src); }
      else { if (crPjUrl) URL.revokeObjectURL(crPjUrl); crPjUrl = URL.createObjectURL(new Blob([octets], { type: d.type })); src = crPjUrl; }
    }
  } catch (e) { if (e.code === "unauthorized") sessionError(e); else alert("Ouverture impossible : " + e.message); return; }
  fermerApercuPiece();
  const m = document.createElement("div");
  m.id = "pjmodal"; m.className = "modal"; m.setAttribute("role", "dialog"); m.setAttribute("aria-modal", "true"); m.setAttribute("aria-label", "Aperçu de " + f.nom);
  m.innerHTML = `<div class="modalbox" style="max-width:920px">
    <div class="modalhead"><div><h2>📎 ${esc(f.nom)}</h2></div>
      <div class="grow"><button class="btn sm" type="button" data-pjdl="${esc(fid)}">⬇️ Télécharger</button><button class="btn sm sec" type="button" data-pjclose>✕ Fermer</button></div></div>
    <div class="pjcorps">${crEstImage(f) ? `<img src="${src}" alt="${esc(f.nom)}">` : `<iframe src="${src}" title="${esc(f.nom)}"></iframe>`}</div>
    ${crEstImage(f) ? "" : '<div class="meta" style="margin-top:6px">Si le PDF ne s’affiche pas (certains téléphones), utilisez « Télécharger ».</div>'}</div>`;
  m.addEventListener("click", e => {
    if (e.target === m || e.target.closest("[data-pjclose]")) return fermerApercuPiece();
    const b = e.target.closest("[data-pjdl]"); if (b) telechargerPiece(b.dataset.pjdl);
  });
  m.addEventListener("keydown", e => { if (e.key === "Escape") fermerApercuPiece(); });
  document.body.appendChild(m); document.body.classList.add("modalopen");
  m.querySelector("[data-pjclose]").focus();
}
function fermerApercuPiece() {
  const m = $("pjmodal"); if (!m) return;
  m.remove();
  if (crPjUrl) { URL.revokeObjectURL(crPjUrl); crPjUrl = ""; }
  if (!document.querySelector(".modal:not(.hidden)")) document.body.classList.remove("modalopen");
}

async function telechargerPiece(fid) {
  try {
    const r = await enCours("Préparation du fichier…", () => api("reunion_fichier_lire", { id: fid }));
    const octets = Uint8Array.from(atob(r.data), c => c.charCodeAt(0));
    telecharger(new Blob([octets], { type: r.type }), r.nom);
  } catch (e) { if (e.code === "unauthorized") sessionError(e); else alert("Téléchargement impossible : " + e.message); }
}

async function supprimerPiece(fid) {
  try { applyResult(await enCours("Suppression…", () => api("reunion_fichier_supprimer", { id: fid }))); }
  catch (e) { if (e.code === "unauthorized") sessionError(e); else alert("Suppression impossible : " + e.message); }
}

// ---------- Éléments d'un nouveau compte rendu : saisis avant l'enregistrement, envoyés une fois le compte rendu créé ----------

let crEnAttente = { taches: [], liens: [], fichiers: [] };

function crAttenteReinit() { crEnAttente = { taches: [], liens: [], fichiers: [] }; }

// Formulaire « Ajouter une tâche » : texte, échéance, personnes, puis Ajouter ou Annuler. rid vide = nouveau compte rendu.
function tacheFormHtml(rid) {
  const membres = (groupeCourant() || {}).membres || [];
  return `<div class="card crtform" data-rid="${esc(rid)}" style="margin-top:8px">
    <div class="grid"><div><label>Tâche</label><input data-tf-texte maxlength="300" placeholder="ex. chercher deux articles sur l’autonomie"></div>
    <div><label>Échéance <span class="meta">(facultative : la tâche apparaît alors dans le calendrier)</span></label><input type="date" data-tf-echeance></div></div>
    <div><label>Personnes concernées</label><select data-tf-pers multiple size="3">${membres.map(x => `<option value="${esc(x.pid)}">${esc(x.prenom)}</option>`).join("")}</select></div>
    <div class="savebar"><div class="err" data-tf-err role="alert"></div><button type="button" class="btn sm" data-tf-ok>Ajouter</button> <button type="button" class="btn sm sec" data-tf-cancel>Annuler</button></div></div>`;
}

// Valide le formulaire : sur un compte rendu existant la tâche est enregistrée tout de suite ; sur un nouveau elle attend l'enregistrement.
async function validerTacheForm(form) {
  const err = form.querySelector("[data-tf-err]");
  const texte = form.querySelector("[data-tf-texte]").value.trim();
  if (!texte) { err.textContent = "Indiquez la tâche."; return; }
  const echeance = form.querySelector("[data-tf-echeance]").value;
  const personnes = [...form.querySelector("[data-tf-pers]").selectedOptions].map(o => o.value);
  const rid = form.dataset.rid;
  if (rid === "") { crEnAttente.taches.push({ texte, personnes, echeance, liens: [] }); crAttenteRafraichir(); return; }
  await enregistrerTache(rid, "", { texte, fait: false, personnes, echeance });
}

// Zone « Étapes, liens et pièces jointes » du formulaire de compte rendu.
// En modification d'un compte rendu existant : ses tâches, liens et pièces jointes, modifiables aussitôt (comme sur sa fiche).
// La zone n'est redessinée que si ces éléments ont changé, pour ne pas fermer un formulaire en cours de saisie.
let crDetailSignature = "";
function crAttenteRafraichir() {
  const z = $("cr_attente"); if (!z) return;
  const enModif = suiviForm && suiviForm.type === "reunion" && suiviForm.id ? reunionsAll.find(r => r.id === suiviForm.id) : null;
  if (enModif) {
    const sig = JSON.stringify([enModif.taches, enModif.liens, enModif.fichiers, enModif.suite, enModif.modifiable]);
    if (sig === crDetailSignature && z.firstChild) return;
    crDetailSignature = sig;
    z.innerHTML = reunionDetailHtml(enModif);
    return;
  }
  crDetailSignature = "";
  const m = crEnAttente, membres = (groupeCourant() || {}).membres || [];
  const retrait = cle => `<button type="button" class="btn sm sec del" data-ca-del="${cle}" aria-label="Retirer">✕</button>`;
  z.innerHTML = `<div class="sect"><b>Étapes pour la suite</b> <span class="meta">(facultatif, ajoutées au compte rendu à l’enregistrement)</span>
    ${m.taches.length ? `<ul class="crtaches">${m.taches.map((t, i) => `<li>${esc(t.texte)} ${t.echeance ? `<span class="meta">📅 ${esc(fmtD(t.echeance))}</span> ` : ""}${t.personnes.length ? `<span class="meta">— ${esc(t.personnes.map(p => ((membres.find(x => x.pid === p) || {}).prenom || "")).join(", "))}</span> ` : ""}
      <button type="button" class="btn sm sec" data-lnew="p${i}" data-rid="" title="Lier un article, une fiche ou un bloc du mémoire">🔗 Lier</button> ${retrait("tache:" + i)}
      ${t.liens.map((l, j) => `<div class="crliens">🔗 <b>${esc(l.libelle)}</b> — ${esc(l.description)} ${retrait("tlien:" + i + ":" + j)}</div>`).join("")}
      <div id="lf__p${i}"></div></li>`).join("")}</ul>` : ""}
    <button type="button" class="btn sm sec" data-tf-open="">＋ Ajouter une tâche</button><div id="tf_"></div></div>
    <div class="sect"><b>Liens de la réunion</b> <span class="meta">(un article, une fiche ou un bloc du mémoire, et pourquoi)</span>
      ${m.liens.length ? `<ul class="crliens">${m.liens.map((l, i) => `<li>🔗 <b>${esc(l.libelle)}</b> — ${esc(l.description)} ${retrait("lien:" + i)}</li>`).join("")}</ul>` : ""}
      <button type="button" class="btn sm sec" data-lnew="" data-rid="">🔗 Ajouter un lien</button><div id="lf__"></div></div>
    <div class="sect"><b>Pièces jointes</b> <span class="meta">(${m.fichiers.length}/${CR_PIECES_MAX})</span>
      ${m.fichiers.length ? `<ul class="crpieces">${m.fichiers.map((f, i) => `<li>📎 ${esc(f.nom)} ${retrait("fichier:" + i)}</li>`).join("")}</ul>` : ""}
      ${m.fichiers.length < CR_PIECES_MAX ? `<button type="button" class="btn sm sec" data-ca-file>＋ Joindre un fichier</button><input type="file" hidden id="ca_file" accept="application/pdf,image/png,image/jpeg">${crBoutonPhoto({ bouton: "data-ca-cam", champ: 'id="ca_cam"' })}` : ""}</div>`;
}

// Enregistre le compte rendu, puis ses tâches (avec leurs liens), ses liens et ses pièces jointes saisis avec lui.
async function enregistrerCompteRendu(id, gid, errId) {
  const data = Object.assign(Object.fromEntries(["date", "titre", "participants", "objectifs", "vu", "attendu"].map(k => [k, $("r_" + k).value])), { suite: (reunionsAll.find(r => r.id === id) || {}).suite || "" });
  if (id && suiviForm && suiviForm.base) data.version_base = suiviForm.base.version;   // le serveur refuse d'écraser un enregistrement plus récent
  const avant = new Set(reunionsAll.map(r => r.id));
  const erreurs = [];
  try {
    await enCours("Enregistrement…", async () => {
      let res = await api("reunion_save", { groupe_id: gid, id: id || undefined, data });
      const rid = id || ((res.reunions || []).find(r => !avant.has(r.id)) || {}).id;
      if (!rid) throw new Error("compte rendu introuvable après enregistrement");
      // Une tâche nouvelle est celle du compte rendu qui n'existait pas avant l'envoi.
      const connues = new Set(((reunionsAll.find(r => r.id === rid) || {}).taches || []).map(t => t.id));
      const trouver = texte => {
        const r = (res.reunions || []).find(x => x.id === rid);
        const t = ((r && r.taches) || []).find(x => !connues.has(x.id) && x.texte === texte);
        if (t) connues.add(t.id);
        return t ? t.id : "";
      };
      for (const t of crEnAttente.taches) {
        try {
          res = await api("tache_save", { groupe_id: gid, reunion_id: rid, data: { texte: t.texte, fait: false, personnes: t.personnes, echeance: t.echeance || "" } });
          const tid = trouver(t.texte);
          for (const l of t.liens) {
            try {
              if (!tid) throw new Error("tâche introuvable");
              res = await api("lien_save", { groupe_id: gid, reunion_id: rid, tache_id: tid, data: { cible_type: l.cible_type, cible_id: l.cible_id, description: l.description } });
            } catch (e) { erreurs.push("lien « " + l.libelle + " » : " + e.message); }
          }
        } catch (e) { erreurs.push("tâche « " + t.texte + " » : " + e.message); }
      }
      for (const l of crEnAttente.liens) {
        try { res = await api("lien_save", { groupe_id: gid, reunion_id: rid, data: { cible_type: l.cible_type, cible_id: l.cible_id, description: l.description } }); }
        catch (e) { erreurs.push("lien « " + l.libelle + " » : " + e.message); }
      }
      for (const f of crEnAttente.fichiers) {
        try { res = await api("reunion_fichier_ajouter", { reunion_id: rid, nom: f.nom, contenu: f.contenu }); }
        catch (e) { erreurs.push("pièce jointe « " + f.nom + " » : " + e.message); }
      }
      crAttenteReinit();
      fermerSuiviForm();
      applyResult(res);
    });
    if (erreurs.length) alert("Le compte rendu est enregistré, mais certains éléments n’ont pas pu être ajoutés :\n" + erreurs.join("\n"));
  } catch (e) {
    if (e.code === "unauthorized") sessionError(e);
    else if (e.code === "conflict" && e.extra) { $(errId).textContent = ""; crAfficherConflit(e.extra, id, gid, errId); }
    else $(errId).textContent = "Enregistrement impossible : " + e.message;
  }
}
// Gestes sur le détail des comptes rendus (délégation sur l'onglet Suivi).
$("suivi")?.addEventListener("click", e => {
  const b = e.target.closest("button"); if (!b) return;
  const d = b.dataset;
  if (d.tfOpen !== undefined) {
    const z = $("tf_" + d.tfOpen);
    if (z) z.innerHTML = tacheFormHtml(d.tfOpen);
    return;
  }
  if (d.tfCancel !== undefined) { const f = b.closest(".crtform"); if (f) f.parentElement.innerHTML = ""; return; }
  if (d.tfOk !== undefined) return validerTacheForm(b.closest(".crtform"));
  if (d.tdel !== undefined) { if (!confirm("Supprimer cette tâche et ses liens ?")) return; return supprimerTache(d.tdel); }
  if (d.tpers !== undefined) { const p = $("tp_" + d.tpers); if (p) p.classList.toggle("hidden"); return; }
  if (d.lnew !== undefined) return ouvrirLienForm(d.rid, d.lnew);
  if (d.lcancel !== undefined) { const z = b.closest(".crlform"); if (z) z.parentElement.innerHTML = ""; return; }
  if (d.lsave !== undefined) return enregistrerLien(b.closest(".crlform"));
  if (d.ldel !== undefined) { if (!confirm("Retirer ce lien ?")) return; return supprimerLien(d.ldel); }
  if (d.caDel !== undefined) {
    const [cle, i, j] = d.caDel.split(":");
    if (cle === "tlien") crEnAttente.taches[Number(i)].liens.splice(Number(j), 1);
    else (cle === "tache" ? crEnAttente.taches : cle === "lien" ? crEnAttente.liens : crEnAttente.fichiers).splice(Number(i), 1);
    return crAttenteRafraichir();
  }
  if (d.caFile !== undefined) { const i = $("ca_file"); if (i) i.click(); return; }
  if (d.caCam !== undefined) { const i = $("ca_cam"); if (i) i.click(); return; }
  if (d.fcam !== undefined) { const i = document.querySelector('[data-fcin="' + d.fcam + '"]'); if (i) i.click(); return; }
  if (d.fadd !== undefined) { const i = document.querySelector('[data-fin="' + d.fadd + '"]'); if (i) i.click(); return; }
  if (d.fdl !== undefined) return apercuPiece(d.fdl);
  if (d.fdel !== undefined) { if (!confirm("Supprimer cette pièce jointe ?")) return; return supprimerPiece(d.fdel); }
});

$("suivi")?.addEventListener("change", e => {
  const t = e.target;
  if (t.matches("[data-tfait]")) {
    const f = crTacheDe(t.dataset.tfait); if (!f) return;
    return enregistrerTache(f.r.id, f.t.id, { texte: f.t.texte, fait: t.checked, personnes: f.t.personnes.map(p => p.pid), echeance: f.t.echeance || "" });
  }
  if (t.matches("[data-tp]")) {
    const f = crTacheDe(t.dataset.tp); if (!f) return;
    const pids = [...document.querySelectorAll('[data-tp="' + f.t.id + '"]:checked')].map(c => c.value);
    return enregistrerTache(f.r.id, f.t.id, { texte: f.t.texte, fait: f.t.fait, personnes: pids, echeance: f.t.echeance || "" });
  }
  if (t.matches("[data-techeance]")) {
    const f = crTacheDe(t.dataset.techeance); if (!f) return;
    return enregistrerTache(f.r.id, f.t.id, { texte: f.t.texte, fait: f.t.fait, personnes: f.t.personnes.map(p => p.pid), echeance: t.value });
  }
  if (t.matches("[data-lt]")) return remplirChoixLien(t.closest(".crlform"));
  if (t.id === "ca_file" && t.files && t.files[0]) {
    const file = t.files[0]; t.value = "";
    return ajouterPieceEnAttente(file);
  }
  if (t.matches("[data-fin]") && t.files && t.files[0]) {
    const file = t.files[0]; t.value = "";
    return ajouterPiece(t.dataset.fin, file);
  }
  // Photo prise avec l'appareil : renommée, puis ajoutée tout de suite (réduite comme les autres images).
  if ((t.id === "ca_cam" || t.matches("[data-fcin]")) && t.files && t.files[0]) {
    const brut = t.files[0]; t.value = "";
    const file = new File([brut], crNomPhoto(brut), { type: brut.type || "image/jpeg" });
    return t.id === "ca_cam" ? ajouterPieceEnAttente(file, true) : ajouterPiece(t.dataset.fcin, file, true);
  }
});

// ---------- Conflit d'enregistrement : version ouverte, votre version, version arrivée entre-temps ----------
const CR_CHAMPS = [["date", "Date"], ["titre", "Titre"], ["participants", "Participants"], ["objectifs", "Objectifs"], ["vu", "Ce qui a été vu"], ["attendu", "Ce qui est attendu"]];
const crChampsDe = x => Object.fromEntries(CR_CHAMPS.map(([k]) => [k, String((x && x[k]) || "")]));
const crValeursFormulaire = () => Object.fromEntries(CR_CHAMPS.map(([k]) => [k, $("r_" + k) ? $("r_" + k).value : ""]));

// Affiché quand quelqu'un a enregistré le compte rendu depuis son ouverture : rien n'a été écrit, on propose de fusionner champ par champ.
function crAfficherConflit(actuel, id, gid, errId) {
  const zone = $("r_conflit"); if (!zone || !suiviForm || !suiviForm.base) return;
  const base = suiviForm.base.champs, mien = crValeursFormulaire();
  const diff = CR_CHAMPS.filter(([k]) => String(actuel[k] || "") !== base[k] && String(actuel[k] || "") !== mien[k]);   // arrivés entre-temps et différents de la saisie
  const bloc = t => `<div class="cdtxt">${t.trim() ? esc(t) : '<span class="meta">(vide)</span>'}</div>`;
  const qui = actuel.par ? esc(actuel.par) : "Quelqu’un";
  zone.innerHTML = `<div class="sec cdiff" role="alert"><b>⚠️ ${qui} a modifié ce compte rendu${actuel.le ? " le " + esc(fmtDT(actuel.le)) : ""} depuis que vous l’avez ouvert.</b>
    <div class="meta">Rien n’a été enregistré. ${diff.length ? "Choisissez, champ par champ, la version à garder." : "Ses changements sont identiques aux vôtres ou sans effet sur vos champs : vous pouvez enregistrer."}</div>
    ${diff.map(([k, lib]) => {
      const mienneInchangee = mien[k] === base[k];
      return `<fieldset class="cdchamp"><legend>${esc(lib)}</legend><div class="cdcols">
        <div><div class="meta">Version que vous aviez ouverte</div>${bloc(base[k])}</div>
        <div><div class="meta">Votre version${mienneInchangee ? " (inchangée)" : ""}</div>${bloc(mien[k])}</div>
        <div><div class="meta">Version de ${qui}</div>${bloc(String(actuel[k] || ""))}</div></div>
        <label class="chk"><input type="radio" name="cd_${k}" value="mien" ${mienneInchangee ? "" : "checked"}> Garder la mienne</label>
        <label class="chk"><input type="radio" name="cd_${k}" value="leur" ${mienneInchangee ? "checked" : ""}> Prendre la sienne</label></fieldset>`;
    }).join("")}
    <div class="savebar"><button type="button" class="btn" id="cd_ok">Enregistrer avec ces choix</button> <button type="button" class="btn sec" id="cd_retour">Revenir au formulaire</button></div></div>`;
  zone.scrollIntoView({ block: "nearest" });
  $("cd_retour").onclick = () => { zone.innerHTML = ""; };
  $("cd_ok").onclick = () => {
    for (const [k] of diff) {
      const choix = zone.querySelector(`input[name="cd_${k}"]:checked`);
      if (choix && choix.value === "leur" && $("r_" + k)) $("r_" + k).value = String(actuel[k] || "");
    }
    // Les champs que seule l'autre personne a changés (donc inchangés ici) reprennent aussi sa version, pour ne pas la défaire.
    for (const [k] of CR_CHAMPS) if (!diff.some(d => d[0] === k) && mien[k] === base[k] && String(actuel[k] || "") !== base[k] && $("r_" + k)) $("r_" + k).value = String(actuel[k] || "");
    suiviForm.base = { version: actuel.version, champs: crChampsDe(actuel) };
    zone.innerHTML = "";
    enregistrerCompteRendu(id, gid, errId);
  };
}

// ---------- Édition à plusieurs : enregistrement automatique + synchronisation des champs toutes les quelques secondes ----------
// Pas de bouton « Enregistrer » pour un compte rendu existant : chaque champ modifié part tout seul (CO_DELAI_MS après la dernière frappe),
// avec la version qu'on avait ouverte. Si quelqu'un a enregistré entre-temps, on fusionne champ par champ : ce que l'autre seul a changé
// arrive dans le formulaire, ce que nous seuls avons changé est gardé. Si les deux ont changé le MÊME champ, notre version est gardée
// (celle de l'autre reste dans l'historique) et on le signale tout de suite.
const CO_DELAI_MS = 1200, CO_SYNC_MS = 3000;
let CO = coVide();
function coVide() { return { id: "", gid: "", base: null, suite: "", enCours: null, sale: false, timer: null, sync: null }; }

// Fusion à trois : base (ce qu'on avait ouvert), mien (valeurs actuelles du formulaire), actuel (état du serveur).
// Renvoie les valeurs à afficher, les champs repris de l'autre personne et ceux changés des deux côtés.
function coFusion(base, mien, actuel) {
  const valeurs = { ...mien }, repris = [], conflits = [];
  for (const [k] of CR_CHAMPS) {
    const leur = String(actuel[k] || "");
    if (leur === base[k] || leur === mien[k]) continue;   // l'autre n'y a pas touché, ou nous sommes d'accord
    if (mien[k] === base[k]) { valeurs[k] = leur; repris.push(k); } else conflits.push(k);
  }
  return { valeurs, repris, conflits };
}
const coLibelle = k => (CR_CHAMPS.find(c => c[0] === k) || [k, k])[1];

function coEtat(msg, erreur) {
  const z = $("r_etat"); if (!z) return;
  z.textContent = msg; z.classList.toggle("err", !!erreur);
}
const coHeure = () => new Date().toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });

// Affiche dans le formulaire les champs repris de l'autre personne (sans déplacer le curseur de celui qu'on tape).
function coAppliquer(ctx, res, actuel) {
  if (ctx !== CO) return;
  for (const k of res.repris) {
    const el = $("r_" + k); if (!el) continue;
    const a = el === document.activeElement && el.type !== "date" ? [el.selectionStart, el.selectionEnd] : null;
    el.value = String(actuel[k] || "");
    if (a) { try { el.setSelectionRange(Math.min(a[0], el.value.length), Math.min(a[1], el.value.length)); } catch (e) { /* champ sans sélection */ } }
  }
  const qui = actuel.par || "Quelqu’un";
  if (res.conflits.length) coEtat(`⚠️ ${qui} a aussi modifié ${res.conflits.map(k => "« " + coLibelle(k) + " »").join(", ")} : votre version est gardée (la sienne est dans 🕘 l’historique).`, true);
  else if (res.repris.length) coEtat(`🔄 ${qui} a modifié ${res.repris.map(k => "« " + coLibelle(k) + " »").join(", ")}.`);
}

// Envoie les champs modifiés. Une seule requête à la fois ; ce qui est tapé pendant l'envoi repart juste après.
// `ctx` est l'état de la session d'édition : on peut fermer le formulaire sans perdre l'envoi en cours.
function coEnregistrer(ctx) {
  if (!ctx.id || !ctx.base) return Promise.resolve(true);
  if (ctx.enCours) return ctx.enCours.then(() => coEnregistrer(ctx));
  const mien = ctx === CO ? crValeursFormulaire() : ctx.dernier;
  if (CR_CHAMPS.every(([k]) => mien[k] === ctx.base.champs[k])) { ctx.sale = false; return Promise.resolve(true); }
  ctx.dernier = mien;
  if (ctx === CO) coEtat("⏳ Enregistrement…");
  ctx.enCours = (async () => {
    let envoye = mien;
    try {
      for (let essai = 0; essai < 4; essai++) {
        try {
          const res = await api("reunion_save", { groupe_id: ctx.gid, id: ctx.id, data: { ...envoye, suite: ctx.suite, version_base: ctx.base.version } });
          const r = (res.reunions || []).find(x => x.id === ctx.id);
          ctx.base = { version: r ? r.version : ctx.base.version + 1, champs: { ...envoye } };
          if (r) ctx.suite = r.suite || "";
          const vivant = ctx === CO ? crValeursFormulaire() : null;   // ce qui a été tapé pendant l'envoi repartira juste après
          ctx.sale = !!vivant && CR_CHAMPS.some(([k]) => vivant[k] !== ctx.base.champs[k]);
          if (ctx === CO) coEtat("✓ Enregistré automatiquement à " + coHeure() + ".");
          applyResult(res);
          return true;
        } catch (e) {
          if (e.code !== "conflict" || !e.extra) throw e;
          const a = e.extra;
          const actuelMien = ctx === CO ? crValeursFormulaire() : envoye;
          const res = coFusion(ctx.base.champs, actuelMien, a);
          coAppliquer(ctx, res, a);
          ctx.base = { version: a.version, champs: crChampsDe(a) };
          ctx.suite = a.suite || "";
          envoye = ctx === CO ? crValeursFormulaire() : res.valeurs;
        }
      }
      throw new Error("trop de modifications simultanées, réessayez");
    } catch (e) {
      if (e.code === "unauthorized") sessionError(e);
      else if (ctx === CO) coEtat("⚠️ Pas enregistré : " + e.message + ". Nouvel essai à la prochaine modification.", true);
      return false;
    }
  })().finally(() => { ctx.enCours = null; if (ctx === CO && ctx.sale) coPlanifier(); });
  return ctx.enCours;
}

function coPlanifier() {
  if (!CO.id) return;
  CO.sale = true;
  clearTimeout(CO.timer);
  if (!CO.enCours) coEtat("Modifications en attente…");
  CO.timer = setTimeout(() => coEnregistrer(CO), CO_DELAI_MS);
}

// Regarde si quelqu'un d'autre a enregistré et reprend ses changements dans les champs qu'on n'a pas touchés.
async function coSynchroniser() {
  const ctx = CO;
  if (!ctx.id || !ctx.base || ctx.enCours || document.hidden) return;
  let a;
  try { a = (await api("reunion_etat", { id: ctx.id })).etat; }
  catch (e) { if (e.code === "unauthorized") sessionError(e); return; }   // synchronisation facultative : on réessaie au prochain tour
  if (ctx !== CO || ctx.enCours || !a || a.version <= ctx.base.version) return;   // une réponse plus ancienne que notre propre envoi est ignorée
  const res = coFusion(ctx.base.champs, crValeursFormulaire(), a);
  coAppliquer(ctx, res, a);
  ctx.base = { version: a.version, champs: crChampsDe(a) };
  ctx.suite = a.suite || "";
}

function coDemarrer(id, gid, x) {
  coArreter();
  if (!id) return;
  CO = { ...coVide(), id, gid, base: { version: x.version, champs: crChampsDe(x) }, suite: x.suite || "" };
  CO.sync = setInterval(coSynchroniser, CO_SYNC_MS);
  coEtat("Les modifications sont enregistrées automatiquement, et celles des autres membres apparaissent ici.");
}

// Ferme la session d'édition : ce qui n'est pas parti est envoyé avant de lâcher.
// À appeler tant que le formulaire est encore affiché : ses valeurs sont relevées avant qu'il soit vidé.
function coArreter() {
  const ctx = CO;
  clearTimeout(ctx.timer); clearInterval(ctx.sync);
  CO = coVide();
  if (!ctx.id) return;
  if (ctx.sale || ctx.enCours) { ctx.dernier = crValeursFormulaire(); coEnregistrer(ctx); }
}

// « Terminer » : on attend que tout soit enregistré avant de refermer le formulaire.
async function coTerminer() {
  clearTimeout(CO.timer);
  const ctx = CO;
  const ok = await coEnregistrer(ctx);
  if (!ok) return;
  fermerSuiviForm();
}

$("reunionform")?.addEventListener("input", e => { if (CO.id && e.target.id && e.target.id.startsWith("r_")) coPlanifier(); });
window.addEventListener("beforeunload", e => { if (CO.id && (CO.sale || CO.enCours)) { e.preventDefault(); e.returnValue = ""; } });

// ---------- Historique : les 25 derniers états écrasés d'un compte rendu, à reprendre dans le formulaire ----------
async function crAfficherHistorique(id) {
  const zone = $("r_histo"); if (!zone) return;
  if (zone.innerHTML) { zone.innerHTML = ""; return; }   // un second clic referme
  let versions;
  try { versions = (await enCours("Chargement de l’historique…", () => api("reunion_historique", { id }))).versions || []; }
  catch (e) { if (e.code === "unauthorized") sessionError(e); else zone.innerHTML = `<div class="err">Historique indisponible : ${esc(e.message)}</div>`; return; }
  zone.innerHTML = `<div class="sec crhisto"><b>🕘 Historique</b> <span class="meta">(les ${CR_HISTORIQUE_MAX} derniers états remplacés, du plus récent au plus ancien)</span>
    ${versions.length ? versions.map((v, i) => `<details><summary>${esc(fmtDT(v.le))}${v.par ? " · " + esc(v.par) : ""}${v.titre ? " · " + esc(v.titre) : ""}</summary>
      ${CR_CHAMPS.filter(([k]) => k !== "date" && String(v[k] || "").trim()).map(([k, lib]) => `<div class="sect"><b>${esc(lib)}</b><div class="cdtxt">${esc(v[k])}</div></div>`).join("") || '<div class="meta">(état vide)</div>'}
      <button type="button" class="btn sm sec" data-hreprendre="${i}">Reprendre cet état dans le formulaire</button></details>`).join("")
      : '<div class="meta">Aucune modification enregistrée pour l’instant.</div>'}</div>`;
  zone.querySelectorAll("[data-hreprendre]").forEach(b => b.onclick = () => {
    const v = versions[Number(b.dataset.hreprendre)];
    for (const [k] of CR_CHAMPS) if ($("r_" + k)) $("r_" + k).value = String(v[k] || "");
    zone.innerHTML = "";
    const e = $("rerr"); if (e) e.textContent = "État repris dans le formulaire : relisez-le puis enregistrez.";
  });
}
const CR_HISTORIQUE_MAX = 25;
