/* Groupes : contexte, membres et votes, administration des groupes.
   Script classique : partage la portée globale avec les autres fichiers de js/ (ordre de chargement : voir index.html). */
"use strict";
/* ---------- Groupes : sélecteur de contexte, fenêtre du groupe, votes ---------- */

// Commentaires non lus d'un groupe (fil du groupe) ou de sa promo (fil de la promo).
function nonLusDe(g, vue) {
  const par = new Map(itemsAll.map(i => [i.id, i]));
  return commentsAll.filter(c => {
    const i = par.get(c.lecture_id);
    if (!i || !nonLu(c)) return false;
    return vue === "promo" ? c.portee === "promo" && memePromo(i, g) : c.portee !== "promo" && i.groupe_id === g.id;
  }).length;
}

const votesAFaire = g => votes.filter(v => v.groupe_id === g.id && v.peut_voter && v.mon_vote === null).length;

// Bandeau sous les onglets : groupe, vue (groupe ou promo) et accès à la fenêtre du groupe. Reconstruit seulement s'il change.
function renderCtx() {
  const bar = $("ctxbar");
  const g = me ? groupeCourant() : null;
  document.body.classList.toggle("nogroup", !!me && !g);
  const msg = $("nogroup");
  if (me && !g) {
    if (canWrite() && !isSuper()) renderRejoindre(msg);
    else if (me.role === "formateur" && rattachements.length) renderRattachements(msg);
    else { msg.dataset.sig = ""; msg.textContent = isSuper() ? "Aucun groupe n’existe encore : créez-en un dans l’onglet « Administration »."
      : "Aucun groupe ne vous est affecté pour le moment : contactez l’administrateur."; }
  }
  msg.classList.toggle("hidden", !(me && !g));
  // Ligne fixe sous le titre : établissement, promo, groupe et personne connectée. Elle ne change ni avec la vue (groupe / promo) ni avec les filtres.
  $("sub").textContent = !g ? "Outil partagé de suivi des lectures de mémoire" : `${g.etablissement} · ${g.promo} · ${g.nom} — ${me.prenom}`;
  if (!g || tab === "home" || tab === "dash") { bar.classList.add("hidden"); bar.innerHTML = ""; ctxSig = ""; return; }
  bar.classList.remove("hidden");
  const avecVue = !["mine", "suivi", "glossaire", "admin", "home", "dash"].includes(tab);   // groupe / promo n'a de sens que pour tableau, commentaires, biblio, synthèse
  const sig = JSON.stringify([avecVue, ctx.gid, ctx.vue, groupes.map(x => [x.id, x.nom, x.promo, x.etablissement, nonLusDe(x, "groupe")]), nonLusDe(g, "promo"), votesAFaire(g), votes.filter(v => v.groupe_id === g.id).length]);
  if (sig === ctxSig && bar.innerHTML) return;
  ctxSig = sig;
  const nvG = nonLusDe(g, "groupe"), nvP = nonLusDe(g, "promo"), vf = votesAFaire(g);
  const pastille = n => n ? ` <span class="count">${n}</span>` : "";
  const choix = groupes.length > 1
    ? `<label class="meta" for="ctxg" style="margin:0">Groupe</label><select id="ctxg" aria-label="Choisir le groupe">${groupes.map(x => { const n = nonLusDe(x, "groupe"); return `<option value="${esc(x.id)}" ${x.id === g.id ? "selected" : ""}>${esc(x.etablissement)} · ${esc(x.promo)} — ${esc(x.nom)}${n ? " (" + n + " non lu" + (n > 1 ? "s" : "") + ")" : ""}</option>`; }).join("")}</select>`
    : `<span class="meta">${esc(g.nom)}</span>`;
  bar.innerHTML = `${choix}
    ${avecVue ? `<span class="seg"><button type="button" class="btn sm sec ${ctx.vue === "promo" ? "" : "on"}" id="vg" aria-pressed="${ctx.vue !== "promo"}">👥 Mon groupe${ctx.vue === "promo" ? pastille(nvG) : ""}</button><button type="button" class="btn sm sec ${ctx.vue === "promo" ? "on" : ""}" id="vp" aria-pressed="${ctx.vue === "promo"}">🌐 Toute la promo${ctx.vue === "promo" ? "" : pastille(nvP)}</button></span>` : ""}`;
  if ($("ctxg")) $("ctxg").onchange = e => changerContexte({ gid: e.target.value });
  if ($("vg")) { $("vg").onclick = () => changerContexte({ vue: "groupe" }); $("vp").onclick = () => changerContexte({ vue: "promo" }); }
}

