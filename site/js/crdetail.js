/* Détail de chaque compte rendu dans l'onglet Suivi : tâches (avec personnes), liens (articles, fiches, blocs du mémoire, avec la raison du lien)
   et pièces jointes (5 au plus ; les images sont réduites avant l'envoi, puis à 300 Ko côté serveur).
   Script classique : portée globale partagée avec js/. Chargé après suivi.js et compterendu.js. */
"use strict";

const CR_PIECES_MAX = 5;
const CR_IMAGE_SEUIL = 2 * 1024 * 1024;   // au-delà, une photo est réduite dans le navigateur avant l'envoi
const CR_FICHIER_MAX = 5 * 1024 * 1024;   // taille maximale d'une pièce jointe (comme le serveur)
const CR_LIENS = { mem: [] };              // blocs du mémoire chargés pour le choix d’un lien

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
      ${ecrit ? `<div class="tools"><input id="tn_${esc(x.id)}" maxlength="300" placeholder="Nouvelle tâche (ex. chercher deux articles sur …)" style="flex:1"><button type="button" class="btn sm sec" data-tnew="${esc(x.id)}">＋ Tâche</button></div>` : ""}
    </div>
    <div class="sect"><b>Liens de la réunion</b> <span class="meta">(un article, une fiche ou un bloc du mémoire, et pourquoi)</span>
      ${liens.length ? liensHtml(liens, ecrit) : '<div class="meta">Aucun lien pour l’instant.</div>'}
      ${ecrit ? `<button type="button" class="btn sm sec" data-lnew="" data-rid="${esc(x.id)}">🔗 Ajouter un lien</button><div id="lf_${esc(x.id)}_"></div>` : ""}
    </div>
    <div class="sect"><b>Pièces jointes</b> <span class="meta">(${pieces.length}/${CR_PIECES_MAX} ; images réduites à 300 Ko)</span>
      ${pieces.length ? `<ul class="crpieces">${pieces.map(f => `<li><button type="button" class="btn sm sec" data-fdl="${esc(f.id)}">📎 ${esc(f.nom)}</button> <span class="meta">${esc(crTaille(f.taille))} · ${esc(f.par)}</span>
        ${ecrit ? ` <button type="button" class="btn sm sec del" data-fdel="${esc(f.id)}" aria-label="Supprimer la pièce jointe">🗑</button>` : ""}</li>`).join("")}</ul>` : '<div class="meta">Aucune pièce jointe.</div>'}
      ${ecrit && pieces.length < CR_PIECES_MAX ? `<button type="button" class="btn sm sec" data-fadd="${esc(x.id)}">＋ Joindre un fichier</button><input type="file" hidden data-fin="${esc(x.id)}" accept="application/pdf,image/png,image/jpeg">` : ""}
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
    crEnAttente.liens.push({ cible_type, cible_id: cible, description, libelle: choix ? choix.textContent : cible });
    zone.innerHTML = "";
    crAttenteRafraichir();
    return;
  }
  try {
    applyResult(await enCours("Enregistrement…", () => api("lien_save", { groupe_id: r.groupe_id, reunion_id: rid, tache_id: tid || undefined, data: { cible_type, cible_id: cible, description } })));
  } catch (e) { if (e.code === "unauthorized") sessionError(e); else err.textContent = "Enregistrement impossible : " + e.message; }
}

