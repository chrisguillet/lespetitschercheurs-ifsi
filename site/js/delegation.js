/* Administration déléguée : demandes de changement de nom, invitations personnelles, rôles par site et par promo.
   Réservé aux administrateurs (général, de site ou de promo) : le serveur contrôle le périmètre de chaque action.
   Script classique : partage la portée globale avec les autres fichiers de js/ (ordre de chargement : voir index.html). */
"use strict";
/* ---------- Administration déléguée ---------- */

let demandesNom = [], invitationsAdmin = [], doublonsAdmin = [], reglesChat = null, lienPersonnel = null;
const ROLES_LIB = { admin: "Administrateur", admin_site: "Admin de site", admin_promo: "Admin de promo", formateur: "Formateur", etudiant: "Étudiant" };
// Rôles que l'on peut attribuer, et type de périmètre attendu : e = établissement (site), p = promo.
const ROLES_ATTRIBUABLES = [["admin_site", "e"], ["admin_promo", "p"], ["formateur", "e"], ["etudiant", "p"]];

const adminDelegue = () => !!me && Array.isArray(me.roles) && me.roles.some(r => r.role === "admin_site" || r.role === "admin_promo");
const gereStructure = () => isSuper() || adminDelegue();
const sigDelegation = () => JSON.stringify([demandesNom, invitationsAdmin, doublonsAdmin, reglesChat]);

async function chargerDelegation() {
  if (!gereStructure()) return;
  try {
    const [n, i, d, rc] = await Promise.all([api("nom_demandes"), api("invitation_list"), api("doublons_list"), api("chat_regles")]);
    demandesNom = n.demandes || [];
    invitationsAdmin = i.invitations || [];
    doublonsAdmin = d.clusters || [];
    reglesChat = rc.regles || null;
  } catch (e) { if (e.code === "unauthorized") sessionError(e); }
}

// Périmètres proposés : [valeur, libellé, type] ; valeur « e:ID » (site) ou « p:ID » (promo).
function perimetres() {
  const l = [];
  structureAdmin.forEach(e => {
    l.push(["e:" + e.id, "Site · " + e.nom, "e"]);
    (e.promos || []).forEach(p => l.push(["p:" + p.id, e.nom + " · " + p.nom, "p"]));
  });
  return l;
}
const libPerimetre = (etab, promo) => {
  const v = promo ? "p:" + promo : etab ? "e:" + etab : "";
  const t = perimetres().find(x => x[0] === v);
  return t ? t[1] : "";
};

function blocNoms() {
  const l = demandesNom;
  return `<h3>✏️ Demandes de changement de nom (${l.length})</h3>` + (l.length
    ? `<div class="wrap"><table class="adm"><thead><tr><th>Personne</th><th>Nouveau prénom et nom</th><th>Demandé le</th><th>Actions</th></tr></thead><tbody>${l.map(d =>
      `<tr data-nid="${d.id}"><td>${esc(d.actuel)}</td><td><b>${esc(d.prenom)} ${esc(d.nom)}</b></td><td>${esc(fmtDT(d.cree_le))}</td>
        <td><button type="button" class="btn sm" data-dn="1">Accepter</button> <button type="button" class="btn sm sec del" data-dn="0">Refuser</button></td></tr>`).join("")}</tbody></table></div>`
    : '<div class="meta">Aucune demande en attente.</div>');
}

