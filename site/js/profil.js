/* Mon profil : prénom et nom (changement sur demande, validé par un administrateur), droit à l'effacement.
   Script classique : partage la portée globale avec les autres fichiers de js/ (ordre de chargement : voir index.html). */
"use strict";
/* ---------- Mon profil ---------- */

const COULEURS_PROFIL = ["#e11d48", "#f97316", "#f59e0b", "#84cc16", "#16a34a", "#0d9488", "#0ea5e9", "#3b82f6", "#6366f1", "#8b5cf6", "#d946ef", "#64748b"];
const PR = { ouvert: false, focus: null, msg: "", err: "", formNom: false };

function ouvrirProfil() {
  if (!me || !$("profmodal")) return;
  PR.ouvert = true; PR.msg = ""; PR.err = ""; PR.formNom = false; PR.focus = document.activeElement;
  $("profmodal").classList.remove("hidden"); document.body.classList.add("modalopen");
  renderProfil();
}
function fermerProfil() {
  if (!PR.ouvert) return;
  PR.ouvert = false;
  $("profmodal").classList.add("hidden");
  if (!cmId && !GM.ouvert && !FB.ouvert) document.body.classList.remove("modalopen");
  $("profbody").innerHTML = "";
  if (PR.focus && PR.focus.isConnected && PR.focus.focus) { try { PR.focus.focus({ preventScroll: true }); } catch (e) { /* ignoré */ } }
}

function renderProfil() {
  const id = me.identite || { prenom: "", nom: "", pseudo: "" };
  const dem = me.demande_nom;
  const contact = (window.LYDIA_CONFIG || {}).CONTACT || "";
  const mail = contact ? `<a href="mailto:${esc(contact)}?subject=${encodeURIComponent("Demande d’effacement de mes données")}">écrire aux responsables</a>` : "écrire aux responsables du projet";
  $("profbody").innerHTML = `
    ${PR.msg ? `<div class="note" role="status">${esc(PR.msg)}</div>` : ""}
    ${PR.err ? `<div class="note err" role="alert">${esc(PR.err)}</div>` : ""}
    <div class="gsec" style="border-top:0"><h3>Prénom et nom</h3>
      <div>Prénom : <b>${esc(id.prenom || "—")}</b> · Nom : <b>${esc(id.nom || "—")}</b></div>
      <div class="meta">Les autres membres vous voient sous le nom <b>${esc(me.prenom)}</b> (prénom et initiale du nom). Votre nom complet n’est visible que des administrateurs de votre site et de votre promo, qui valident les changements.</div>
      ${dem ? `<div class="note" role="status">⏳ Demande en attente : <b>${esc(dem.prenom)} ${esc(dem.nom)}</b> (envoyée le ${esc(fmtDT(dem.cree_le))}). Un administrateur va la traiter.</div>`
        : PR.formNom ? `<div class="grow"><input id="prnprenom" maxlength="60" value="${esc(id.prenom)}" placeholder="Prénom" aria-label="Nouveau prénom" autocomplete="given-name"><input id="prnnom" maxlength="60" value="${esc(id.nom)}" placeholder="Nom de famille" aria-label="Nouveau nom de famille" autocomplete="family-name">
          <button type="button" class="btn sm" id="prnok">Envoyer la demande</button><button type="button" class="btn sm sec" id="prnannuler">Annuler</button></div>`
          : '<button type="button" class="btn sm sec" id="prnouvrir">Demander un changement de prénom ou de nom</button>'}</div>
    <div class="gsec"><h3>Ma couleur</h3>
      <div class="meta">Votre pastille dans les listes, les fiches de lecture et le rétroplanning.</div>
      <div class="swatches">${COULEURS_PROFIL.map(c => `<button type="button" class="swatch ${String(me.couleur).toLowerCase() === c ? "on" : ""}" style="background:${c}" data-couleur="${c}" aria-label="Couleur ${c}" aria-pressed="${String(me.couleur).toLowerCase() === c}"></button>`).join("")}
        <label class="swatchpick" title="Choisir une autre couleur"><input type="color" id="prcolor" value="${esc(me.couleur)}" aria-label="Autre couleur"></label></div></div>
    <div class="gsec"><h3>Mes données</h3>
      <div class="meta">Vous pouvez <a href="#" id="prexport">télécharger tout ce que l’outil garde sur vous</a>. Pour demander l’effacement de votre compte, vous pouvez ${mail} : vous choisirez alors si vos contributions (fiches terminées, commentaires) sont anonymisées ou supprimées. <a href="privacy.html" target="_blank" rel="noopener">Politique de confidentialité</a></div></div>`;
}


async function enregistrerCouleur(couleur) {
  try {
    const res = await enCours("Enregistrement…", () => api("profile_update", { data: { couleur } }));
    if (res.me) { me = Object.assign(me, res.me); renderMe(); }
    applyResult(res);
    PR.msg = "Couleur enregistrée ✅"; PR.err = "";
  } catch (e) {
    if (e.code === "unauthorized") return sessionError(e);
    PR.err = e.message; PR.msg = "";
  }
  if (PR.ouvert) renderProfil();
}

async function demanderChangementNom() {
  const prenom = $("prnprenom").value.trim(), nom = $("prnnom").value.trim();
  if (!prenom || !nom) { PR.err = "Indiquez le prénom et le nom de famille souhaités."; PR.msg = ""; return renderProfil(); }
  $("prnok").disabled = true;
  try {
    await enCours("Envoi de la demande…", () => api("nom_demande", { data: { prenom, nom } }));
    me.demande_nom = { prenom, nom, cree_le: new Date().toISOString() };
    PR.formNom = false; PR.msg = "Demande envoyée ✅ Elle sera traitée par un administrateur."; PR.err = "";
  } catch (e) {
    if (e.code === "unauthorized") return sessionError(e);
    PR.err = e.message; PR.msg = "";
  }
  if (PR.ouvert) renderProfil();
}

async function exporterMesDonnees() {
  try {
    const j = await enCours("Préparation de vos données…", () => api("mes_donnees"));
    telecharger(new Blob([JSON.stringify(j.export, null, 2)], { type: "application/json" }), "mes-donnees-lectures-ifsi-" + new Date().toISOString().slice(0, 10) + ".json");
  } catch (e) { if (e.code === "unauthorized") sessionError(e); else alert("Téléchargement impossible : " + e.message); }
}

$("profclose")?.addEventListener("click", fermerProfil);
$("profmodal")?.addEventListener("click", e => {
  if (e.target === $("profmodal")) return fermerProfil();
  const b = e.target.closest("button, a"); if (!b) return;
  if (b.dataset.couleur) { enregistrerCouleur(b.dataset.couleur); return; }
  if (b.id === "prnouvrir") { PR.formNom = true; PR.msg = ""; PR.err = ""; renderProfil(); $("prnprenom").focus(); }
  else if (b.id === "prnannuler") { PR.formNom = false; renderProfil(); }
  else if (b.id === "prnok") demanderChangementNom();
  else if (b.id === "prexport") { e.preventDefault(); exporterMesDonnees(); }
});
$("profmodal")?.addEventListener("change", e => { if (e.target.id === "prcolor") enregistrerCouleur(e.target.value); });
$("profmodal")?.addEventListener("keydown", e => {
  if (e.key === "Escape") fermerProfil();
});
