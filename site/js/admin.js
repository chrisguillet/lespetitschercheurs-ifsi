/* Thème, nouveautés et administration des accès.
   Script classique : partage la portée globale avec les autres fichiers de js/ (ordre de chargement : voir index.html). */
"use strict";
/* ---------- Thème et « nouveautés » ---------- */

let vuDepuis = null;
const cleVu = () => "lydia_vu:" + (me ? me.prenom : "");
function chargerVu() { try { vuDepuis = localStorage.getItem(cleVu()) || null; } catch (e) { vuDepuis = null; } }
function marquerVu() { if (!me) return; try { localStorage.setItem(cleVu(), new Date().toISOString()); } catch (e) { /* ignoré */ } }
window.addEventListener("pagehide", marquerVu);
document.addEventListener("visibilitychange", () => { if (document.hidden) marquerVu(); });


/* ---------- Administration des accès (étudiants) ---------- */

// Sans droit d'administration (étudiant, formateur), l'onglet ne contient que l'accès aux membres du groupe et aux votes.
const adminComplet = () => isSuper() || (typeof adminDelegue === "function" && adminDelegue());
function majTitreAdmin() {
  const h = document.querySelector("#admin h2"), n = document.querySelector("#admin .note");
  if (h) h.textContent = adminComplet() ? "Administration" : "Membres du groupe";
  if (n) n.classList.toggle("hidden", !adminComplet());
}

async function loadAdmin() {
  majTitreAdmin();
  if (!adminComplet()) { $("adminbox").innerHTML = blocMembresVotes() || '<div class="meta">Aucun groupe.</div>'; renderedAcces = ""; return; }
  try {
    const r = await api("admin_list");
    const next = r.acces;
    groupesAdmin = r.groupesAdmin || [];
    structureAdmin = r.structure || [];
    stockage = r.stockage || null;
    feedbacksAdmin = r.feedbacks || feedbacksAdmin;
    await chargerDelegation();
    // Pas de reconstruction si rien n'a changé ou si une saisie est en cours (sinon elle serait perdue).
    const a = document.activeElement;
    const typing = a && a.closest && a.closest("#adminbox") && (a.tagName === "INPUT" || a.tagName === "SELECT");
    acces = next;
    if (signatureAcces(next) + sigFeedbacks() + sigDelegation() !== renderedAcces && !typing) renderAdmin();
  } catch (e) { if (e.code === "unauthorized") sessionError(e); else showStatus("Administration indisponible : " + e.message); }
}

/* ----- Organisation : À traiter / Personnes / Structure / Réglages ----- */
let admSection = "traiter";
// Filtres de la liste des personnes (gardés d'une mise à jour à l'autre) ; la recherche et la pagination se font dans le navigateur.
const admPers = { q: "", role: "", perim: "", statut: "actif", inactifs: false, page: 0, ouverte: "" };
const PAGE_PERS = 25;
const SECTIONS_ADMIN = [["traiter", "À traiter"], ["personnes", "Personnes"], ["structure", "Structure"], ["reglages", "Réglages"]];
const sansAccent = s => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

const nbRetours = () => isSuper() ? feedbacksAdmin.filter(f => (f.statut || "nouveau") === "nouveau").length : 0;
const nbATraiter = () => acces.filter(a => a.statut === "en_attente").length + demandesNom.length + doublonsAdmin.length + nbRetours();

// Les vrais rôles de la personne (attributions) avec leur périmètre : plus de « rôle global ».
function puces(a) {
  if (a.statut === "en_attente") {
    const d = a.demande || {};
    return `<span class="chip fixe">En attente${d.role ? " · demande " + (d.role === "etudiant" ? "étudiant" : "formateur") : ""}${d.promo ? " · " + esc(d.promo) : ""}</span>`;
  }
  const l = a.attributions || [];
  if (!l.length) return '<span class="meta">Aucun rôle</span>';
  return l.map(r => `<span class="chip fixe">${esc(ROLES_LIB[r.role] || r.role)}${r.perimetre ? ` <span class="meta">· ${esc(r.perimetre)}</span>` : ""}</span>`).join("");
}