function blocInvitations() {
  const per = perimetres();
  const optsPromo = per.filter(x => x[2] === "p").map(x => `<option value="${esc(x[0])}">${esc(x[1])}</option>`).join("");
  const libType = i => i.type === "personnel" ? "Personnelle" : i.type === "groupe" ? "Groupe" : "Promo";
  const lib = i => i.actif ? "✅ active" : i.revoquee ? "révoquée" : i.usages >= i.max ? "épuisée" : "expirée";
  const frais = lienPersonnel ? `<div class="note" role="status">✅ Invitation créée : copiez le lien maintenant, il ne sera plus affiché ensuite.
      <div class="grow"><input readonly value="${esc(lienPersonnel)}" aria-label="Lien d’invitation" onfocus="this.select()" style="min-width:260px;flex:1"><button type="button" class="btn sm" data-ri="copier" data-code="${esc(lienPersonnel)}">Copier le lien</button></div></div>` : "";
  return `<h3>✉️ Invitations</h3>${frais}
    <div class="meta">Une invitation personnelle n’est utilisable que par l’adresse indiquée (connexion Google de cette adresse). Les invitations de promo se créent dans l’arbre ci-dessous.</div>
    ${per.length ? `<div class="grow" data-inv="form"><input data-ri="email" type="email" placeholder="adresse e-mail" aria-label="Adresse e-mail de la personne invitée" style="min-width:200px">
      <select data-ri="role" aria-label="Rôle"><option value="etudiant">Étudiant</option><option value="formateur">Formateur</option></select>
      <select data-ri="perim" aria-label="Périmètre">${optsPromo}</select>
      <label class="meta" style="margin:0">validité (jours)</label><input data-ri="jours" type="number" min="1" max="365" value="30" style="width:70px" aria-label="Validité en jours">
      <button type="button" class="btn sm" data-ri="creer">Créer l’invitation</button></div>` : '<div class="meta">Aucune promo dans votre périmètre.</div>'}
    ${invitationsAdmin.length ? `<div class="wrap"><table class="adm"><thead><tr><th>Type</th><th>Pour</th><th>Périmètre</th><th>Expire le</th><th>Utilisations</th><th>État</th><th></th></tr></thead><tbody>${invitationsAdmin.slice(0, 40).map(i => `<tr data-iid="${i.id}">
      <td>${esc(libType(i))}</td><td>${esc(i.email || (ROLES_LIB[i.role] || i.role))}</td><td>${esc(libPerimetre(i.etablissement_id, i.promo_id) || (i.groupe_id ? "groupe" : ""))}</td>
      <td>${esc(fmtDT(i.expire_le))}</td><td>${i.usages}/${i.max}</td><td>${lib(i)}</td><td>${i.actif ? '<button type="button" class="btn sm sec del" data-ri="revoquer">Révoquer</button>' : ""}</td></tr>`).join("")}</tbody></table></div>` : '<div class="meta">Aucune invitation créée.</div>'}`;
}

function blocRoles() {
  const per = perimetres();
  const actifs = acces.filter(a => a.statut === "actif");
  const roleOpts = ROLES_ATTRIBUABLES.filter(([r]) => isSuper() || r !== "admin_site").map(([r, t]) => `<option value="${r}" data-t="${t}">${esc(ROLES_LIB[r])}</option>`).join("");
  const chips = a => (a.attributions || []).map(r => `<span class="chip">${esc(ROLES_LIB[r.role] || r.role)}${r.perimetre ? ` <span class="meta">· ${esc(r.perimetre)}</span>` : ""}
      <button type="button" class="btn sm sec del" style="padding:0 6px" data-rr="${r.id}" aria-label="Retirer ce rôle">✕</button></span>`).join(" ") || '<span class="meta">aucun rôle visible</span>';
  return `<h3>🎭 Rôles par site et par promo</h3>
    <div class="meta">Un administrateur de site gère son établissement ; un administrateur de promo, sa promo. Les rôles se cumulent. Vous ne voyez et ne modifiez que ceux de votre périmètre.</div>
    ${actifs.length && per.length ? `<div class="grow" data-rol="form"><select data-rl="email" aria-label="Personne">${actifs.map(a => `<option value="${esc(a.email)}">${esc(a.prenom || a.email)} — ${esc(a.email)}</option>`).join("")}</select>
      <select data-rl="role" aria-label="Rôle à attribuer">${roleOpts}</select>
      <select data-rl="perim" aria-label="Périmètre">${per.map(x => `<option value="${esc(x[0])}" data-t="${x[2]}">${esc(x[1])}</option>`).join("")}</select>
      <button type="button" class="btn sm" data-rl="ajouter">Attribuer</button></div>` : '<div class="meta">Aucune personne active ou aucun périmètre à gérer.</div>'}
    ${actifs.length ? `<div class="wrap"><table class="adm"><thead><tr><th>Personne</th><th>Rôles</th></tr></thead><tbody>${actifs.map(a => `<tr><td>${esc(a.prenom || a.email)}<div class="meta">${esc(a.email)}</div></td><td>${chips(a)}</td></tr>`).join("")}</tbody></table></div>` : ""}`;
}

// Le périmètre proposé suit le rôle choisi : site pour admin de site et formateur, promo pour admin de promo et étudiant.
function ajusterPerimetres(form) {
  const role = form.querySelector('[data-rl="role"]'), per = form.querySelector('[data-rl="perim"]');
  if (!role || !per) return;
  const t = role.selectedOptions[0] ? role.selectedOptions[0].dataset.t : "p";
  let premier = null;
  [...per.options].forEach(o => { const ok = o.dataset.t === t; o.hidden = !ok; o.disabled = !ok; if (ok && !premier) premier = o; });
  if (per.selectedOptions[0] && per.selectedOptions[0].disabled && premier) per.value = premier.value;
}

