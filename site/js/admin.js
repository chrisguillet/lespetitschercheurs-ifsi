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

async function loadAdmin() {
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

function accesRow(a) {
  const sup = isSuper(), gere = gereStructure();   // gere : administrateur général, de site ou de promo (le serveur contrôle le périmètre)
  const k = esc(a.email);
  const dates = `<td>${esc(fmtDT(a.demande_le))}</td><td>${esc(fmtDT(a.derniere_connexion))}</td>`;
  // Un étudiant ne peut pas gérer les étudiants ; l'administrateur, si.
  if (a.protege && !gere) return `<tr><td>${k}</td>${dates}<td>${esc(a.prenom)}</td><td>Étudiant</td><td class="meta">Géré par l’administrateur</td></tr>`;
  const dem = a.statut === "en_attente" && a.demande ? a.demande : null;
  const veut = dem && dem.role ? dem.role : a.role;
  if (dem && dem.role === "etudiant" && !gere) return `<tr><td>${k}</td>${dates}<td>${esc(a.prenom)}</td><td>Étudiant</td><td class="meta">Demande en tant qu’étudiant : validée par l’administrateur${dem.promo ? " (" + esc(dem.promo) + ")" : ""}</td></tr>`;
  const opt = (v, lbl) => `<option value="${v}" ${veut === v ? "selected" : ""}>${lbl}</option>`;
  const roles = (gere ? opt("etudiant", "Étudiant") : "") + opt("formateur", "Formateur");
  const acts = a.statut === "actif"
    ? `<button class="btn sm" data-as="actif">Enregistrer</button> <button class="btn sm sec del" data-as="refuse">Retirer l’accès</button>`
    : a.statut === "en_attente"
      ? `<button class="btn sm" data-as="actif">Valider</button> <button class="btn sm sec del" data-as="refuse">Refuser</button>`
      : `<button class="btn sm" data-as="actif">Réactiver</button>`;
  const suppr = sup ? ` <button class="btn sm sec del" data-del="1" title="Retire l’accès ; ses fiches et commentaires restent dans la base de données">🗑 Supprimer l’accès</button> <button class="btn sm sec del" data-erase="1" title="Droit à l’effacement : supprime l’accès et les données de cette personne ; ses contributions sont anonymisées ou supprimées, au choix">🧹 Effacer ses données</button>` : "";
  const adresse = sup ? `<td><input data-f="nouvel_email" type="email" value="${k}"></td>` : `<td>${k}</td>`;
  const couleur = sup ? `<td><input data-f="couleur" type="color" value="${esc(a.couleur)}" style="min-width:48px;padding:2px"></td>` : "";
  return `<tr data-k="${k}">${adresse}${dates}<td><input data-f="prenom" maxlength="60" value="${esc(a.prenom)}" placeholder="Prénom">${dem && (dem.promo || dem.role) ? `<div class="meta">Demande : ${esc(dem.role === "etudiant" ? "étudiant" : dem.role === "formateur" ? "formateur" : "")}${dem.promo ? " · " + esc(dem.promo) : ""}</div>` : ""}</td>${couleur}
    <td><select data-f="role">${roles}</select></td><td>${acts}${suppr}</td></tr>`;
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
  const head = `<tr><th>Adresse</th><th>Demande</th><th>Dernière connexion</th><th>Prénom</th>${isSuper() ? "<th>Couleur</th>" : ""}<th>Rôle</th><th>Actions</th></tr>`;
  const bloc = (titre, list, vide) => `<h3>${titre} (${list.length})</h3>` + (list.length
    ? `<div class="wrap"><table class="adm"><thead>${head}</thead><tbody>${list.map(accesRow).join("")}</tbody></table></div>`
    : `<div class="meta">${vide}</div>`);
  $("adminbox").innerHTML = blocMembresVotes() +
    bloc("⏳ Demandes en attente", acces.filter(a => a.statut === "en_attente"), "Aucune demande en attente.") +
    bloc(isSuper() ? "✅ Accès actifs" : "✅ Formateurs de vos groupes", acces.filter(a => a.statut === "actif"), "Aucun accès actif.") +
    (isSuper() && comptesInactifs(acces).length ? `<div class="meta rgpdnote">🕓 Conservation limitée : ces comptes ne se sont pas connectés depuis plus de ${INACTIF_MOIS} mois (ou n’ont aucune date connue). Selon la politique de confidentialité, leurs données doivent être effacées ou anonymisées : « 🧹 Effacer ses données ».</div>` + bloc("🕓 Comptes inactifs depuis plus de " + INACTIF_MOIS + " mois", comptesInactifs(acces), "") : "") +
    (isSuper() ? bloc("⛔ Accès refusés", acces.filter(a => a.statut === "refuse"), "Aucun accès refusé.") : "") +
    (gereStructure() ? blocNoms() + blocInvitations() + blocRoles() + blocChat() + blocDoublons() + blocGroupes() : "") +
    (isSuper() ? blocFeedbacks() : "");
}

async function supprimerUtilisateur(b) {
  const email = b.closest("tr").dataset.k;
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
  const email = b.closest("tr").dataset.k;
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

$("adminbox").onclick = async e => {
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
  const row = b.closest("tr");
  const val = f => { const el = row.querySelector(`[data-f="${f}"]`); return el ? el.value : undefined; };
  const data = { email: row.dataset.k, prenom: val("prenom"), role: val("role"), statut: b.dataset.as };
  if (isSuper()) { data.nouvel_email = val("nouvel_email"); data.couleur = val("couleur"); }
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
