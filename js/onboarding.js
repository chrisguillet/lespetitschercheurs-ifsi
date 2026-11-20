/* Première connexion, étudiant sans groupe.
   Script classique : partage la portée globale avec les autres fichiers de js/ (ordre de chargement : voir index.html). */
"use strict";
/* ---------- Première connexion : promo, code d'invitation ---------- */

const A = { structure: [], demande: null, msg: "", err: "" };

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
    <div class="gsec" style="border-top:0"><label for="ac_prenom"><b>Votre prénom</b></label>
      <input id="ac_prenom" maxlength="60" autocomplete="given-name" value="${esc(d.prenom || "")}" placeholder="Prénom (visible des membres de votre promo)"></div>
    <div class="gsec"><h3>🔑 J’ai un code d’invitation</h3>
      <div class="meta">Donné par votre formateur : il vous inscrit tout de suite comme étudiant(e) de la promo.</div>
      <div class="grow"><input id="ac_code" maxlength="20" autocomplete="off" autocapitalize="characters" placeholder="Code (ex. K7M2 9QXA)" aria-label="Code d’invitation"><button type="button" class="btn sm" id="ac_ok">Entrer</button></div></div>
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
  const garde = () => { const p = $("ac_prenom").value.trim(); if (!p) { A.err = "Indiquez votre prénom."; renderAccueil(); const f = $("ac_prenom"); if (f) f.focus(); } return p; };
  $("ac_ok").onclick = async () => {
    const prenom = garde(); if (!prenom) return;
    const code = $("ac_code").value;
    try { await enCours("Vérification du code…", () => api("join_code", { data: { code, prenom } })); box.innerHTML = ""; box.classList.add("hidden"); boot(); }
    catch (e) { if (e.code === "unauthorized") return sessionError(e); A.demande = Object.assign({}, d, { prenom }); A.err = e.message; A.msg = ""; renderAccueil(); }
  };
  if ($("ac_dem")) $("ac_dem").onclick = async () => {
    const prenom = garde(); if (!prenom) return;
    try {
      const r = await enCours("Envoi de la demande…", () => api("onboarding_demande", { data: { prenom, role: $("ac_role").value, promo_id: $("ac_promo") ? $("ac_promo").value : (unique ? unique.id : "") } }));
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
    ${libres.length ? libres.map(bloc).join("") : '<div class="meta" style="margin:6px 0">Vous n’êtes inscrit(e) à aucune promo : entrez le code d’invitation donné par votre formateur.</div>'}
    <div class="grow" style="margin-top:8px"><input id="rj_code" maxlength="20" autocomplete="off" autocapitalize="characters" placeholder="Code d’invitation d’une promo" aria-label="Code d’invitation"><button type="button" class="btn sm sec" id="rj_ok">Entrer le code</button></div>`;
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
    const code = $("rj_code").value;
    if (!code.trim()) return;
    try { await enCours("Vérification du code…", () => api("join_code", { data: { code } })); box.dataset.sig = ""; await refresh(true); }
    catch (err) { if (err.code === "unauthorized") sessionError(err); else alert("Code refusé : " + err.message); }
  }
};