// Une demande d'accès : seul endroit où l'on choisit étudiant ou formateur (la suite se gère dans la fiche de la personne).
function demandeRow(a) {
  const sup = isSuper(), k = esc(a.email);
  const dem = a.demande && a.demande.role ? a.demande : null;
  const veut = dem ? dem.role : "etudiant";
  const opt = (v, lbl) => `<option value="${v}" ${veut === v ? "selected" : ""}>${lbl}</option>`;
  const nomCol = sup ? `<td><input data-f="nom" maxlength="60" value="${esc(a.nom || "")}" placeholder="Nom de famille"></td>` : "";
  return `<tr data-k="${k}"><td>${k}</td><td>${esc(fmtDT(a.demande_le))}</td>
    <td><input data-f="prenom" maxlength="60" value="${esc(sup ? (a.prenom_legal || a.prenom) : a.prenom)}" placeholder="Prénom"></td>${nomCol}
    <td>${dem && dem.promo ? esc(dem.promo) : '<span class="meta">—</span>'}</td>
    <td><select data-f="role" aria-label="Rôle accordé">${opt("etudiant", "Étudiant")}${opt("formateur", "Formateur")}</select></td>
    <td><button class="btn sm" data-as="actif">Valider</button> <button class="btn sm sec del" data-as="refuse">Refuser</button></td></tr>`;
}

function sectionTraiter() {
  const att = acces.filter(a => a.statut === "en_attente");
  const head = `<tr><th>Adresse</th><th>Demandé le</th><th>Prénom</th>${isSuper() ? "<th>Nom</th>" : ""}<th>Promo demandée</th><th>Rôle accordé</th><th>Actions</th></tr>`;
  const demandes = `<h3>⏳ Demandes d’accès (${att.length})</h3>` + (att.length
    ? `<div class="meta">Une personne inconnue qui se connecte apparaît ici. Vérifiez son nom puis choisissez son rôle : <b>Étudiant</b> (rattaché à la promo demandée) ou <b>Formateur</b>.</div><div class="wrap"><table class="adm"><thead>${head}</thead><tbody>${att.map(demandeRow).join("")}</tbody></table></div>`
    : '<div class="meta">Aucune demande en attente.</div>');
  const rien = !nbATraiter() ? '<div class="meta" style="margin-top:10px">✅ Rien d’autre à traiter pour le moment.</div>' : "";
  return demandes + blocNoms() + blocDoublons() + (isSuper() ? blocFeedbacks() : "") + rien;
}

// ----- Personnes -----
function optionsPerimetre() {
  return structureAdmin.map(e => `<option value="e:${esc(e.id)}">${esc(e.nom)} (tout l’établissement)</option>` +
    (e.promos || []).map(p => `<option value="p:${esc(p.id)}">&nbsp;&nbsp;${esc(e.nom)} · ${esc(p.nom)}</option>`).join("")).join("");
}
function personnesFiltrees() {
  const q = sansAccent(admPers.q).trim();
  const inactifs = admPers.inactifs ? new Set(comptesInactifs(acces).map(a => a.email)) : null;
  const [pt, pid] = admPers.perim ? [admPers.perim[0], admPers.perim.slice(2)] : ["", ""];
  const promosDeSite = pt === "e" ? new Set(((structureAdmin.find(e => e.id === pid) || {}).promos || []).map(p => p.id)) : null;
  return acces.filter(a => {
    if (a.statut === "en_attente") return false;
    if (admPers.statut && a.statut !== admPers.statut) return false;
    if (q && !sansAccent([a.prenom_legal, a.nom, a.prenom, a.email].join(" ")).includes(q)) return false;
    const at = a.attributions || [];
    if (admPers.role && !at.some(r => r.role === admPers.role)) return false;
    if (pt === "p" && !at.some(r => r.promo_id === pid)) return false;
    if (pt === "e" && !at.some(r => r.etablissement_id === pid || (r.promo_id && promosDeSite.has(r.promo_id)))) return false;
    if (inactifs && !inactifs.has(a.email)) return false;
    return true;
  });
}
const nomComplet = a => isSuper() ? [a.prenom_legal || a.prenom, a.nom].filter(Boolean).join(" ") : a.prenom;

