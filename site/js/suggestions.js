/* Propositions de lecture : un formateur (ou un administrateur) propose un article à la promo, sans fiche de lecture.
   Les groupes « tagués » reçoivent une alerte ; le tag n'est visible que de l'auteur et des administrateurs.
   Script classique : partage la portée globale avec les autres fichiers de js/ (ordre de chargement : voir index.html). */
"use strict";
/* ---------- Propositions de lecture ---------- */

let sugEtat = { liste: [], peut: [], groupes: [], alertes: 0 };
const SUG = { form: null, ouvertes: new Set(), msg: "" };   // form : { id, ...champs } en cours de saisie ; ouvertes : propositions « nouvelles » à l'ouverture de l'onglet

const sugVisible = () => !!me && (sugEtat.liste.length > 0 || sugEtat.peut.length > 0);
const sugPromo = () => { const g = groupeCourant(); return g ? g.promo_id : ""; };
const sugListe = () => { const p = sugPromo(); return p ? sugEtat.liste.filter(s => s.promo_id === p) : sugEtat.liste; };
const sugPromoForm = () => { const p = sugPromo(); return sugEtat.peut.includes(p) ? p : (sugEtat.peut[0] || ""); };

// Pastille de l'onglet : propositions qui m'alertent (mon groupe est tagué) et que je n'ai pas encore ouvertes.
function majPastilleSuggestions() {
  const b = $("sugcount"); if (!b) return;
  const n = sugEtat.alertes || 0;
  b.textContent = n ? String(n) : "";
  b.classList.toggle("hidden", !n);
}

function renderSuggestions() {
  const box = $("sugbox");
  if (!box || !me) return;
  const liste = sugListe();
  const peutProposer = sugEtat.peut.length > 0;
  // Ce qui était nouveau à l'ouverture reste marqué pendant la visite ; on prévient le serveur que c'est vu.
  liste.filter(s => s.nouveau).forEach(s => SUG.ouvertes.add(s.id));
  box.innerHTML = `<div class="card">
      <div class="tools" style="justify-content:space-between"><h2 style="font-size:16px;margin:0">💡 Propositions de lecture</h2>
        ${peutProposer && !SUG.form ? '<button type="button" class="btn" id="sugnew">＋ Proposer une lecture</button>' : ""}</div>
      <div class="meta">${peutProposer ? "Proposez un article à la promo, sans fiche de lecture ; vous pouvez alerter des groupes en particulier (les autres ne voient pas ce choix)." : "Des articles proposés à la promo par vos formateurs."}</div>
      ${SUG.msg ? `<div class="note" role="status">${esc(SUG.msg)}</div>` : ""}
    </div>
    ${SUG.form ? sugFormHtml() : ""}
    <div class="sugliste">${liste.length ? liste.map(sugCarte).join("") : '<div class="card empty">Aucune proposition pour l’instant.</div>'}</div>`;
  const nouveaux = liste.filter(s => s.nouveau).map(s => s.id);
  if (nouveaux.length && tab === "sug") {
    api("suggestion_vues", { ids: nouveaux }).then(res => { applyResult(res); }).catch(e => { if (e.code === "unauthorized") sessionError(e); });
  }
}

function sugCarte(s) {
  const doi = s.doi ? `<a class="lien" href="https://doi.org/${encodeURIComponent(s.doi).replace(/%2F/gi, "/")}" target="_blank" rel="noopener noreferrer">DOI ${esc(s.doi)}</a>` : "";
  const lien = urlSure(s.lien) ? `<a class="lien" href="${esc(urlSure(s.lien))}" target="_blank" rel="noopener noreferrer">🔗 Ouvrir l’article</a>` : "";
  const refs = [s.auteur, s.parution, s.type, s.source].filter(Boolean).map(esc).join(" · ");
  const nouveau = s.nouveau || SUG.ouvertes.has(s.id);
  const tags = s.modifiable && s.groupes.length ? `<div class="meta">🔔 Groupes alertés : ${s.groupes.map(id => esc((sugEtat.groupes.find(g => g.id === id) || {}).nom || "?")).join(", ")} (invisible des autres)</div>` : "";
  return `<article class="cardc sug" data-sid="${esc(s.id)}">
      <h3>${esc(s.titre)} ${nouveau ? '<span class="new">Nouveau</span>' : ""}</h3>
      ${refs ? `<div class="meta">${refs}</div>` : ""}
      ${doi || lien ? `<div class="sugliens">${doi} ${lien}</div>` : ""}
      ${s.note ? `<div class="sugnote">${esc(s.note)}</div>` : ""}
      <div class="meta">Proposé par <b>${esc(s.par)}</b> le ${esc(fmtD(s.cree_le))}</div>${tags}
      <div class="acts">${canWrite() ? `<button type="button" class="btn sm" data-sug-lire="${esc(s.id)}">➕ Ajouter à mes lectures</button>` : ""}
        ${s.modifiable ? `<button type="button" class="btn sm sec" data-sug-edit="${esc(s.id)}">✏️ Modifier</button><button type="button" class="btn sm sec del" data-sug-del="${esc(s.id)}">🗑 Supprimer</button>` : ""}</div>
    </article>`;
}