function changerContexte(c) {
  if (c.gid !== undefined) ctx.gid = c.gid;
  if (c.vue !== undefined) ctx.vue = c.vue;
  try { localStorage.setItem("lydia_groupe", ctx.gid); localStorage.setItem("lydia_portee", ctx.vue); } catch (e) { /* ignoré */ }
  fermerDiscussion(true); fermerGroupe(true);
  closeDrawer(true);
  openRows.clear();
  Object.assign(F, filtresVierges(), { grp: F.grp });
  B.who = "";
  deriver();
  studentsSig = JSON.stringify(students());
  renderCtx();
  renderFilters();
  renderMine(); renderTable(); renderComments();
  if (tab === "biblio") { renderBiblioTools(); renderBiblio(); }
  if (tab === "synth") renderSynth();
  // Les pages propres au groupe se rechargent d'elles-mêmes : plus besoin de changer de page ou de recharger.
  if (typeof fermerJour === "function") fermerJour();
  if (tab === "suivi") renderSuivi();
  if (tab === "glossaire") renderGlossaire();
  if (tab === "home") renderHome();
  majOnglets(); majAlertes();
  if (tab === "admin" && canAdmin()) loadAdmin();
}

/* ----- Fenêtre « Membres et votes » ----- */

const GM = { ouvert: false, cand: null, fcand: null };
let lienInvitation = null;   // dernier lien d’invitation créé (visible une seule fois) : { pid, lien }

function ouvrirGroupe() {
  if (!groupeCourant()) return;
  GM.ouvert = true; GM.cand = null; GM.fcand = null; GM.focus = document.activeElement;
  renderGroupe();
  $("gclose").focus();
}

function fermerGroupe(silencieux) {
  GM.ouvert = false;
  $("gmodal").classList.add("hidden");
  if (!cmId) document.body.classList.remove("modalopen");
  $("gbody").innerHTML = "";
  if (!silencieux && GM.focus && GM.focus.isConnected && GM.focus.focus) { try { GM.focus.focus({ preventScroll: true }); } catch (e) { /* ignoré */ } }
}

// Pas de reconstruction pendant une saisie dans la fenêtre (actualisation automatique).
function majGroupe() {
  if (!GM.ouvert) return;
  const a = document.activeElement;
  if (a && $("gbody").contains(a) && (a.tagName === "INPUT" || a.tagName === "SELECT")) return;
  renderGroupe();
}

