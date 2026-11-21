/* Première connexion, étudiant sans groupe.
   Script classique : partage la portée globale avec les autres fichiers de js/ (ordre de chargement : voir index.html). */
"use strict";
/* ---------- Première connexion : promo, code d'invitation ---------- */

const A = { structure: [], demande: null, msg: "", err: "" };

// Texte de consentement : à garder aligné sur la politique de confidentialité (la version est portée par le serveur).
const CONSENT_TEXTE = "L’outil est en version bêta : son fonctionnement va évoluer, avec pour but final de constituer une base de connaissances qui aide les étudiants à préparer leur mémoire. Mes contributions (fiches de lecture terminées, commentaires, termes du glossaire) sont conservées dans l’outil et pourront être mises à disposition des promotions suivantes, associées à mon prénom et à l’initiale de mon nom et à ma promo, sans mon adresse e-mail. Mes données sont hébergées chez IONOS ; les administrateurs de mon site et de ma promo voient mon adresse e-mail et mon nom pour gérer les accès. Je peux retirer mon accord et demander l’effacement de mes données à tout moment auprès des responsables du projet. Mon accord sera redemandé si l’usage de l’outil change de façon importante.";
const CONSENT_CASE = "J’ai lu la politique de confidentialité et j’accepte que mes contributions soient conservées et partagées avec les promotions suivantes, comme décrit ci-dessus.";

// Comptes déjà actifs avant le consentement explicite : fenêtre bloquante, accepter ou se déconnecter.
function demanderConsentement(version) {
  const m = $("consmodal"); if (!m) return;
  $("ctexte").textContent = CONSENT_TEXTE; $("ccase").textContent = CONSENT_CASE;
  $("caccord").checked = false; $("cerr").textContent = "";
  m.classList.remove("hidden"); document.body.classList.add("modalopen");
  $("cok").onclick = async () => {
    if (!$("caccord").checked) { $("cerr").textContent = "Cochez la case pour continuer."; return; }
    try {
      await enCours("Enregistrement…", () => api("consentement", { data: { consentement: true } }));
      me.consentement = true; m.classList.add("hidden"); document.body.classList.remove("modalopen");
    } catch (e) { if (e.code === "unauthorized") return sessionError(e); $("cerr").textContent = e.message || "Échec de l’enregistrement."; }
  };
  $("cno").onclick = () => { m.classList.add("hidden"); document.body.classList.remove("modalopen"); logout(); };
}