// Pièce jointe gardée pour le nouveau compte rendu ; le serveur contrôle le format et la taille à l'enregistrement.
async function ajouterPieceEnAttente(file) {
  if (crEnAttente.fichiers.length >= CR_PIECES_MAX) { alert("Cinq pièces jointes au plus par compte rendu."); return; }
  if (!/^image\//.test(file.type) && file.size > CR_FICHIER_MAX) { alert("Fichier trop volumineux (5 Mo maximum)."); return; }
  try {
    const contenu = await crContenuFichier(file);
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
async function crContenuFichier(file) {
  if (!/^image\//.test(file.type) || file.size <= CR_IMAGE_SEUIL) return crLireBase64(file);
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

async function ajouterPiece(rid, file) {
  try {
    const contenu = await crContenuFichier(file);
    applyResult(await enCours("Envoi du fichier…", () => api("reunion_fichier_ajouter", { reunion_id: rid, nom: file.name, contenu })));
  } catch (e) { if (e.code === "unauthorized") sessionError(e); else alert("Envoi impossible : " + e.message); }
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

// Zone « Étapes, liens et pièces jointes » du formulaire de compte rendu.
function crAttenteRafraichir() {
  const z = $("cr_attente"); if (!z) return;
  const m = crEnAttente, membres = (groupeCourant() || {}).membres || [];
  const retrait = (cle, i) => `<button type="button" class="btn sm sec del" data-ca-del="${cle}:${i}" aria-label="Retirer">✕</button>`;
  z.innerHTML = `<div class="sect"><b>Étapes pour la suite</b> <span class="meta">(facultatif, ajoutées au compte rendu à l’enregistrement)</span>
    ${m.taches.length ? `<ul class="crtaches">${m.taches.map((t, i) => `<li>${esc(t.texte)} ${t.personnes.length ? `<span class="meta">— ${esc(t.personnes.map(p => ((membres.find(x => x.pid === p) || {}).prenom || "")).join(", "))}</span>` : ""} ${retrait("tache", i)}</li>`).join("")}</ul>` : ""}
    <div class="tools"><input id="ca_tache" maxlength="300" placeholder="Nouvelle tâche" style="flex:1"><select id="ca_pers" multiple size="3" aria-label="Personnes concernées">${membres.map(x => `<option value="${esc(x.pid)}">${esc(x.prenom)}</option>`).join("")}</select><button type="button" class="btn sm sec" data-ca-tache>＋ Tâche</button></div></div>
    <div class="sect"><b>Liens</b> <span class="meta">(un article, une fiche ou un bloc du mémoire, et pourquoi)</span>
      ${m.liens.length ? `<ul class="crliens">${m.liens.map((l, i) => `<li>🔗 <b>${esc(l.libelle)}</b> — ${esc(l.description)} ${retrait("lien", i)}</li>`).join("")}</ul>` : ""}
      <button type="button" class="btn sm sec" data-lnew="" data-rid="">🔗 Ajouter un lien</button><div id="lf__"></div></div>
    <div class="sect"><b>Pièces jointes</b> <span class="meta">(${m.fichiers.length}/${CR_PIECES_MAX})</span>
      ${m.fichiers.length ? `<ul class="crpieces">${m.fichiers.map((f, i) => `<li>📎 ${esc(f.nom)} ${retrait("fichier", i)}</li>`).join("")}</ul>` : ""}
      ${m.fichiers.length < CR_PIECES_MAX ? `<button type="button" class="btn sm sec" data-ca-file>＋ Joindre un fichier</button><input type="file" hidden id="ca_file" accept="application/pdf,image/png,image/jpeg">` : ""}</div>`;
}

// Enregistre le compte rendu, puis ses étapes, liens et pièces jointes saisis avec lui.
async function enregistrerCompteRendu(id, gid, errId) {
  const data = Object.assign(Object.fromEntries(["date", "titre", "participants", "vu", "attendu"].map(k => [k, $("r_" + k).value])), { suite: (reunionsAll.find(r => r.id === id) || {}).suite || "" });
  const avant = new Set(reunionsAll.map(r => r.id));
  const erreurs = [];
  try {
    await enCours("Enregistrement…", async () => {
      let res = await api("reunion_save", { groupe_id: gid, id: id || undefined, data });
      const rid = id || ((res.reunions || []).find(r => !avant.has(r.id)) || {}).id;
      if (!rid) throw new Error("compte rendu introuvable après enregistrement");
      for (const t of crEnAttente.taches) {
        try { res = await api("tache_save", { groupe_id: gid, reunion_id: rid, data: { texte: t.texte, fait: false, personnes: t.personnes } }); }
        catch (e) { erreurs.push("tâche « " + t.texte + " » : " + e.message); }
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
    if (e.code === "unauthorized") sessionError(e); else $(errId).textContent = "Enregistrement impossible : " + e.message;
  }
}

// Gestes sur le détail des comptes rendus (délégation sur l'onglet Suivi).
$("suivi")?.addEventListener("click", e => {
  const b = e.target.closest("button"); if (!b) return;
  const d = b.dataset;
  if (d.tnew !== undefined) {
    const i = $("tn_" + d.tnew), texte = i ? i.value.trim() : "";
    if (!texte) return;
    return enregistrerTache(d.tnew, "", { texte, fait: false, personnes: [] });
  }
  if (d.tdel !== undefined) { if (!confirm("Supprimer cette tâche et ses liens ?")) return; return supprimerTache(d.tdel); }
  if (d.tpers !== undefined) { const p = $("tp_" + d.tpers); if (p) p.classList.toggle("hidden"); return; }
  if (d.lnew !== undefined) return ouvrirLienForm(d.rid, d.lnew);
  if (d.lcancel !== undefined) { const z = b.closest(".crlform"); if (z) z.parentElement.innerHTML = ""; return; }
  if (d.lsave !== undefined) return enregistrerLien(b.closest(".crlform"));
  if (d.ldel !== undefined) { if (!confirm("Retirer ce lien ?")) return; return supprimerLien(d.ldel); }
  if (d.caTache !== undefined) {
    const texte = ($("ca_tache").value || "").trim();
    if (!texte) return;
    const personnes = [...$("ca_pers").selectedOptions].map(o => o.value);
    crEnAttente.taches.push({ texte, personnes });
    return crAttenteRafraichir();
  }
  if (d.caDel !== undefined) {
    const [cle, i] = d.caDel.split(":"), liste = cle === "tache" ? crEnAttente.taches : cle === "lien" ? crEnAttente.liens : crEnAttente.fichiers;
    liste.splice(Number(i), 1);
    return crAttenteRafraichir();
  }
  if (d.caFile !== undefined) { const i = $("ca_file"); if (i) i.click(); return; }
  if (d.fadd !== undefined) { const i = document.querySelector('[data-fin="' + d.fadd + '"]'); if (i) i.click(); return; }
  if (d.fdl !== undefined) return telechargerPiece(d.fdl);
  if (d.fdel !== undefined) { if (!confirm("Supprimer cette pièce jointe ?")) return; return supprimerPiece(d.fdel); }
});

$("suivi")?.addEventListener("change", e => {
  const t = e.target;
  if (t.matches("[data-tfait]")) {
    const f = crTacheDe(t.dataset.tfait); if (!f) return;
    return enregistrerTache(f.r.id, f.t.id, { texte: f.t.texte, fait: t.checked, personnes: f.t.personnes.map(p => p.pid) });
  }
  if (t.matches("[data-tp]")) {
    const f = crTacheDe(t.dataset.tp); if (!f) return;
    const pids = [...document.querySelectorAll('[data-tp="' + f.t.id + '"]:checked')].map(c => c.value);
    return enregistrerTache(f.r.id, f.t.id, { texte: f.t.texte, fait: f.t.fait, personnes: pids });
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
});
