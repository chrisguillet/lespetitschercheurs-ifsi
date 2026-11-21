/* Retours sur l'outil (bugs, idées).
   Script classique : partage la portée globale avec les autres fichiers de js/ (ordre de chargement : voir index.html). */
"use strict";
/* ---------- Retours sur l'outil (bugs, idées) ---------- */

const TYPES_FB = { bug: "🐞 Bug", idee: "💡 Idée d’amélioration", autre: "💬 Autre" };
// Suivi des retours (administrateur général) : « nouveau » = non traité.
const STATUTS_FB = { nouveau: "Non traité", a_faire: "À faire", ecartee: "Écartée", traitee: "Traitée" };
const FB = { ouvert: false, liste: [], restants: { bug: 10, idee: 5, autre: 3 }, limites: { bug: 10, idee: 5, autre: 3 }, type: "bug", edition: "", focus: null };

function ouvrirFeedback() {
  if (!$("fbmodal")) return;
  FB.ouvert = true; FB.edition = ""; FB.focus = document.activeElement;
  $("fbmodal").classList.remove("hidden"); document.body.classList.add("modalopen");
  renderFeedback();
  api("feedback_list").then(r => { majEtatFeedback(r); if (FB.ouvert) renderFeedback(); })
    .catch(e => { if (e.code === "unauthorized") sessionError(e); else $("fberr").textContent = "Chargement impossible : " + e.message; });
  $("fbtexte").focus();
}
function fermerFeedback(silencieux) {
  if (!$("fbmodal")) return;
  FB.ouvert = false; FB.edition = "";
  $("fbmodal").classList.add("hidden");
  if (!cmId && !GM.ouvert) document.body.classList.remove("modalopen");
  $("fbbody").innerHTML = "";
  if (!silencieux && FB.focus && FB.focus.isConnected && FB.focus.focus) { try { FB.focus.focus({ preventScroll: true }); } catch (e) { /* ignoré */ } }
}
function majEtatFeedback(r) { FB.liste = r.feedbacks || []; FB.restants = r.feedbackRestants || FB.restants; FB.limites = r.feedbackLimites || FB.limites; }

const LIB_PAR_JOUR = { bug: "bugs", idee: "idées", autre: "autres" };
function renderFeedback() {
  const ed = FB.liste.find(x => x.id === FB.edition);
  if (ed) FB.type = ed.type;
  const reste = FB.restants[FB.type] ?? 0, peut = !!ed || reste > 0;
  const quand = iso => new Date(iso).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
  const parJour = Object.keys(TYPES_FB).map(k => `${FB.limites[k]} ${LIB_PAR_JOUR[k]}`).join(", ");
  $("fbbody").innerHTML = `<div class="meta" style="margin-bottom:10px">Un bug, une idée, une remarque ? Ça aide à améliorer l’outil. Vos retours sont lus par l’administrateur.
    Par jour : ${parJour}, modifiables jusqu’à minuit.</div>
   <div class="grid"><div><label for="fbtype">Type</label><select id="fbtype">${Object.keys(TYPES_FB).map(k => `<option value="${k}" ${FB.type === k ? "selected" : ""}>${esc(TYPES_FB[k])}</option>`).join("")}</select></div></div>
   <label for="fbtexte" style="margin-top:8px">Votre retour</label>
   <textarea id="fbtexte" maxlength="2000" rows="5" ${peut ? "" : "disabled"} placeholder="${peut ? "Que s’est-il passé ? Qu’aimeriez-vous voir ?" : "Limite du jour atteinte pour ce type de retour."}">${esc(ed ? ed.texte : "")}</textarea>
   <div class="meta">${ed ? "Modification d’un retour envoyé aujourd’hui" : peut ? `Il vous reste ${reste} retour${reste > 1 ? "s" : ""} de ce type aujourd’hui` : `Limite de ${FB.limites[FB.type]} retours de ce type par jour atteinte : modifiez-en un ci-dessous, choisissez un autre type ou revenez demain`}
     · l’onglet et le navigateur utilisés sont joints pour aider à comprendre un bug.</div>
   <div class="savebar"><div id="fberr" class="err" role="alert"></div>
     <button class="btn" id="fbsend" type="button" ${peut ? "" : "disabled"}>${ed ? "Enregistrer la modification" : "Envoyer"}</button>
     ${ed ? '<button class="btn sec" id="fbannuler" type="button">Annuler la modification</button>' : ""}</div>
   ${FB.liste.length ? `<h3 style="font-size:14px;margin:14px 0 6px">Vos retours d’aujourd’hui</h3>` + FB.liste.map(x => `<div class="cardc" style="margin:6px 0"><div class="tools" style="justify-content:space-between"><span><b>${esc(TYPES_FB[x.type] || x.type)}</b> <span class="meta">· ${esc(quand(x.cree_le))}${x.modifie_le ? " · modifié" : ""}</span></span>
      <button type="button" class="btn sm sec" data-fbe="${esc(x.id)}">Modifier</button></div><div style="white-space:pre-wrap">${esc(x.texte)}</div></div>`).join("") : ""}`;
}
// Changer de type : la limite affichée et le bouton suivent, sans perdre le texte déjà saisi.
$("fbmodal")?.addEventListener("change", e => {
  if (e.target.id !== "fbtype") return;
  const brouillon = $("fbtexte").value;
  FB.type = e.target.value;
  renderFeedback();
  if (!$("fbtexte").disabled) $("fbtexte").value = brouillon;
  $("fbtype").focus();
});

