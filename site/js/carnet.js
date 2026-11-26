/* Carnet d'apprentissage : strictement individuel (jamais visible du groupe, des formateurs ni de l'administrateur de l'outil).
   Affiché dans la fenêtre « Mes notes » (onglet 🎓), chargé après notes.js. Script classique : portée globale partagée. */
"use strict";

const SECT_CARNET = [
  { k: "vu", ico: "👥", lib: "Vu par le groupe", aide: "Ce qui a été abordé, présenté ou débattu pendant la séance.", ex: "Présentation de l’article X, discussion sur…" },
  { k: "comprehension", ico: "💡", lib: "Ma compréhension", aide: "Ce que j’en comprends, avec mes propres mots.", ex: "Pour moi, cela signifie que…" },
  { k: "apprentissage", ico: "🎓", lib: "Ce que j’en retiens", aide: "L’apprentissage que je retiens à titre individuel.", ex: "J’ai appris que…" },
  { k: "interrogations", ico: "❓", lib: "Mes interrogations", aide: "Ce qui me questionne, ce qui reste flou.", ex: "Je me demande si…" },
  { k: "axe", ico: "🌱", lib: "Axe de développement", aide: "Le point que j’envisage de développer.", ex: "Je veux progresser sur…" },
  { k: "transfert", ico: "🔁", lib: "Transfert envisagé", aide: "Ce que j’envisage de transférer à la suite (stage, travaux, pratique).", ex: "Je pourrai mobiliser cela pour…" },
];
const TYPES_CARNET = ["Savoir théorique", "Savoir-faire", "Savoir-être", "Méthode de travail", "Réflexivité", "Communication"];

const CA_FICHIERS_MAX = 20;
const CA_IMG = new Map();   // id du document → data URL de l'image (chargée une fois)
const CA = { entrees: [], charge: false, d: null, snap: "", q: "", mode: "ecrire", err: "", attente: [] };
const carnetVide = () => ({ id: "", date: aujourdhuiISO(), vu: "", comprehension: "", apprentissage: "", types: [], interrogations: "", axe: "", transfert: "" });
const copieCarnet = e => ({ id: e.id, date: e.date, vu: e.vu, comprehension: e.comprehension, apprentissage: e.apprentissage, types: (e.types || []).slice(), interrogations: e.interrogations, axe: e.axe, transfert: e.transfert });
const nbRempli = e => SECT_CARNET.filter(s => String(e[s.k] || "").trim()).length;
const resume = (t, n) => { const s = String(t || "").replace(/\s+/g, " ").trim(); return s.length > n ? s.slice(0, n - 1) + "…" : s; };
const carnetModifie = () => !!CA.d && (JSON.stringify(CA.d) !== CA.snap || CA.attente.length > 0);
const fichiersCarnet = id => { const e = CA.entrees.find(x => x.id === id); return e ? e.fichiers || [] : []; };
const confirmerAbandon = () => !carnetModifie() || confirm("Cette entrée a des modifications non enregistrées. Les abandonner ?");

function chargerCarnet() {
  return api("carnet_list").then(j => { CA.entrees = j.carnet || []; CA.charge = true; })
    .catch(e => { if (!CA.charge && N.ouvert && N.vue === "carnet") $("notebody").innerHTML = `<div class="err" style="padding:14px">Chargement impossible : ${esc(e.message)}</div>`; throw e; });
}
function ouvrirCarnet() {
  CA.d = null; CA.snap = ""; CA.attente = []; CA.q = ""; CA.err = ""; CA.mode = "ecrire";
  if (CA.charge) renderCarnet(); else $("notebody").innerHTML = '<div class="meta" style="padding:14px">Chargement…</div>';
  chargerCarnet().then(() => { if (N.ouvert && N.vue === "carnet") renderCarnet(); }).catch(() => {});
}
function reinitialiserCarnet() { CA.entrees = []; CA.charge = false; CA.d = null; CA.snap = ""; CA.attente = []; CA_IMG.clear(); }