function renderListePersonnes() {
  const zone = $("persliste");
  if (!zone) return;
  const l = personnesFiltrees(), pages = Math.max(1, Math.ceil(l.length / PAGE_PERS));
  admPers.page = Math.min(admPers.page, pages - 1);
  const vue = l.slice(admPers.page * PAGE_PERS, (admPers.page + 1) * PAGE_PERS);
  const ligne = a => `<tr class="pers" data-pk="${esc(a.email)}" tabindex="0"><td><b>${esc(nomComplet(a))}</b><div class="meta">${esc(a.email)}</div></td>
    <td>${puces(a)}</td><td class="meta">${esc(a.derniere_connexion ? fmtDT(a.derniere_connexion) : "jamais")}</td>
    <td><button type="button" class="btn sm sec" data-pg="${esc(a.email)}">Gérer</button></td></tr>`;
  const nav = pages > 1 ? `<div class="grow pagpers"><button type="button" class="btn sm sec" data-pp="-1" ${admPers.page === 0 ? "disabled" : ""}>← Précédent</button>
    <span class="meta">Page ${admPers.page + 1} / ${pages}</span><button type="button" class="btn sm sec" data-pp="1" ${admPers.page >= pages - 1 ? "disabled" : ""}>Suivant →</button></div>` : "";
  zone.innerHTML = `<div class="meta" role="status">${l.length} personne${l.length > 1 ? "s" : ""}${l.length > PAGE_PERS ? ` · ${admPers.page * PAGE_PERS + 1} à ${admPers.page * PAGE_PERS + vue.length}` : ""}</div>` +
    (l.length ? `<div class="wrap"><table class="adm pers"><thead><tr><th>Personne</th><th>Rôles</th><th>Dernière connexion</th><th></th></tr></thead><tbody>${vue.map(ligne).join("")}</tbody></table></div>${nav}`
      : '<div class="meta">Aucune personne ne correspond à ces critères.</div>');
}

function sectionPersonnes() {
  const a = admPers.ouverte && acces.find(x => x.email === admPers.ouverte);
  if (a) return panneauPersonne(a);
  admPers.ouverte = "";
  const opt = (v, lbl, cur) => `<option value="${v}" ${cur === v ? "selected" : ""}>${lbl}</option>`;
  const roles = [["", "Tous les rôles"], ["etudiant", "Étudiants"], ["formateur", "Formateurs"], ["admin_promo", "Admins de promo"], ["admin_site", "Admins de site"], ["admin", "Administrateur général"]];
  return `<div class="persfiltres grow">
      <input type="search" data-pf="q" value="${esc(admPers.q)}" placeholder="Rechercher un nom ou une adresse" aria-label="Rechercher une personne" style="min-width:220px;flex:1">
      <select data-pf="role" aria-label="Filtrer par rôle">${roles.map(([v, l]) => opt(v, l, admPers.role)).join("")}</select>
      ${structureAdmin.length ? `<select data-pf="perim" aria-label="Filtrer par établissement ou promo"><option value="">Tous les établissements et promos</option>${optionsPerimetre().replace(`value="${esc(admPers.perim)}"`, `value="${esc(admPers.perim)}" selected`)}</select>` : ""}
      <select data-pf="statut" aria-label="Filtrer par statut">${[["actif", "Accès actifs"], ["refuse", "Accès retirés ou refusés"], ["", "Tous les statuts"]].map(([v, l]) => opt(v, l, admPers.statut)).join("")}</select>
      ${isSuper() ? `<label class="meta" style="margin:0"><input type="checkbox" data-pf="inactifs" ${admPers.inactifs ? "checked" : ""}> inactifs depuis plus de ${INACTIF_MOIS} mois</label>` : ""}
    </div><div id="persliste"></div>`;
}