async function envoyerFeedback() {
  const texte = $("fbtexte").value.trim();
  if (!texte) { $("fberr").textContent = "Écrivez votre retour."; return; }
  $("fbsend").disabled = true;
  const data = { type: $("fbtype").value, texte };
  if (!FB.edition) data.contexte = `onglet « ${tab} » · ${window.innerWidth}×${window.innerHeight} · ${(navigator.userAgent || "").slice(0, 150)}`;
  try {
    const r = await api("feedback_save", { id: FB.edition || undefined, data });
    majEtatFeedback(r); FB.edition = ""; renderFeedback();
    $("fberr").textContent = ""; $("fbbody").insertAdjacentHTML("afterbegin", '<div class="note" role="status">Merci, votre retour est enregistré ✅</div>');
  } catch (e) {
    if (e.code === "unauthorized") return sessionError(e);
    $("fberr").textContent = e.message; $("fbsend").disabled = false;
  }
}
if ($("fbopen")) $("fbopen").onclick = ouvrirFeedback;
if ($("fbclose")) $("fbclose").onclick = () => fermerFeedback();
$("fbmodal")?.addEventListener("click", e => {
  if (e.target === $("fbmodal")) return fermerFeedback();
  const b = e.target.closest("button"); if (!b) return;
  if (b.id === "fbsend") envoyerFeedback();
  else if (b.id === "fbannuler") { FB.edition = ""; renderFeedback(); }
  else if (b.dataset.fbe) { FB.edition = b.dataset.fbe; renderFeedback(); $("fbtexte").focus(); }
});