const dateCourte = iso => { const d = new Date(iso); return isNaN(d) ? "" : d.toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit" }); };

function voteHtml(v) {
  const q = v.type === "adhesion" ? `Accepter <b>${esc(v.cible)}</b> dans le groupe ?`
    : v.type === "formateur_demande" ? `Accepter le formateur <b>${esc(v.cible)}</b> dans le groupe ?`
    : v.type === "formateur_invite" ? `Inviter le formateur <b>${esc(v.cible)}</b> à rejoindre le groupe ?`
    : v.type === "retrait" ? `Retirer <b>${esc(v.cible)}</b> du groupe ?` : `Renommer le groupe en <b>« ${esc(v.valeur)} »</b> ?`;
  const etat = `${v.oui} oui · ${v.non} non — ${v.besoin} oui nécessaires sur ${v.n} votant${v.n > 1 ? "s" : ""}`;
  let actions = "";
  if (!canWrite()) actions = "";
  else if (!v.peut_voter) actions = '<div class="meta">Vous êtes concerné(e) par cette proposition : vous ne votez pas.</div>';
  else actions = `<div class="votes"><button type="button" class="btn sm ${v.mon_vote === 1 ? "" : "sec"}" data-vote="${esc(v.id)}" data-oui="1" aria-pressed="${v.mon_vote === 1}">👍 Oui</button><button type="button" class="btn sm ${v.mon_vote === 0 ? "" : "sec"}" data-vote="${esc(v.id)}" data-oui="0" aria-pressed="${v.mon_vote === 0}">👎 Non</button>${v.proposant ? `<button type="button" class="btn sm sec del" data-vcancel="${esc(v.id)}">Annuler ma proposition</button>` : ""}</div>`;
  return `<div class="vote ${v.peut_voter && v.mon_vote === null ? "attente" : ""}"><div>${q}</div><div class="meta">${v.type === "adhesion" || v.type === "formateur_demande" ? "Demande de" : "Proposé par"} ${esc(v.propose_par)} · ${etat} · jusqu’au ${esc(dateCourte(v.expire_le))}</div>${actions}</div>`;
}

function renderGroupe() {
  const g = groupeCourant();
  if (!g) { fermerGroupe(true); return; }
  const mesVotes = votes.filter(x => x.groupe_id === g.id);
  const nbEtu = g.membres.filter(m => m.role === "etudiant").length;
  const membres = g.membres.map(m => {
    const retrait = canWrite() && m.role === "etudiant" && !m.moi
      ? ` <button type="button" class="btn sm sec del" data-vr="${esc(m.pid)}" data-nom="${esc(m.prenom)}">Proposer le retrait</button>` : "";
    return `<div class="gmembre"><span class="dot" style="background:${esc(m.couleur)}"></span><b>${esc(m.prenom)}</b>${m.moi ? ' <span class="meta">(vous)</span>' : ""}${m.role !== "etudiant" ? ` <span class="meta">${esc(m.role)}</span>` : ""}${retrait}</div>`;
  }).join("");
  const ajout = !canWrite() ? "" : GM.cand === null
    ? '<button type="button" class="btn sm sec" id="gcand">＋ Ajouter un membre</button>'
    : GM.cand.length
      ? `<div class="grow"><select id="gcsel" aria-label="Étudiant à ajouter">${GM.cand.map(c => `<option value="${esc(c.pid)}">${esc(c.prenom)}</option>`).join("")}</select><button type="button" class="btn sm" id="gadd">Ajouter au groupe</button><button type="button" class="btn sm sec" id="gcancel">Annuler</button></div>`
      : '<div class="meta">Aucun étudiant sans groupe dans cette promo. <button type="button" class="btn sm sec" id="gcancel">Fermer</button></div>';
  const inviter = !canWrite() ? "" : GM.fcand === null
    ? '<button type="button" class="btn sm sec" id="gfcand">🎓 Inviter un formateur</button>'
    : GM.fcand.length
      ? `<div class="grow"><select id="gfsel" aria-label="Formateur à inviter">${GM.fcand.map(c => `<option value="${esc(c.pid)}">${esc(c.prenom)}</option>`).join("")}</select><button type="button" class="btn sm" id="gfadd">Proposer l’invitation</button><button type="button" class="btn sm sec" id="gfcancel">Annuler</button></div>`
      : '<div class="meta">Aucun formateur de la promo à inviter pour le moment. <button type="button" class="btn sm sec" id="gfcancel">Fermer</button></div>';
  $("gtitle").textContent = "👥 " + g.nom;
  $("gsub").textContent = `${g.etablissement} · ${g.promo}`;
  $("gbody").innerHTML = `
    <div class="gsec" style="border-top:0;padding-top:0"><h3>Votes en cours (${mesVotes.length})</h3>
      <div class="cmbox">${mesVotes.length ? mesVotes.map(voteHtml).join("") : '<div class="meta">Aucune proposition en cours.</div>'}</div></div>
    <div class="gsec"><h3>Membres (${g.membres.length})</h3>${membres}
      <div style="margin-top:8px">${ajout}</div>
      ${inviter ? `<div style="margin-top:8px">${inviter}</div><div class="meta" style="margin-top:4px">Inviter un formateur : les étudiants du groupe votent (majorité simple). Un formateur peut être rattaché à plusieurs groupes.</div>` : ""}
      ${canWrite() ? `<div class="meta" style="margin-top:6px">Un membre peut en ajouter un autre tout de suite. Pour retirer quelqu’un, les autres étudiants du groupe votent : la majorité simple suffit (la proposition expire après 7 jours${nbEtu < 3 ? " ; à deux étudiants, le retrait passe par l’administrateur" : ""}).</div>` : ""}</div>
    ${!canWrite() && me.role === "formateur" ? `<div class="gsec"><h3>Mes groupes</h3>${rattachementsHtml(false)}</div>` : ""}
    ${canWrite() ? `<div class="gsec"><h3>Nom du groupe</h3>
      <div class="grow"><input id="gnom" maxlength="60" placeholder="Nouveau nom du groupe" aria-label="Nouveau nom du groupe"><button type="button" class="btn sm" id="gnomok">${nbEtu > 1 ? "Proposer ce nom" : "Renommer"}</button></div>
      <div class="meta" style="margin-top:6px">${nbEtu > 1 ? "Le changement de nom est soumis au vote des étudiants du groupe (majorité simple)." : "Vous êtes seul(e) étudiant(e) dans le groupe : le changement est immédiat."}</div></div>` : ""}`;
  $("gmodal").classList.remove("hidden");
  document.body.classList.add("modalopen");
}

async function actionGroupe(fn, errLabel) {
  try { applyResult(await enCours("Enregistrement…", fn)); }
  catch (e) { if (e.code === "unauthorized") sessionError(e); else alert(errLabel + " : " + e.message); }
  if (GM.ouvert) renderGroupe();
}

$("gclose").onclick = () => fermerGroupe();
$("gmodal").addEventListener("mousedown", e => { if (e.target === $("gmodal")) fermerGroupe(); });
$("gbody").onclick = async e => {
  const b = e.target.closest("button");
  if (!b) return;
  const g = groupeCourant();
  const d = b.dataset;
  if (d.vote) return actionGroupe(() => api("vote_answer", { id: d.vote, oui: d.oui === "1" }), "Vote impossible");
  if (d.vcancel) return actionGroupe(() => api("vote_cancel", { id: d.vcancel }), "Annulation impossible");
  if (d.fr) return actionGroupe(() => api("formateur_request", { groupe_id: d.fr }), "Demande impossible");
  if (d.frc) return actionGroupe(() => api("vote_cancel", { id: d.frc }), "Annulation impossible");
  if (d.vr) {
    if (!confirm(`Proposer le retrait de ${d.nom} du groupe ?\n\nLes autres étudiants du groupe (hors ${d.nom}) voteront ; la majorité simple suffit.`)) return;
    return actionGroupe(() => api("vote_propose", { groupe_id: g.id, type: "retrait", pid: d.vr }), "Proposition impossible");
  }
  if (b.id === "gcand") {
    try { GM.cand = (await api("member_candidates", { groupe_id: g.id })).candidats; renderGroupe(); }
    catch (err) { if (err.code === "unauthorized") sessionError(err); else alert("Liste indisponible : " + err.message); }
  } else if (b.id === "gcancel") { GM.cand = null; renderGroupe(); }
  else if (b.id === "gfcand") {
    try { GM.fcand = (await api("formateur_candidates", { groupe_id: g.id })).candidats; renderGroupe(); }
    catch (err) { if (err.code === "unauthorized") sessionError(err); else alert("Liste indisponible : " + err.message); }
  } else if (b.id === "gfcancel") { GM.fcand = null; renderGroupe(); }
  else if (b.id === "gfadd") {
    const pid = $("gfsel").value;
    GM.fcand = null;
    actionGroupe(() => api("vote_propose", { groupe_id: g.id, type: "formateur_invite", pid }), "Invitation impossible");
  }
  else if (b.id === "gadd") {
    const pid = $("gcsel").value;
    GM.cand = null;
    actionGroupe(() => api("member_add", { groupe_id: g.id, pid }), "Ajout impossible");
  } else if (b.id === "gnomok") {
    const nom = $("gnom").value.trim();
    if (!nom) return;
    actionGroupe(() => api("vote_propose", { groupe_id: g.id, type: "nom", nom }), "Changement de nom impossible");
  }
};

/* ----- Administration des groupes (administrateur) ----- */

// Structure en arbre : établissement → promos → groupes. Les volets repliés par l'administrateur restent repliés après chaque mise à jour.
function blocGroupes() {
  const etudiants = acces.filter(a => a.statut === "actif" && a.role === "etudiant");
  const promosPlates = structureAdmin.flatMap(e => e.promos.map(p => ({ id: p.id, etab: e.nom, nom: p.nom })));
  const ouvert = k => adminFerme.has(k) ? "" : "open";
  const carte = (x, promoId) => {
    const dispo = acces.filter(a => a.statut === "actif" && !x.membres.some(m => m.email === a.email));
    return `<div class="admgrp" data-gid="${esc(x.id)}">
      <div class="grow"><input data-gf="nom" maxlength="60" value="${esc(x.nom)}" aria-label="Nom du groupe">
        <select data-gf="promo_id" aria-label="Promo du groupe">${promosPlates.map(p => `<option value="${esc(p.id)}" ${p.id === promoId ? "selected" : ""}>${esc(p.etab)} · ${esc(p.nom)}</option>`).join("")}</select>
        <button type="button" class="btn sm" data-g="save">Enregistrer</button><button type="button" class="btn sm sec del" data-g="del">🗑 Supprimer le groupe</button></div>
      <div>${x.membres.length ? x.membres.map(m => `<span class="chip">${esc(m.prenom)} <span class="meta">${esc(m.role)}</span> <button type="button" class="btn sm sec del" style="padding:0 6px" data-g="rm" data-email="${esc(m.email)}" aria-label="Retirer ${esc(m.prenom)} du groupe">✕</button></span>`).join("") : '<span class="meta">Aucun membre.</span>'}</div>
      <div class="grow"><select data-gadd aria-label="Ajouter au groupe"><option value="">— ajouter une personne —</option>${dispo.map(a => `<option value="${esc(a.email)}">${esc(a.prenom || a.email)} (${esc(a.role)}) — ${esc(a.email)}</option>`).join("")}</select><button type="button" class="btn sm" data-g="add">Ajouter</button></div>
    </div>`;
  };
  // Invitation de promo : le serveur ne garde que l'empreinte du lien (jamais le lien lui-même). Le lien n'est donc visible qu'à sa création.
  const blocCode = p => {
    const actif = !!p.code_actif;
    const frais = lienInvitation && lienInvitation.pid === p.id ? lienInvitation : null;
    return `<div class="admcode" data-pid="${esc(p.id)}">
      ${frais ? `<div class="note" role="status">✅ Lien créé : copiez-le maintenant, il ne sera plus affiché ensuite.
        <div class="grow"><input readonly value="${esc(frais.lien)}" aria-label="Lien d’invitation" onfocus="this.select()" style="min-width:260px;flex:1"><button type="button" class="btn sm" data-s="code_copy" data-code="${esc(frais.lien)}">Copier le lien</button></div></div>` : ""}
      <div class="grow">${actif ? `<span>🔑 Invitation active <span class="meta">· expire le ${esc(new Date(p.code_expire).toLocaleDateString("fr-FR"))} · ${p.code_usages}/${p.code_max} utilisation${p.code_max > 1 ? "s" : ""}</span></span>
        <button type="button" class="btn sm sec del" data-s="promo_code_revoke">Révoquer</button>` : '<span class="meta">Aucune invitation active.</span>'}
      <label class="meta" style="margin:0">validité (jours)</label><input data-sf="jours" type="number" min="1" max="365" value="30" style="width:70px" aria-label="Validité en jours">
      <label class="meta" style="margin:0">utilisations max.</label><input data-sf="max" type="number" min="1" max="1000" value="150" style="width:80px" aria-label="Nombre d’utilisations maximal">
      <button type="button" class="btn sm" data-s="promo_code">${actif ? "Créer un nouveau lien" : "🔑 Créer un lien d’invitation"}</button></div></div>`;
  };
  const promoBloc = (e, p) => {
    const gs = groupesAdmin.filter(g => g.etablissement === e.nom && g.promo === p.nom);
    return `<details class="admpromo" data-k="p:${esc(p.id)}" ${ouvert("p:" + p.id)}><summary><b>🎓 ${esc(p.nom)}</b> <span class="meta">${gs.length} groupe${gs.length > 1 ? "s" : ""}</span></summary>
      <div class="grow" data-pid="${esc(p.id)}"><input data-sf="nom" maxlength="60" value="${esc(p.nom)}" aria-label="Nom de la promo"><button type="button" class="btn sm" data-s="promo_rename">Renommer la promo</button><button type="button" class="btn sm sec del" data-s="promo_delete">🗑 Supprimer la promo</button></div>
      ${blocCode(p)}
      ${gs.map(g => carte(g, p.id)).join("")}
      <div class="admgrp" data-newg="${esc(p.id)}"><b>＋ Nouveau groupe dans cette promo</b>
        <div class="grow"><input data-ng="nom" maxlength="60" placeholder="Nom du groupe"></div>
        <label class="meta" style="margin:0">Étudiants du groupe (Ctrl/Cmd + clic pour en choisir plusieurs)</label>
        <select data-ng="membres" multiple size="5">${etudiants.map(a => `<option value="${esc(a.email)}">${esc(a.prenom || a.email)} — ${esc(a.email)}</option>`).join("")}</select>
        <div><button type="button" class="btn sm" data-s="group_create">Créer le groupe</button></div></div>
    </details>`;
  };
  const etabBloc = e => `<details class="admetab" data-k="e:${esc(e.id)}" ${ouvert("e:" + e.id)}><summary><b>🏫 ${esc(e.nom)}</b> <span class="meta">${e.promos.length} promo${e.promos.length > 1 ? "s" : ""}</span></summary>
      <div class="grow" data-eid="${esc(e.id)}"><input data-sf="nom" maxlength="60" value="${esc(e.nom)}" aria-label="Nom de l’établissement"><button type="button" class="btn sm" data-s="etab_rename">Renommer l’établissement</button><button type="button" class="btn sm sec del" data-s="etab_delete">🗑 Supprimer l’établissement</button></div>
      <div class="grow" data-eid="${esc(e.id)}"><input data-sf="newpromo" maxlength="60" placeholder="Nouvelle promo (ex. Promo 24-27)"><button type="button" class="btn sm" data-s="promo_create">＋ Ajouter la promo</button></div>
      ${e.promos.map(p => promoBloc(e, p)).join("") || '<div class="meta">Aucune promo : ajoutez-en une ci-dessus.</div>'}
    </details>`;
  return `<h3>🏫 Établissements, promos et groupes</h3>
    ${stockage ? `<div class="meta">📎 Fichiers déposés : ${stockage.nb} (${esc(fmtTaille(stockage.octets))}) dans le Drive du propriétaire du script.</div>` : ""}
    <div class="note">Établissement → promo → groupe. Un étudiant n’est que dans un groupe par promo ; un formateur peut être rattaché à plusieurs groupes (il ne voit que ceux-là, et les fiches de lecture terminées de leur promo). Renommer un établissement ou une promo met à jour tous ses groupes. On ne supprime un établissement qu’une fois ses promos supprimées, une promo qu’une fois ses groupes supprimés. Supprimer un groupe conserve ses fiches dans la base de données mais ne les affiche plus.</div>
    <div class="grow" style="margin:8px 0"><input id="ne_nom" maxlength="60" placeholder="Nouvel établissement (ex. IFSI Saint-Nazaire)"><button type="button" class="btn sm" data-s="etab_create">＋ Ajouter l’établissement</button></div>
    ${structureAdmin.map(etabBloc).join("") || '<div class="meta">Aucun établissement pour l’instant.</div>'}`;
}

// Actions sur la structure (établissements, promos, création de groupe dans une promo).
async function actionStructureAdmin(b) {
  const a = b.dataset.s;
  const zone = b.closest("[data-eid], [data-pid], [data-newg]");
  const val = sel => { const el = zone && zone.querySelector(sel); return el ? el.value : ""; };
  let appel;
  if (a === "etab_create") appel = () => api("etab_create", { data: { nom: $("ne_nom").value } });
  else if (a === "etab_rename") appel = () => api("etab_rename", { data: { id: zone.dataset.eid, nom: val('[data-sf="nom"]') } });
  else if (a === "etab_delete") {
    const e = structureAdmin.find(x => x.id === zone.dataset.eid);
    if (!e || !confirm(`Supprimer l’établissement « ${e.nom} » ?`)) return;
    appel = () => api("etab_delete", { id: e.id });
  } else if (a === "promo_create") appel = () => api("promo_create", { data: { etablissement_id: zone.dataset.eid, nom: val('[data-sf="newpromo"]') } });
  else if (a === "code_copy") { try { await navigator.clipboard.writeText(b.dataset.code); b.textContent = "Copié ✓"; } catch (e) { prompt("Lien d’invitation :", b.dataset.code); } return; }
  else if (a === "promo_code") appel = () => api("promo_code", { data: { id: zone.dataset.pid, jours: Number(val('[data-sf="jours"]')), max: Number(val('[data-sf="max"]')) } });
  else if (a === "promo_code_revoke") {
    if (!confirm("Révoquer le code ? Il ne pourra plus être utilisé (les personnes déjà inscrites le restent).")) return;
    appel = () => api("promo_code_revoke", { id: zone.dataset.pid });
  } else if (a === "promo_rename") appel = () => api("promo_rename", { data: { id: zone.dataset.pid, nom: val('[data-sf="nom"]') } });
  else if (a === "promo_delete") {
    const p = structureAdmin.flatMap(e => e.promos).find(x => x.id === zone.dataset.pid);
    if (!p || !confirm(`Supprimer la promo « ${p.nom} » ?`)) return;
    appel = () => api("promo_delete", { id: p.id });
  } else if (a === "group_create") {
    const sel = zone.querySelector('[data-ng="membres"]');
    appel = () => api("group_create", { data: { promo_id: zone.dataset.newg, nom: zone.querySelector('[data-ng="nom"]').value, membres: [...sel.selectedOptions].map(o => o.value) } });
  } else return;
  await lancerAdmin(b, appel);
}

async function lancerAdmin(b, appel) {
  b.disabled = true;
  try {
    const res = await enCours("Enregistrement…", appel);
    if (res.lien && res.invitation) lienInvitation = { pid: res.invitation.promo_id, lien: res.lien };
    else if (res.ok && b.dataset.s === "promo_code_revoke") lienInvitation = null;
    if (res.acces) acces = res.acces;
    if (res.groupesAdmin) groupesAdmin = res.groupesAdmin;
    if (res.structure) structureAdmin = res.structure;
    if (res.stockage) stockage = res.stockage;
    renderAdmin();
    applyResult(res);
  } catch (err) {
    b.disabled = false;
    if (err.code === "unauthorized") sessionError(err); else alert("Action impossible : " + err.message);
  }
}
async function actionGroupeAdmin(b) {
  const a = b.dataset.g;
  const carte = b.closest(".admgrp");
  const gid = carte && carte.dataset.gid;
  const val = (sel) => { const el = carte.querySelector(sel); return el ? el.value : ""; };
  let appel;
  if (a === "save") {
    const data = { id: gid, nom: val('[data-gf="nom"]'), promo_id: val('[data-gf="promo_id"]') };
    appel = () => api("group_update", { data });
  } else if (a === "del") {
    const g = groupesAdmin.find(x => x.id === gid);
    if (!g || !confirm(`Supprimer le groupe « ${g.nom} » ?\n\nSes membres sont détachés. Ses fiches et commentaires restent dans la base de données mais ne sont plus affichés.`)) return;
    appel = () => api("group_delete", { id: gid });
  } else if (a === "add") {
    const email = val("[data-gadd]");
    if (!email) return;
    appel = () => api("member_add", { groupe_id: gid, email });
  } else if (a === "rm") {
    appel = () => api("member_remove", { groupe_id: gid, email: b.dataset.email });
  } else return;
  await lancerAdmin(b, appel);
}