async function lancerDelegation(b, appel, apres) {
  b.disabled = true;
  try {
    const res = await enCours("Enregistrement…", appel);
    if (apres) apres(res);
    await loadAdmin();
    renderAdmin();
  } catch (err) {
    b.disabled = false;
    if (err.code === "unauthorized") sessionError(err); else alert("Action impossible : " + err.message);
  }
}

$("adminbox").addEventListener("change", e => {
  const f = e.target.closest('[data-rol="form"]');
  if (f && e.target.dataset.rl === "role") ajusterPerimetres(f);
});
$("adminbox").addEventListener("click", async e => {
  const b = e.target.closest("button");
  if (!b) return;
  if (b.dataset.dn !== undefined) {
    const id = Number(b.closest("tr").dataset.nid);
    return lancerDelegation(b, () => api("nom_decision", { data: { id, accepte: b.dataset.dn === "1" } }), res => { demandesNom = res.demandes || []; });
  }
  if (b.dataset.ri === "copier") { try { await navigator.clipboard.writeText(b.dataset.code); b.textContent = "Copié ✓"; } catch (x) { prompt("Lien d’invitation :", b.dataset.code); } return; }
  if (b.dataset.ri === "revoquer") {
    if (!confirm("Révoquer cette invitation ? Elle ne pourra plus être utilisée.")) return;
    const id = Number(b.closest("tr").dataset.iid);
    return lancerDelegation(b, () => api("invitation_revoke", { data: { id } }), res => { invitationsAdmin = res.invitations || []; });
  }
  if (b.dataset.ri === "creer") {
    const f = b.closest('[data-inv="form"]'), v = k => f.querySelector(`[data-ri="${k}"]`).value;
    const email = v("email").trim(), role = v("role"), perim = v("perim");
    if (!email) return alert("Indiquez l’adresse e-mail de la personne invitée.");
    const data = { type: "personnel", email, role, jours: Number(v("jours")) || 30 };
    if (perim.startsWith("p:")) data.promo_id = perim.slice(2); else data.etablissement_id = perim.slice(2);
    return lancerDelegation(b, () => api("invitation_create", { data }), res => { lienPersonnel = res.invitation ? res.invitation.lien : null; });
  }
  if (b.dataset.rl === "ajouter") {
    const f = b.closest('[data-rol="form"]'), v = k => f.querySelector(`[data-rl="${k}"]`).value;
    const role = v("role"), perim = v("perim");
    const data = { email: v("email"), role };
    if (perim.startsWith("p:")) data.promo_id = perim.slice(2); else data.etablissement_id = perim.slice(2);
    return lancerDelegation(b, () => api("attribution_add", { data }), null);
  }
  if (b.dataset.rr !== undefined) {
    if (!confirm("Retirer ce rôle ?")) return;
    return lancerDelegation(b, () => api("attribution_remove", { data: { id: Number(b.dataset.rr) } }), null);
  }
});

/* ----- Doublons d'articles ----- */
function blocDoublons() {
  const l = doublonsAdmin;
  const art = (a, i, propose) => `<label class="dblart"><input type="radio" name="dp${i}" value="${esc(a.id)}" ${a.id === propose ? "checked" : ""}>
      <span><b>${esc(a.titre)}</b><span class="meta"> ${esc(a.auteur)}${a.parution ? " · " + esc(a.parution) : ""}${a.source ? " · " + esc(a.source) : ""}</span>
      <span class="meta dbl2">${a.doi ? "DOI " + esc(a.doi) + " · " : ""}${esc(a.lieu)} · ${a.fiches} fiche${a.fiches > 1 ? "s" : ""}${a.propositions ? ` · ${a.propositions} proposition${a.propositions > 1 ? "s" : ""}` : ""}${a.fichier ? " · 📎 pièce jointe" : ""}</span></span></label>`;
  return `<h3>🧬 Doublons d’articles (${l.length})</h3>` + (l.length
    ? `<div class="meta">Le même article saisi plusieurs fois (même DOI, ou même titre). Choisissez celui à garder : les fiches, commentaires, propositions et la pièce jointe des autres lui sont rattachés, puis les doublons sont supprimés. Une fusion est définitive.</div>`
      + l.map((g, i) => `<div class="dblgrp" data-dg="${i}"><div>${g.articles.map(a => art(a, i, g.propose)).join("")}</div>
        <div class="grow"><button type="button" class="btn sm" data-dmerge="${i}">Fusionner dans l’article choisi</button><button type="button" class="btn sm sec" data-dign="${i}">Ce ne sont pas des doublons</button></div></div>`).join("")
    : '<div class="meta">Aucun doublon détecté dans votre périmètre.</div>');
}