function renderCarnet() {
  $("notebody").innerHTML = `<div class="nwrap"><div class="nlist"><div class="nbar"><input id="cq" type="search" placeholder="Rechercher dans mon carnet…" aria-label="Rechercher dans mon carnet" value="${esc(CA.q)}"><button type="button" class="btn sm" data-cnew>＋ Nouvelle</button><button type="button" class="btn sm sec" data-cexport title="Télécharger tout mon carnet (texte)" aria-label="Exporter mon carnet">⬇️</button></div><div id="citems"></div></div><div class="nedit" id="cedit"></div></div>`;
  renderCListe(); renderCEdit();
}
function renderCListe() {
  const q = cleTitre(CA.q);
  const l = CA.entrees.filter(e => !q || cleTitre(SECT_CARNET.map(s => e[s.k]).concat(e.types || []).join(" ")).includes(q));
  $("citems").innerHTML = l.map(e => {
    const pts = SECT_CARNET.map(s => `<span class="cdot ${String(e[s.k] || "").trim() ? "on" : ""}" title="${esc(s.lib)}"></span>`).join("");
    const apercu = resume(e.vu || e.comprehension || e.apprentissage || e.interrogations || e.axe || e.transfert, 110);
    return `<button type="button" class="nitem ${CA.d && CA.d.id === e.id ? "on" : ""}" data-copen="${esc(e.id)}"><b>🗓️ ${esc(fmtD(e.date))}</b><span class="cdots" aria-label="${nbRempli(e)} rubriques sur 6">${pts}<span class="meta">${nbRempli(e)}/6</span></span>${(e.fichiers || []).length ? `<span class="meta">📎 ${e.fichiers.length} document${e.fichiers.length > 1 ? "s" : ""}</span>` : ""}${(e.types || []).length ? `<span class="meta">${e.types.map(t => "🎓 " + esc(t)).join(" · ")}</span>` : ""}<span class="meta ccex">${esc(apercu)}</span></button>`;
  }).join("") || `<div class="note">${CA.entrees.length ? "Aucune entrée ne correspond." : "Aucune entrée pour le moment. Ce carnet est individuel : invisible du groupe et des formateurs."}</div>`;
}

function renderCEdit() {
  const d = CA.d, box = $("cedit");
  if (!d) {
    const der = CA.entrees[0];
    box.innerHTML = `<div class="note">🔒 Votre carnet d’apprentissage est <b>individuel</b> : le groupe, les formateurs et l’application ne le voient pas. 🩺 N’y mettez aucune information permettant d’identifier un patient.</div>
      <div class="cguide"><b>Pour chaque séance, six rubriques :</b>${SECT_CARNET.map(s => `<div class="cstep"><span class="cico" aria-hidden="true">${s.ico}</span><div><b>${esc(s.lib)}</b><div class="meta">${esc(s.aide)}</div></div></div>`).join("")}</div>
      <div class="nacts"><button type="button" class="btn" data-cnew>＋ Nouvelle entrée</button>${der ? ` <button type="button" class="btn sm sec" data-copen="${esc(der.id)}">Revoir la dernière (${esc(fmtD(der.date))})</button>` : ""}</div>`;
    return;
  }
  box.innerHTML = `<div class="cseg" role="tablist" aria-label="Mode d’affichage"><button type="button" role="tab" class="${CA.mode === "ecrire" ? "on" : ""}" aria-selected="${CA.mode === "ecrire"}" data-cmode="ecrire">✏️ Écrire</button><button type="button" role="tab" class="${CA.mode === "apercu" ? "on" : ""}" aria-selected="${CA.mode === "apercu"}" data-cmode="apercu">👁️ Aperçu</button><span class="meta" id="ccompte"></span></div>
    <div id="cmain"></div>
    <div id="cerr" class="meta" role="alert" style="color:var(--bad,#c0392b)">${esc(CA.err)}</div>
    <div class="nacts"><button type="button" class="btn" data-csave>Enregistrer</button>${d.id ? ' <button type="button" class="btn sm sec" data-cdel>Supprimer</button>' : ""} <button type="button" class="btn sm sec" data-cclose>Fermer l’entrée</button></div>`;
  if (CA.mode === "apercu") renderCApercu(); else renderCForm();
  majCCompte();
}
function majCCompte() { const c = $("ccompte"); if (c && CA.d) c.textContent = nbRempli(CA.d) + "/6 rubriques renseignées"; }