function sugFormHtml() {
  const f = SUG.form, promo = f.promo_id || sugPromoForm();
  const groupes = sugEtat.groupes.filter(g => g.promo_id === promo);
  const promosOpts = sugEtat.peut.length > 1 && !f.id
    ? `<div><label for="sg_promo">Promo</label><select id="sg_promo">${sugEtat.peut.map(p => { const lib = ((sugEtat.liste.find(s => s.promo_id === p) || {}).promo) || ((groupesAdminLib(p)) || p); return `<option value="${esc(p)}" ${p === promo ? "selected" : ""}>${esc(lib)}</option>`; }).join("")}</select></div>` : "";
  const champ = (id, lib, val, extra) => `<div><label for="sg_${id}">${lib}</label><input id="sg_${id}" value="${esc(val || "")}" ${extra || ""}></div>`;
  return `<div class="card sugform" id="sugform"><h3 style="margin:0 0 8px;font-size:15px">${f.id ? "Modifier la proposition" : "Proposer une lecture"}</h3>
    <div class="grid">${promosOpts}
      <div style="grid-column:1/-1"><label for="sg_doi">DOI <span class="meta">(préremplit le reste)</span></label>
        <div class="grow"><input id="sg_doi" value="${esc(f.doi || "")}" placeholder="10.xxxx/…" style="flex:1;min-width:200px"><button type="button" class="btn sm sec" id="sg_doigo">Préremplir</button></div>
        <div id="sg_doimsg" class="meta" role="status"></div></div>
      <div style="grid-column:1/-1">${champ("titre", "Titre de l’article *", f.titre, 'maxlength="500"')}</div>
      ${champ("auteur", "Auteur(s)", f.auteur, 'maxlength="500"')}${champ("parution", "Date de parution", f.parution, 'maxlength="20" placeholder="2021"')}
      <div><label for="sg_type">Type d’article</label><select id="sg_type"><option value=""></option>${TYPES.map(t => `<option ${f.type === t ? "selected" : ""}>${esc(t)}</option>`).join("")}</select></div>
      ${champ("source", "Revue ou source", f.source, 'maxlength="500"')}
      <div style="grid-column:1/-1">${champ("lien", "Lien", f.lien, 'maxlength="500" type="url" placeholder="https://…"')}</div>
      <div style="grid-column:1/-1"><label for="sg_note">Pourquoi le lire ? <span class="meta">(facultatif, visible de la promo)</span></label><textarea id="sg_note" rows="3" maxlength="1500">${esc(f.note || "")}</textarea></div>
    </div>
    ${groupes.length ? `<fieldset class="sugtags"><legend>🔔 Alerter des groupes <span class="meta">(les autres étudiants ne voient pas ce choix)</span></legend>
      ${groupes.map(g => `<label class="chk"><input type="checkbox" data-sg-g="${esc(g.id)}" ${(f.groupes || []).includes(g.id) ? "checked" : ""}> ${esc(g.nom)}</label>`).join(" ")}</fieldset>` : ""}
    <div class="savebar"><div id="sg_err" class="err" role="alert"></div><button type="button" class="btn" id="sg_save">${f.id ? "Enregistrer" : "Proposer"}</button> <button type="button" class="btn sec" id="sg_cancel">Annuler</button></div></div>`;
}
const groupesAdminLib = p => { const g = groupes.find(x => x.promo_id === p); return g ? `${g.etablissement} · ${g.promo}` : ""; };

function sugLireForm() {
  const v = id => ($("sg_" + id) ? $("sg_" + id).value : "");
  return { promo_id: $("sg_promo") ? $("sg_promo").value : (SUG.form.promo_id || sugPromoForm()), titre: v("titre"), auteur: v("auteur"), parution: v("parution"), type: v("type"), source: v("source"),
    doi: v("doi"), lien: v("lien"), note: v("note"), groupes: [...document.querySelectorAll("[data-sg-g]:checked")].map(c => c.dataset.sgG) };
}

