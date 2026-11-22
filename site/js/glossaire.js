/* Glossaire du groupe : un mot, sa définition (modifiable) et la référence qui la fonde.
   Script classique : partage la portée globale avec les autres fichiers de js/ (ordre de chargement : voir index.html). */
"use strict";

let gloForm = null;   // { id } pendant la saisie : le formulaire est à part de la liste, qu'une actualisation peut reconstruire

// Comparaison sans casse ni accents (recherche et tri).
const gloCle = s => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim();

function renderGlossaire() {
  const g = groupeCourant(), box = $("glolist");
  if (!g || !box) { if (box) box.innerHTML = ""; return; }
  const ecrit = canWrite() && groupes.some(x => x.id === g.id);
  $("addterme").classList.toggle("hidden", !ecrit);
  const tous = termesAll.filter(t => t.groupe_id === g.id);
  const q = gloCle($("gloq").value);
  const tri = $("glotri") ? $("glotri").value : "mot";
  const alpha = (a, b) => gloCle(a).localeCompare(gloCle(b), "fr");
  const comparer = {
    "mot": (a, b) => alpha(a.mot, b.mot),
    "mot-desc": (a, b) => alpha(b.mot, a.mot),
    "recent": (a, b) => String(b.cree_le).localeCompare(String(a.cree_le)),
    "ancien": (a, b) => String(a.cree_le).localeCompare(String(b.cree_le)),
    "ref": (a, b) => (!a.reference) - (!b.reference) || alpha(a.reference, b.reference) || alpha(a.mot, b.mot),   // sans référence à la fin
  }[tri] || ((a, b) => alpha(a.mot, b.mot));
  const l = tous.filter(t => !q || gloCle(t.mot).includes(q) || gloCle(t.definition).includes(q) || gloCle(t.reference).includes(q))
    .sort(comparer);
  const alphabetique = tri === "mot" || tri === "mot-desc";   // intertitres par lettre seulement pour le tri alphabétique
  if (!tous.length) { box.innerHTML = `<div class="empty">Aucun terme pour l’instant.${ecrit ? " Ajoutez les définitions importantes de votre mémoire, avec la référence qui les donne." : ""}</div>`; return; }
  if (!l.length) { box.innerHTML = `<div class="empty">Aucun terme ne correspond à la recherche.</div>`; return; }
  let html = `<div class="meta" style="margin:8px 0">Groupe <b>${esc(g.nom)}</b> · ${tous.length} terme${tous.length > 1 ? "s" : ""}${q ? ` · ${l.length} affiché${l.length > 1 ? "s" : ""}` : ""}</div>`, lettre = "";
  l.forEach(t => {
    const ini = (gloCle(t.mot)[0] || "#").toUpperCase();
    if (alphabetique && ini !== lettre) { lettre = ini; html += `<h3 class="gloini">${esc(/[A-Z]/.test(ini) ? ini : "#")}</h3>`; }
    html += `<article class="terme"><div class="tools" style="justify-content:space-between"><b class="termemot">${esc(t.mot)}</b>
      ${t.modifiable ? `<div><button type="button" class="btn sm sec" data-ted="${esc(t.id)}">Modifier</button> <button type="button" class="btn sm sec del" data-tdel="${esc(t.id)}">Supprimer</button></div>` : ""}</div>
      <div style="white-space:pre-wrap">${esc(t.definition)}</div>
      ${t.reference ? `<div class="meta">📎 Référence : ${esc(t.reference)}</div>` : `<div class="meta">Aucune référence indiquée</div>`}
      <div class="meta">saisi par ${esc(t.par)}${t.modifie_par ? ` · modifié par ${esc(t.modifie_par)}` : ""}</div></article>`;
  });
  box.innerHTML = html;
}

function ouvrirTermeForm(id) {
  const g = groupeCourant(); if (!g) return;
  gloForm = { id: id || "" };
  const t = termesAll.find(x => x.id === id) || {};
  // Références déjà connues du groupe (ses fiches de lecture) proposées à la saisie ; le texte reste libre.
  const refs = [...new Set(itemsAll.filter(i => i.groupe_id === g.id && i.titre).map(i => `${i.auteur || "Auteur inconnu"}${i.parution ? " (" + i.parution + ")" : ""}. ${i.titre}`))].slice(0, 200);
  $("gloform").innerHTML = `<div class="sec" style="margin:10px 0"><div class="grid">
    <div><label for="t_mot">Mot ou expression</label><input id="t_mot" maxlength="120" value="${esc(t.mot)}" placeholder="ex. Résilience"></div>
    <div><label for="t_reference">Référence de la définition</label><input id="t_reference" maxlength="500" list="t_refs" value="${esc(t.reference)}" placeholder="ex. Cyrulnik (2002), p. 12"><datalist id="t_refs">${refs.map(r => `<option value="${esc(r)}">`).join("")}</datalist></div></div>
    <div><label for="t_definition">Définition</label><textarea id="t_definition" maxlength="2500" placeholder="La définition retenue, avec vos mots ou entre guillemets si c’est une citation">${esc(t.definition)}</textarea></div>
    <div class="meta">Un mot n’apparaît qu’une fois par groupe : pour le préciser, modifiez sa définition. Indiquez toujours la source (auteur, année, page) : elle vous servira pour la bibliographie.</div>
    <div class="savebar"><div id="terr" class="err" role="alert"></div><button class="btn" id="tsave" type="button">Enregistrer le terme</button> <button class="btn sec" id="tcancel" type="button">Annuler</button></div></div>`;
  $("tsave").onclick = () => enregistrerTerme(g.id, id, { mot: $("t_mot").value, definition: $("t_definition").value, reference: $("t_reference").value });
  $("tcancel").onclick = fermerTermeForm;
  $("t_mot").focus();
}

function fermerTermeForm() { gloForm = null; $("gloform").innerHTML = ""; }

async function enregistrerTerme(gid, id, data) {
  if (!data.mot.trim()) { $("terr").textContent = "Indiquez le mot ou l’expression."; return; }
  if (!data.definition.trim()) { $("terr").textContent = "Indiquez la définition."; return; }
  try {
    const res = await enCours("Enregistrement…", () => api("terme_save", { groupe_id: gid, id: id || undefined, data }));
    fermerTermeForm();
    applyResult(res);
  } catch (e) {
    if (e.code === "unauthorized") sessionError(e); else $("terr").textContent = e.code === "duplicate" ? e.message : "Enregistrement impossible : " + e.message;
  }
}

async function supprimerTerme(id) {
  if (!confirm("Supprimer ce terme du glossaire ?")) return;
  try { applyResult(await enCours("Suppression…", () => api("terme_delete", { id }))); }
  catch (e) { if (e.code === "unauthorized") sessionError(e); else alert("Suppression impossible : " + e.message); }
}

$("addterme").onclick = () => { fermerTermeForm(); ouvrirTermeForm(); };
$("gloq").addEventListener("input", renderGlossaire);
$("glotri")?.addEventListener("change", renderGlossaire);
$("glossaire").addEventListener("click", e => {
  const b = e.target.closest("button"); if (!b) return;
  if (b.dataset.ted) { fermerTermeForm(); ouvrirTermeForm(b.dataset.ted); }
  else if (b.dataset.tdel) supprimerTerme(b.dataset.tdel);
});