function renderCForm() {
  const d = CA.d, perso = d.types.filter(t => !TYPES_CARNET.includes(t));
  const chips = TYPES_CARNET.concat(perso).map(t => `<button type="button" class="ntag ${d.types.includes(t) ? "on" : ""}" data-ctype="${esc(t)}" aria-pressed="${d.types.includes(t)}">${esc(t)}</button>`).join("");
  $("cmain").innerHTML = `<div class="nrow"><div><label for="cd">Date de la séance</label><input id="cd" type="date" value="${esc(d.date)}"></div></div>`
    + SECT_CARNET.map((s, i) => `<section class="csec s${i}"><label for="c_${s.k}"><span class="cico" aria-hidden="true">${s.ico}</span> ${esc(s.lib)} <span class="meta">${esc(s.aide)}</span></label>
      <textarea id="c_${s.k}" data-ck="${s.k}" rows="${s.k === "vu" ? 5 : 4}" maxlength="10000" placeholder="${esc(s.ex)}">${esc(d[s.k])}</textarea>
      ${s.k === "apprentissage" ? `<div class="meta">Type d’apprentissage :</div><div class="ntags" id="ctypes">${chips}</div>` : ""}</section>`).join("")
    + `<section class="csec sdoc"><label>📎 Documents <span class="meta">3 au plus : photo, image ou PDF (5 Mo max). Envoyés à l’enregistrement.</span></label><div id="cdocs">${htmlDocs(d.id, true)}</div></section>`;
  chargerMiniatures();
}

// Aperçu : la fiche telle qu’elle se lira, les rubriques vides étant signalées plutôt que masquées.
function htmlApercu(e) {
  return `<article class="capercu"><header><b>🗓️ ${esc(fmtD(e.date))}</b><span class="meta">${nbRempli(e)}/6 rubriques</span></header>`
    + SECT_CARNET.map((s, i) => {
      const t = String(e[s.k] || "").trim();
      const types = s.k === "apprentissage" && (e.types || []).length ? `<div class="ntags">${e.types.map(x => `<span class="ntag on">${esc(x)}</span>`).join("")}</div>` : "";
      return `<section class="csec s${i} ${t ? "" : "vide"}"><h4><span class="cico" aria-hidden="true">${s.ico}</span> ${esc(s.lib)}</h4>${t ? `<p>${esc(t)}</p>` : '<p class="meta">Non renseigné.</p>'}${types}</section>`;
    }).join("") + (fichiersCarnet(e.id).length ? `<section class="csec sdoc"><h4><span class="cico" aria-hidden="true">📎</span> Documents</h4>${htmlDocs(e.id, false)}</section>` : "") + "</article>";
}
function renderCApercu() { $("cmain").innerHTML = htmlApercu(CA.d); chargerMiniatures(); }

function carnetEnTexte() {
  return CA.entrees.map(e => {
    const lignes = SECT_CARNET.filter(s => String(e[s.k] || "").trim()).map(s => s.lib.toUpperCase() + (s.k === "apprentissage" && (e.types || []).length ? " (" + e.types.join(", ") + ")" : "") + "\n" + e[s.k].trim());
    return "Séance du " + fmtD(e.date) + "\n\n" + lignes.join("\n\n");
  }).join("\n\n----------------------------------------\n\n");
}
function exportCarnet() {
  if (!CA.entrees.length) return;
  telecharger(new Blob(["﻿" + carnetEnTexte()], { type: "text/plain;charset=utf-8" }), "mon-carnet-apprentissage-" + stamp() + ".txt");
}

