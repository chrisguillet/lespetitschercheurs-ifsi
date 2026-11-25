/* Tags entre camarades : un étudiant signale à un camarade de son groupe un document ou une fiche de lecture, avec un mot facultatif.
   Le destinataire est alerté (cloche 🏷 en haut à droite, accueil) et voit de qui vient le tag et pourquoi.
   Script classique : partage la portée globale avec les autres fichiers de js/ (ordre de chargement : voir index.html). */
"use strict";
/* ---------- Tags entre camarades ---------- */

let menEtat = { recues: [], envoyees: [], non_lues: 0 };
const MEN = { pop: false, form: null, msg: "", err: "" };   // form : { article_id, analyse_id, titre, pid, description } en cours de saisie

// Camarades que je peux taguer : les étudiants des groupes dont je fais partie (sans moi, sans doublon).
function camaradesTaggables() {
  if (!me || me.role !== "etudiant" || VUE_AS) return [];
  const m = new Map();
  groupes.filter(g => (g.membres || []).some(x => x.moi)).forEach(g => g.membres.filter(x => x.role === "etudiant" && !x.moi).forEach(x => {
    const e = m.get(x.pid) || { pid: x.pid, prenom: x.prenom, groupes: [] };
    e.groupes.push(g.nom); m.set(x.pid, e);
  }));
  return [...m.values()].sort((a, b) => a.prenom.localeCompare(b.prenom, "fr"));
}
const peutTaguer = () => camaradesTaggables().length > 0;
const boutonTag = (attr, id) => peutTaguer() ? ` <button type="button" class="btn sm sec" ${attr}="${esc(id)}" title="Signaler ceci à un camarade de votre groupe">🏷 Taguer</button>` : "";

function majMentions() {
  const zone = $("mentionbell"); if (!zone) return;
  if (!me || VUE_AS || (!peutTaguer() && !menEtat.recues.length)) { MEN.pop = false; zone.innerHTML = ""; return; }
  const n = menEtat.non_lues || 0;
  const fiche = m => {
    const cible = m.titre ? `<button type="button" class="lnk" data-men-voir="${esc(m.id)}" title="Retrouver dans le tableau commun">📄 ${esc(m.titre)}</button>` : "";
    return `<div class="alrow menrow ${m.lue ? "" : "fresh"}"><div class="alt"><b>${esc(m.de)}</b> <span class="meta">${esc(fmtDT(m.cree_le))}</span> ${m.lue ? "" : '<span class="new">Nouveau</span>'}
        ${cible ? `<div>${cible}</div>` : ""}${m.description ? `<div class="mendesc">${esc(m.description)}</div>` : '<div class="meta">(sans message)</div>'}</div>
      <button type="button" class="btn sm sec del" data-men-del="${esc(m.id)}" aria-label="Retirer ce tag">✕</button></div>`;
  };
  const pop = MEN.pop ? `<div class="alertpop menpop" role="dialog" aria-label="Tags de vos camarades"><div class="alhead"><b>🏷 Tags de vos camarades</b><button type="button" class="btn sm sec" data-men-fermer="1" aria-label="Fermer">✕</button></div>
      ${MEN.msg ? `<div class="note" role="status">${esc(MEN.msg)}</div>` : ""}
      ${menEtat.recues.length ? menEtat.recues.slice(0, 10).map(fiche).join("") : '<div class="meta" style="padding:8px 0">Aucun tag reçu pour l’instant.</div>'}
      <div class="alfoot">${n ? '<button type="button" class="btn sm sec" data-men-lu="1">Tout marquer comme lu</button> ' : ""}${peutTaguer() ? '<button type="button" class="btn sm" data-men-new="1">＋ Taguer un camarade</button>' : ""}</div></div>` : "";
  zone.innerHTML = `<button type="button" class="alertbtn" id="menbtn" aria-expanded="${MEN.pop}" aria-label="Tags de vos camarades${n ? " : " + n + " non lu" + (n > 1 ? "s" : "") : ""}" title="Tags de vos camarades">🏷${n ? `<span class="alertpt">${n}</span>` : ""}</button>${pop}`;
  const p = zone.querySelector(".alertpop");
  if (p && window.innerWidth <= 640) p.style.top = Math.round(zone.getBoundingClientRect().bottom + 8) + "px";
}