// Fiche d'une personne : identité, rôles et périmètres, statut, actions RGPD.
function panneauPersonne(a) {
  const sup = isSuper(), k = esc(a.email), general = a.role === "admin";
  const per = perimetres();
  const roleOpts = ROLES_ATTRIBUABLES.filter(([r]) => sup || r !== "admin_site").map(([r, t]) => `<option value="${r}" data-t="${t}">${esc(ROLES_LIB[r])}</option>`).join("");
  const chips = (a.attributions || []).map(r => `<span class="chip fixe">${esc(ROLES_LIB[r.role] || r.role)}${r.perimetre ? ` <span class="meta">· ${esc(r.perimetre)}</span>` : ""}${r.role === "admin" ? "" : ` <button type="button" class="btn sm sec del" style="padding:0 6px" data-rr="${r.id}" aria-label="Retirer ce rôle">✕</button>`}</span>`).join(" ") || '<span class="meta">Aucun rôle visible dans votre périmètre.</span>';
  const identite = sup && !general
    ? `<div class="idgrid"><label class="meta">Prénom <input data-f="prenom" maxlength="60" value="${esc(a.prenom_legal || a.prenom)}"></label>
        <label class="meta">Nom <input data-f="nom" maxlength="60" value="${esc(a.nom || "")}" title="« - » : nom de famille pas encore connu"></label>
        <label class="meta">Adresse <input data-f="nouvel_email" type="email" value="${k}" style="min-width:230px"></label>
        <label class="meta">Couleur <input data-f="couleur" type="color" value="${esc(a.couleur)}" style="min-width:48px;padding:2px"></label>
        <button class="btn sm" data-as="${esc(a.statut)}">Enregistrer</button></div>`
    : `<div><b>${esc(nomComplet(a))}</b> <span class="meta">${k}</span></div>`;
  const ajout = a.statut === "actif" && per.length && !general
    ? `<div class="grow" data-rol="form"><input type="hidden" data-rl="email" value="${k}"><select data-rl="role" aria-label="Rôle à attribuer">${roleOpts}</select>
        <select data-rl="perim" aria-label="Périmètre">${per.map(x => `<option value="${esc(x[0])}" data-t="${x[2]}">${esc(x[1])}</option>`).join("")}</select>
        <button type="button" class="btn sm" data-rl="ajouter">Ajouter ce rôle</button></div>` : "";
  const statutActs = general ? '<div class="meta">Compte de l’administrateur général : il n’est pas modifiable ici.</div>'
    : (a.statut === "actif" ? '<button class="btn sm sec del" data-as="refuse">Retirer l’accès</button>' : '<button class="btn sm" data-as="actif">Réactiver l’accès</button>')
      + (sup ? ` <button class="btn sm sec del" data-del="1" title="Retire l’accès ; ses fiches et commentaires restent dans la base de données">🗑 Supprimer l’accès</button> <button class="btn sm sec del" data-erase="1" title="Droit à l’effacement : supprime l’accès et les données de cette personne ; ses contributions sont anonymisées ou supprimées, au choix">🧹 Effacer ses données</button>` : "");
  return `<div class="persfiche" data-k="${k}">
    <button type="button" class="btn sm sec" data-pg="">← Retour à la liste</button>
    <h3 style="margin-top:12px">${esc(nomComplet(a))}</h3>
    <div class="meta">${k} · ${a.statut === "actif" ? "accès actif" : "accès retiré ou refusé"} · dernière connexion : ${esc(a.derniere_connexion ? fmtDT(a.derniere_connexion) : "jamais")} · ${a.nb_lectures || 0} fiche${(a.nb_lectures || 0) > 1 ? "s" : ""}, ${a.nb_commentaires || 0} commentaire${(a.nb_commentaires || 0) > 1 ? "s" : ""}</div>
    <div class="sect"><b>Identité</b>${identite}</div>
    <div class="sect"><b>Rôles et périmètres</b><div>${chips}</div>${ajout}
      <div class="meta">Les rôles se cumulent. Un administrateur de site gère son établissement, un administrateur de promo sa promo ; vous ne voyez et ne modifiez que ceux de votre périmètre.</div></div>
    <div class="sect"><b>Accès</b><div class="grow">${statutActs}</div></div></div>`;
}