$("notebody")?.addEventListener("input", e => {
  if (N.vue !== "carnet") return;
  const t = e.target;
  if (t.id === "cq") { CA.q = t.value; renderCListe(); }
  else if (t.id === "cd") CA.d.date = t.value;
  else if (t.dataset.ck) { CA.d[t.dataset.ck] = t.value; majCCompte(); }
});
$("notebody")?.addEventListener("click", async e => {
  if (N.vue !== "carnet") return;
  const b = e.target.closest("button"); if (!b) return;
  const ouvrir = e2 => { CA.d = e2; CA.snap = e2 ? JSON.stringify(e2) : ""; CA.err = ""; renderCListe(); renderCEdit(); };
  if (b.dataset.cnew !== undefined) { if (!confirmerAbandon()) return; CA.mode = "ecrire"; ouvrir(carnetVide()); $("c_vu")?.focus(); }
  else if (b.dataset.copen) { if (!confirmerAbandon()) return; const x = CA.entrees.find(y => y.id === b.dataset.copen); if (x) { CA.mode = "apercu"; ouvrir(copieCarnet(x)); } }
  else if (b.dataset.cclose !== undefined) { if (!confirmerAbandon()) return; ouvrir(null); }
  else if (b.dataset.cmode) { CA.mode = b.dataset.cmode; renderCEdit(); }
  else if (b.dataset.ctype) { const t = b.dataset.ctype; CA.d.types = CA.d.types.includes(t) ? CA.d.types.filter(x => x !== t) : CA.d.types.concat(t); renderCForm(); }
  else if (b.dataset.cexport !== undefined) exportCarnet();
  else if (b.dataset.csave !== undefined) {
    if (!nbRempli(CA.d)) { CA.err = "Renseignez au moins une rubrique."; $("cerr").textContent = CA.err; return; }
    try {
      const j = await enCours("Enregistrement…", () => api("carnet_save", { data: CA.d }));
      CA.entrees = j.carnet || []; CA.err = "";
      CA.d.id = j.id; CA.snap = JSON.stringify(CA.d);   // l'entrée existe : un échec d'envoi d'un document ne la fera pas recréer
      let echec = "";
      while (CA.attente.length) {
        const f = CA.attente[0];
        try { const r = await enCours("Envoi du document…", () => api("carnet_fichier_ajouter", { carnet_id: j.id, nom: f.nom, contenu: f.contenu })); CA.entrees = r.carnet || CA.entrees; CA.attente.shift(); }
        catch (x) { echec = "Entrée enregistrée, mais « " + f.nom + " » n’a pas pu être envoyé : " + (x.message || "erreur"); break; }
      }
      const x = CA.entrees.find(y => y.id === j.id);
      CA.d = x ? copieCarnet(x) : null; CA.snap = CA.d ? JSON.stringify(CA.d) : "";
      renderCListe(); renderCEdit();
      if (CA.d) $("cerr").textContent = echec || "✔ Enregistré";
    } catch (x) { CA.err = x.message || "Échec de l'enregistrement."; if ($("cerr")) $("cerr").textContent = CA.err; }
  }
  else if (b.dataset.cdel !== undefined) {
    if (!confirm("Supprimer cette entrée du carnet ?")) return;
    try { const j = await enCours("Suppression…", () => api("carnet_delete", { id: CA.d.id })); CA.entrees = j.carnet || []; ouvrir(null); }
    catch (x) { CA.err = x.message || "Échec de la suppression."; if ($("cerr")) $("cerr").textContent = CA.err; }
  }
});

