/* Onglet Commentaires.
   Script classique : partage la portée globale avec les autres fichiers de js/ (ordre de chargement : voir index.html). */
"use strict";
/* ---------- Onglet « Commentaires » : tous les commentaires, non lus en tête ---------- */

function renderComments() {
  if (!me) return;
  const nv = comments.filter(nonLu).length;
  $("cmtcount").textContent = nv || "";
  $("cmtcount").classList.toggle("hidden", !nv);
  if (tab !== "cmts") return;
  const parId = new Map(items.map(i => [i.id, i]));
  let l = comments.filter(c => parId.has(c.lecture_id));
  if (CM.nonLus) l = l.filter(nonLu);
  if (CM.miennes) l = l.filter(c => parId.get(c.lecture_id).mine);
  l.sort((a, b) => String(b.date).localeCompare(String(a.date)));
  const cartes = l.map(c => {
    const it = parId.get(c.lecture_id), nvC = nonLu(c);
    return `<article class="cmcard ${nvC ? "fresh" : ""}" data-cid="${esc(c.id)}">
      <div class="cmhead"><b>${esc(c.auteur)}</b> <span class="meta">${esc(fmtDT(c.date))}${c.modifie_le ? " · modifié" : ""}</span>${nvC ? ' <span class="new">Nouveau</span>' : ""}</div>
      <div class="meta">sur <b>${esc(it.titre)}</b> · lecture de ${esc(it.etudiant)}${ctx.vue === "promo" ? " · " + esc(it.groupe) : ""}</div>
      <div class="cmtxt">${esc(c.texte)}</div>
      <div class="cmacts"><button class="btn sm" data-cgo="${esc(it.id)}">${canComment() ? "Voir et répondre" : "Voir la discussion"}</button>${nvC ? ` <button class="btn sm sec" data-cr="${esc(c.id)}">Marquer comme lu</button>` : !c.mine ? ` <button class="btn sm sec" data-cu="${esc(c.id)}">Marquer comme non lu</button>` : ""}</div>
    </article>`;
  }).join("");
  const vide = CM.nonLus ? "Aucun commentaire non lu. 🎉" : CM.miennes ? "Aucun commentaire sur vos lectures." : "Aucun commentaire pour le moment.";
  $("cmtsbox").innerHTML = `
    <div class="card tools">
      <label class="chk"><input type="checkbox" id="cmtnl" ${CM.nonLus ? "checked" : ""}> Non lus seulement</label>
      ${canWrite() ? `<label class="chk"><input type="checkbox" id="cmtmine" ${CM.miennes ? "checked" : ""}> Sur mes lectures</label>` : ""}
      <span class="meta">${nv ? nv + " non lu" + (nv > 1 ? "s" : "") : "Tout est lu"} · ${comments.length} au total</span>
      <button class="btn sm sec" id="cmtall" ${nv ? "" : "disabled"} style="margin-left:auto">Tout marquer comme lu</button>
    </div>
    <div class="cmlist">${cartes || `<div class="note">${vide}</div>`}</div>`;
}

$("cmtsbox").onclick = e => {
  const b = e.target.closest("button");
  if (!b) return;
  if (b.dataset.cgo) ouvrirDiscussion(b.dataset.cgo);
  else if (b.dataset.cr) marquerLus([b.dataset.cr]);
  else if (b.dataset.cu) marquerNonLus([b.dataset.cu]);
  else if (b.id === "cmtall") marquerLus([], true);
};
$("cmtsbox").onchange = e => {
  if (e.target.id === "cmtnl") CM.nonLus = e.target.checked;
  else if (e.target.id === "cmtmine") CM.miennes = e.target.checked;
  else return;
  renderComments();
};

async function commentAction(fn, errLabel) {
  try { applyResult(await enCours("Enregistrement…", fn)); }
  catch (e) { if (e.code === "unauthorized") sessionError(e); else alert(errLabel + " : " + e.message); }
}