/* ---------- Lien d'invitation : « ?invitation=JETON » dans l'adresse, gardé le temps de la connexion Google ---------- */
const CLE_INVITATION = "lpc_invitation";
(function () {
  try {
    const p = new URLSearchParams(location.search), j = p.get("invitation");
    if (j) {
      sessionStorage.setItem(CLE_INVITATION, j.trim());
      p.delete("invitation");
      history.replaceState(null, "", location.pathname + (p.toString() ? "?" + p : "") + location.hash);   // le jeton ne reste pas dans l'adresse affichée
    }
  } catch (e) { /* stockage indisponible : le code peut être collé à la main */ }
})();
function jetonInvitationMemorise() { try { return sessionStorage.getItem(CLE_INVITATION) || ""; } catch (e) { return ""; } }
function oublierJetonInvitation() { try { sessionStorage.removeItem(CLE_INVITATION); } catch (e) { /* ignoré */ } }
// Accepte le lien complet ou le seul code.
function extraireJeton(v) {
  const t = String(v || "").trim(), m = /[?&]invitation=([^&#\s]+)/.exec(t);
  return m ? decodeURIComponent(m[1]) : t;
}

async function afficherAccueil(msg) {
  try {
    const r = await api("onboarding");
    Object.assign(A, { structure: r.structure || [], demande: r.demande || null, msg: msg || "", err: "" });
    renderAccueil();
  } catch (e) { if (e.code === "unauthorized") sessionError(e); }
}

function renderAccueil() {
  const box = $("accueil");
  const d = A.demande || {};
  const idn = { prenom: d.prenom || "", nom: d.nom || "" };
  const etabs = A.structure.filter(e => e.promos.length);
  const promoSel = d.promo_id ? A.structure.find(e => e.promos.some(p => p.id === d.promo_id)) : null;
  const etabId = promoSel ? promoSel.id : (etabs[0] ? etabs[0].id : "");
  const promos = (etabs.find(e => e.id === etabId) || { promos: [] }).promos;
  const toutes = etabs.flatMap(e => e.promos.map(p => ({ id: p.id, lib: `${e.nom} · ${p.nom}` })));
  const unique = toutes.length === 1 ? toutes[0] : null;   // une seule promo ouverte : aucun choix à faire
  const envoyee = d.role && d.promo ? `<div class="note" role="status">✅ Demande envoyée : ${esc(d.role === "etudiant" ? "étudiant" : "formateur")} · ${esc(d.promo)}. Vous aurez accès dès qu’elle sera validée ; vous pouvez la modifier ci-dessous, ou utiliser un code d’invitation pour entrer tout de suite.</div>` : "";
  box.innerHTML = `
    ${envoyee}
    ${A.msg ? `<div class="note" role="status">${esc(A.msg)}</div>` : ""}
    ${A.err ? `<div class="note err" role="alert">${esc(A.err)}</div>` : ""}
    <div class="gsec" style="border-top:0"><b>Votre identité</b>
      <div class="grow"><input id="ac_prenom" maxlength="60" autocomplete="given-name" value="${esc(idn.prenom)}" placeholder="Prénom" aria-label="Prénom"><input id="ac_nom" maxlength="60" autocomplete="family-name" value="${esc(idn.nom)}" placeholder="Nom de famille" aria-label="Nom de famille"></div>
      <div class="meta">Les autres membres verront votre prénom et l’initiale de votre nom (ex. « Camille D. ») : jamais votre nom complet. Vérifiez bien : prénom et nom ne pourront ensuite être changés que sur demande, validée par un administrateur.</div>
      <label class="rgpdcheck"><input type="checkbox" id="ac_consent" ${A.consent ? "checked" : ""}> <span>${esc(CONSENT_CASE)}</span></label>
      <div class="meta">${esc(CONSENT_TEXTE)} <a href="privacy.html" target="_blank" rel="noopener">Politique de confidentialité</a></div></div>
    <div class="gsec"><h3>🔑 J’ai un lien ou un code d’invitation</h3>
      <div class="meta">Donné par votre formateur ou un administrateur : il vous inscrit tout de suite. Collez ici le lien reçu, ou son code (la partie après « invitation= »).</div>
      <div class="grow"><input id="ac_code" maxlength="300" autocomplete="off" value="${esc(jetonInvitationMemorise())}" placeholder="Lien ou code d’invitation" aria-label="Lien ou code d’invitation"><button type="button" class="btn sm" id="ac_ok">Entrer</button></div></div>
    <div class="gsec"><h3>📨 Je demande l’accès</h3>
      ${etabs.length ? `<div class="grow"><label class="meta" for="ac_role" style="margin:0">Je suis</label><select id="ac_role"><option value="etudiant" ${d.role !== "formateur" ? "selected" : ""}>étudiant(e)</option><option value="formateur" ${d.role === "formateur" ? "selected" : ""}>formateur / formatrice</option></select></div>
        ${unique ? `<div class="meta">Promo : <b>${esc(unique.lib)}</b></div>` : `<div class="grow"><select id="ac_etab" aria-label="Établissement">${etabs.map(e => `<option value="${esc(e.id)}" ${e.id === etabId ? "selected" : ""}>${esc(e.nom)}</option>`).join("")}</select>
        <select id="ac_promo" aria-label="Promo">${promos.map(p => `<option value="${esc(p.id)}" ${p.id === d.promo_id ? "selected" : ""}>${esc(p.nom)}</option>`).join("")}</select></div>`}
        <div><button type="button" class="btn sm" id="ac_dem">Envoyer ma demande</button></div>
        <div class="meta">Sans code, l’administrateur valide votre demande avant que vous accédiez à l’outil.</div>`
    : '<div class="meta">Aucune promo n’est encore ouverte : demandez un code d’invitation à votre formateur.</div>'}</div>`;
  box.classList.remove("hidden");
  const et = $("ac_etab");
  if (et) et.onchange = () => {
    const e = A.structure.find(x => x.id === et.value);
    $("ac_promo").innerHTML = (e ? e.promos : []).map(p => `<option value="${esc(p.id)}">${esc(p.nom)}</option>`).join("");
  };
  // Prénom, nom et case de consentement obligatoires ; renvoie null (avec message) si l'un manque.
  const garde = () => {
    const prenom = $("ac_prenom").value.trim(), nom = $("ac_nom").value.trim(), consentement = $("ac_consent").checked;
    const manque = !prenom ? "Indiquez votre prénom." : !nom ? "Indiquez votre nom de famille." : !consentement ? "Cochez la case de consentement pour continuer." : "";
    if (manque) { A.err = manque; A.msg = ""; A.demande = Object.assign({}, d, { prenom, nom }); A.consent = consentement; renderAccueil(); const f = $(!prenom ? "ac_prenom" : !nom ? "ac_nom" : "ac_consent"); if (f) f.focus(); return null; }
    return { prenom, nom, consentement };
  };
  $("ac_ok").onclick = async () => {
    const id = garde(); if (!id) return;
    const code = extraireJeton($("ac_code").value);
    try { await enCours("Vérification de l’invitation…", () => api("join_code", { data: Object.assign({ code }, id) })); oublierJetonInvitation(); box.innerHTML = ""; box.classList.add("hidden"); boot(); }
    catch (e) { if (e.code === "unauthorized") return sessionError(e); A.demande = Object.assign({}, d, { prenom: id.prenom, nom: id.nom }); A.consent = id.consentement; A.err = e.message; A.msg = ""; renderAccueil(); }
  };
  if ($("ac_dem")) $("ac_dem").onclick = async () => {
    const id = garde(); if (!id) return;
    try {
      const r = await enCours("Envoi de la demande…", () => api("onboarding_demande", { data: { ...id, role: $("ac_role").value, promo_id: $("ac_promo") ? $("ac_promo").value : (unique ? unique.id : "") } }));
      Object.assign(A, { demande: r.demande, msg: "", err: "" }); renderAccueil();
    } catch (e) { if (e.code === "unauthorized") return sessionError(e); A.err = e.message; renderAccueil(); }
  };
}

/* ---------- Étudiant sans groupe : rejoindre (vote du groupe) ou créer le sien ---------- */

// Formateur : groupes de sa promo, demande de rattachement (vote des étudiants du groupe) et invitations reçues. Un formateur peut être dans plusieurs groupes.
function rattachementsHtml(sansMembre) {
  const grp = g => {
    const membres = g.membres.map(m => `<span class="chip"><span class="dot" style="background:${esc(m.couleur)}"></span>${esc(m.prenom)}</span>`).join(" ");
    const etat = x => `${x.oui} oui · ${x.non} non — ${x.besoin} oui nécessaires sur ${x.n} (jusqu’au ${esc(dateCourte(x.expire_le))})`;
    let act;
    if (g.membre) act = '<span class="meta">✅ Vous en faites partie</span>';
    else if (g.demande) act = `<span class="meta">Demande en cours : ${etat(g.demande)}</span> <button type="button" class="btn sm sec del" data-frc="${esc(g.demande.id)}">Annuler ma demande</button>`;
    else if (g.invitation) act = `<span class="meta">📨 Ce groupe vous invite : ${etat(g.invitation)}</span>`;
    else if (g.bloque) act = '<span class="meta">Demande refusée récemment : réessayez dans quelques jours.</span>';
    else act = `<button type="button" class="btn sm" data-fr="${esc(g.id)}">Demander à rejoindre</button>`;
    return `<div class="gmembre"><b>${esc(g.nom)}</b> ${membres || '<span class="meta">aucun étudiant</span>'} ${act}</div>`;
  };
  const blocs = rattachements.map(p => ({ ...p, groupes: p.groupes.filter(g => !sansMembre || !g.membre) })).filter(p => p.groupes.length);
  if (!blocs.length) return '<div class="meta">Aucun autre groupe à rejoindre dans votre promo pour l’instant.</div>';
  return `<div class="meta">Rejoindre un groupe : les étudiants du groupe votent (majorité simple, 7 jours). Un groupe peut aussi vous inviter. Vous pouvez être dans plusieurs groupes.</div>`
    + blocs.map(p => `${rattachements.length > 1 ? `<h3>🎓 ${esc(p.titre)}</h3>` : ""}${p.groupes.map(grp).join("")}`).join("");
}
function renderRattachements(box) {
  const sig = JSON.stringify(rattachements);
  if (box.dataset.sig === sig && box.innerHTML) return;
  box.dataset.sig = sig;
  box.innerHTML = `<b>Vous n’êtes rattaché(e) à aucun groupe pour le moment.</b>${rattachementsHtml(false)}
    <div class="meta" style="margin-top:6px">Si vous ne voyez aucun groupe, contactez l’administrateur.</div>`;
}

function renderRejoindre(box) {
  const libres = promosMoi.filter(p => !p.mon_groupe_id);
  const sig = JSON.stringify(promosMoi);
  const a = document.activeElement;
  if (box.dataset.sig === sig && box.innerHTML) return;
  if (a && box.contains(a) && (a.tagName === "INPUT" || a.tagName === "SELECT")) return;   // pas de reconstruction pendant une saisie
  box.dataset.sig = sig;
  const grp = (p, g) => {
    const membres = g.membres.map(m => `<span class="chip"><span class="dot" style="background:${esc(m.couleur)}"></span>${esc(m.prenom)}</span>`).join(" ");
    let act;
    if (g.demande) act = `<span class="meta">Demande en cours : ${g.demande.oui} oui · ${g.demande.non} non — ${g.demande.besoin} oui nécessaires sur ${g.demande.n} (jusqu’au ${esc(dateCourte(g.demande.expire_le))})</span> <button type="button" class="btn sm sec del" data-jcancel="${esc(g.demande.id)}">Annuler ma demande</button>`;
    else if (g.bloque) act = '<span class="meta">Demande refusée récemment : réessayez dans quelques jours.</span>';
    else act = `<button type="button" class="btn sm" data-jr="${esc(g.id)}">Demander à rejoindre</button>`;
    return `<div class="gmembre"><b>${esc(g.nom)}</b> ${membres} ${act}</div>`;
  };
  const bloc = p => `<div class="gsec"><h3>${promosMoi.length > 1 ? `🎓 ${esc(p.etablissement)} · ${esc(p.nom)}` : "Groupes de votre promo"}</h3>
      ${p.groupes.length ? `<div class="meta">Rejoindre un groupe : les étudiants du groupe votent (majorité simple, 7 jours).</div>${p.groupes.map(g => grp(p, g)).join("")}` : '<div class="meta">Aucun groupe dans cette promo pour l’instant.</div>'}
      <div class="grow" style="margin-top:8px"><input data-jn="${esc(p.id)}" maxlength="60" placeholder="Nom de mon groupe" aria-label="Nom de mon groupe"><button type="button" class="btn sm" data-jc="${esc(p.id)}">Créer mon groupe</button></div>
      <div class="meta">Un groupe peut compter un seul membre : d’autres pourront demander à le rejoindre.</div></div>`;
  box.innerHTML = `<b>Vous n’avez pas encore de groupe.</b>
    ${libres.length ? libres.map(bloc).join("") : '<div class="meta" style="margin:6px 0">Vous n’êtes inscrit(e) à aucune promo : entrez le lien ou le code d’invitation donné par votre formateur.</div>'}
    <div class="grow" style="margin-top:8px"><input id="rj_code" maxlength="300" autocomplete="off" value="${esc(jetonInvitationMemorise())}" placeholder="Lien ou code d’invitation" aria-label="Lien ou code d’invitation"><button type="button" class="btn sm sec" id="rj_ok">Entrer</button></div>`;
}

$("nogroup").onclick = async e => {
  const b = e.target.closest("button");
  if (!b) return;
  const d = b.dataset, box = $("nogroup");
  const rendre = res => { box.dataset.sig = ""; applyResult(res); };
  const agir = async (fn, errLabel) => {
    try { rendre(await enCours("Enregistrement…", fn)); }
    catch (err) { if (err.code === "unauthorized") sessionError(err); else alert(errLabel + " : " + err.message); }
  };
  if (d.jr) return agir(() => api("join_request", { groupe_id: d.jr }), "Demande impossible");
  if (d.fr) return agir(() => api("formateur_request", { groupe_id: d.fr }), "Demande impossible");
  if (d.frc) return agir(() => api("vote_cancel", { id: d.frc }), "Annulation impossible");
  if (d.jcancel) return agir(() => api("vote_cancel", { id: d.jcancel }), "Annulation impossible");
  if (d.jc) {
    const nom = box.querySelector(`[data-jn="${d.jc}"]`).value.trim();
    if (!nom) return;
    return agir(() => api("group_create_self", { promo_id: d.jc, nom }), "Création impossible");
  }
  if (b.id === "rj_ok") {
    const code = extraireJeton($("rj_code").value);
    if (!code.trim()) return;
    try { await enCours("Vérification du code…", () => api("join_code", { data: { code } })); box.dataset.sig = ""; await refresh(true); }
    catch (err) { if (err.code === "unauthorized") sessionError(err); else alert("Code refusé : " + err.message); }
  }
};