$("adminbox").addEventListener("click", async e => {
  const b = e.target.closest("button[data-dmerge], button[data-dign]");
  if (!b) return;
  const i = Number(b.dataset.dmerge ?? b.dataset.dign), g = doublonsAdmin[i];
  if (!g) return;
  const zone = b.closest(".dblgrp"), choix = zone.querySelector("input[type=radio]:checked");
  if (b.dataset.dign !== undefined) {
    if (!confirm("Marquer ces articles comme différents ? Ils ne seront plus proposés comme doublons.")) return;
    return lancerDelegation(b, () => api("doublons_ignore", { data: { ids: g.articles.map(a => a.id) } }), res => { doublonsAdmin = res.clusters || []; });
  }
  if (!choix) return;
  const principal = g.articles.find(a => a.id === choix.value), autres = g.articles.filter(a => a.id !== choix.value);
  const fiches = autres.reduce((n, a) => n + a.fiches, 0);
  if (!confirm(`Garder « ${principal.titre} » et fusionner ${autres.length} doublon${autres.length > 1 ? "s" : ""} dedans ?\n\n${fiches} fiche${fiches > 1 ? "s" : ""} de lecture ${fiches > 1 ? "seront rattachées" : "sera rattachée"} à l’article gardé. Les champs vides de l’article gardé sont complétés par ceux des doublons ; si plusieurs ont une pièce jointe, seule celle de l’article gardé est conservée.\n\nCette action est définitive.`)) return;
  return lancerDelegation(b, () => api("article_merge", { data: { principal: principal.id, doublons: autres.map(a => a.id) } }), res => {
    doublonsAdmin = res.clusters || [];
    if (typeof refresh === "function") refresh(true);
    setTimeout(() => alert(`Fusion faite : ${res.bilan.fiches} fiche${res.bilan.fiches > 1 ? "s" : ""} rattachée${res.bilan.fiches > 1 ? "s" : ""}.`), 50);
  });
});

/* ----- Membres du groupe et votes : accessible depuis « Membres et accès » (section Mon groupe) uniquement ----- */
function blocMembresVotes() {
  const g = groupeCourant();
  if (!g) return "";
  const vf = canWrite() ? votesAFaire(g) : 0;
  return `<div class="cardc" style="margin-bottom:12px"><b>👥 Membres du groupe « ${esc(g.nom)} »</b>
    <div class="meta">Ajouter ou retirer un membre, inviter un formateur, répondre aux votes du groupe.</div>
    <div class="grow" style="margin-top:6px"><button type="button" class="btn sm" id="gbtn">⚙️ Membres et votes${vf ? ` <span class="count">${vf}</span>` : ""}</button></div></div>`;
}
$("adminbox").addEventListener("click", e => { if (e.target.closest("#gbtn")) ouvrirGroupe(); });

/* ----- Chat : activation générale, par promo ou par groupe ----- */
function blocChat() {
  const r = reglesChat;
  if (!r) return "";
  const val = v => v === true ? "actif" : v === false ? "inactif" : "herite";
  const sel = (portee, cible, v, defaut) => `<select data-chp="${portee}" data-chc="${esc(cible)}" aria-label="Chat">
      <option value="herite" ${val(v) === "herite" ? "selected" : ""}>${esc(defaut)}</option><option value="actif" ${val(v) === "actif" ? "selected" : ""}>✅ Activé</option><option value="inactif" ${val(v) === "inactif" ? "selected" : ""}>⛔ Désactivé</option></select>`;
  const promos = structureAdmin.flatMap(e => (e.promos || []).map(p => ({ id: p.id, lib: `${e.nom} · ${p.nom}` })));
  const lignePromo = p => `<div class="chrow"><span>🎓 ${esc(p.lib)}</span>${sel("promo", p.id, r.promos[p.id], "Selon le réglage général")}</div>`;
  const ligneGroupe = g => {
    const pid = (promos.find(p => p.lib === `${g.etablissement} · ${g.promo}`) || {}).id;
    return `<div class="chrow"><span>👥 ${esc(g.promo)} · ${esc(g.nom)}</span>${sel("groupe", g.id, r.groupes[g.id], "Selon la promo")}</div>`;
  };
  return `<h3>💬 Chat</h3>
    <div class="meta">Le réglage le plus précis l’emporte : groupe, puis promo, puis réglage général. Sans réglage, le chat est activé. Un chat désactivé disparaît pour les personnes concernées ; l’historique est conservé jusqu’à son expiration (7 jours).</div>
    ${r.peut_general ? `<div class="chrow"><span><b>🌍 Tous les groupes</b></span>${sel("general", "", r.general, "Activé (par défaut)")}</div>` : ""}
    ${promos.length ? `<div class="meta" style="margin-top:6px">Par promo</div>${promos.map(lignePromo).join("")}` : ""}
    ${groupesAdmin.length ? `<div class="meta" style="margin-top:6px">Par groupe</div>${groupesAdmin.map(ligneGroupe).join("")}` : ""}`;
}
$("adminbox").addEventListener("change", async e => {
  const s = e.target.closest("select[data-chp]"); if (!s) return;
  s.disabled = true;
  try {
    const res = await api("chat_regle_set", { data: { portee: s.dataset.chp, cible: s.dataset.chc, valeur: s.value } });
    reglesChat = res.regles || reglesChat;
    applyResult(res);
    renderAdmin();
  } catch (err) {
    s.disabled = false;
    if (err.code === "unauthorized") sessionError(err); else alert("Réglage impossible : " + err.message);
  }
});