const sigFeedbacks = () => feedbacksAdmin.length + ":" + (feedbacksAdmin[0] ? feedbacksAdmin[0].id : "");
// Filtres de la liste (administrateur) : par défaut, les retours encore à traiter (non traités ou à faire) ; les traités et écartés se retrouvent par le filtre.
const FBF = { q: "", statut: "actifs", type: "" };
const FILTRES_STATUT_FB = [["actifs", "À traiter (non traités + à faire)"], ["", "Tous les statuts"], ["nouveau", "Non traités"], ["a_faire", "À faire"], ["traitee", "Traités"], ["ecartee", "Écartés"]];
function retoursFiltres() {
  const q = String(FBF.q || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
  return feedbacksAdmin.filter(f => {
    const st = f.statut || "nouveau";
    if (FBF.statut === "actifs" ? (st === "traitee" || st === "ecartee") : (FBF.statut && st !== FBF.statut)) return false;
    if (FBF.type && f.type !== FBF.type) return false;
    return !q || [f.texte, f.par, f.email, f.contexte].join(" ").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().includes(q);
  });
}
function listeRetoursHtml() {
  const l = retoursFiltres();
  const tete = `<div class="meta" role="status">${l.length} retour${l.length > 1 ? "s" : ""} affiché${l.length > 1 ? "s" : ""} sur ${feedbacksAdmin.length}</div>`;
  if (!l.length) return tete + '<div class="meta">Aucun retour ne correspond à ces critères.</div>';
  return tete + `<div class="wrap"><table class="adm"><thead><tr><th>Date</th><th>De</th><th>Type</th><th>Retour</th><th>Statut</th></tr></thead><tbody>${l.map(f => `<tr><td>${esc(fmtDT(f.cree_le))}</td><td>${esc(f.par)}<div class="meta">${esc(f.email)}</div></td><td>${esc(TYPES_FB[f.type] || f.type)}</td>
        <td><div style="white-space:pre-wrap">${esc(f.texte)}</div>${f.contexte ? `<div class="meta">${esc(f.contexte)}</div>` : ""}</td><td><select data-fbs="${esc(f.id)}" aria-label="Statut du retour">${Object.keys(STATUTS_FB).map(k => `<option value="${k}" ${(f.statut || "nouveau") === k ? "selected" : ""}>${esc(STATUTS_FB[k])}</option>`).join("")}</select></td></tr>`).join("")}</tbody></table></div>`;
}
function blocFeedbacks() {
  if (!feedbacksAdmin.length) return `<h3>💡 Retours sur l’outil</h3><div class="meta">Aucun retour pour l’instant.</div>`;
  const opt = (v, l, cur) => `<option value="${v}" ${cur === v ? "selected" : ""}>${esc(l)}</option>`;
  return `<h3>💡 Retours sur l’outil</h3>
    <div class="meta">Les plus récents d’abord. Choisissez le statut de chaque retour : il se range tout seul, et sort de la liste s’il est traité ou écarté (filtre « Tous les statuts » pour le retrouver).</div>
    <div class="persfiltres grow"><input type="search" data-ff="q" value="${esc(FBF.q)}" placeholder="Rechercher dans les retours" aria-label="Rechercher dans les retours" style="min-width:220px;flex:1">
      <select data-ff="statut" aria-label="Filtrer par statut">${FILTRES_STATUT_FB.map(([v, l]) => opt(v, l, FBF.statut)).join("")}</select>
      <select data-ff="type" aria-label="Filtrer par type">${opt("", "Tous les types", FBF.type)}${Object.keys(TYPES_FB).map(k => opt(k, TYPES_FB[k], FBF.type)).join("")}</select></div>
    <div id="fbliste">${listeRetoursHtml()}</div>`;
}
// Seule la liste est redessinée quand un filtre change : la saisie dans la recherche n'est pas interrompue.
$("adminbox").addEventListener("input", e => {
  const f = e.target.dataset && e.target.dataset.ff;
  if (!f) return;
  FBF[f] = e.target.value;
  if ($("fbliste")) $("fbliste").innerHTML = listeRetoursHtml();
});

// Changement de statut d'un retour, depuis la liste de l'administration.
$("adminbox").addEventListener("change", async e => {
  const s = e.target.closest("select[data-fbs]"); if (!s) return;
  s.disabled = true;
  try {
    const res = await api("feedback_status", { data: { id: s.dataset.fbs, statut: s.value } });
    feedbacksAdmin = res.feedbacks || feedbacksAdmin;
    renderAdmin();
  } catch (err) {
    s.disabled = false;
    if (err.code === "unauthorized") sessionError(err); else alert("Statut non enregistré : " + err.message);
  }
});