// ---------- Documents joints (3 au plus par entrée, photos comprises) ----------
// Les documents ajoutés restent « en attente » dans le navigateur et partent à l'enregistrement ; ceux déjà envoyés se suppriment tout de suite.
const nbDocs = id => (id ? fichiersCarnet(id).length : 0) + CA.attente.length;
function htmlDocs(id, edition) {
  const env = id ? fichiersCarnet(id) : [];
  const vign = f => /^image\//.test(f.type) ? `<img class="cimg" data-cimg="${esc(f.id)}" alt="${esc(f.nom)}" ${CA_IMG.has(f.id) ? `src="${CA_IMG.get(f.id)}"` : ""}>` : '<span class="cpdf" aria-hidden="true">📄</span>';
  const l = env.map(f => `<div class="cdoc">${vign(f)}<div class="cdocinfo"><b>${esc(f.nom)}</b><span class="meta">${esc(crTaille(f.taille))}</span></div>
      <button type="button" class="btn sm sec" data-cdl="${esc(f.id)}">${/^image\//.test(f.type) ? "⬇️" : "📄 Ouvrir"}</button>${edition ? `<button type="button" class="btn sm sec" data-cdocdel="${esc(f.id)}" aria-label="Supprimer ${esc(f.nom)}">✕</button>` : ""}</div>`).join("")
    + (edition ? CA.attente.map((f, i) => `<div class="cdoc attente">${f.apercu ? `<img class="cimg" src="${f.apercu}" alt="">` : '<span class="cpdf" aria-hidden="true">📄</span>'}<div class="cdocinfo"><b>${esc(f.nom)}</b><span class="meta">À envoyer à l’enregistrement</span></div>
      <button type="button" class="btn sm sec" data-cdocretire="${i}" aria-label="Retirer ${esc(f.nom)}">✕</button></div>`).join("") : "");
  const reste = CA_FICHIERS_MAX - nbDocs(id);
  const ajout = edition ? (reste > 0
    ? `<div class="nacts"><button type="button" class="btn sm sec" data-cfile>＋ Joindre un document</button><input type="file" hidden id="cfile" accept="application/pdf,image/png,image/jpeg">${crBoutonPhoto({ bouton: "data-ccam", champ: 'id="ccam"' })} <span class="meta">${reste} restant${reste > 1 ? "s" : ""}</span></div>`
    : '<div class="meta">Vingt documents joints : supprimez-en un pour en ajouter un autre.</div>') : "";
  return (l + ajout) || '<div class="meta">Aucun document.</div>';
}
function majDocs() { const b = $("cdocs"); if (b && CA.d) { b.innerHTML = htmlDocs(CA.d.id, true); chargerMiniatures(); } }
// Charge (une fois) les miniatures des images déjà envoyées : le contenu passe par le serveur, sans lien public.
function chargerMiniatures() {
  document.querySelectorAll("img[data-cimg]").forEach(async img => {
    const id = img.dataset.cimg;
    if (CA_IMG.has(id)) { img.src = CA_IMG.get(id); return; }
    try { const d = await api("carnet_fichier_lire", { id }); const src = "data:" + d.type + ";base64," + d.data; CA_IMG.set(id, src); img.src = src; } catch (e) { /* miniature absente */ }
  });
}
async function ajouterDocEnAttente(file, reduire) {
  if (nbDocs(CA.d.id) >= CA_FICHIERS_MAX) { CA.err = "Vingt documents au plus."; $("cerr").textContent = CA.err; return; }
  if (file.size > CR_FICHIER_MAX * 2 && !/^image\//.test(file.type)) { CA.err = "Fichier trop volumineux (5 Mo maximum)."; $("cerr").textContent = CA.err; return; }
  try {
    const contenu = await crContenuFichier(file, reduire);
    CA.attente.push({ nom: file.name, contenu, apercu: /^image\//.test(file.type) ? "data:" + (reduire || file.size > CR_IMAGE_SEUIL ? "image/jpeg" : file.type) + ";base64," + contenu : "" });
    CA.err = ""; $("cerr").textContent = ""; majDocs();
  } catch (e) { CA.err = "Fichier illisible : " + e.message; $("cerr").textContent = CA.err; }
}
async function ouvrirDoc(id) {
  try { const d = await enCours("Ouverture du document…", () => api("carnet_fichier_lire", { id })); telecharger(new Blob([Uint8Array.from(atob(d.data), c => c.charCodeAt(0))], { type: d.type }), d.nom); }
  catch (e) { alert("Ouverture impossible : " + e.message); }
}

$("notebody")?.addEventListener("change", e => {
  if (N.vue !== "carnet" || !CA.d) return;
  const t = e.target;
  if ((t.id === "cfile" || t.id === "ccam") && t.files && t.files[0]) {
    const brut = t.files[0]; t.value = "";
    if (t.id === "ccam") ajouterDocEnAttente(new File([brut], crNomPhoto(brut), { type: brut.type || "image/jpeg" }), true);   // photo prise avec l'appareil
    else ajouterDocEnAttente(brut, false);
  }
});
$("notebody")?.addEventListener("click", async e => {
  if (N.vue !== "carnet" || !CA.d) return;
  const b = e.target.closest("button"); if (!b) return;
  if (b.dataset.cfile !== undefined) $("cfile")?.click();
  else if (b.dataset.ccam !== undefined) $("ccam")?.click();
  else if (b.dataset.cdocretire !== undefined) { CA.attente.splice(Number(b.dataset.cdocretire), 1); majDocs(); }
  else if (b.dataset.cdl) ouvrirDoc(b.dataset.cdl);
  else if (b.dataset.cdocdel) {
    if (!confirm("Supprimer ce document ?")) return;
    try { const j = await enCours("Suppression…", () => api("carnet_fichier_supprimer", { id: b.dataset.cdocdel })); CA.entrees = j.carnet || []; renderCListe(); if (CA.mode === "ecrire") majDocs(); else renderCEdit(); }
    catch (x) { CA.err = x.message || "Suppression impossible."; if ($("cerr")) $("cerr").textContent = CA.err; }
  }
});