let renderedAcces = "";
// Le rendu dépend du rôle (étudiant ou administrateur) autant que de la liste : les deux entrent dans la signature.
const signatureAcces = l => (me ? me.role : "") + "|" + JSON.stringify([l, groupesAdmin, structureAdmin]);
// Rappel RGPD : comptes actifs sans connexion depuis plus de 12 mois (date de demande à défaut), ou sans aucune date connue.
const INACTIF_MOIS = 12;
function comptesInactifs(liste) {
  const limite = new Date(); limite.setMonth(limite.getMonth() - INACTIF_MOIS);
  return liste.filter(a => {
    if (a.statut !== "actif" || a.role === "admin" || (me && a.email === me.email)) return false;
    const t = Date.parse(a.derniere_connexion || a.demande_le);
    return !t || t < limite.getTime();
  });
}
function renderAdmin() {
  renderedAcces = signatureAcces(acces) + sigFeedbacks() + sigDelegation();
  const n = nbATraiter();
  const compteur = k => k === "traiter" ? (n ? ` <span class="count">${n}</span>` : "") : k === "personnes" ? "" : "";
  const onglets = `<div class="admtabs" role="tablist" aria-label="Administration">${SECTIONS_ADMIN.map(([k, l]) =>
    `<button type="button" role="tab" class="btn sm ${admSection === k ? "on" : "sec"}" aria-selected="${admSection === k}" data-adm="${k}">${l}${compteur(k)}</button>`).join("")}</div>`;
  const corps = admSection === "personnes" ? sectionPersonnes()
    : admSection === "structure" ? blocGroupes() + blocInvitations()
      : admSection === "reglages" ? (blocChat() || '<div class="meta">Aucun réglage disponible.</div>')
        : sectionTraiter();
  $("adminbox").innerHTML = onglets + `<div class="admcorps">${corps}</div>`;
  if (admSection === "personnes") { renderListePersonnes(); const f = $("adminbox").querySelector('[data-rol="form"]'); if (f) ajusterPerimetres(f); }
}

async function supprimerUtilisateur(b) {
  const email = b.closest("[data-k]").dataset.k;
  const a = acces.find(x => x.email === email);
  if (!a) return;
  const n = a.nb_lectures || 0;
  const garde = n ? `\n\nSes ${n} lecture${n > 1 ? "s" : ""} et ses commentaires sont conservés dans la base de données mais ne seront plus affichés (ses commentaires sur les lectures des autres apparaîtront sous « Utilisateur supprimé »).` : "";
  if (!confirm(`Supprimer ${a.prenom || email} (${email}) ? Cette personne n’aura plus accès à l’application.${garde}`)) return;
  b.disabled = true;
  try {
    const res = await enCours("Suppression…", () => api("admin_delete", { email }));
    acces = res.acces;
    renderAdmin();
    applyResult(res);
  } catch (err) {
    b.disabled = false;
    if (err.code === "unauthorized") sessionError(err); else alert("Suppression impossible : " + err.message);
  }
}

