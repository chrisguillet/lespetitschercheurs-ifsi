/* Bibliographie et synthèse.
   Script classique : partage la portée globale avec les autres fichiers de js/ (ordre de chargement : voir index.html). */
"use strict";
/* ---------- Bibliographie ---------- */

const B = { who: "", enCours: false };

// Une référence par article, même s'il porte plusieurs fiches de lecture.
const parArticle = l => { const vu = new Set(); return l.filter(i => { const k = i.article_id || i.id; if (vu.has(k)) return false; vu.add(k); return true; }); };

function biblioListe() {
  return LydiaApa.bibliographie(parArticle(items.filter(i => (!B.who || i.etudiant === B.who) && (B.enCours || i.statut === "Terminée"))));
}

function renderBiblioTools() {
  $("bibtools").innerHTML = `<label for="bwho" class="meta" style="margin:0">Étudiant</label>
   <select id="bwho"><option value="">Tous</option>${students().map(s => `<option ${B.who === s.prenom ? "selected" : ""}>${esc(s.prenom)}</option>`).join("")}</select>
   <label class="chk"><input type="checkbox" id="ben" ${B.enCours ? "checked" : ""}> Inclure les lectures en cours</label>
   <button type="button" class="btn sm" id="bcopy">📋 Tout copier</button>
   <button type="button" class="btn sm sec" id="bdoc">⬇️ Word</button>
   <button type="button" class="btn sm sec" id="btxt">⬇️ Texte</button>
   <button type="button" class="btn sm sec" id="bprint">🖨️ Imprimer</button>`;
  $("bwho").onchange = e => { B.who = e.target.value; renderBiblio(); };
  $("ben").onchange = e => { B.enCours = e.target.checked; renderBiblio(); };
  $("bcopy").onclick = () => {
    const l = biblioListe();
    if (l.length) copier(l.map(r => `<p style="margin-left:36pt;text-indent:-36pt">${r.html}</p>`).join(""), l.map(r => r.text).join("\n\n"), "📋 Bibliographie copiée");
  };
  $("bdoc").onclick = exportBiblioWord;
  $("btxt").onclick = () => { const l = biblioListe(); if (l.length) telecharger(new Blob([l.map(r => r.text).join("\n\n")], { type: "text/plain;charset=utf-8" }), "bibliographie-" + stamp() + ".txt"); };
  $("bprint").onclick = () => window.print();
}

function renderBiblio() {
  const l = biblioListe();
  $("biblist").innerHTML = `<h2 style="margin-top:0;font-size:16px">Références (${l.length})</h2>
   <div class="note noprint">Classées par ordre alphabétique d’auteur (APA 7). Les références marquées « incomplète » n’ont pas encore de revue ou de pages : complétez-les dans le formulaire de la lecture.</div>
   <div class="biblio">${l.length ? l.map(r => `<p>${r.html}${r.incomplet ? '<span class="warn noprint">⚠ incomplète</span>' : ""}</p>`).join("") : '<div class="empty">Aucune référence à afficher.</div>'}</div>`;
}

function telecharger(blob, nom) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = nom;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}

function exportBiblioWord() {
  const l = biblioListe();
  if (!l.length) return;
  // Word ouvre ce HTML tel quel : retrait suspendu de 1,27 cm et interligne double, comme l'exige l'APA.
  const html = `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40"><head><meta charset="utf-8"><title>Références</title></head>
<body style="font-family:'Times New Roman',serif;font-size:12pt"><h1 style="font-size:14pt;text-align:center">Références</h1>
${l.map(r => `<p style="margin:0 0 0 36pt;text-indent:-36pt;line-height:200%">${r.html}</p>`).join("\n")}</body></html>`;
  telecharger(new Blob(["﻿" + html], { type: "application/msword" }), "bibliographie-" + stamp() + ".doc");
}

/* ---------- Synthèse ---------- */

function barres(titre, entrees, couleur) {
  if (!entrees.length) return "";
  const max = Math.max(...entrees.map(e => e[1]));
  return `<div class="card"><h3>${titre}</h3>${entrees.map(([lib, n, c]) =>
    `<div class="bar"><span class="bl" title="${esc(lib)}">${esc(lib)}</span><div class="bt"><div class="bf" style="width:${Math.round(n / max * 100)}%;background:${esc(c || couleur)}"></div></div><span class="bn">${n}</span></div>`).join("")}</div>`;
}

function compter(valeurs, max) {
  const m = new Map();
  valeurs.forEach(v => { const k = cleTitre(v); if (!k) return; const e = m.get(k) || [String(v).trim(), 0]; e[1]++; m.set(k, e); });
  return [...m.values()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "fr")).slice(0, max);
}

