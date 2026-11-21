/* Retours sur l'outil (bugs, idées).
   Script classique : partage la portée globale avec les autres fichiers de js/ (ordre de chargement : voir index.html). */
"use strict";
/* ---------- Retours sur l'outil (bugs, idées) ---------- */

const TYPES_FB = { bug: "🐞 Bug", idee: "💡 Idée d’amélioration", autre: "💬 Autre" };
// Suivi des retours (administrateur général) : « nouveau » = non traité.
const STATUTS_FB = { nouveau: "Non traité", a_faire: "À faire", ecartee: "Écartée", traitee: "Traitée" };
const FB = { ouvert: false, liste: [], restant: 2, par: 2, edition: "", focus: null };

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
function majEtatFeedback(r) { FB.liste = r.feedbacks || []; FB.restant = r.feedbackRestant ?? 0; FB.par = r.feedbackParJour || 2; }

function renderFeedback() {
  const ed = FB.liste.find(x => x.id === FB.edition), peut = !!ed || FB.restant > 0;
  const quand = iso => new Date(iso).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
  $("fbbody").innerHTML = `<div class="meta" style="margin-bottom:10px">Un bug, une idée, une remarque ? Ça aide à améliorer l’outil. Vos retours sont lus par l’administrateur.
    ${FB.par} au maximum par jour, modifiables jusqu’à minuit.</div>
   <div class="grid"><div><label for="fbtype">Type</label><select id="fbtype" ${peut ? "" : "disabled"}>${Object.keys(TYPES_FB).map(k => `<option value="${k}" ${ed && ed.type === k ? "selected" : ""}>${esc(TYPES_FB[k])}</option>`).join("")}</select></div></div>
   <label for="fbtexte" style="margin-top:8px">Votre retour</label>
   <textarea id="fbtexte" maxlength="2000" rows="5" ${peut ? "" : "disabled"} placeholder="${peut ? "Que s’est-il passé ? Qu’aimeriez-vous voir ?" : "Vous avez envoyé vos retours du jour."}">${esc(ed ? ed.texte : "")}</textarea>
   <div class="meta">${ed ? "Modification d’un retour envoyé aujourd’hui" : peut ? `Il vous reste ${FB.restant} retour${FB.restant > 1 ? "s" : ""} aujourd’hui` : `Limite de ${FB.par} retours par jour atteinte : modifiez-en un ci-dessous ou revenez demain`}
     · l’onglet et le navigateur utilisés sont joints pour aider à comprendre un bug.</div>
   <div class="savebar"><div id="fberr" class="err" role="alert"></div>
     <button class="btn" id="fbsend" type="button" ${peut ? "" : "disabled"}>${ed ? "Enregistrer la modification" : "Envoyer"}</button>
     ${ed ? '<button class="btn sec" id="fbannuler" type="button">Annuler la modification</button>' : ""}</div>
   ${FB.liste.length ? `<h3 style="font-size:14px;margin:14px 0 6px">Vos retours d’aujourd’hui</h3>` + FB.liste.map(x => `<div class="cardc" style="margin:6px 0"><div class="tools" style="justify-content:space-between"><span><b>${esc(TYPES_FB[x.type] || x.type)}</b> <span class="meta">· ${esc(quand(x.cree_le))}${x.modifie_le ? " · modifié" : ""}</span></span>
      <button type="button" class="btn sm sec" data-fbe="${esc(x.id)}">Modifier</button></div><div style="white-space:pre-wrap">${esc(x.texte)}</div></div>`).join("") : ""}`;
}

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
function blocFeedbacks() {
  const l = feedbacksAdmin;
  return `<h3>💡 Retours sur l’outil (${l.length})</h3>` + (l.length
    ? `<div class="meta">Les plus récents d’abord. Choisissez le statut de chaque retour : il se range tout seul dans la liste.</div>
      <div class="wrap"><table class="adm"><thead><tr><th>Date</th><th>De</th><th>Type</th><th>Retour</th><th>Statut</th></tr></thead><tbody>${l.map(f => `<tr><td>${esc(fmtDT(f.cree_le))}</td><td>${esc(f.par)}<div class="meta">${esc(f.email)}</div></td><td>${esc(TYPES_FB[f.type] || f.type)}</td>
        <td><div style="white-space:pre-wrap">${esc(f.texte)}</div>${f.contexte ? `<div class="meta">${esc(f.contexte)}</div>` : ""}</td><td><select data-fbs="${esc(f.id)}" aria-label="Statut du retour">${Object.keys(STATUTS_FB).map(k => `<option value="${k}" ${(f.statut || "nouveau") === k ? "selected" : ""}>${esc(STATUTS_FB[k])}</option>`).join("")}</select></td></tr>`).join("")}</tbody></table></div>`
    : `<div class="meta">Aucun retour pour l’instant.</div>`);
}

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
