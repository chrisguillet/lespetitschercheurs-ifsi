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

const CA = { entrees: [], charge: false, d: null, snap: "", q: "", mode: "ecrire", err: "" };
const carnetVide = () => ({ id: "", date: aujourdhuiISO(), vu: "", comprehension: "", apprentissage: "", types: [], interrogations: "", axe: "", transfert: "" });
const copieCarnet = e => ({ id: e.id, date: e.date, vu: e.vu, comprehension: e.comprehension, apprentissage: e.apprentissage, types: (e.types || []).slice(), interrogations: e.interrogations, axe: e.axe, transfert: e.transfert });
const nbRempli = e => SECT_CARNET.filter(s => String(e[s.k] || "").trim()).length;
const resume = (t, n) => { const s = String(t || "").replace(/\s+/g, " ").trim(); return s.length > n ? s.slice(0, n - 1) + "…" : s; };
const carnetModifie = () => !!CA.d && JSON.stringify(CA.d) !== CA.snap;
const confirmerAbandon = () => !carnetModifie() || confirm("Cette entrée a des modifications non enregistrées. Les abandonner ?");

function chargerCarnet() {
  return api("carnet_list").then(j => { CA.entrees = j.carnet || []; CA.charge = true; })
    .catch(e => { if (!CA.charge && N.ouvert && N.vue === "carnet") $("notebody").innerHTML = `<div class="err" style="padding:14px">Chargement impossible : ${esc(e.message)}</div>`; throw e; });
}
function ouvrirCarnet() {
  CA.d = null; CA.snap = ""; CA.q = ""; CA.err = ""; CA.mode = "ecrire";
  if (CA.charge) renderCarnet(); else $("notebody").innerHTML = '<div class="meta" style="padding:14px">Chargement…</div>';
  chargerCarnet().then(() => { if (N.ouvert && N.vue === "carnet") renderCarnet(); }).catch(() => {});
}
function reinitialiserCarnet() { CA.entrees = []; CA.charge = false; CA.d = null; CA.snap = ""; }

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
    return `<button type="button" class="nitem ${CA.d && CA.d.id === e.id ? "on" : ""}" data-copen="${esc(e.id)}"><b>🗓️ ${esc(fmtD(e.date))}</b><span class="cdots" aria-label="${nbRempli(e)} rubriques sur 6">${pts}<span class="meta">${nbRempli(e)}/6</span></span>${(e.types || []).length ? `<span class="meta">${e.types.map(t => "🎓 " + esc(t)).join(" · ")}</span>` : ""}<span class="meta ccex">${esc(apercu)}</span></button>`;
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
      ${s.k === "apprentissage" ? `<div class="meta">Type d’apprentissage :</div><div class="ntags" id="ctypes">${chips}</div>` : ""}</section>`).join("");
}

// Aperçu : la fiche telle qu’elle se lira, les rubriques vides étant signalées plutôt que masquées.
function htmlApercu(e) {
  return `<article class="capercu"><header><b>🗓️ ${esc(fmtD(e.date))}</b><span class="meta">${nbRempli(e)}/6 rubriques</span></header>`
    + SECT_CARNET.map((s, i) => {
      const t = String(e[s.k] || "").trim();
      const types = s.k === "apprentissage" && (e.types || []).length ? `<div class="ntags">${e.types.map(x => `<span class="ntag on">${esc(x)}</span>`).join("")}</div>` : "";
      return `<section class="csec s${i} ${t ? "" : "vide"}"><h4><span class="cico" aria-hidden="true">${s.ico}</span> ${esc(s.lib)}</h4>${t ? `<p>${esc(t)}</p>` : '<p class="meta">Non renseigné.</p>'}${types}</section>`;
    }).join("") + "</article>";
}
function renderCApercu() { $("cmain").innerHTML = htmlApercu(CA.d); }

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
      const x = CA.entrees.find(y => y.id === j.id);
      CA.d = x ? copieCarnet(x) : null; CA.snap = CA.d ? JSON.stringify(CA.d) : "";
      renderCListe(); renderCEdit();
      if (CA.d) $("cerr").textContent = "✔ Enregistré";
    } catch (x) { CA.err = x.message || "Échec de l'enregistrement."; if ($("cerr")) $("cerr").textContent = CA.err; }
  }
  else if (b.dataset.cdel !== undefined) {
    if (!confirm("Supprimer cette entrée du carnet ?")) return;
    try { const j = await enCours("Suppression…", () => api("carnet_delete", { id: CA.d.id })); CA.entrees = j.carnet || []; ouvrir(null); }
    catch (x) { CA.err = x.message || "Échec de la suppression."; if ($("cerr")) $("cerr").textContent = CA.err; }
  }
});