/* ----- Voir en tant que (administrateur général, lecture seule) ----- */
function bandeauAs(nom) {
  document.getElementById("asbar")?.remove();
  const b = document.createElement("div");
  b.id = "asbar"; b.className = "asbar"; b.setAttribute("role", "status");
  b.innerHTML = `<span>👁 Vue en tant que <b>${esc(nom)}</b> · lecture seule : rien ne peut être modifié, ses notes et son chat ne sont pas affichés.</span><button type="button" class="btn sm" id="asquit">Quitter cette vue</button>`;
  document.body.prepend(b);
  document.body.classList.add("avec-asbar");
  $("asquit").onclick = () => { try { sessionStorage.removeItem("lpc_as"); } catch (e) { /* ignoré */ } location.reload(); };
}

async function ouvrirChoixAs() {
  let liste;
  try { liste = (await api("admin_list")).acces || []; } catch (e) { if (e.code === "unauthorized") return sessionError(e); alert("Liste indisponible : " + e.message); return; }
  const actifs = liste.filter(a => a.statut === "actif" && a.pid && a.email !== me.email).sort((a, b) => String(a.prenom).localeCompare(String(b.prenom), "fr"));
  const lib = a => `${a.prenom} — ${(a.attributions || []).map(r => (ROLES_LIB[r.role] || r.role) + (r.perimetre ? " (" + r.perimetre + ")" : "")).join(", ") || a.role}`;
  document.getElementById("asmodal")?.remove();
  const m = document.createElement("div");
  m.id = "asmodal"; m.className = "modal"; m.setAttribute("role", "dialog"); m.setAttribute("aria-modal", "true");
  m.innerHTML = `<div class="modalbox" style="max-width:560px"><div class="modalhead"><div><h2>👁 Voir en tant que…</h2></div><button class="btn sm sec" id="asclose" type="button">✕ Fermer</button></div>
    <div class="cmbox" style="padding:14px 18px 18px">
      <div class="meta">L’application s’affiche comme la verrait la personne choisie (rôle, groupes, onglets, droits). <b>Lecture seule</b> : aucune modification n’est possible, ses notes personnelles et ses messages de chat ne sont pas affichés, sa dernière connexion n’est pas modifiée. L’accès est inscrit au journal d’administration.</div>
      ${actifs.length ? `<label for="assel">Personne</label><select id="assel">${actifs.map(a => `<option value="${esc(a.pid)}">${esc(lib(a))}</option>`).join("")}</select>
      <div class="savebar"><button class="btn" id="asok" type="button">Voir l’application comme cette personne</button> <button class="btn sec" id="ascancel" type="button">Annuler</button></div>` : '<div class="meta">Aucune autre personne active.</div>'}
    </div></div>`;
  document.body.appendChild(m);
  const fermer = () => m.remove();
  m.addEventListener("click", e => { if (e.target === m) fermer(); });
  $("asclose").onclick = fermer;
  if ($("ascancel")) $("ascancel").onclick = fermer;
  if ($("asok")) $("asok").onclick = () => { try { sessionStorage.setItem("lpc_as", $("assel").value); } catch (e) { alert("Impossible de mémoriser le choix dans ce navigateur."); return; } location.reload(); };
}