// Droit à l'effacement : retire l'accès ET toutes les données de la personne (fiches, commentaires, notes, appartenances, fichiers, votes…).
async function effacerUtilisateur(b) {
  const email = b.closest("[data-k]").dataset.k;
  const a = acces.find(x => x.email === email);
  if (!a) return;
  const n = a.nb_lectures || 0, c = a.nb_commentaires || 0;
  if (!confirm(`EFFACER DÉFINITIVEMENT les données de ${a.prenom || email} (${email}) ?\n\nSont toujours supprimés : son accès, son adresse, ses notes, ses retours, ses messages, ses fichiers joints, ses appartenances et ses brouillons.\nLes réunions, jalons et termes du groupe restent, détachés de son adresse. Les sauvegardes des bases disparaissent d’elles-mêmes sous 7 jours.\n\nCette action est irréversible.`)) return;
  // Contributions (fiches terminées, commentaires) : par défaut anonymisées, comme à la purge automatique ; tout supprimer si la personne retire son consentement.
  const anonymiser = confirm(`Que faire de ses contributions (${n} fiche${n > 1 ? "s" : ""}, ${c} commentaire${c > 1 ? "s" : ""}) ?\n\nOK : les CONSERVER, anonymisées (plus rattachées à personne), pour la base de connaissances.\nAnnuler : TOUT SUPPRIMER aussi (retrait du consentement : fiches, commentaires, propositions de correction et votes).`);
  b.disabled = true;
  try {
    const res = await enCours("Effacement…", () => api("admin_erase", { email, contributions: anonymiser ? "anonymiser" : "supprimer" }));
    acces = res.acces;
    renderAdmin();
    applyResult(res);
  } catch (err) {
    b.disabled = false;
    if (err.code === "unauthorized") sessionError(err); else alert("Effacement impossible : " + err.message);
  }
}

// Volets repliés / dépliés de l'arbre : mémorisés d'une mise à jour à l'autre.
$("adminbox").addEventListener("toggle", e => {
  const k = e.target.dataset && e.target.dataset.k;
  if (k) { if (e.target.open) adminFerme.delete(k); else adminFerme.add(k); }
}, true);

// Filtres de la liste des personnes : seule la liste est redessinée (la saisie dans la recherche n'est pas interrompue).
$("adminbox").addEventListener("input", e => {
  const f = e.target.dataset && e.target.dataset.pf;
  if (!f) return;
  admPers[f] = e.target.type === "checkbox" ? e.target.checked : e.target.value;
  admPers.page = 0;
  renderListePersonnes();
});

$("adminbox").addEventListener("keydown", e => {
  const lg = e.key === "Enter" && e.target.matches && e.target.matches("tr.pers") ? e.target : null;
  if (lg) { admPers.ouverte = lg.dataset.pk; renderAdmin(); }
});

function ouvrirSection(k) {
  admSection = k;
  admPers.ouverte = "";
  renderAdmin();
}

$("adminbox").onclick = async e => {
  const tab = e.target.closest("button[data-adm]");
  if (tab) return ouvrirSection(tab.dataset.adm);
  const pg = e.target.closest("button[data-pg]");
  if (pg) { admPers.ouverte = pg.dataset.pg; return renderAdmin(); }
  const lg = e.target.closest("tr.pers");
  if (lg && !e.target.closest("button")) { admPers.ouverte = lg.dataset.pk; return renderAdmin(); }
  const pp = e.target.closest("button[data-pp]");
  if (pp) { admPers.page = Math.max(0, admPers.page + Number(pp.dataset.pp)); return renderListePersonnes(); }
  const sb = e.target.closest("button[data-s]");
  if (sb) return actionStructureAdmin(sb);
  const gb = e.target.closest("button[data-g]");
  if (gb) return actionGroupeAdmin(gb);
  const del = e.target.closest("button[data-del]");
  if (del) return supprimerUtilisateur(del);
  const era = e.target.closest("button[data-erase]");
  if (era) return effacerUtilisateur(era);
  const b = e.target.closest("button[data-as]");
  if (!b) return;
  const row = b.closest("[data-k]");
  const val = f => { const el = row.querySelector(`[data-f="${f}"]`); return el ? el.value : undefined; };
  const data = { email: row.dataset.k, prenom: val("prenom"), role: val("role"), statut: b.dataset.as };
  if (isSuper()) { data.nouvel_email = val("nouvel_email"); data.couleur = val("couleur"); data.nom = val("nom"); }
  if (data.statut === "refuse" && !confirm("Retirer ou refuser l’accès de " + data.email + " ?")) return;
  b.disabled = true;
  try {
    const res = await enCours("Enregistrement…", () => api("admin_set", { data }));
    acces = res.acces;
    renderAdmin();
    applyResult(res);
  } catch (err) {
    b.disabled = false;
    if (err.code === "unauthorized") sessionError(err); else alert("Action impossible : " + err.message);
  }
};