async function sugPrerempli() {
  const doi = $("sg_doi").value.trim();
  if (!doi) { $("sg_doimsg").textContent = "Saisissez un DOI."; return; }
  $("sg_doigo").disabled = true; $("sg_doimsg").textContent = "Recherche…";
  try {
    const r = await api("doi_lookup", { doi });
    const c = r.champs || {}; let n = 0;
    ["titre", "auteur", "parution", "type", "source", "doi", "lien"].forEach(k => { const e = $("sg_" + k); if (e && c[k] && !e.value.trim()) { e.value = c[k]; n++; } });
    $("sg_doimsg").textContent = n ? `✅ ${n} champ${n > 1 ? "s" : ""} prérempli${n > 1 ? "s" : ""} (Crossref). Vérifiez-les.` : "Rien à ajouter : les champs sont déjà remplis ou la notice est vide.";
  } catch (e) {
    if (e.code === "unauthorized") return sessionError(e);
    $("sg_doimsg").textContent = "Préremplissage impossible : " + e.message;
  } finally { $("sg_doigo").disabled = false; }
}

async function sugEnregistrer() {
  $("sg_save").disabled = true;
  try {
    const res = await enCours("Enregistrement…", () => api("suggestion_save", { id: SUG.form.id || undefined, data: sugLireForm() }));
    SUG.msg = SUG.form.id ? "Proposition modifiée." : "Proposition publiée : toute la promo la voit, les groupes choisis sont alertés.";
    SUG.form = null; applyResult(res); renderSuggestions();
  } catch (e) {
    if (e.code === "unauthorized") return sessionError(e);
    $("sg_err").textContent = e.message; $("sg_save").disabled = false;
  }
}

// Ajoute la proposition aux lectures « À lire » de la personne (l'article est créé, ou rattaché s'il existe déjà dans la promo).
async function sugAjouterAMesLectures(id, bouton) {
  const s = sugEtat.liste.find(x => x.id === id), g = groupeCourant();
  if (!s || !g) return;
  bouton.disabled = true;
  const base = { statut: "À lire", priorite: "normale" };
  try {
    let res;
    try { res = await api("add", { data: { ...base, groupe_id: g.id, titre: s.titre, auteur: s.auteur, parution: s.parution, type: s.type, source: s.source, doi: s.doi, lien: s.lien } }); }
    catch (e) {
      if (e.code === "duplicate" && e.extra && e.extra.article_id) res = await api("add", { data: { ...base, article_id: e.extra.article_id } });
      else throw e;
    }
    applyResult(res);
    SUG.msg = "« " + s.titre + " » est dans vos lectures (À lire).";
    renderSuggestions();
  } catch (e) {
    if (e.code === "unauthorized") return sessionError(e);
    SUG.msg = e.message.includes("déjà une fiche") ? "Cet article est déjà dans vos lectures." : "Ajout impossible : " + e.message;
    renderSuggestions();
  }
}

$("sugbox").addEventListener("click", async e => {
  const b = e.target.closest("button"); if (!b) return;
  if (b.id === "sugnew") { SUG.form = { promo_id: sugPromoForm(), groupes: [] }; SUG.msg = ""; return renderSuggestions(); }
  if (b.id === "sg_cancel") { SUG.form = null; return renderSuggestions(); }
  if (b.id === "sg_save") return sugEnregistrer();
  if (b.id === "sg_doigo") return sugPrerempli();
  if (b.dataset.sugLire) return sugAjouterAMesLectures(b.dataset.sugLire, b);
  if (b.dataset.sugEdit) {
    const s = sugEtat.liste.find(x => x.id === b.dataset.sugEdit); if (!s) return;
    SUG.form = { ...s }; SUG.msg = ""; renderSuggestions(); $("sugform")?.scrollIntoView({ block: "start" }); return;
  }
  if (b.dataset.sugDel) {
    const s = sugEtat.liste.find(x => x.id === b.dataset.sugDel); if (!s) return;
    if (!confirm("Supprimer la proposition « " + s.titre + " » ? Elle disparaît pour toute la promo.")) return;
    try { applyResult(await enCours("Suppression…", () => api("suggestion_delete", { id: s.id }))); SUG.msg = "Proposition supprimée."; renderSuggestions(); }
    catch (err) { if (err.code === "unauthorized") sessionError(err); else alert("Suppression impossible : " + err.message); }
  }
});
$("sugbox").addEventListener("change", e => {
  if (e.target.id !== "sg_promo") return;
  SUG.form = { ...sugLireForm(), id: SUG.form.id };   // la liste des groupes à alerter dépend de la promo choisie
  renderSuggestions();
});