function ouvrirTag(cible) {
  MEN.form = { article_id: "", analyse_id: "", titre: "", pid: "", description: "", ...cible }; MEN.err = ""; MEN.pop = false; majMentions();
  renderTag(); $("tmodal").classList.remove("hidden"); document.body.classList.add("modalopen");
  $("tg_pid").focus();
}
function fermerTag() {
  MEN.form = null; $("tmodal").classList.add("hidden"); $("tbody").innerHTML = "";
  if (!cmId && !GM.ouvert) document.body.classList.remove("modalopen");
}
function renderTag() {
  const f = MEN.form; if (!f) return;
  const l = camaradesTaggables();
  $("tbody").innerHTML = `${f.titre ? `<div class="meta">À propos de : <b>${esc(f.titre)}</b></div>` : ""}
    <div><label for="tg_pid">Pour qui ?</label><select id="tg_pid"><option value="">— Choisir un camarade —</option>${l.map(c => `<option value="${esc(c.pid)}" ${c.pid === f.pid ? "selected" : ""}>${esc(c.prenom)}${groupes.length > 1 ? " (" + esc(c.groupes.join(", ")) + ")" : ""}</option>`).join("")}</select></div>
    <div><label for="tg_desc">Message <span class="meta">(facultatif : dites-lui pourquoi)</span></label><textarea id="tg_desc" rows="4" maxlength="500" placeholder="Ex. : ce passage peut t’aider pour ton cadre théorique">${esc(f.description)}</textarea></div>
    <div class="meta">Seul votre camarade verra ce tag, avec votre nom.</div>
    <div class="savebar"><div id="tg_err" class="err" role="alert">${esc(MEN.err)}</div><button type="button" class="btn" id="tg_send">Envoyer le tag</button> <button type="button" class="btn sec" id="tg_cancel">Annuler</button></div>`;
}
async function envoyerTag() {
  const f = MEN.form; if (!f) return;
  f.pid = $("tg_pid").value; f.description = $("tg_desc").value;
  if (!f.pid) { MEN.err = "Choisissez le camarade à taguer."; return renderTag(); }
  $("tg_send").disabled = true;
  try {
    const res = await enCours("Envoi du tag…", () => api("mention_send", { pid: f.pid, article_id: f.analyse_id ? undefined : f.article_id || undefined, analyse_id: f.analyse_id || undefined, description: f.description }));
    const nom = (camaradesTaggables().find(c => c.pid === f.pid) || {}).prenom || "votre camarade";
    fermerTag(); applyResult(res);
    MEN.msg = "Tag envoyé à " + nom + "."; MEN.pop = true; majMentions();
  } catch (e) {
    if (e.code === "unauthorized") return sessionError(e);
    MEN.err = e.message; renderTag();
  }
}
async function actionMention(nom, params) {
  try { applyResult(await api(nom, params)); }
  catch (e) { if (e.code === "unauthorized") sessionError(e); else alert("Action impossible : " + e.message); }
}
// Retrouve la fiche ou le document tagué dans le tableau commun (recherche sur son titre).
function voirMention(id) {
  const m = menEtat.recues.find(x => x.id === id); if (!m) return;
  if (!m.lue) actionMention("mention_read", { ids: [m.id] });
  MEN.pop = false;
  Object.assign(F, filtresVierges(), { sort: F.sort }); F.q = m.titre;
  setTab("all"); renderFilters(); renderTable(); majMentions();
}

$("mentionbell")?.addEventListener("click", e => {
  const b = e.target.closest("button"); if (!b) return;
  if (b.id === "menbtn") { MEN.pop = !MEN.pop; MEN.msg = ""; majMentions(); }
  else if (b.dataset.menFermer) { MEN.pop = false; majMentions(); }
  else if (b.dataset.menNew) ouvrirTag({});
  else if (b.dataset.menLu) actionMention("mention_read", { tout: true });
  else if (b.dataset.menDel) actionMention("mention_delete", { id: b.dataset.menDel });
  else if (b.dataset.menVoir) voirMention(b.dataset.menVoir);
});
document.addEventListener("click", e => { if (MEN.pop && !e.composedPath().includes($("mentionbell")) && !e.composedPath().includes($("tmodal"))) { MEN.pop = false; majMentions(); } });

// Boutons « Taguer » des fiches et des documents (le tableau est reconstruit souvent : délégation sur le document).
document.addEventListener("click", e => {
  const b = e.target.closest("[data-tag-fiche],[data-tag-doc],[data-men-accueil]"); if (!b) return;
  if (b.dataset.menAccueil) { MEN.pop = true; MEN.msg = ""; majMentions(); return; }
  const i = b.dataset.tagFiche ? ficheLiee(b.dataset.tagFiche) : itemsAll.find(x => x.article_id === b.dataset.tagDoc);
  if (!i) return;
  ouvrirTag(b.dataset.tagFiche ? { analyse_id: i.id, article_id: i.article_id, titre: i.titre } : { article_id: i.article_id, titre: i.titre });
});
$("tmodal").addEventListener("click", e => {
  if (e.target === $("tmodal") || e.target.id === "tg_cancel" || e.target.closest("#tclose")) return fermerTag();
  if (e.target.id === "tg_send") envoyerTag();
});
$("tmodal").addEventListener("keydown", e => { if (e.key === "Escape") fermerTag(); });
