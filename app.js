"use strict";

// Une erreur de script ne doit pas passer inaperçue : on l'affiche en haut de page (aide au diagnostic).
function signalerErreur(msg, ligne) {
  const z = document.getElementById("status");
  if (!z) return;
  z.textContent = "Erreur d’affichage : " + msg + (ligne ? " (app.js, ligne " + ligne + ")" : "") + ". Si elle persiste, notez ce message dans un retour sur l’outil.";
  z.classList.remove("hidden");
}
window.addEventListener("error", e => signalerErreur(e.message || "inconnue", e.lineno));
window.addEventListener("unhandledrejection", e => signalerErreur((e.reason && e.reason.message) || "requête échouée"));

const CFG = window.LYDIA_CONFIG;
const TYPES = ["Article scientifique", "Article de recherche", "Revue de littérature", "Article professionnel",
  "Rapport / recommandation HAS", "Thèse / mémoire", "Autre"];
const LAB = { titre: "titre", parution: "date de parution", auteur: "auteur", qualite: "qualité",
  nation: "nationalité", type: "type d’article" };
const FIN = ["titre", "parution", "auteur", "qualite", "nation", "type"];

const $ = id => document.getElementById(id);
const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const fmtD = iso => {
  if (!iso) return "";
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (m) return `${m[3]}/${m[2]}/${m[1]}`;
  const my = /^(\d{4})-(\d{2})$/.exec(iso);
  if (my) return `${my[2]}/${my[1]}`;
  if (/^\d{4}$/.test(iso)) return iso;
  const d = new Date(iso);
  return isNaN(d) ? iso : d.toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric" });
};
const fmtDT = iso => {
  if (!iso) return "—";
  const d = new Date(iso);
  return isNaN(d) ? iso : d.toLocaleString("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
};
const stamp = () => new Date().toISOString().slice(0, 10);

let token = null;
try { token = sessionStorage.getItem("lydia_token"); } catch (e) { /* stockage indisponible */ }
let me = null, users = [], items = [], comments = [], acces = [], pendingCount = 0;
// items / comments = ce que montre la vue courante ; itemsAll / commentsAll = tout ce que le serveur renvoie à la personne.
let structureAdmin = [], adminFerme = new Set(), reunionsAll = [], jalonsAll = [], groupes = [], votes = [], itemsAll = [], commentsAll = [], groupesAdmin = [], promosMoi = [], fichiers = [], stockage = null, feedbacksAdmin = [];
const ctx = { gid: "", vue: "groupe" };          // groupe choisi, et vue : « groupe » ou « promo » (fiches partagées)
try { ctx.gid = localStorage.getItem("lydia_groupe") || ""; ctx.vue = localStorage.getItem("lydia_portee") === "groupe" ? "groupe" : "promo"; } catch (e) { /* ignoré */ }
let cmScope = "groupe", studentsSig = "", ctxSig = "";
let editing = null, artCible = "", modeArticle = false, props = [], tab = "all", timer = null;
const drafts = {};          // brouillons de commentaires, par lecture
let cmId = null, cmFocus = null;   // lecture dont la discussion est ouverte dans la fenêtre « Commentaires »
let enLigne = [], enLigneSig = "";   // personnes actives en ce moment (fourni par le serveur)
let lusSet = new Set();     // commentaires déjà lus par la personne connectée (suivi côté serveur)
const lusEnvoi = new Set(); // lus marqués ici mais pas encore confirmés par le serveur
const nonLusEnvoi = new Set(); // remis en non lu ici, pas encore confirmés par le serveur
const frais = new Set();    // commentaires qui étaient non lus à l'ouverture : surlignés tant que la discussion reste ouverte
const CM = { nonLus: false, miennes: false };
const lsGet = (k, d) => { try { return localStorage.getItem(k) || d; } catch (e) { return d; } };
const F = { q: "", who: "", grp: "", st: "", type: "", kw: "", kwLabel: "", sort: "ajoute",
  view: lsGet("lydia_vue", matchMedia("(max-width:700px)").matches ? "cartes" : "tableau") };
const masquees = new Set((() => { try { return JSON.parse(lsGet("lydia_cols", "[]")); } catch (e) { return []; } })());

// etudiant : écrit, administre et commente ; formateur : lit et commente (dans ses groupes) ; admin : gère tout.
const canWrite = () => !!me && me.role === "etudiant";
const canComment = () => !!me && (me.role === "formateur" || me.role === "etudiant");
const canAdmin = () => !!me && (me.role === "etudiant" || me.role === "admin");   // valide les accès, modère
const isSuper = () => !!me && me.role === "admin";                                // gère aussi les étudiants

/* ---------- API ---------- */

async function api(action, payload = {}) {
  let j;
  try {
    const res = await fetch(CFG.API_URL, {
      method: "POST",
      // text/plain évite la requête de pré-vérification CORS, non gérée par Apps Script
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({ action, token, ...payload })
    });
    j = await res.json();
  } catch (e) {
    const err = new Error("Connexion au serveur impossible");
    err.code = "network";
    throw err;
  }
  if (!j.ok) {
    const err = new Error(j.message || j.error);
    err.code = j.error;
    err.extra = j.extra;
    throw err;
  }
  return j;
}

/* ---------- Connexion ---------- */

// Écran de connexion : état d'attente (le serveur peut mettre quelques secondes à répondre au premier appel).
let attenteTimer = null;
function gateAttente(msg) {
  $("gate").classList.remove("hidden");
  $("login").classList.add("hidden");
  $("retry").classList.add("hidden");
  $("gatemsg").classList.add("hidden");
  $("gatewaitmsg").textContent = msg;
  $("gatewait").classList.remove("hidden");
  clearTimeout(attenteTimer);
  attenteTimer = setTimeout(() => { $("gatewaitmsg").textContent = "Le serveur démarre, cela peut prendre encore quelques secondes…"; }, 6000);
}
function gatePret() {
  clearTimeout(attenteTimer);
  $("gatewait").classList.add("hidden");
  $("login").classList.remove("hidden");
  $("gatemsg").classList.remove("hidden");
}

function initGoogle() {
  if (!(window.google && google.accounts && google.accounts.id)) { setTimeout(initGoogle, 200); return; }
  google.accounts.id.initialize({ client_id: CFG.GOOGLE_CLIENT_ID, callback: onCredential, auto_select: true });
  google.accounts.id.renderButton($("login"), { theme: "outline", size: "large", text: "signin_with", locale: "fr" });
  $("retry").onclick = () => boot();
  if (token) boot(); else google.accounts.id.prompt();
}

function onCredential(resp) {
  token = resp.credential;
  try { sessionStorage.setItem("lydia_token", token); } catch (e) { /* ignoré */ }
  if (me) { clearStatus(); refresh(); } else boot();
}

function showGate(msg, retry) {
  gatePret();
  $("gate").classList.remove("hidden");
  $("app").classList.add("hidden");
  $("tabs").classList.add("hidden");
  renderMeAnonyme();
  $("retry").classList.toggle("hidden", !retry);
  if (msg) $("gatemsg").textContent = msg;
}

// Remet à zéro tout ce qui dépend du compte : rien ne doit survivre d'une session à l'autre.
function reinitialiserEtat() {
  closeDrawer(true);
  token = null; me = null; users = []; items = []; comments = []; acces = []; pendingCount = 0;
  groupes = []; votes = []; promosMoi = []; fichiers = []; stockage = null; feedbacksAdmin = []; fermerFeedback(true); fermerJeu(); $("fbopen")?.classList.add("hidden"); dataSig = ""; itemsAll = []; commentsAll = []; groupesAdmin = []; structureAdmin = []; studentsSig = ""; ctxSig = ""; GM.cand = null; fermerGroupe(true);
  editing = null; artCible = ""; modeArticle = false; forceStatut = "";
  openRows.clear(); openArts.clear(); fermesArts.clear(); fermerDiscussion(true); lusSet = new Set(); lusEnvoi.clear(); nonLusEnvoi.clear(); frais.clear(); Object.assign(CM, { nonLus: false, miennes: false });
  Object.keys(drafts).forEach(k => delete drafts[k]);
  Object.assign(F, { q: "", who: "", grp: "", st: "", type: "", kw: "", kwLabel: "", sort: "ajoute" });
  B.who = ""; B.enCours = false;
  enLigne = []; enLigneSig = "";
  tab = "all"; vuDepuis = null; renderedAcces = ""; derniereSync = null; usersChanged = false;
  ["rows", "cards", "mylist", "mysum", "adminbox", "bibtools", "biblist", "synthbox", "cmtsbox", "cmbody", "online", "filters", "stats", "form", "ctxbar", "gbody"].forEach(id => { $(id).innerHTML = ""; });
  $("pending").textContent = ""; $("cmtcount").textContent = "";
  document.body.classList.remove("nogroup");
  $("nogroup").innerHTML = ""; $("nogroup").dataset.sig = ""; $("accueil").innerHTML = ""; $("accueil").classList.add("hidden");
  $("sub").textContent = "Outil partagé de suivi des lectures de mémoire";
}

function logout() {
  marquerVu();
  if (token) api("bye").catch(() => {});   // disparaît tout de suite de la liste des personnes en ligne
  if (timer) clearInterval(timer);
  reinitialiserEtat();
  try { sessionStorage.removeItem("lydia_token"); } catch (e) { /* ignoré */ }
  if (window.google) google.accounts.id.disableAutoSelect();
  showGate("Vous êtes déconnecté(e). Connectez-vous avec votre compte Google.");
}

function sessionError(e) {
  token = null;
  try { sessionStorage.removeItem("lydia_token"); } catch (x) { /* ignoré */ }
  if (me) {
    showStatus("Session expirée : reconnectez-vous (vos saisies en cours sont conservées).");
    google.accounts.id.prompt();
  } else {
    showGate(e.message);
    google.accounts.id.prompt();
  }
}

function showStatus(msg) { $("status").textContent = msg; $("status").classList.remove("hidden"); }
function clearStatus() { $("status").classList.add("hidden"); }

let derniereSync = null, usersChanged = false;
function majSync() {
  const el = $("sync");
  if (el && derniereSync) el.textContent = "mis à jour à " + derniereSync.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
}

// Groupe courant (celui choisi, sinon le premier) et vue (groupe ou promo) : ce que montrent le tableau, les commentaires, la synthèse.
function groupeCourant() { return groupes.find(g => g.id === ctx.gid) || groupes[0] || null; }
const memePromo = (a, b) => a.etablissement === b.etablissement && a.promo === b.promo;

function deriver() {
  const g = groupeCourant();
  if (!g) { items = []; comments = []; return; }
  ctx.gid = g.id;
  items = ctx.vue === "promo" ? itemsAll.filter(i => i.portee === "promo" && memePromo(i, g)) : itemsAll.filter(i => i.groupe_id === g.id);
  const ids = new Set(items.map(i => i.id));
  comments = commentsAll.filter(c => ids.has(c.lecture_id) && (ctx.vue === "promo" ? c.portee === "promo" : c.portee !== "promo"));
}

// Signature des données utiles (hors « en ligne ») : une actualisation qui ne change rien ne reconstruit pas le tableau.
let dataSig = "";
function applyData(j) {
  const sig = JSON.stringify([j.utilisateurs, j.groupes, j.votes, j.propositions, j.promosMoi, j.fichiers, j.reunions, j.jalons, j.lectures, j.commentaires, j.lus, j.enAttente]);
  const change = sig !== dataSig;
  dataSig = sig;
  applyDataBrut(j);
  return change;
}
function applyDataBrut(j) {
  derniereSync = new Date();
  majSync();
  if (j.utilisateurs) users = j.utilisateurs;
  groupes = j.groupes || [];
  votes = j.votes || [];
  promosMoi = j.promosMoi || [];
  fichiers = j.fichiers || [];
  itemsAll = j.lectures;
  props = j.propositions || [];
  reunionsAll = j.reunions || [];
  jalonsAll = j.jalons || [];
  commentsAll = j.commentaires || [];
  deriver();
  // La liste des étudiants (filtres, statistiques) dépend de la vue : on ne reconstruit les filtres que si elle change.
  const sig = JSON.stringify(students());
  usersChanged = sig !== studentsSig;
  studentsSig = sig;
  // Un filtre sur un étudiant qui n'est plus dans la vue n'a plus de sens.
  if (F.who && !students().some(u => u.prenom === F.who)) F.who = "";
  if (F.grp && !groupesListe().includes(F.grp)) F.grp = "";
  if (B.who && !students().some(u => u.prenom === B.who)) B.who = "";
  enLigne = j.enLigne || [];
  lusSet = new Set((j.lus || []).concat([...lusEnvoi]).filter(id => !nonLusEnvoi.has(id)));
  pendingCount = j.enAttente || 0;
}

// Les écritures renvoient les données à jour : on les applique sans second appel.
function applyResult(j) {
  if (!j || !j.lectures) return;
  applyData(j);
  renderData();
}

// Chaque étape est isolée : une erreur d'affichage sur un bloc (données inattendues) ne doit pas empêcher d'afficher les onglets
// et le reste de la page. L'erreur est signalée en haut de page avec le nom de l'étape.
function etape(nom, fn) {
  try { fn(); } catch (e) { console.error(nom, e); signalerErreur(nom + " : " + (e && e.message || e)); }
}
function renderData() {
  etape("contexte", renderCtx);
  etape("groupe", majGroupe);
  etape("filtres", () => { if (usersChanged && me) renderFilters(); });
  etape("mes lectures", renderMine);
  etape("tableau", renderTable);
  etape("propositions", renderPending);
  etape("commentaires", renderComments);
  etape("en ligne", renderOnline);
  etape("discussion", majModal);
  etape("onglet", () => {
    if (tab === "biblio") renderBiblio();
    if (tab === "synth") renderSynth();
    if (tab === "suivi") renderSuivi();
  });
  etape("barres", majBarres);
}

// Onglet de suivi (selon le groupe), alertes du rétroplanning, lien de retour : à rafraîchir après CHAQUE affichage
// (première connexion, actualisation automatique, action), pas seulement après une action.
// Onglets selon la personne : « Mes lectures » réservé aux étudiants, « Suivi de projet » à qui a un groupe,
// « Administration » à l'administrateur et aux étudiants qui ont un groupe (un formateur ne l'a jamais).
function majOnglets() {
  const vis = { mine: canWrite(), suivi: !!groupeCourant(), admin: canAdmin() && (isSuper() || !!groupeCourant()) };
  Object.keys(vis).forEach(t => document.querySelector(`.tab[data-t="${t}"]`).classList.toggle("hidden", !vis[t]));
  if (vis[tab] === false) setTab("all");
}
function majBarres() {
  majOnglets();
  etape("alertes", majAlertes);
  $("fbopen")?.classList.toggle("hidden", !me);
}

// Affiche l'attente le temps d'une écriture (l'API peut mettre quelques secondes à répondre).
async function enCours(msg, fn) {
  showStatus("⏳ " + msg);
  try { return await fn(); } finally { clearStatus(); }
}

let bootEnCours = false;
async function boot() {
  if (bootEnCours) return;                      // évite un second « init » si on reclique pendant l'attente
  bootEnCours = true;
  gateAttente("Connexion en cours… vérification de votre compte");
  try {
    const j = await api("init");
    me = j.me;
    chargerVu();
    applyData(j);
    clearTimeout(attenteTimer);
    $("gate").classList.add("hidden");
    $("app").classList.remove("hidden");
    clearStatus();
    renderAll();
    startPolling();
  } catch (e) {
    if (e.code === "unauthorized") sessionError(e);
    else if (e.code === "pending") { showGate(e.message, true); afficherAccueil(); }
    else if (e.code === "forbidden") showGate(e.message + ". Changez de compte si besoin.");
    else showGate("Erreur : " + e.message);
  } finally { bootEnCours = false; }
}

async function refresh(manuel) {
  if (!token || !me) return;
  if (manuel === true) showStatus("⏳ Actualisation…");
  try {
    const change = applyData(await api("list"));
    if (!change && manuel !== true) {   // rien de neuf : on met seulement à jour ce qui bouge sans les données (en ligne, compteurs)
      renderCtx(); renderPending(); renderOnline(); majSync(); majBarres();
      if (tab === "admin" && canAdmin()) await loadAdmin();
      clearStatus();
      return;
    }
    renderCtx();
    majGroupe();
    if (usersChanged) renderFilters();
    // On ne reconstruit pas le tableau pendant qu'un commentaire est en cours de saisie.
    const a = document.activeElement;
    const typing = a && a.tagName === "TEXTAREA" && a.closest("#rows, #cards");
    renderMine();
    if (!typing) renderTable();
    renderPending();
    renderComments();
    renderOnline();
    majModal();
    if (tab === "biblio") renderBiblio();
    if (tab === "synth") renderSynth();
    if (tab === "suivi") renderSuivi();
    majBarres();
    if (tab === "admin" && canAdmin()) await loadAdmin();
    clearStatus();
  } catch (e) {
    if (e.code === "unauthorized") sessionError(e);
    else if (e.code === "forbidden" || e.code === "pending") {   // l'accès a été retiré ou suspendu pendant la session
      if (timer) clearInterval(timer);
      reinitialiserEtat();
      showGate(e.message, e.code === "pending");
      if (e.code === "pending") afficherAccueil();
    } else showStatus("Actualisation impossible : " + e.message);
  }
}

function startPolling() {
  if (timer) clearInterval(timer);
  if (CFG.REFRESH_SECONDS > 0) {
    timer = setInterval(() => { if (!document.hidden) refresh(); }, CFG.REFRESH_SECONDS * 1000);
  }
}
document.addEventListener("visibilitychange", () => { if (!document.hidden) refresh(); });

/* ---------- Interface générale ---------- */

// Étudiants de la vue : auteurs des fiches affichées, et (vue du groupe) tous les membres étudiants du groupe.
const students = () => {
  const m = new Map();
  const g = groupeCourant();
  if (g && ctx.vue !== "promo") g.membres.filter(x => x.role === "etudiant").forEach(x => m.set(x.prenom, { prenom: x.prenom, couleur: x.couleur, role: "etudiant" }));
  items.forEach(i => { if (!m.has(i.etudiant)) m.set(i.etudiant, { prenom: i.etudiant, couleur: i.couleur, role: "etudiant" }); });
  return [...m.values()].sort((a, b) => a.prenom.localeCompare(b.prenom, "fr"));
};

const ROLE_NOM = { etudiant: "Étudiant", formateur: "Formateur · lecture et commentaires", admin: "Administrateur" };

const themeSombre = () => (document.documentElement.dataset.theme || (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light")) === "dark";
function majLibelleTheme() { const b = $("themebtn"); if (b) b.textContent = themeSombre() ? "☀️ Mode clair" : "🌙 Mode sombre"; }
function basculerTheme() {
  const next = themeSombre() ? "light" : "dark";
  document.documentElement.dataset.theme = next;
  try { localStorage.setItem("lydia_theme", next); } catch (e) { /* ignoré */ }
  majLibelleTheme();
}

// En haut à droite : menu du compte (statut de connexion, thème, déconnexion).
function renderMe() {
  const init = esc(String(me.prenom || "?").trim().charAt(0).toUpperCase());
  $("me").innerHTML = `<details class="colmenu acct"><summary class="btn sm sec acctbtn" aria-label="Menu du compte : ${esc(me.prenom)}">
      <span class="avatar" style="--c:${esc(me.couleur)}">${init}</span><span class="acctname">${esc(me.prenom)}</span> ▾</summary>
    <div class="colpop right acctpop">
      <div class="acctwho"><span class="avatar big" style="--c:${esc(me.couleur)}">${init}</span><div><b>${esc(me.prenom)}</b><div class="meta">${esc(ROLE_NOM[me.role] || me.role)}</div></div></div>
      ${isSuper() && window.LydiaJeux ? `<div class="acctgrp"><div class="acctlabel">🎮 Pause ludique</div>${LydiaJeux.liste.map(j => `<button type="button" class="acctitem" data-jeu="${esc(j.id)}">${esc(j.titre)}</button>`).join("")}</div>` : ""}
      <div class="acctgrp"><div class="acctlabel">Affichage</div><button type="button" class="acctitem" id="themebtn"></button></div>
      <div class="acctgrp"><button type="button" class="acctitem danger" id="logout">⎋ Se déconnecter</button></div>
    </div></details>`;
  $("me").querySelectorAll("[data-jeu]").forEach(b => b.onclick = () => { b.closest("details").removeAttribute("open"); ouvrirJeu(b.dataset.jeu); });
  $("logout").onclick = logout;
  $("themebtn").onclick = basculerTheme;
  majLibelleTheme();
}

// Pause ludique (administrateur seulement pour l'instant) : un jeu dans une fenêtre, arrêté à la fermeture.
let jeuOuvert = false;
function ouvrirJeu(id) {
  if (!isSuper() || !window.LydiaJeux || !$("jeumodal")) return;
  const j = LydiaJeux.liste.find(x => x.id === id); if (!j) return;
  jeuOuvert = true;
  $("jeutitle").textContent = j.titre;
  $("jeumodal").classList.remove("hidden"); document.body.classList.add("modalopen");
  LydiaJeux.ouvrir(id, $("jeubody"));
}
function fermerJeu() {
  if (!jeuOuvert) return;
  jeuOuvert = false;
  LydiaJeux.fermer();
  $("jeubody").innerHTML = "";
  $("jeumodal").classList.add("hidden"); document.body.classList.remove("modalopen");
}
$("jeuclose")?.addEventListener("click", fermerJeu);
$("jeumodal")?.addEventListener("click", e => { if (e.target === $("jeumodal")) fermerJeu(); });

function renderMeAnonyme() {
  $("me").innerHTML = '<button type="button" class="btn sm sec" id="themebtn"></button>';
  $("themebtn").onclick = basculerTheme;
  majLibelleTheme();
}

// Pastille « N en ligne » avec la liste des prénoms. Reconstruite seulement si la liste change (sinon le menu ouvert se refermerait).
function renderOnline() {
  if (!me) return;
  const sig = JSON.stringify(enLigne);
  if (sig === enLigneSig && $("online").innerHTML) return;
  enLigneSig = sig;
  const role = { formateur: "formateur" };
  const lignes = enLigne.map(u => `<div class="olu"><span class="dot" style="background:${esc(u.couleur)}"></span><b>${esc(u.prenom)}</b>${u.moi ? ' <span class="meta">(vous)</span>' : role[u.role] ? ` <span class="meta">${role[u.role]}</span>` : ""}</div>`).join("");
  const n = enLigne.length;
  $("online").innerHTML = `<details class="colmenu"><summary class="btn sm sec" aria-label="${n} personne${n > 1 ? "s" : ""} en ligne"><span class="live" aria-hidden="true"></span> ${n} en ligne</summary>
    <div class="colpop right pop-online"><div class="meta" style="margin-bottom:6px">Actives ces dernières minutes</div>${lignes || '<div class="meta">Personne pour le moment.</div>'}</div></details>`;
}

function renderPending() {
  const el = $("pending");
  el.textContent = pendingCount || "";
  el.classList.toggle("hidden", !(canAdmin() && pendingCount));
}

const ONGLETS = ["all", "mine", "cmts", "suivi", "biblio", "synth", "admin"];
function setTab(t) {
  tab = t;
  document.querySelectorAll(".tab").forEach(b => {
    const on = b.dataset.t === t;
    b.classList.toggle("on", on);
    b.setAttribute("aria-selected", String(on));
  });
  ONGLETS.forEach(x => $(x).classList.toggle("hidden", t !== x));
  if (me) renderCtx();
  if (t === "admin" && canAdmin()) loadAdmin();
  if (t === "cmts") renderComments();
  if (t === "suivi") renderSuivi();
  majAlertes();
  if (t === "biblio") { renderBiblioTools(); renderBiblio(); }
  if (t === "synth") renderSynth();
}
document.querySelectorAll(".tab").forEach(b => b.onclick = () => setTab(b.dataset.t));

/* ---------- Suivi de projet : rétroplanning et réunions du groupe ---------- */

const STATUT_JALON = { a_faire: "À faire", en_cours: "En cours", fait: "Fait ✅" };
let suiviForm = null;   // { type: "jalon" | "reunion", id } pendant la saisie : on ne reconstruit pas le formulaire (actualisation automatique)

const aujourdhui = () => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), d.getDate()); };
const jourDe = iso => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || ""); return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null; };
const ecartJours = iso => { const d = jourDe(iso); return d ? Math.round((d - aujourdhui()) / 864e5) : null; };

const debutJalon = j => j.debut || j.echeance;
const estPlage = j => !!j.debut && j.debut !== j.echeance;
const fmtDatesJalon = j => estPlage(j) ? `du ${fmtD(j.debut)} au ${fmtD(j.echeance)}` : fmtD(j.echeance);
const pad2 = n => String(n).padStart(2, "0");
const isoJour = d => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;

function delaiJalon(j) {
  if (j.statut === "fait") return "";
  const fin = ecartJours(j.echeance);
  if (fin === null) return "";
  if (fin < 0) return `<span class="late">⚠ en retard de ${-fin} j</span>`;
  if (estPlage(j)) {
    const d = ecartJours(j.debut);
    if (d > 0) return `débute dans ${d} j`;
    return fin === 0 ? "<b>dernier jour</b>" : `en cours · fin dans ${fin} j`;
  }
  return fin === 0 ? "<b>aujourd’hui</b>" : `J-${fin}`;
}

// Alerte facultative : « retard » une fois la fin dépassée, « proche » à partir de N jours avant la première date.
function alerteJalon(j) {
  if (j.statut === "fait" || j.alerte_jours === "" || j.alerte_jours == null) return "";
  const fin = ecartJours(j.echeance), deb = ecartJours(debutJalon(j));
  if (fin === null || deb === null) return "";
  if (fin < 0) return "retard";
  return deb <= +j.alerte_jours ? "proche" : "";
}
// Les alertes ne concernent que mes groupes (l'administrateur, qui voit tout, n'en reçoit pas pour les groupes des autres).
const mesGroupesIds = () => new Set(groupes.filter(g => (g.membres || []).some(m => m.moi)).map(g => g.id));
const alertesJalons = () => jalonsAll.filter(j => mesGroupesIds().has(j.groupe_id) && alerteJalon(j)).sort((a, b) => debutJalon(a).localeCompare(debutJalon(b)));
let alertesMasquees = false;   // le temps de la session
function majAlertes() {
  const zone = $("alertes"), nb = $("alertnb");
  if (!zone || !nb) return;   // page plus ancienne que le script (cache) : pas d'alertes
  const l = alertesJalons(); nb.textContent = l.length; nb.classList.toggle("hidden", !l.length);
  const montrer = l.length && !alertesMasquees && tab !== "suivi" && !!me;
  zone.classList.toggle("hidden", !montrer);
  if (!montrer) { zone.innerHTML = ""; return; }
  const nomG = j => groupes.length > 1 ? ` <span class="meta">(${esc((groupes.find(g => g.id === j.groupe_id) || {}).nom || "")})</span>` : "";
  zone.innerHTML = `<b>⏰ Rétroplanning</b> · ${l.slice(0, 3).map(j => `<span class="${alerteJalon(j) === "retard" ? "late" : ""}"><b>${esc(j.titre)}</b>${nomG(j)} ${esc(fmtDatesJalon(j))} ${delaiJalon(j)}</span>`).join(" · ")}${l.length > 3 ? ` · +${l.length - 3} autre${l.length > 4 ? "s" : ""}` : ""}
    <button type="button" class="btn sm" data-alerte="voir">Voir le calendrier</button> <button type="button" class="btn sm sec" data-alerte="masquer">Masquer</button>`;
}
$("alertes")?.addEventListener("click", e => {
  const b = e.target.closest("button"); if (!b) return;
  if (b.dataset.alerte === "masquer") { alertesMasquees = true; majAlertes(); } else setTab("suivi");
});

// Calendrier mensuel : jalons (date fixe ou plage sur plusieurs jours) et réunions du groupe.
let calMois = null;
function calendrier(jal, reu) {
  const t = aujourdhui();
  if (!calMois) calMois = { a: t.getFullYear(), m: t.getMonth() };
  const decal = (new Date(calMois.a, calMois.m, 1).getDay() + 6) % 7;          // semaine commençant le lundi
  const nbSem = Math.ceil((decal + new Date(calMois.a, calMois.m + 1, 0).getDate()) / 7), auj = isoJour(t);
  const titre = new Date(calMois.a, calMois.m, 1).toLocaleDateString("fr-FR", { month: "long", year: "numeric" });
  let cases = "";
  for (let n = 0; n < nbSem * 7; n++) {
    const jour = new Date(calMois.a, calMois.m, 1 - decal + n), cle = isoJour(jour);
    const elems = jal.filter(j => debutJalon(j) <= cle && cle <= j.echeance).map(j => {
      const pos = !estPlage(j) ? "" : cle === debutJalon(j) ? "deb" : cle === j.echeance ? "fin" : "mid";
      const txt = !estPlage(j) || pos === "deb" || n % 7 === 0 ? esc(j.titre) : "&nbsp;";
      const cl = `calj ${esc(j.statut)} ${pos} ${j.statut !== "fait" && ecartJours(j.echeance) < 0 ? "retard" : ""} ${alerteJalon(j) ? "alerte" : ""}`;
      const tip = `${j.titre} · ${fmtDatesJalon(j)} · ${STATUT_JALON[j.statut] || j.statut}`;
      return j.modifiable ? `<button type="button" class="${cl}" data-jed="${esc(j.id)}" title="${esc(tip)}">${txt}</button>` : `<span class="${cl}" title="${esc(tip)}">${txt}</span>`;
    }).concat(reu.filter(r => r.date === cle).map(r => `<span class="calj reu" title="${esc("Réunion · " + (r.titre || ""))}">💬 ${esc(r.titre || "Réunion")}</span>`));
    cases += `<div class="calc ${jour.getMonth() !== calMois.m ? "hors" : ""} ${cle === auj ? "auj" : ""}"><div class="calnum">${jour.getDate()}</div>${elems.slice(0, 3).join("")}${elems.length > 3 ? `<span class="meta" title="${elems.length} éléments ce jour-là">+${elems.length - 3}</span>` : ""}</div>`;
  }
  return `<div class="calendrier"><div class="tools" style="justify-content:space-between;margin:8px 0"><b style="text-transform:capitalize">${esc(titre)}</b>
    <div><button type="button" class="btn sm sec" data-cal="-1" aria-label="Mois précédent">◀</button> <button type="button" class="btn sm sec" data-cal="0">Aujourd’hui</button> <button type="button" class="btn sm sec" data-cal="1" aria-label="Mois suivant">▶</button></div></div>
    <div class="calgrille" role="grid" aria-label="Calendrier des échéances">${["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"].map(x => `<div class="calh">${x}</div>`).join("")}${cases}</div>
    <div class="meta" style="margin-top:4px">Date fixe ou plage · rouge : échéance dépassée · contour orange : alerte · 💬 réunion du groupe</div></div>`;
}

function frise(l) {
  if (l.length < 1) return "";
  const t0 = aujourdhui().getTime();
  const dates = l.map(j => jourDe(j.echeance).getTime()).concat([t0]);
  const min = Math.min(...dates), max = Math.max(...dates), span = Math.max(max - min, 864e5);
  const pos = t => `${(5 + 90 * (t - min) / span).toFixed(1)}%`;
  return `<div class="frise" role="img" aria-label="Frise des jalons"><div class="fligne"></div>
   <div class="faujourdhui" style="left:${pos(t0)}" title="Aujourd’hui"><span>aujourd’hui</span></div>
   ${l.map(j => `<div class="fjalon ${esc(j.statut)} ${j.statut !== "fait" && ecartJours(j.echeance) < 0 ? "retard" : ""}" style="left:${pos(jourDe(j.echeance).getTime())}" title="${esc(j.titre)} · ${esc(fmtDatesJalon(j))}"><span>${esc(j.titre)}<br>${esc(fmtD(j.echeance))}</span></div>`).join("")}</div>`;
}

function renderSuivi() {
  const g = groupeCourant();
  if (!g) { $("retro").innerHTML = ""; $("reunions").innerHTML = ""; return; }
  const ecrit = canWrite() && groupes.some(x => x.id === g.id);
  $("addjalon").classList.toggle("hidden", !ecrit);
  $("addreunion").classList.toggle("hidden", !ecrit);
  const jal = jalonsAll.filter(j => j.groupe_id === g.id).sort((a, b) => debutJalon(a).localeCompare(debutJalon(b)) || a.echeance.localeCompare(b.echeance));
  const fait = jal.filter(j => j.statut === "fait").length;
  $("retro").innerHTML = jal.length
    ? `<div class="meta" style="margin:8px 0">Groupe <b>${esc(g.nom)}</b> · ${fait} jalon${fait > 1 ? "s" : ""} fait${fait > 1 ? "s" : ""} sur ${jal.length}</div>
       <div class="barre" aria-hidden="true"><i style="width:${Math.round(100 * fait / jal.length)}%"></i></div>${calendrier(jal, reunionsAll.filter(x => x.groupe_id === g.id))}${frise(jal)}
       <div class="jalons">${jal.map(j => `<div class="jalon ${esc(j.statut)} ${alerteJalon(j)}"><div><span class="badge ${j.statut === "fait" ? "" : "prog"}">${esc(STATUT_JALON[j.statut] || j.statut)}</span> <b>${esc(j.titre)}</b>
         <span class="meta">· ${esc(fmtDatesJalon(j))} ${delaiJalon(j)}${j.alerte_jours !== "" && j.alerte_jours != null && j.statut !== "fait" ? ` · <span title="Alerte dans l’outil">🔔 ${+j.alerte_jours ? j.alerte_jours + " j avant" : "le jour même"}</span>` : ""}</span>${j.note ? `<div class="meta">${esc(j.note)}</div>` : ""}</div>
         ${j.modifiable ? `<div><button type="button" class="btn sm sec" data-jed="${esc(j.id)}">Modifier</button> <button type="button" class="btn sm sec del" data-jdel="${esc(j.id)}">Supprimer</button></div>` : ""}</div>`).join("")}</div>`
    : `<div class="empty">Aucun jalon pour l’instant.${ecrit ? " Ajoutez les grandes étapes (plan, première version, dépôt…) avec leur échéance." : ""}</div>`;
  const reu = reunionsAll.filter(x => x.groupe_id === g.id).sort((a, b) => b.date.localeCompare(a.date));
  const sect = (t, v) => String(v || "").trim() ? `<div class="sect"><b>${t}</b><div style="white-space:pre-wrap">${esc(v)}</div></div>` : "";
  $("reunions").innerHTML = reu.length ? reu.map(x => `<article class="cardc reunion"><div class="tools" style="justify-content:space-between"><h3 style="margin:0">${esc(fmtD(x.date))}${x.titre ? " · " + esc(x.titre) : ""}</h3>
    ${x.modifiable ? `<div><button type="button" class="btn sm sec" data-red="${esc(x.id)}">Modifier</button> <button type="button" class="btn sm sec del" data-rdel="${esc(x.id)}">Supprimer</button></div>` : ""}</div>
    <div class="meta">${x.participants ? "Participants : " + esc(x.participants) + " · " : ""}saisi par ${esc(x.par)}${x.modifie_par ? ` · modifié par ${esc(x.modifie_par)}` : ""}</div>
    ${sect("Ce qui a été vu", x.vu)}${sect("Ce qui est attendu", x.attendu)}${sect("Étapes pour la suite", x.suite)}</article>`).join("")
    : `<div class="empty">Aucun compte rendu pour l’instant.</div>`;
}

function ouvrirSuiviForm(type, id) {
  suiviForm = { type, id: id || "" };
  const g = groupeCourant();
  if (type === "jalon") {
    const j = jalonsAll.find(x => x.id === id) || { statut: "a_faire" };
    const plage = estPlage(j), al = j.alerte_jours == null ? "" : String(j.alerte_jours);
    const ALERTES = [["", "Aucune"], ["0", "Le jour même"], ["1", "1 jour avant"], ["3", "3 jours avant"], ["7", "1 semaine avant"], ["14", "2 semaines avant"], ["30", "1 mois avant"]];
    if (!ALERTES.some(a => a[0] === al)) ALERTES.push([al, al + " jours avant"]);
    $("jalonform").innerHTML = `<div class="sec" style="margin:10px 0"><div class="grid">
      <div><label for="j_titre">Jalon</label><input id="j_titre" maxlength="200" value="${esc(j.titre)}" placeholder="ex. Plan détaillé validé"></div>
      <div><label for="j_mode">Type de date</label><select id="j_mode"><option value="fixe" ${plage ? "" : "selected"}>Date fixe</option><option value="plage" ${plage ? "selected" : ""}>Plage de dates</option></select></div>
      <div id="j_debutw" class="${plage ? "" : "hidden"}"><label for="j_debut">Du</label><input id="j_debut" type="date" value="${esc(plage ? j.debut : "")}"></div>
      <div><label for="j_echeance" id="j_echlab">${plage ? "Au" : "Date"}</label><input id="j_echeance" type="date" value="${esc(j.echeance)}"></div>
      <div><label for="j_alerte">Alerte dans l’outil (facultative)</label><select id="j_alerte">${ALERTES.map(a => `<option value="${esc(a[0])}" ${a[0] === al ? "selected" : ""}>${esc(a[1])}</option>`).join("")}</select></div>
      <div><label for="j_statut">Statut</label><select id="j_statut">${Object.keys(STATUT_JALON).map(k => `<option value="${k}" ${j.statut === k ? "selected" : ""}>${esc(STATUT_JALON[k])}</option>`).join("")}</select></div>
      <div><label for="j_note">Note</label><input id="j_note" maxlength="500" value="${esc(j.note)}"></div></div>
      <div class="meta">L’alerte s’affiche à tous les membres du groupe, à partir du nombre de jours choisi avant la première date (le début, pour une plage), tant que le jalon n’est pas « Fait ».</div>
      <div class="savebar"><div id="jerr" class="err" role="alert"></div><button class="btn" id="jsave" type="button">Enregistrer le jalon</button> <button class="btn sec" id="jcancel" type="button">Annuler</button></div></div>`;
    $("j_mode").onchange = () => { const p = $("j_mode").value === "plage"; $("j_debutw").classList.toggle("hidden", !p); $("j_echlab").textContent = p ? "Au" : "Date"; };
    $("jsave").onclick = () => {
      const p = $("j_mode").value === "plage";
      if (p && !$("j_debut").value) { $("jerr").textContent = "Indiquez la date de début de la plage."; return; }
      if (p && $("j_echeance").value && $("j_debut").value > $("j_echeance").value) { $("jerr").textContent = "La date de début doit précéder la date de fin."; return; }
      enregistrerSuivi("jalon", g.id, id, { titre: $("j_titre").value, echeance: $("j_echeance").value, debut: p ? $("j_debut").value : "", alerte_jours: $("j_alerte").value, statut: $("j_statut").value, note: $("j_note").value }, "jerr");
    };
    $("jcancel").onclick = () => fermerSuiviForm();
    $("j_titre").focus();
  } else {
    const x = reunionsAll.find(r => r.id === id) || { date: stamp() };
    $("reunionform").innerHTML = `<div class="sec" style="margin:10px 0"><div class="grid">
      <div><label for="r_date">Date</label><input id="r_date" type="date" value="${esc(x.date)}"></div>
      <div><label for="r_titre">Titre</label><input id="r_titre" maxlength="200" value="${esc(x.titre)}" placeholder="ex. Point avec la formatrice"></div>
      <div><label for="r_participants">Participants</label><input id="r_participants" maxlength="500" value="${esc(x.participants)}"></div></div>
      <div class="grid"><div><label for="r_vu">Ce qui a été vu</label><textarea id="r_vu" maxlength="2500">${esc(x.vu)}</textarea></div>
      <div><label for="r_attendu">Ce qui est attendu</label><textarea id="r_attendu" maxlength="2500">${esc(x.attendu)}</textarea></div>
      <div><label for="r_suite">Étapes pour la suite</label><textarea id="r_suite" maxlength="2500">${esc(x.suite)}</textarea></div></div>
      <div class="savebar"><div id="rerr" class="err" role="alert"></div><button class="btn" id="rsave" type="button">Enregistrer le compte rendu</button> <button class="btn sec" id="rcancel" type="button">Annuler</button></div></div>`;
    $("rsave").onclick = () => enregistrerSuivi("reunion", g.id, id, Object.fromEntries(["date", "titre", "participants", "vu", "attendu", "suite"].map(k => [k, $("r_" + k).value])), "rerr");
    $("rcancel").onclick = () => fermerSuiviForm();
    $("r_vu").focus();
  }
}

function fermerSuiviForm() { suiviForm = null; $("jalonform").innerHTML = ""; $("reunionform").innerHTML = ""; }

async function enregistrerSuivi(type, gid, id, data, errId) {
  try {
    const res = await enCours("Enregistrement…", () => api(type + "_save", { groupe_id: gid, id: id || undefined, data }));
    fermerSuiviForm();
    applyResult(res);
  } catch (e) {
    if (e.code === "unauthorized") sessionError(e); else $(errId).textContent = "Enregistrement impossible : " + e.message;
  }
}

async function supprimerSuivi(type, id) {
  if (!confirm(type === "jalon" ? "Supprimer ce jalon ?" : "Supprimer ce compte rendu ?")) return;
  try { applyResult(await enCours("Suppression…", () => api(type + "_delete", { id }))); }
  catch (e) { if (e.code === "unauthorized") sessionError(e); else alert("Suppression impossible : " + e.message); }
}

$("addjalon").onclick = () => { fermerSuiviForm(); ouvrirSuiviForm("jalon"); };
$("addreunion").onclick = () => { fermerSuiviForm(); ouvrirSuiviForm("reunion"); };
$("suivi").addEventListener("click", e => {
  const b = e.target.closest("button");
  if (!b) return;
  const d = b.dataset;
  if (d.cal !== undefined) { const t = aujourdhui(); if (d.cal === "0") calMois = { a: t.getFullYear(), m: t.getMonth() }; else { const n = new Date(calMois.a, calMois.m + +d.cal, 1); calMois = { a: n.getFullYear(), m: n.getMonth() }; } renderSuivi(); }
  else if (d.jed) { fermerSuiviForm(); ouvrirSuiviForm("jalon", d.jed); }
  else if (d.red) { fermerSuiviForm(); ouvrirSuiviForm("reunion", d.red); }
  else if (d.jdel) supprimerSuivi("jalon", d.jdel);
  else if (d.rdel) supprimerSuivi("reunion", d.rdel);
});

/* ---------- Mes lectures ---------- */

const cleTitre = s => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
// Plusieurs métiers possibles dans « Qualité de l’auteur » : virgule, point-virgule, « / », « & », « + », « et » ou retour à la ligne.
// Un même métier écrit deux fois pour une lecture (casse, accents) n'est compté qu'une fois.
const metiersListe = txt => {
  const vus = new Set();
  return String(txt || "").split(/\s*(?:[,;\n/&+]|\s+et\s+)\s*/i).map(x => x.trim()).filter(x => {
    const k = cleTitre(x);
    if (!k || vus.has(k)) return false;
    vus.add(k); return true;
  });
};
const motsListe = txt => String(txt || "").split(/[,;\n]+/).map(x => x.trim()).filter(Boolean);
let forceStatut = "", focusAvant = null, scrollAvant = 0;

function field(id, label, val, opts = {}) {
  const req = opts.req ? '<span class="req"> *</span>' : "";
  if (opts.area) return `<div><label for="${id}">${label}</label><textarea id="${id}" maxlength="2500">${esc(val)}</textarea></div>`;
  if (opts.sel) return `<div><label for="${id}">${label}${req}</label><select id="${id}" ${opts.dis || ""}><option value="">— choisir —</option>${opts.sel.map(o => `<option ${o === val ? "selected" : ""}>${esc(o)}</option>`).join("")}</select></div>`;
  return `<div><label for="${id}">${label}${req}</label><input id="${id}" type="${opts.type || "text"}" maxlength="500" value="${esc(val)}" ${opts.dis || ""} ${opts.ph ? `placeholder="${opts.ph}"` : ""}></div>`;
}

function renderForm() {
  if (!canWrite()) return;
  const d = editing ? itemsAll.find(i => i.id === editing) || {} : {};
  const art = artCible || modeArticle ? itemsAll.find(i => i.article_id === (artCible || modeArticle)) : null;
  const base = editing ? d : art || {};
  const gc = groupeCourant();
  const objDesact = k => artCible && String(art && art[k] || "").trim() ? "disabled" : "";
  $("ftitle").textContent = modeArticle ? "Corriger l’article" : artCible ? "Ajouter ma fiche de lecture" : editing ? "Modifier ma fiche de lecture" : "Ajouter une lecture";
  $("fnote").textContent = modeArticle
    ? "La partie objective (identification, références) est commune à toute la promo : votre correction sera proposée, puis appliquée quand 3 étudiants de la promo l’auront approuvée (vous comptez pour un)."
    : artCible
      ? "Cet article existe déjà dans la base de la promo : sa partie objective est commune. Ajoutez votre propre fiche de lecture (colonnes 2 à 8) ; elle sera partagée avec la promo dès qu’elle sera « Terminée »."
      : forceStatut
      ? "Pour passer cette lecture à « Terminée », complétez d’abord les champs obligatoires de la première partie."
      : "Choisissez « 📖 En cours de lecture » si vous n’avez pas fini : seul le titre est alors obligatoire. Pour une lecture « ✅ Terminée », toute la première partie est obligatoire.";
  const statut = forceStatut || (editing ? d.statut : "") || "Terminée";
  $("form").innerHTML = `
  <div id="draftnote" class="meta" style="display:none;margin-bottom:10px"></div>
  <details class="sec" open><summary>Colonne 1 · Identification de l’article <span class="req" style="color:#d33">(obligatoire)</span></summary>
   <div style="margin-bottom:12px;${modeArticle ? "display:none" : ""}"><label for="f_statut">Statut</label><select id="f_statut">
     <option value="Terminée" ${statut === "Terminée" ? "selected" : ""}>✅ Terminée</option>
     <option value="En cours" ${statut === "En cours" ? "selected" : ""}>📖 En cours de lecture</option></select></div>
   <div class="grid">
    ${field("f_titre", "Titre de l’article", base.titre, { dis: objDesact("titre"), req: 1 })}
    ${field("f_parution", "Date de parution", fmtD(base.parution), { dis: objDesact("parution"), req: 1, ph: "2021, mars 2021 ou 04/03/2021" })}
    ${field("f_auteur", "Auteur(s)", base.auteur, { dis: objDesact("auteur"), req: 1, ph: "Nom, Prénom ; Nom, Prénom" })}
    ${field("f_qualite", "Qualité de l’auteur", base.qualite, { dis: objDesact("qualite"), req: 1, ph: "chercheur, IDE, cadre de santé… (séparer par une virgule s’il y en a plusieurs)" })}
    ${field("f_nation", "Nationalité", base.nation, { dis: objDesact("nation"), req: 1 })}
    ${field("f_type", "Type d’article", base.type, { dis: objDesact("type"), req: 1, sel: TYPES })}
   </div>
   <div id="dup" style="display:none;margin-top:10px;color:#b45309;font-weight:600"></div></details>
  ${modeArticle ? "" : `<details class="sec" open><summary>Partage</summary>
   <div class="meta">Cette fiche de lecture est rattachée au groupe <b>${esc(editing ? (d.groupe || "") : gc ? gc.nom : "")}</b>. <b>En cours</b> : seul votre groupe la voit. <b>Terminée</b> : elle est partagée automatiquement avec toute la promo, qui peut la commenter ; les commentaires du groupe restent réservés au groupe.</div>
  </details>`}
  <details class="sec" open><summary>Compléments pour la référence APA (facultatifs, mais recommandés pour les articles)</summary>
   <div class="grid">
    ${field("f_source", "Revue / éditeur / établissement", base.source, { dis: objDesact("source"), ph: "revue de l’article, éditeur du rapport, université de la thèse" })}
    ${field("f_volume", "Volume", d.volume)}
    ${field("f_numero", "Numéro", d.numero)}
    ${field("f_pages", "Pages", base.pages, { dis: objDesact("pages"), ph: "ex. 12-25" })}
    ${field("f_doi", "DOI ou URL", base.doi, { dis: objDesact("doi"), ph: "10.xxxx/xxxxx ou https://…" })}
    ${field("f_lien", "Lien vers la fiche ou l’article", base.lien, { dis: objDesact("lien"), ph: "https://… (cliquable dans le tableau commun)" })}
   </div>
   <div id="apaprev" class="meta" style="margin-top:12px;padding:10px 12px;border:1px dashed var(--bd);border-radius:8px"></div>
  </details>
  ${(formFich = !modeArticle && (editing ? d.mine : true) ? { k: editing ? d.article_id : artCible || "", differe: !editing } : null) ? `<details class="sec" open><summary>Document joint (facultatif)</summary><div id="fichform">${fichiersFormHtml()}</div></details>` : ""}
  ${modeArticle ? "" : `<details class="sec" open><summary>Colonnes 2 à 8 · Libres (à remplir comme vous voulez, modifiable à tout moment)</summary>
   <div class="grid">
    ${field("f_mots", "Mots-clés", d.mots, { area: 1 })}
    <div><label for="f_kw">Mots-clés en anglais</label><textarea id="f_kw" maxlength="2500">${esc(d.kw)}</textarea>
     <div class="tr"><button type="button" class="btn sm sec" id="trad">🌐 Traduire les mots-clés français</button><span id="tradmsg" class="meta"></span></div>
     <div id="tradres" aria-live="polite"></div></div>
    ${field("f_concepts", "Concepts en sciences infirmières développés", d.concepts, { area: 1 })}
    ${field("f_objet", "Objet / sujet principal du texte", d.objet, { area: 1 })}
    ${field("f_opinion", "Opinion de l’auteur", d.opinion, { area: 1 })}
    ${field("f_controverse", "Controverse", d.controverse, { area: 1 })}
    ${field("f_libre", "Colonne libre", d.libre, { area: 1 })}
   </div></details>`}
  <div class="savebar"><div id="ferr" class="err" role="alert"></div>
   <button class="btn" id="save" type="button">${modeArticle ? "Proposer la correction" : editing ? "Enregistrer les modifications" : artCible ? "Enregistrer ma fiche de lecture" : "Enregistrer la lecture"}</button>
   <button class="btn sec" id="cancel" type="button">Annuler</button></div>`;
  $("save").onclick = save;
  $("trad").onclick = traduire;
  $("cancel").onclick = () => { effacerBrouillon(); closeDrawer(true); };
  formBase = JSON.stringify(snapshot());
  restaurerBrouillon();
  $("form").oninput = $("form").onchange = surSaisie;
  $("form").onclick = e => {
    const b = e.target.closest("[data-fu],[data-fo],[data-fx],[data-fr]"); if (!b) return;
    if (b.dataset.fr) { fichierAttente = null; majFichiersForm(); } else if (b.dataset.fu) choisirFichier(b.dataset.fu); else if (b.dataset.fo) ouvrirFichier(b.dataset.fo); else supprimerFichierCli(b.dataset.fx);
  };
  majApercu(); majDoublon();
}

function openForm() {
  if (!canWrite()) return;
  focusAvant = document.activeElement;
  scrollAvant = window.scrollY;
  fichierAttente = null;
  renderForm();
  $("drawer").classList.remove("hidden");
  document.body.classList.add("formmode");          // page à part : le reste de l'interface est masqué
  window.scrollTo(0, 0);
  const f = $("f_titre"); if (f) f.focus();
}

function closeDrawer(sansBrouillon) {
  if ($("drawer").classList.contains("hidden")) return;
  if (!sansBrouillon && $("f_titre")) { clearTimeout(brouillonTimer); sauverBrouillon(); }
  $("drawer").classList.add("hidden");
  document.body.classList.remove("formmode");
  editing = null; artCible = ""; modeArticle = false; forceStatut = ""; fichierAttente = null; formFich = null;
  window.scrollTo(0, scrollAvant);
  if (focusAvant && focusAvant.focus) { try { focusAvant.focus({ preventScroll: true }); } catch (e) { /* ignoré */ } }
}
$("drawerclose").onclick = () => closeDrawer();
document.addEventListener("keydown", e => {
  if (e.key !== "Escape") return;
  const ouvert = document.querySelector("details.colmenu[open]");
  if (ouvert) ouvert.removeAttribute("open"); else if (jeuOuvert) fermerJeu(); else if (FB.ouvert) fermerFeedback(); else if (cmId) fermerDiscussion(); else if (GM.ouvert) fermerGroupe(); else closeDrawer();
});
$("addbtn").onclick = () => { editing = null; artCible = ""; modeArticle = false; forceStatut = ""; openForm(); };

/* ---------- Traduction des mots-clés ---------- */

const ICONE_FIAB = { haute: "🟢", moyenne: "🟠", faible: "🔴" };
const LIBELLE_FIAB = { haute: "fiable", moyenne: "à vérifier", faible: "douteux" };

async function traduire() {
  const msg = $("tradmsg");
  const src = $("f_mots").value.trim();
  if (!src) { msg.textContent = "Saisissez d’abord les mots-clés en français."; return; }
  if ($("f_kw").value.trim() && !confirm("Le champ anglais contient déjà du texte. Le remplacer par la traduction ?")) return;
  $("trad").disabled = true;
  msg.textContent = "⏳ Traduction…";
  try {
    const r = await api("translate", { texte: src });
    $("f_kw").value = r.items.map(i => i.en).filter(Boolean).join(", ");
    $("tradres").innerHTML = r.items.map(i =>
      `<span class="fiab fiab-${esc(i.niveau)}" title="${esc(i.raison)}">${ICONE_FIAB[i.niveau] || ""} ${esc(i.fr)} → ${esc(i.en)} <span class="meta">(${LIBELLE_FIAB[i.niveau] || ""})</span></span>`).join("")
      + '<div class="legende">🟢 fiable · 🟠 à vérifier · 🔴 douteux. Indice automatique fondé sur le glossaire et sur la retraduction en français : ce n’est pas une garantie, relisez les termes importants (survolez une pastille pour le détail).</div>';
    msg.textContent = "";
    planifierBrouillon();
  } catch (e) {
    if (e.code === "unauthorized") sessionError(e);
    msg.textContent = "Traduction impossible : " + e.message;
  } finally { if ($("trad")) $("trad").disabled = false; }
}

/* ---------- Aperçu APA, doublons, brouillon ---------- */

const CHAMPS_FORM = ["statut", "titre", "parution", "auteur", "qualite", "nation", "type", "source", "volume", "numero",
  "pages", "doi", "lien", "mots", "kw", "concepts", "objet", "opinion", "controverse", "libre"];
let formBase = "", brouillonTimer = null;

const snapshot = () => Object.fromEntries(CHAMPS_FORM.map(k => [k, $("f_" + k) ? $("f_" + k).value : ""]));

function lireForm() {
  const v = snapshot();
  Object.keys(v).forEach(k => { v[k] = v[k].trim(); });
  // « www.exemple.fr/page » collé sans le début : on ajoute https://
  if (v.lien && !/^[a-z][a-z0-9+.-]*:/i.test(v.lien) && /^[^\s/]+\.[^\s/]{2,}(\/\S*)?$/.test(v.lien)) v.lien = "https://" + v.lien;
  const norm = LydiaApa.normaliserDate(v.parution);
  return { data: { ...v, parution: norm === null ? v.parution : norm }, dateOk: norm !== null };
}

function majApercu() {
  const box = $("apaprev");
  if (!box) return;
  const { data, dateOk } = lireForm();
  if (!data.titre) { box.innerHTML = "📚 La référence APA apparaîtra ici au fil de la saisie."; return; }
  const r = LydiaApa.apa(data);
  box.innerHTML = `<b>Aperçu APA</b><br><span style="color:var(--tx)">${r.html}</span>`
    + (data.parution && !dateOk ? '<br><span style="color:#b45309">⚠ Date non reconnue (ex. 2021, mars 2021, 04/03/2021)</span>' : "")
    + (r.incomplet ? '<br>⚠ À compléter : revue et pages' : "")
    + (!data.auteur ? '<br>⚠ Sans auteur, le titre passe en tête de la référence' : "");
}

const cleDoi = s => {
  const t = String(s || "").trim().toLowerCase().replace(/^doi:\s*/, "").replace(/^https?:\/\/(dx\.)?doi\.org\//, "");
  return /^10\.\d{4,9}\//.test(t) ? t : "";
};

function majDoublon() {
  const box = $("dup");
  if (!box) return;
  const { data } = lireForm();
  const t = cleTitre(data.titre), d = cleDoi(data.doi);
  const cur = editing ? (itemsAll.find(i => i.id === editing) || {}).article_id : artCible || modeArticle;
  const autre = (t.length >= 8 || d) ? itemsAll.find(i => i.article_id !== cur && ((d && cleDoi(i.doi) === d) || (t.length >= 8 && cleTitre(i.titre) === t))) : null;
  if (!autre) { box.style.display = "none"; return; }
  const peutAjouter = !editing && !artCible && !modeArticle && !autre.mine && autre.article_modifiable
    && !itemsAll.some(i => i.mine && i.article_id === autre.article_id);
  box.innerHTML = autre.mine
    ? "⚠ Vous avez déjà saisi cet article : modifiez plutôt votre fiche de lecture."
    : `⚠ Cet article est déjà dans la base de la promo (déjà analysé par ${esc(autre.etudiant)}).`
      + (peutAjouter ? ' <button type="button" class="btn sm" id="dupuse">Ajouter ma fiche de lecture à cet article</button>' : "");
  box.style.display = "block";
  if ($("dupuse")) $("dupuse").onclick = () => basculerAnalyse(autre.article_id);
}

const cleBrouillon = () => "lydia_brouillon:" + (me ? me.prenom : "") + ":" + (editing || (modeArticle ? "art:" + modeArticle : artCible ? "an:" + artCible : "new"));
function effacerBrouillon() { clearTimeout(brouillonTimer); try { localStorage.removeItem(cleBrouillon()); } catch (e) { /* ignoré */ } }

function sauverBrouillon() {
  try {
    const cur = JSON.stringify(snapshot());
    if (cur === formBase) localStorage.removeItem(cleBrouillon());
    else localStorage.setItem(cleBrouillon(), JSON.stringify({ t: Date.now(), v: snapshot() }));
  } catch (e) { /* stockage indisponible : le brouillon est simplement désactivé */ }
}

function planifierBrouillon() { clearTimeout(brouillonTimer); brouillonTimer = setTimeout(sauverBrouillon, 600); }

function restaurerBrouillon() {
  let b = null;
  try { b = JSON.parse(localStorage.getItem(cleBrouillon()) || "null"); } catch (e) { b = null; }
  if (!b || !b.v || Date.now() - b.t > 30 * 864e5) return;
  CHAMPS_FORM.forEach(k => { if ($("f_" + k) && !$("f_" + k).disabled && b.v[k] !== undefined) $("f_" + k).value = b.v[k]; });
  const note = $("draftnote");
  note.innerHTML = `📝 Brouillon non enregistré restauré (${esc(fmtDT(new Date(b.t).toISOString()))}). <button type="button" class="btn sm sec" id="draftreset">Repartir de zéro</button>`;
  note.style.display = "block";
  $("draftreset").onclick = () => { effacerBrouillon(); renderForm(); };
}

function surSaisie(e) {
  if (e && e.target && e.target.id === "f_kw" && $("tradres")) $("tradres").innerHTML = "";   // les pastilles ne décrivent plus le texte
  majApercu(); majDoublon();
  planifierBrouillon();
}

// Bascule le formulaire de « nouvel article » vers « ma fiche de lecture sur cet article », en gardant ce qui est déjà saisi.
function basculerAnalyse(articleId) {
  const garde = snapshot();
  effacerBrouillon();
  artCible = articleId;
  renderForm();
  ["statut", "mots", "kw", "concepts", "objet", "opinion", "controverse", "libre"].forEach(k => { if ($("f_" + k) && garde[k]) $("f_" + k).value = garde[k]; });
  majApercu(); majDoublon();
}

const OBJ = ["titre", "parution", "auteur", "qualite", "nation", "type", "source", "volume", "numero", "pages", "doi", "lien"];

async function save() {
  clearTimeout(brouillonTimer);
  const { data, dateOk } = lireForm();
  if (!dateOk) { $("ferr").textContent = "Date de parution non reconnue (exemples : 2021, mars 2021, 04/03/2021)"; return; }
  const orig = editing ? itemsAll.find(i => i.id === editing) : null;
  const need = (modeArticle ? itemsAll.some(i => i.article_id === modeArticle && i.statut === "Terminée") ? FIN : ["titre"]
    : data.statut === "En cours" ? ["titre"] : FIN);
  const miss = need.filter(k => !data[k]);
  if (miss.length) { $("ferr").textContent = "À compléter : " + miss.map(k => LAB[k]).join(", "); return; }
  $("save").disabled = true;
  try {
    const artId = modeArticle || (orig && orig.article_id);
    const objChange = !!artId && OBJ.some(k => String(((orig || itemsAll.find(i => i.article_id === artId)) || {})[k] || "") !== data[k]);
    const jointe = !editing && !modeArticle ? fichierAttente : null, avant = new Set(itemsAll.map(i => i.id));
    const res = await enCours("Enregistrement…", () => modeArticle
      ? api("article_update", { article_id: modeArticle, data: Object.fromEntries(OBJ.map(k => [k, data[k]])) })
      : editing
        ? api("update", { id: editing, data })
        : artCible
          ? api("add", { data: { ...data, article_id: artCible } })
          : api("add", { data: { ...data, groupe_id: (groupeCourant() || {}).id } }));
    effacerBrouillon();
    closeDrawer(true);
    applyResult(res);
    if (jointe) await joindreApresCreation(res, jointe, avant);
    if (objChange && (res.propositions || []).some(p => p.mine && p.article_id === artId)) {
      alert("Votre correction de l’article est proposée à la promo : elle sera appliquée quand 3 étudiants (vous compris) l’auront approuvée.");
    }
  } catch (e) {
    $("ferr").textContent = "Enregistrement impossible : " + e.message;
    if (e.code === "duplicate" && e.extra && e.extra.article_id) {
      $("ferr").innerHTML = esc(e.message) + ' <button type="button" class="btn sm" id="dupgo">Ajouter ma fiche de lecture à cet article</button>';
      $("dupgo").onclick = () => basculerAnalyse(e.extra.article_id);
    }
    if (e.code === "unauthorized") sessionError(e);
    $("save").disabled = false;
  }
}

// Envoie le fichier choisi pendant la création, maintenant que la fiche (donc son article) existe.
async function joindreApresCreation(res, jointe, avant) {
  const nouvelle = (res.lectures || []).find(l => l.mine && !avant.has(l.id));
  if (!nouvelle) return alert("Fiche enregistrée, mais le fichier n’a pas pu être joint : rouvrez la fiche pour l’ajouter.");
  try { applyResult(await enCours("Envoi du fichier…", () => api("file_add", { article_id: nouvelle.article_id, nom: jointe.nom, data: jointe.data }))); }
  catch (e) {
    if (e.code === "unauthorized") return sessionError(e);
    alert("Fiche enregistrée, mais le fichier n’a pas pu être joint (" + e.message + "). Rouvrez la fiche pour le rajouter.");
  }
}

async function del(id) {
  if (!confirm("Supprimer cette lecture et ses commentaires ?")) return;
  try { applyResult(await enCours("Suppression…", () => api("delete", { id }))); }
  catch (e) { alert("Suppression impossible : " + e.message); }
}

function startEdit(id, ov, statut) {
  const it = itemsAll.find(i => i.id === id);
  if (!it) return;
  editing = id; artCible = ""; modeArticle = false; forceStatut = statut || "";
  openForm();
}

function startAnalyse(articleId) { editing = null; artCible = articleId; modeArticle = false; forceStatut = ""; openForm(); }
function startCorrection(articleId) { editing = null; artCible = ""; modeArticle = articleId; forceStatut = ""; openForm(); }

// « Terminée » en un clic quand tous les champs obligatoires sont déjà remplis ; sinon on ouvre le formulaire.
async function marquerTerminee(id) {
  const it = itemsAll.find(x => x.id === id);
  if (!it) return;
  if (FIN.some(k => !String(it[k] || "").trim())) { startEdit(id, false, "Terminée"); return; }
  const data = Object.fromEntries(CHAMPS_FORM.map(k => [k, String(it[k] || "")]));
  data.statut = "Terminée";
  try { applyResult(await enCours("Enregistrement…", () => api("update", { id, data }))); }
  catch (e) { if (e.code === "unauthorized") sessionError(e); else alert("Enregistrement impossible : " + e.message); }
}

function renderMine() {
  if (!canWrite()) return;
  const g = groupeCourant();
  const mine = itemsAll.filter(i => i.mine && g && i.groupe_id === g.id).sort((a, b) =>
    (a.statut === "En cours" ? 0 : 1) - (b.statut === "En cours" ? 0 : 1) || String(b.ajoute).localeCompare(a.ajoute));
  const enc = mine.filter(i => i.statut === "En cours").length;
  $("mysum").textContent = mine.length ? `${mine.length} lecture${mine.length > 1 ? "s" : ""} · ${enc} en cours · ${mine.length - enc} terminée${mine.length - enc > 1 ? "s" : ""}` : "";
  if (!mine.length) { $("mylist").innerHTML = '<div class="empty">Aucune lecture pour l’instant.<br>Cliquez sur « ＋ Ajouter une lecture » pour saisir la première.</div>'; return; }
  $("mylist").innerHTML = mine.map(i => `<div class="card" style="border-left:6px solid ${esc(i.couleur)};padding:10px 14px"><div class="tools" style="justify-content:space-between"><div><span class="badge ${i.statut === "En cours" ? "prog" : ""}" style="--c:${esc(i.couleur)}">${i.statut === "En cours" ? "📖 En cours" : "✅ Terminée"}</span> <b>${esc(i.titre)}</b> <span class="meta">· saisi le ${esc(fmtD(i.ajoute))}${i.modifie_par ? ` · modifié par ${esc(i.modifie_par)}` : ""}</span></div><div>${i.statut === "En cours" ? `<button class="btn sm" data-done="${esc(i.id)}">✅ Marquer terminée</button> ` : ""}<button class="btn sm sec" data-e="${esc(i.id)}">Modifier</button> <button class="btn sm sec del" data-d="${esc(i.id)}">Supprimer</button></div></div></div>`).join("");
  $("mylist").querySelectorAll("[data-e]").forEach(b => b.onclick = () => startEdit(b.dataset.e, false));
  $("mylist").querySelectorAll("[data-d]").forEach(b => b.onclick = () => del(b.dataset.d));
  $("mylist").querySelectorAll("[data-done]").forEach(b => b.onclick = () => marquerTerminee(b.dataset.done));
}

/* ---------- Tableau commun, cartes et commentaires ---------- */

const openRows = new Set();   // lectures dont les textes longs sont dépliés

const chips = txt => motsListe(txt).map(k =>
  `<button type="button" class="chip ${cleTitre(k) === F.kw ? "on" : ""}" data-kw="${esc(k)}" title="Filtrer sur ce mot-clé">${esc(k)}</button>`).join("");

function clampTxt(id, txt) { return `<div class="clamp">${esc(txt)}</div>`; }

// Seuls les liens http(s) sont rendus cliquables (jamais javascript: ni data:), et s'ouvrent dans un nouvel onglet.
const urlSure = u => /^https?:\/\/[^\s<>"']+$/i.test(String(u || "").trim()) ? String(u).trim() : "";
const lienHtml = i => urlSure(i.lien)
  ? `<a class="lien" href="${esc(urlSure(i.lien))}" target="_blank" rel="noopener noreferrer" title="${esc(urlSure(i.lien))}">🔗 Ouvrir le lien</a>` : "";

// Dans la vue promo on indique le groupe d'origine ; dans la vue du groupe, une fiche partagée porte une pastille.
const badgeGroupe = i => ctx.vue === "promo"
  ? `<span class="badge grp" title="Groupe de ${esc(i.etudiant)}">👥 ${esc(i.groupe)}</span>`
  : i.portee === "promo" ? '<span class="badge share" title="Cette fiche est aussi visible de toute la promo">🌐 Partagée</span>' : "";

const anneeDe = i => (/^(\d{4})/.exec(i.parution || "") || [])[1] || "";

function badgeNouveau(i) {
  if (!vuDepuis || i.mine) return "";
  if (String(i.ajoute || "") > vuDepuis) return '<span class="new">🆕 Nouveau</span>';
  if (String(i.modifie_le || "") > vuDepuis) return '<span class="new">✏️ Modifié</span>';
  return "";
}

const nonLu = c => !c.mine && !lusSet.has(c.id);
const nbNonLus = id => comments.filter(c => c.lecture_id === id && nonLu(c)).length;

// Marque des commentaires comme lus (immédiatement à l'écran, puis confirmé par le serveur).
async function marquerLus(ids, tous) {
  const aMarquer = tous ? comments.filter(nonLu).map(c => c.id) : ids.filter(id => !lusSet.has(id));
  if (!aMarquer.length) return;
  aMarquer.forEach(id => { lusSet.add(id); lusEnvoi.add(id); nonLusEnvoi.delete(id); });
  renderComments();
  try {
    const j = await api("comments_read", { ids: aMarquer });
    aMarquer.forEach(id => lusEnvoi.delete(id));
    applyResult(j);
  } catch (e) {
    aMarquer.forEach(id => lusEnvoi.delete(id));
    if (e.code === "unauthorized") sessionError(e);
    // Autre erreur : ils redeviendront non lus à la prochaine actualisation, sans autre conséquence.
  }
}

// Remet des commentaires en « non lu » (par exemple pour y revenir plus tard).
async function marquerNonLus(ids) {
  const cibles = ids.filter(id => lusSet.has(id));
  if (!cibles.length) return;
  cibles.forEach(id => { lusSet.delete(id); lusEnvoi.delete(id); nonLusEnvoi.add(id); frais.delete(id); });
  renderComments(); renderTable();
  if (cmId) {   // action de l'utilisateur : on reconstruit la fenêtre même si la zone de saisie a le focus (le brouillon est conservé)
    const haut = $("cmbody").scrollTop; renderModal(); $("cmbody").scrollTop = haut;
  }
  try {
    applyResult(await api("comments_unread", { ids: cibles }));
  } catch (e) {
    if (e.code === "unauthorized") sessionError(e);
  } finally { cibles.forEach(id => nonLusEnvoi.delete(id)); }
}

// Discussion d'une lecture : fenêtre au-dessus de la page (tableau, cartes ou onglet Commentaires).
function ouvrirDiscussion(id, scope) {
  const it = items.find(i => i.id === id);
  if (!it) return;
  cmFocus = document.activeElement;
  cmId = id;
  cmScope = scope || (ctx.vue === "promo" ? "promo" : "groupe");
  const nv = fil(id, cmScope).filter(nonLu).map(c => c.id);
  nv.forEach(x => frais.add(x));      // surlignés tant que la fenêtre reste ouverte
  marquerLus(nv);
  renderModal();
  const t = $("cmbody").querySelector("textarea");
  if (t) t.focus(); else $("cmclose").focus();
}

function fermerDiscussion(silencieux) {
  if (cmId) commentsAll.filter(c => c.lecture_id === cmId).forEach(c => frais.delete(c.id));
  cmId = null;
  $("cmodal").classList.add("hidden");
  document.body.classList.remove("modalopen");
  $("cmbody").innerHTML = "";          // vidée, pas seulement masquée
  if (silencieux) return;
  renderTable(); renderComments();
  if (cmFocus && cmFocus.isConnected && cmFocus.focus) { try { cmFocus.focus({ preventScroll: true }); } catch (e) { /* ignoré */ } }
  cmFocus = null;
}

// Deux fils par fiche : celui du groupe (réservé à ses membres) et celui de la promo (si la fiche est partagée).
const fil = (id, scope) => commentsAll.filter(c => c.lecture_id === id && (scope === "promo" ? c.portee === "promo" : c.portee !== "promo"));
const monGroupe = i => groupes.some(g => g.id === i.groupe_id);
const filsDe = i => (monGroupe(i) ? ["groupe"] : []).concat(i.portee === "promo" ? ["promo"] : []);

function renderModal() {
  const it = cmId && (items.find(i => i.id === cmId) || itemsAll.find(i => i.id === cmId));
  if (!it) { if (cmId) fermerDiscussion(); return; }   // lecture supprimée entre-temps
  const fils = filsDe(it);
  if (!fils.includes(cmScope)) cmScope = fils[0] || "groupe";   // fiche retirée de la promo, ou groupe quitté
  $("cmtitle").textContent = it.titre;
  $("cmsub").textContent = [it.groupe, it.etudiant, it.auteur, anneeDe(it)].filter(Boolean).join(" · ");
  $("cmbody").innerHTML = (fils.length > 1 ? `<div class="seg" role="tablist"><button type="button" class="btn sm sec ${cmScope === "groupe" ? "on" : ""}" data-sc="groupe" role="tab" aria-selected="${cmScope === "groupe"}">👥 Mon groupe (${fil(it.id, "groupe").length})</button><button type="button" class="btn sm sec ${cmScope === "promo" ? "on" : ""}" data-sc="promo" role="tab" aria-selected="${cmScope === "promo"}">🌐 Toute la promo (${fil(it.id, "promo").length})</button></div>` : "")
    + `<div class="meta">${cmScope === "promo" ? "Discussion ouverte à toute la promo." : "Discussion réservée aux membres du groupe."}</div>`
    + commentsBox(it, cmScope);
  $("cmodal").classList.remove("hidden");
  document.body.classList.add("modalopen");
}

// Pas de reconstruction pendant la saisie d'un commentaire (actualisation automatique).
function majModal() {
  if (!cmId) return;
  const a = document.activeElement;
  if (a && a.tagName === "TEXTAREA" && $("cmbody").contains(a)) return;
  const haut = $("cmbody").scrollTop;
  renderModal();
  $("cmbody").scrollTop = haut;
}

$("cmclose").onclick = () => fermerDiscussion();
$("cmodal").addEventListener("mousedown", e => { if (e.target === $("cmodal")) fermerDiscussion(); });

const nbComm = i => { const n = comments.filter(x => x.lecture_id === i.id).length; const u = nbNonLus(i.id); return n ? `<span class="cn" title="${n} commentaire${n > 1 ? "s" : ""}${u ? ", " + u + " non lu" + (u > 1 ? "s" : "") : ""}">💬 ${n}</span>${u ? `<span class="new">${u} non lu${u > 1 ? "s" : ""}</span>` : ""}` : ""; };

// Actions d'une fiche de lecture : la modifier (la sienne) et la commenter.
function actionsHtml(i) {
  const edit = canWrite() && i.mine && i.modifiable ? `<button class="btn sm sec" data-e="${esc(i.id)}">Modifier ma fiche de lecture</button> ` : "";
  const n = comments.filter(x => x.lecture_id === i.id).length, u = nbNonLus(i.id);
  return `${edit}<button class="btn sm sec" data-c="${esc(i.id)}" aria-label="Commentaires (${n}${u ? ", " + u + " non lus" : ""})">💬 ${canComment() ? "Commenter" : "Commentaires"} (${n})${u ? ` · <b>${u} nouveau${u > 1 ? "x" : ""}</b>` : ""}</button>`;
}

// Actions du document : ajouter sa fiche de lecture, corriger la partie objective.
function actionsArticle(i) {
  if (!canWrite() || !i.article_modifiable) return "";
  const dejaMienne = itemsAll.some(x => x.mine && x.article_id === i.article_id);
  return (!dejaMienne ? `<button class="btn sm" data-an="${esc(i.article_id)}">＋ Ajouter ma fiche de lecture</button> ` : "")
    + `<button class="btn sm sec" data-ea="${esc(i.article_id)}">Corriger l’article</button>`;
}

function infosHtml(i) {
  return `Parution : ${esc(fmtD(i.parution)) || "—"}<br>Auteur : ${esc(i.auteur) || "—"} (${esc(i.qualite) || "—"})<br>Nationalité : ${esc(i.nation) || "—"}<br>Type : ${esc(i.type) || "—"}<br><i>Saisi le ${esc(fmtD(i.ajoute))}</i>${i.modifie_par ? `<br><i>Modifié par ${esc(i.modifie_par)} le ${esc(fmtD(i.modifie_le))}</i>` : ""}`;
}

// Un document (article) par ligne ; ses fiches de lecture se déplient en dessous.
const openArts = new Set(), fermesArts = new Set();     // documents dépliés ; documents repliés à la main malgré un filtre actif
const filtreActif = () => !!(F.q || F.who || F.grp || F.st || F.type || F.kw);
const artOuvert = k => openArts.has(k) || (filtreActif() && !fermesArts.has(k));   // une recherche déplie les documents trouvés
const cleArt = i => i.article_id || i.id;
const libFiches = n => `${n} fiche${n > 1 ? "s" : ""} de lecture`;

function groupesArticles(l) {
  const m = new Map();
  l.forEach(i => { const k = cleArt(i); if (!m.has(k)) m.set(k, []); m.get(k).push(i); });
  return [...m.values()];
}

// Résumé d'un document : qui a fait une fiche, et où elle en est.
function resumeFiches(g) {
  return g.map(x => `<span class="badge ${x.statut === "En cours" ? "prog" : ""}" style="--c:${esc(x.couleur)}" title="${x.statut === "En cours" ? "En cours de lecture" : "Terminée"}">${esc(x.etudiant)} ${x.statut === "En cours" ? "📖" : "✅"}${x.groupe ? ` <span class="grpn">· ${esc(x.groupe)}</span>` : ""}</span>`).join(" ");
}
function badgesArticle(g) {
  const nc = g.reduce((n, x) => n + comments.filter(c => c.lecture_id === x.id).length, 0);
  const nl = g.reduce((n, x) => n + nbNonLus(x.id), 0);
  const nf = fichiersDe(cleArt(g[0])).length;
  return `<span class="badge" title="Fiches de lecture de ce document">📚 ${libFiches(g.length)}</span>${nf ? `<span class="badge" title="Fichiers joints">📎 ${nf}</span>` : ""}${nc ? `<span class="cn" title="${nc} commentaire${nc > 1 ? "s" : ""}">💬 ${nc}</span>` : ""}${nl ? `<span class="new">${nl} non lu${nl > 1 ? "s" : ""}</span>` : ""}`;
}

const CHAMP_LIB = { titre: "titre", parution: "parution", auteur: "auteur", qualite: "qualité", nation: "nationalité", type: "type",
  source: "revue", volume: "volume", numero: "numéro", pages: "pages", doi: "DOI", lien: "lien" };
function propHtml(i, sub) {
  if (sub) return "";
  return props.filter(p => p.article_id === i.article_id).map(p => {
    const champs = Object.keys(p.valeurs).filter(k => String(p.valeurs[k] || "") !== String(i[k] || "")).map(k => `${CHAMP_LIB[k] || k} → « ${esc(String(p.valeurs[k] || "—"))} »`).join(" ; ");
    const vote = !canWrite() ? "" : p.mine
      ? `<button type="button" class="btn sm sec del" data-pc="${esc(p.id)}">Annuler ma proposition</button>`
      : `<button type="button" class="btn sm ${p.monVote === 1 ? "" : "sec"}" data-pv="${esc(p.id)}" data-pvo="1" aria-pressed="${p.monVote === 1}">👍 Approuver</button> <button type="button" class="btn sm ${p.monVote === 0 ? "" : "sec"}" data-pv="${esc(p.id)}" data-pvo="0" aria-pressed="${p.monVote === 0}">👎 Refuser</button>`;
    return `<div class="vote" style="margin-top:6px">✏️ <b>${esc(p.par)}</b> propose de corriger l’article : ${champs || "—"} <span class="meta">(${p.pour} approbation${p.pour > 1 ? "s" : ""} sur ${p.seuil} nécessaires)</span> ${vote}</div>`;
  }).join("");
}

async function voterProp(id, oui) {
  try { applyResult(await enCours("Vote…", () => api("article_vote", { id, vote: oui }))); }
  catch (e) { if (e.code === "unauthorized") sessionError(e); else alert("Vote impossible : " + e.message); }
}
async function annulerProp(id) {
  try { applyResult(await enCours("Annulation…", () => api("article_cancel", { id }))); }
  catch (e) { if (e.code === "unauthorized") sessionError(e); else alert("Annulation impossible : " + e.message); }
}

/* ---------- Retours sur l'outil (bugs, idées) ---------- */

const TYPES_FB = { bug: "🐞 Bug", idee: "💡 Idée d’amélioration", autre: "💬 Autre" };
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
    ? `<div class="meta">Les plus récents d’abord. Le suivi (colonne « statut ») se change directement dans l’onglet « Feedback » du Sheet.</div>
      <div class="wrap"><table class="adm"><thead><tr><th>Date</th><th>De</th><th>Type</th><th>Retour</th><th>Statut</th></tr></thead><tbody>${l.map(f => `<tr><td>${esc(fmtDT(f.cree_le))}</td><td>${esc(f.par)}<div class="meta">${esc(f.email)}</div></td><td>${esc(TYPES_FB[f.type] || f.type)}</td>
        <td><div style="white-space:pre-wrap">${esc(f.texte)}</div>${f.contexte ? `<div class="meta">${esc(f.contexte)}</div>` : ""}</td><td>${esc(f.statut)}</td></tr>`).join("")}</tbody></table></div>`
    : `<div class="meta">Aucun retour pour l’instant.</div>`);
}

// Fichiers joints (PDF, images) à un document : partage interne à but pédagogique.
const FICHIER_MAX = 5 * 1024 * 1024;
const AVERT_DROIT = "Droit d’auteur : ces fichiers restent un partage INTERNE, à but PÉDAGOGIQUE, réservé aux personnes de l’outil. Ne déposez que des documents que vous avez le droit de partager dans ce cadre, et ne les diffusez pas en dehors.";
const fichiersDe = k => fichiers.filter(f => f.article_id === k);
const fmtTaille = o => o < 1048576 ? Math.max(1, Math.round(o / 1024)) + " Ko" : (o / 1048576).toFixed(1).replace(".", ",") + " Mo";
const chipFichier = (f, avecSuppr) => `<span class="chip fichier"><button type="button" class="lnk" data-fo="${esc(f.id)}" title="Ouvrir dans un nouvel onglet">${f.type === "application/pdf" ? "📄" : "🖼️"} ${esc(f.nom)}</button> <span class="meta">${esc(fmtTaille(f.taille))} · ${esc(f.par)}</span>${avecSuppr && f.supprimable ? ` <button type="button" class="btn sm sec del" style="padding:0 6px" data-fx="${esc(f.id)}" aria-label="Supprimer ${esc(f.nom)}">✕</button>` : ""}</span>`;
// Tableau commun : consultation seulement (l'ajout et la suppression se font dans l'édition de sa fiche).
function fichiersHtml(i) {
  const l = fichiersDe(cleArt(i));
  return l.length ? `<div class="fichiers">${l.map(f => chipFichier(f, false)).join(" ")}</div>` : "";
}
// Formulaire de ma fiche : un seul fichier par document. En modification, le dépôt est immédiat ;
// à la création, le fichier choisi est gardé en mémoire et envoyé juste après l'enregistrement de la fiche.
let fichierAttente = null;   // { nom, data, taille } choisi avant l'enregistrement d'une nouvelle fiche
let formFich = null;         // { k: article, differe: bool } de la section affichée
function fichiersFormHtml() {
  const { k, differe } = formFich, l = k ? fichiersDe(k) : [];
  const pret = differe && fichierAttente;
  const puces = l.map(f => chipFichier(f, true)).join(" ")
    + (pret ? `<span class="chip fichier">📄 ${esc(fichierAttente.nom)} <span class="meta">${esc(fmtTaille(fichierAttente.taille))} · sera joint à l’enregistrement</span> <button type="button" class="btn sm sec del" style="padding:0 6px" data-fr="1" aria-label="Retirer le fichier">✕</button></span>` : "");
  const libre = !l.length && !pret;
  return `<div class="fichiers">${puces}${libre ? `<button type="button" class="btn sm sec" data-fu="${esc(k)}">📎 Ajouter un fichier</button>` : ""}</div>
    <div class="meta">Un fichier par document (PDF, PNG ou JPEG, 5 Mo maximum), partagé avec la promo. Partage interne à but pédagogique (droit d’auteur) : ne déposez que ce que vous avez le droit de partager dans ce cadre.${l.length ? " Pour le remplacer, supprimez-le d’abord." : ""}</div>`;
}
function majFichiersForm() { const z = $("fichform"); if (z && formFich) z.innerHTML = fichiersFormHtml(); }

let fupCible = "";   // article du fichier en cours d’ajout (formulaire de la fiche)
async function ouvrirFichier(id) {
  const fen = window.open("", "_blank");          // ouverte tout de suite : sinon le navigateur bloque la fenêtre
  try { if (fen) { fen.document.title = "Chargement…"; fen.document.body.innerHTML = '<p style="font:16px system-ui,sans-serif;margin:2em;color:#444">⏳ Chargement du fichier…</p>'; } } catch (_) {}
  try {
    const r = await enCours("Ouverture du fichier…", () => api("file_get", { id }));
    const bin = atob(r.data), o = new Uint8Array(bin.length);
    for (let n = 0; n < bin.length; n++) o[n] = bin.charCodeAt(n);
    const url = URL.createObjectURL(new Blob([o], { type: r.type }));
    if (fen) fen.location.href = url; else window.open(url, "_blank");
    setTimeout(() => URL.revokeObjectURL(url), 120000);
  } catch (e) {
    if (fen) fen.close();
    if (e.code === "unauthorized") sessionError(e); else alert("Ouverture impossible : " + e.message);
  }
}
function choisirFichier(k) {
  if (!confirm(AVERT_DROIT + "\n\nContinuer ?")) return;
  fupCible = k; $("fup").value = ""; $("fup").click();
}
async function envoyerFichier(file) {
  if (!file) return;
  const type = (file.type || "").toLowerCase(), nom = file.name || "";
  if (!/^(application\/pdf|image\/png|image\/jpeg)$/.test(type) && !/\.(pdf|png|jpe?g)$/i.test(nom)) return alert("Format non accepté : PDF, PNG ou JPEG uniquement.");
  if (file.size > FICHIER_MAX) return alert(`Fichier trop volumineux (${fmtTaille(file.size)}) : 5 Mo maximum.`);
  const data = await new Promise((ok, ko) => { const r = new FileReader(); r.onload = () => ok(String(r.result).split(",")[1] || ""); r.onerror = () => ko(new Error("Lecture du fichier impossible")); r.readAsDataURL(file); }).catch(e => { alert(e.message); return ""; });
  if (!data) return;
  if (formFich && formFich.differe) { fichierAttente = { nom, data, taille: file.size }; majFichiersForm(); return; }
  try { applyResult(await enCours("Envoi du fichier…", () => api("file_add", { article_id: fupCible, nom, data }))); majFichiersForm(); }
  catch (e) { if (e.code === "unauthorized") sessionError(e); else alert("Envoi impossible : " + e.message); }
}
async function supprimerFichierCli(id) {
  const f = fichiers.find(x => x.id === id);
  if (f) fupCible = f.article_id;
  if (!f || !confirm(`Supprimer le fichier « ${f.nom} » ?`)) return;
  try { applyResult(await enCours("Suppression…", () => api("file_delete", { id }))); majFichiersForm(); }
  catch (e) { if (e.code === "unauthorized") sessionError(e); else alert("Suppression impossible : " + e.message); }
}

// Ligne du document : titre, références, qui l'a lu ; les fiches de lecture sont dessous.
function artRow(g) {
  const i = g[0], k = cleArt(i), open = artOuvert(k);
  return `<tr class="art ${open ? "open" : ""}" data-art="${esc(k)}" tabindex="0" aria-expanded="${open}"><td class="first"><span class="chev" aria-hidden="true"></span>${badgesArticle(g)}
   <b>${esc(i.titre)}</b>${lienHtml(i)}
   <div class="meta">${esc([i.auteur, anneeDe(i), i.type].filter(Boolean).join(" · ")) || "—"}</div>
   ${propHtml(i)}<div class="artacts">${actionsArticle(i)}</div>${fichiersHtml(i)}</td>
   <td class="artres" colspan="7"><div class="meta" style="margin-bottom:4px"><span class="hint-c">Cliquez pour déplier les fiches de lecture</span><span class="hint-o">Fiches de lecture ci-dessous</span></div>${resumeFiches(g)}</td>
   <td class="apa c9">${apaCell(i)}</td></tr>`;
}

// Fiche de lecture : colonnes 2 à 8, visible quand son document est déplié.
function cells(i) {
  const c = esc(i.couleur), k = cleArt(i);
  const prog = i.statut === "En cours";
  return `<tr data-id="${esc(i.id)}" data-fa="${esc(k)}" tabindex="0" aria-expanded="${openRows.has(i.id)}" class="fiche ${artOuvert(k) ? "show" : ""} ${prog ? "prog" : ""} ${openRows.has(i.id) ? "open" : ""}" style="--c:${c}"><td class="first"><span class="chev" aria-hidden="true"></span><span class="badge" style="--c:${c}">${esc(i.etudiant)}</span><span class="badge ${prog ? "prog" : ""}" style="--c:${c}">${prog ? "📖 En cours" : "✅ Terminée"}</span>${badgeGroupe(i)}${badgeNouveau(i)}${nbComm(i)}
   <div class="meta">Fiche de lecture${i.modifie_par ? ` · modifiée par ${esc(i.modifie_par)} le ${esc(fmtD(i.modifie_le))}` : ""} · saisie le ${esc(fmtD(i.ajoute))}</div>
   <div class="rowacts">${actionsHtml(i)}</div></td>
   <td class="c2 nowrapc"><div class="chipsc">${chips(i.mots)}</div></td><td class="c3 nowrapc"><div class="chipsc">${chips(i.kw)}</div></td>
   <td class="c4">${clampTxt(i.id, i.concepts)}</td><td class="c5">${clampTxt(i.id, i.objet)}</td><td class="c6">${clampTxt(i.id, i.opinion)}</td>
   <td class="c7">${clampTxt(i.id, i.controverse)}</td><td class="c8">${clampTxt(i.id, i.libre)}</td><td class="c9"></td></tr>`;
}

function artCard(g) {
  const i = g[0], k = cleArt(i), open = artOuvert(k);
  return `<article class="cardc art ${open ? "open" : ""}" data-art="${esc(k)}" tabindex="0" aria-expanded="${open}">
   <div>${badgesArticle(g)}</div>
   <h3><span class="chev" aria-hidden="true"></span>${esc(i.titre)}</h3>${lienHtml(i)}
   <div class="meta">${esc([i.auteur, anneeDe(i), i.type].filter(Boolean).join(" · ")) || "—"}</div>
   <div class="chipsc" style="max-height:none">${resumeFiches(g)}</div>
   <div class="sect"><b>Référence APA</b>${apaCell(i)}</div>
   ${propHtml(i)}<div class="acts">${actionsArticle(i)}</div>${fichiersHtml(i)}
  </article>`;
}

function cardHtml(i) {
  const c = esc(i.couleur);
  const prog = i.statut === "En cours";
  const sect = (t, v) => String(v || "").trim() ? `<div class="sect"><b>${t}</b>${clampTxt(i.id, v)}</div>` : "";
  return `<article class="cardc fiche ${prog ? "prog" : ""} ${openRows.has(i.id) ? "open" : ""}" data-id="${esc(i.id)}" tabindex="0" aria-expanded="${openRows.has(i.id)}" style="--c:${c}">
   <div><span class="badge" style="--c:${c}">${esc(i.etudiant)}</span><span class="badge ${prog ? "prog" : ""}" style="--c:${c}">${prog ? "📖 En cours de lecture" : "✅ Terminée"}</span>${badgeGroupe(i)}${badgeNouveau(i)}</div>
   <h3><span class="chev" aria-hidden="true"></span>Fiche de lecture de ${esc(i.etudiant)}</h3>
   ${motsListe(i.mots).length || motsListe(i.kw).length ? `<div class="chipsc">${chips(i.mots)}${chips(i.kw)}</div>` : ""}
   ${sect("Concepts en sciences infirmières", i.concepts)}${sect("Objet / sujet principal", i.objet)}${sect("Opinion de l’auteur", i.opinion)}${sect("Controverse", i.controverse)}${sect("Libre", i.libre)}
   <div class="acts">${actionsHtml(i)}</div>
  </article>`;
}

function apaCell(i) {
  const r = LydiaApa.apa(i);
  const note = r.incomplet ? '<div class="meta" style="margin-top:4px">⚠ À compléter : revue et pages (formulaire, section APA)</div>' : "";
  return `<div class="apatxt clamp">${r.html}</div>${note}<button class="btn sm sec" style="margin-top:6px" data-apa="${esc(i.id)}">📋 Copier</button>`;
}

async function copier(html, texte, message) {
  try {
    if (window.ClipboardItem && navigator.clipboard && navigator.clipboard.write) {
      // HTML pour conserver l'italique dans Word ; texte brut en secours.
      await navigator.clipboard.write([new ClipboardItem({
        "text/html": new Blob([html], { type: "text/html" }),
        "text/plain": new Blob([texte], { type: "text/plain" })
      })]);
    } else await navigator.clipboard.writeText(texte);
    showStatus(message);
    setTimeout(clearStatus, 1500);
  } catch (e) { alert("Copie impossible : sélectionnez le texte à la main.\n\n" + texte); }
}

function copierApa(id) {
  const it = items.find(x => x.id === id);
  if (!it) return;
  const r = LydiaApa.apa(it);
  copier(r.html, r.text, "📋 Référence copiée");
}

function commentsBox(i, scope) {
  const cle = i.id + "|" + scope;
  const l = fil(i.id, scope).sort((a, b) => String(a.date).localeCompare(b.date));
  const list = l.length ? l.map(c => {
    const own = c.mine && canComment();
    const nl = `<button class="btn sm sec" data-cu="${esc(c.id)}" title="Le retrouver parmi les non lus">Marquer comme non lu</button>`;
    const acts = (own
      ? `<button class="btn sm sec" data-ce="${esc(c.id)}">Modifier</button> <button class="btn sm sec del" data-cd="${esc(c.id)}">Supprimer</button>`
      : (!c.mine && lusSet.has(c.id) ? nl + " " : "") + (canAdmin() && (scope !== "promo" || isSuper()) ? `<button class="btn sm sec del" data-cd="${esc(c.id)}">Supprimer</button>` : ""));
    const nouveau = frais.has(c.id) || nonLu(c);
    return `<div class="cm ${nouveau ? "fresh" : ""}"><b>${esc(c.auteur)}</b>${scope === "promo" && c.groupe ? ` <span class="meta">(${esc(c.groupe)})</span>` : ""}${nouveau ? ' <span class="new">Nouveau</span>' : ""} <span class="meta">${esc(fmtDT(c.date))}${c.modifie_le ? " · modifié" : ""}</span>
      <div class="cmtxt">${esc(c.texte)}</div>${acts}</div>`;
  }).join("") : '<div class="meta">Aucun commentaire.</div>';
  const form = canComment()
    ? `<div><textarea data-cm="${esc(cle)}" maxlength="2000" placeholder="${scope === "promo" ? "Écrire à toute la promo…" : "Écrire au groupe…"}" aria-label="Nouveau commentaire">${esc(drafts[cle] || "")}</textarea>
       <button class="btn sm" data-ca="${esc(cle)}" style="margin-top:6px">Publier</button></div>` : "";
  return list + form;
}

/* ---------- Onglet « Commentaires » : tous les commentaires, non lus en tête ---------- */

function renderComments() {
  if (!me) return;
  const nv = comments.filter(nonLu).length;
  $("cmtcount").textContent = nv || "";
  $("cmtcount").classList.toggle("hidden", !nv);
  if (tab !== "cmts") return;
  const parId = new Map(items.map(i => [i.id, i]));
  let l = comments.filter(c => parId.has(c.lecture_id));
  if (CM.nonLus) l = l.filter(nonLu);
  if (CM.miennes) l = l.filter(c => parId.get(c.lecture_id).mine);
  l.sort((a, b) => String(b.date).localeCompare(String(a.date)));
  const cartes = l.map(c => {
    const it = parId.get(c.lecture_id), nvC = nonLu(c);
    return `<article class="cmcard ${nvC ? "fresh" : ""}" data-cid="${esc(c.id)}">
      <div class="cmhead"><b>${esc(c.auteur)}</b> <span class="meta">${esc(fmtDT(c.date))}${c.modifie_le ? " · modifié" : ""}</span>${nvC ? ' <span class="new">Nouveau</span>' : ""}</div>
      <div class="meta">sur <b>${esc(it.titre)}</b> · lecture de ${esc(it.etudiant)}${ctx.vue === "promo" ? " · " + esc(it.groupe) : ""}</div>
      <div class="cmtxt">${esc(c.texte)}</div>
      <div class="cmacts"><button class="btn sm" data-cgo="${esc(it.id)}">${canComment() ? "Voir et répondre" : "Voir la discussion"}</button>${nvC ? ` <button class="btn sm sec" data-cr="${esc(c.id)}">Marquer comme lu</button>` : !c.mine ? ` <button class="btn sm sec" data-cu="${esc(c.id)}">Marquer comme non lu</button>` : ""}</div>
    </article>`;
  }).join("");
  const vide = CM.nonLus ? "Aucun commentaire non lu. 🎉" : CM.miennes ? "Aucun commentaire sur vos lectures." : "Aucun commentaire pour le moment.";
  $("cmtsbox").innerHTML = `
    <div class="card tools">
      <label class="chk"><input type="checkbox" id="cmtnl" ${CM.nonLus ? "checked" : ""}> Non lus seulement</label>
      ${canWrite() ? `<label class="chk"><input type="checkbox" id="cmtmine" ${CM.miennes ? "checked" : ""}> Sur mes lectures</label>` : ""}
      <span class="meta">${nv ? nv + " non lu" + (nv > 1 ? "s" : "") : "Tout est lu"} · ${comments.length} au total</span>
      <button class="btn sm sec" id="cmtall" ${nv ? "" : "disabled"} style="margin-left:auto">Tout marquer comme lu</button>
    </div>
    <div class="cmlist">${cartes || `<div class="note">${vide}</div>`}</div>`;
}

$("cmtsbox").onclick = e => {
  const b = e.target.closest("button");
  if (!b) return;
  if (b.dataset.cgo) ouvrirDiscussion(b.dataset.cgo);
  else if (b.dataset.cr) marquerLus([b.dataset.cr]);
  else if (b.dataset.cu) marquerNonLus([b.dataset.cu]);
  else if (b.id === "cmtall") marquerLus([], true);
};
$("cmtsbox").onchange = e => {
  if (e.target.id === "cmtnl") CM.nonLus = e.target.checked;
  else if (e.target.id === "cmtmine") CM.miennes = e.target.checked;
  else return;
  renderComments();
};

async function commentAction(fn, errLabel) {
  try { applyResult(await enCours("Enregistrement…", fn)); }
  catch (e) { if (e.code === "unauthorized") sessionError(e); else alert(errLabel + " : " + e.message); }
}

const COLS = { 2: "Mots-clés", 3: "Keywords (EN)", 4: "Concepts", 5: "Objet / sujet", 6: "Opinion", 7: "Controverse", 8: "Libre", 9: "Référence APA" };

function applyCols() {
  for (let k = 2; k <= 9; k++) $("tbl").classList.toggle("hc" + k, masquees.has(k));
}

function renderFilters() {
  usersChanged = false;
  const types = [...new Set(TYPES.concat(items.map(i => i.type).filter(Boolean)))];
  const tableau = F.view !== "cartes";
  const actifs = [["q", F.q ? `« ${F.q} »` : ""], ["who", F.who], ["grp", F.grp], ["st", F.st], ["type", F.type]].filter(x => x[1]);
  const nb = actifs.length + (F.kw ? 1 : 0);
  $("filters").innerHTML = `
   <details class="colmenu" id="mfilt"><summary class="btn sm sec" aria-label="Rechercher et filtrer">🔍 Rechercher / filtrer${nb ? ` <span class="count">${nb}</span>` : ""}</summary>
    <div class="colpop pop-filtres">
     <div><label for="q">Recherche</label><input id="q" placeholder="Titre, auteur, mot-clé, commentaire…" value="${esc(F.q)}"></div>
     <div><label for="who">Étudiant</label><select id="who"><option value="">Tous les étudiants</option>${students().map(s => `<option ${F.who === s.prenom ? "selected" : ""}>${esc(s.prenom)}</option>`).join("")}</select></div>
     ${groupesListe().length > 1 ? `<div><label for="grp">Groupe</label><select id="grp"><option value="">Tous les groupes</option>${groupesListe().map(n => `<option ${F.grp === n ? "selected" : ""}>${esc(n)}</option>`).join("")}</select></div>` : ""}
     <div><label for="st">Statut</label><select id="st"><option value="">Tous les statuts</option><option value="Terminée" ${F.st === "Terminée" ? "selected" : ""}>✅ Terminées</option><option value="En cours" ${F.st === "En cours" ? "selected" : ""}>📖 En cours</option></select></div>
     <div><label for="type">Type d’article</label><select id="type"><option value="">Tous les types</option>${types.map(t => `<option ${F.type === t ? "selected" : ""}>${esc(t)}</option>`).join("")}</select></div>
     <div><label for="sort">Tri</label><select id="sort"><option value="ajoute" ${F.sort === "ajoute" ? "selected" : ""}>Date de saisie</option><option value="etudiant" ${F.sort === "etudiant" ? "selected" : ""}>Étudiant</option><option value="titre" ${F.sort === "titre" ? "selected" : ""}>Titre</option><option value="parution" ${F.sort === "parution" ? "selected" : ""}>Date de parution</option></select></div>
     <button type="button" class="btn sm sec" id="reset">Réinitialiser les filtres</button>
    </div></details>
   ${actifs.map(([k, v]) => `<button type="button" class="chip on" data-clear="${k}" title="Retirer ce filtre">${esc(v)} ✕</button>`).join("")}
   ${F.kw ? `<button type="button" class="chip on" id="kwoff" title="Retirer le filtre">Mot-clé : ${esc(F.kwLabel)} ✕</button>` : ""}
   <span class="meta" id="nbres"></span>
   <span class="spacer"></span>
   <span class="seg"><button type="button" class="btn sm sec ${tableau ? "on" : ""}" id="vt" aria-pressed="${tableau}">▦ Tableau</button><button type="button" class="btn sm sec ${tableau ? "" : "on"}" id="vc" aria-pressed="${!tableau}">🗂 Cartes</button></span>
   ${tableau ? `<details class="colmenu"><summary class="btn sm sec">Colonnes ▾</summary><div class="colpop">${Object.keys(COLS).map(k => `<label><input type="checkbox" data-col="${k}" ${masquees.has(+k) ? "" : "checked"}> ${COLS[k]}</label>`).join("")}</div></details>` : ""}
   <button type="button" class="btn sm sec" id="expall"></button>
   <button type="button" class="btn sm sec" id="refresh" title="Actualisation automatique toutes les ${CFG.REFRESH_SECONDS || 0} s tant que la page est ouverte" aria-label="Actualiser">↻</button><span class="meta" id="sync"></span>
   ${canWrite() ? '<button type="button" class="btn sm" id="add2">＋ Ajouter une lecture</button>' : ""}
   <details class="colmenu"><summary class="btn sm sec">⬇️ Exporter ▾</summary><div class="colpop right"><button class="btn sm" id="xl" type="button">Excel</button> <button class="btn sm" id="pdf" type="button">PDF</button></div></details>`;
  $("q").oninput = e => { F.q = e.target.value; renderTable(); };
  ["who", "grp", "st", "type", "sort"].forEach(k => $(k) && ($(k).onchange = e => { F[k] = e.target.value; renderTable(); }));
  $("mfilt").ontoggle = () => { if ($("mfilt").open) $("q").focus(); };
  $("reset").onclick = () => { F.q = ""; F.who = ""; F.grp = ""; F.st = ""; F.type = ""; F.kw = ""; F.kwLabel = ""; renderFilters(); renderTable(); };
  $("filters").querySelectorAll("[data-clear]").forEach(b => b.onclick = () => { F[b.dataset.clear] = ""; renderFilters(); renderTable(); });
  if ($("kwoff")) $("kwoff").onclick = () => filtrerMotCle(F.kwLabel);
  $("vt").onclick = () => changerVue("tableau");
  $("vc").onclick = () => changerVue("cartes");
  $("filters").querySelectorAll("[data-col]").forEach(cb => cb.onchange = () => {
    if (cb.checked) masquees.delete(+cb.dataset.col); else masquees.add(+cb.dataset.col);
    try { localStorage.setItem("lydia_cols", JSON.stringify([...masquees])); } catch (e) { /* ignoré */ }
    applyCols();
  });
  $("expall").onclick = toutDeplier;
  $("refresh").onclick = () => refresh(true);
  if ($("add2")) $("add2").onclick = () => { editing = null; artCible = ""; modeArticle = false; forceStatut = ""; openForm(); };
  $("xl").onclick = exportXlsx;
  $("pdf").onclick = exportPdf;
  majBoutonDeplier(); majSync();
}

// Les menus déroulants (recherche, colonnes, export) se ferment au clic en dehors ou avec Échap.
document.addEventListener("click", e => document.querySelectorAll("details.colmenu[open]").forEach(d => { if (!d.contains(e.target)) d.removeAttribute("open"); }));

function changerVue(v) {
  F.view = v;
  try { localStorage.setItem("lydia_vue", v); } catch (e) { /* ignoré */ }
  renderFilters();
  renderTable();
}

function filtrerMotCle(label) {
  const k = cleTitre(label);
  if (F.kw === k) { F.kw = ""; F.kwLabel = ""; } else { F.kw = k; F.kwLabel = label; }
  renderFilters();
  renderTable();
}

// Recherche : champs visibles + commentaires, sans accents ni casse ; chaque mot saisi doit apparaître quelque part.
const CHAMPS_RECHERCHE = ["etudiant", "titre", "parution", "auteur", "qualite", "nation", "type", "mots", "kw", "concepts", "objet",
  "opinion", "controverse", "libre", "source", "volume", "numero", "pages", "doi"];
function correspond(i, q) {
  const texte = cleTitre(CHAMPS_RECHERCHE.map(k => i[k]).concat(comments.filter(c => c.lecture_id === i.id).map(c => c.texte)).join(" "));
  return q.split(" ").every(m => texte.includes(m));
}

// Noms des groupes présents dans la vue courante (filtre « Groupe »).
const groupesListe = () => [...new Set(items.map(i => i.groupe).filter(Boolean))].sort((a, b) => a.localeCompare(b, "fr"));

function filtered() {
  const q = cleTitre(F.q);
  const l = items.filter(i => (!F.who || i.etudiant === F.who) && (!F.grp || i.groupe === F.grp) && (!F.st || i.statut === F.st) && (!F.type || i.type === F.type)
    && (!F.kw || motsListe(i.mots).concat(motsListe(i.kw)).some(k => cleTitre(k) === F.kw))
    && (!q || correspond(i, q)));
  l.sort((a, b) => F.sort === "ajoute"
    ? String(b.ajoute).localeCompare(a.ajoute)
    : String(a[F.sort] || "").localeCompare(String(b[F.sort] || ""), "fr"));
  // Les fiches de lecture d'un même document se suivent, à la place de la première.
  const parArt = new Map();
  l.forEach(i => { const k = i.article_id || i.id; if (!parArt.has(k)) parArt.set(k, []); parArt.get(k).push(i); });
  return [...parArt.values()].flat();
}

function renderTable() {
  const l = filtered();
  const cartes = F.view === "cartes";
  const vide = items.length ? "Aucune lecture ne correspond aux filtres."
    : canWrite() ? "Aucune lecture pour l’instant : utilisez « ＋ Ajouter une lecture »." : "Aucune lecture pour l’instant.";
  $("tablewrap").classList.toggle("hidden", cartes);
  $("cards").classList.toggle("hidden", !cartes);
  // La vue inutilisée est vidée, pas seulement masquée : rien ne peut réapparaître en dessous si une feuille de style périmée est en cache.
  const groupes = groupesArticles(l);
  if (cartes) {
    $("rows").innerHTML = "";
    $("cards").innerHTML = groupes.length ? groupes.map(g => `<div class="artgrp ${artOuvert(cleArt(g[0])) ? "open" : ""}">${artCard(g)}<div class="fiches">${g.map(cardHtml).join("")}</div></div>`).join("") : `<div class="empty">${vide}</div>`;
  } else {
    $("cards").innerHTML = "";
    $("rows").innerHTML = groupes.length ? groupes.map(g => artRow(g) + g.map(cells).join("")).join("") : `<tr><td colspan="9" class="empty">${vide}</td></tr>`;
  }
  applyCols();
  const nbres = $("nbres");
  if (nbres) nbres.textContent = (F.q || F.who || F.grp || F.st || F.type || F.kw) ? `${l.length} / ${items.length} fiches de lecture` : "";
  $("stats").innerHTML = students().map(s => {
    const n = items.filter(i => i.etudiant === s.prenom);
    return `<span class="badge" style="--c:${esc(s.couleur)}">${esc(s.prenom)} : ${n.length} fiche${n.length > 1 ? "s" : ""} de lecture (${n.filter(i => i.statut === "En cours").length} en cours)</span>`;
  }).join("");
}

function majBoutonDeplier() {
  const b = $("expall");
  if (b) b.textContent = openRows.size || openArts.size ? "⇱ Tout replier" : "⇲ Tout déplier";
}

function toggleOpen(id, host) {
  if (openRows.has(id)) openRows.delete(id); else openRows.add(id);
  if (host) {
    host.classList.toggle("open", openRows.has(id));
    host.setAttribute("aria-expanded", String(openRows.has(id)));
  }
  majBoutonDeplier();
}

// Déplier / replier un document : on change des classes, sans reconstruire le tableau.
function toggleArt(k) {
  const ouvrir = !artOuvert(k);
  if (ouvrir) { openArts.add(k); fermesArts.delete(k); } else { openArts.delete(k); fermesArts.add(k); }
  const racine = F.view === "cartes" ? $("cards") : $("rows");
  racine.querySelectorAll("tr.art, .cardc.art").forEach(h => {
    if (h.dataset.art !== k) return;
    h.classList.toggle("open", ouvrir); h.setAttribute("aria-expanded", String(ouvrir));
    const g = h.closest(".artgrp"); if (g) g.classList.toggle("open", ouvrir);
  });
  racine.querySelectorAll("tr.fiche").forEach(t => { if (t.dataset.fa === k) t.classList.toggle("show", ouvrir); });
  majBoutonDeplier();
}

function toutDeplier() {
  if (openRows.size || openArts.size) { openRows.clear(); openArts.clear(); if (filtreActif()) filtered().forEach(i => fermesArts.add(cleArt(i))); }
  else { fermesArts.clear(); filtered().forEach(i => { openRows.add(i.id); openArts.add(cleArt(i)); }); }
  renderTable();
  majBoutonDeplier();
}

const onAction = e => {
  const b = e.target.closest("button");
  if (!b) {
    // Clic ailleurs que sur un bouton, un lien ou un commentaire : on déplie / replie la ligne (sauf sélection de texte en cours).
    if (e.target.closest("a, input, select, textarea, label") || (window.getSelection && String(window.getSelection()).length)) return;
    const a = e.target.closest("tr.art, .cardc.art");
    if (a) return toggleArt(a.dataset.art);
    const h = e.target.closest("tr[data-id], .cardc[data-id]");
    if (h) toggleOpen(h.dataset.id, h);
    return;
  }
  const d = b.dataset;
  if (d.e) startEdit(d.e, false);
  else if (d.fo) ouvrirFichier(d.fo);
  else if (d.an) startAnalyse(d.an);
  else if (d.ea) startCorrection(d.ea);
  else if (d.pv) voterProp(d.pv, d.pvo === "1");
  else if (d.pc) annulerProp(d.pc);
  else if (d.apa) copierApa(d.apa);
  else if (d.cu) marquerNonLus([d.cu]);
  else if (d.kw !== undefined) filtrerMotCle(d.kw);
  else if (d.c) ouvrirDiscussion(d.c);
  else if (d.sc) { cmScope = d.sc; renderModal(); const z = $("cmbody").querySelector("textarea"); if (z) z.focus(); }
  else if (d.ca) {
    const t = (drafts[d.ca] || "").trim();
    if (!t) return;
    const [lid, portee] = d.ca.split("|");
    b.disabled = true;
    commentAction(async () => { const j = await api("comment_add", { lecture_id: lid, texte: t, portee }); drafts[d.ca] = ""; return j; }, "Commentaire impossible")
      .then(() => {
        renderModal();                    // la saisie est terminée : on affiche le nouveau commentaire même si la zone avait le focus
        $("cmbody").scrollTop = $("cmbody").scrollHeight;
        const z = $("cmbody").querySelector("textarea"); if (z) z.focus();
      });
  } else if (d.ce) {
    const c = commentsAll.find(x => x.id === d.ce);
    const t = c && prompt("Modifier le commentaire :", c.texte);
    if (t && t.trim()) commentAction(() => api("comment_update", { id: d.ce, texte: t }), "Modification impossible");
  } else if (d.cd) {
    if (confirm("Supprimer ce commentaire ?")) commentAction(() => api("comment_delete", { id: d.cd }), "Suppression impossible");
  }
};
const onDraft = e => { if (e.target.dataset.cm) drafts[e.target.dataset.cm] = e.target.value; };
$("fup").onchange = e => envoyerFichier(e.target.files && e.target.files[0]);
$("rows").onclick = $("cards").onclick = $("cmbody").onclick = onAction;
$("rows").oninput = $("cards").oninput = $("cmbody").oninput = onDraft;
$("rows").onkeydown = $("cards").onkeydown = e => {
  if ((e.key === "Enter" || e.key === " ") && e.target.matches && e.target.matches("tr[data-id], .cardc[data-id], tr.art, .cardc.art")) {
    e.preventDefault();
    if (e.target.dataset.art) toggleArt(e.target.dataset.art); else toggleOpen(e.target.dataset.id, e.target);
  }
};

/* ---------- Bibliographie ---------- */

const B = { who: "", enCours: false };

// Une référence par article, même s'il porte plusieurs fiches de lecture.
const parArticle = l => { const vu = new Set(); return l.filter(i => { const k = i.article_id || i.id; if (vu.has(k)) return false; vu.add(k); return true; }); };

function biblioListe() {
  return LydiaApa.bibliographie(parArticle(items.filter(i => (!B.who || i.etudiant === B.who) && (B.enCours || i.statut === "Terminée"))));
}

function renderBiblioTools() {
  $("bibtools").innerHTML = `<label for="bwho" class="meta" style="margin:0">Étudiant</label>
   <select id="bwho"><option value="">Tous</option>${students().map(s => `<option ${B.who === s.prenom ? "selected" : ""}>${esc(s.prenom)}</option>`).join("")}</select>
   <label class="chk"><input type="checkbox" id="ben" ${B.enCours ? "checked" : ""}> Inclure les lectures en cours</label>
   <button type="button" class="btn sm" id="bcopy">📋 Tout copier</button>
   <button type="button" class="btn sm sec" id="bdoc">⬇️ Word</button>
   <button type="button" class="btn sm sec" id="btxt">⬇️ Texte</button>
   <button type="button" class="btn sm sec" id="bprint">🖨️ Imprimer</button>`;
  $("bwho").onchange = e => { B.who = e.target.value; renderBiblio(); };
  $("ben").onchange = e => { B.enCours = e.target.checked; renderBiblio(); };
  $("bcopy").onclick = () => {
    const l = biblioListe();
    if (l.length) copier(l.map(r => `<p style="margin-left:36pt;text-indent:-36pt">${r.html}</p>`).join(""), l.map(r => r.text).join("\n\n"), "📋 Bibliographie copiée");
  };
  $("bdoc").onclick = exportBiblioWord;
  $("btxt").onclick = () => { const l = biblioListe(); if (l.length) telecharger(new Blob([l.map(r => r.text).join("\n\n")], { type: "text/plain;charset=utf-8" }), "bibliographie-" + stamp() + ".txt"); };
  $("bprint").onclick = () => window.print();
}

function renderBiblio() {
  const l = biblioListe();
  $("biblist").innerHTML = `<h2 style="margin-top:0;font-size:16px">Références (${l.length})</h2>
   <div class="note noprint">Classées par ordre alphabétique d’auteur (APA 7). Les références marquées « incomplète » n’ont pas encore de revue ou de pages : complétez-les dans le formulaire de la lecture.</div>
   <div class="biblio">${l.length ? l.map(r => `<p>${r.html}${r.incomplet ? '<span class="warn noprint">⚠ incomplète</span>' : ""}</p>`).join("") : '<div class="empty">Aucune référence à afficher.</div>'}</div>`;
}

function telecharger(blob, nom) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = nom;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}

function exportBiblioWord() {
  const l = biblioListe();
  if (!l.length) return;
  // Word ouvre ce HTML tel quel : retrait suspendu de 1,27 cm et interligne double, comme l'exige l'APA.
  const html = `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40"><head><meta charset="utf-8"><title>Références</title></head>
<body style="font-family:'Times New Roman',serif;font-size:12pt"><h1 style="font-size:14pt;text-align:center">Références</h1>
${l.map(r => `<p style="margin:0 0 0 36pt;text-indent:-36pt;line-height:200%">${r.html}</p>`).join("\n")}</body></html>`;
  telecharger(new Blob(["﻿" + html], { type: "application/msword" }), "bibliographie-" + stamp() + ".doc");
}

/* ---------- Synthèse ---------- */

function barres(titre, entrees, couleur) {
  if (!entrees.length) return "";
  const max = Math.max(...entrees.map(e => e[1]));
  return `<div class="card"><h3>${titre}</h3>${entrees.map(([lib, n, c]) =>
    `<div class="bar"><span class="bl" title="${esc(lib)}">${esc(lib)}</span><div class="bt"><div class="bf" style="width:${Math.round(n / max * 100)}%;background:${esc(c || couleur)}"></div></div><span class="bn">${n}</span></div>`).join("")}</div>`;
}

function compter(valeurs, max) {
  const m = new Map();
  valeurs.forEach(v => { const k = cleTitre(v); if (!k) return; const e = m.get(k) || [String(v).trim(), 0]; e[1]++; m.set(k, e); });
  return [...m.values()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "fr")).slice(0, max);
}

function renderSynth() {
  if (!items.length) { $("synthbox").innerHTML = '<div class="card empty">Pas encore de données à synthétiser.</div>'; return; }
  const fin = items.filter(i => i.statut === "Terminée").length;
  const annees = new Map();
  const arts = parArticle(items);
  arts.forEach(i => { const a = (/^(\d{4})/.exec(i.parution || "") || [])[1]; if (a) annees.set(a, (annees.get(a) || 0) + 1); });
  const parAnnee = [...annees.entries()].sort((a, b) => a[0].localeCompare(b[0])).slice(-12);
  const kpi = (n, t) => `<div class="kpi"><b>${n}</b>${t}</div>`;
  $("synthbox").innerHTML = `<div class="kpis">${kpi(items.length, "lectures")}${kpi(fin, "terminées")}${kpi(items.length - fin, "en cours")}${kpi(comments.length, "commentaires")}</div>
   <div class="synth">
   ${barres("Lectures par étudiant", students().map(s => [s.prenom, items.filter(i => i.etudiant === s.prenom).length, s.couleur]), "var(--pri)")}
   ${barres("Types d’articles", compter(arts.map(i => i.type), 8), "var(--pri)")}
   ${barres("Nationalité des auteurs", compter(arts.map(i => i.nation), 10), "var(--pri)")}
   ${barres("Qualité des auteurs (plusieurs possibles par lecture)", compter(arts.flatMap(i => metiersListe(i.qualite)), 8), "var(--pri)")}
   ${barres("Années de parution", parAnnee, "var(--pri)")}
   ${barres("Mots-clés les plus fréquents", compter(items.flatMap(i => motsListe(i.mots)), 12), "var(--pri)")}
   </div>`;
}

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
    // Pas de reconstruction si rien n'a changé ou si une saisie est en cours (sinon elle serait perdue).
    const a = document.activeElement;
    const typing = a && a.closest && a.closest("#adminbox") && (a.tagName === "INPUT" || a.tagName === "SELECT");
    acces = next;
    if (signatureAcces(next) + sigFeedbacks() !== renderedAcces && !typing) renderAdmin();
  } catch (e) { if (e.code === "unauthorized") sessionError(e); else showStatus("Administration indisponible : " + e.message); }
}

function accesRow(a) {
  const sup = isSuper();
  const k = esc(a.email);
  const dates = `<td>${esc(fmtDT(a.demande_le))}</td><td>${esc(fmtDT(a.derniere_connexion))}</td>`;
  // Un étudiant ne peut pas gérer les étudiants ; l'administrateur, si.
  if (a.protege && !sup) return `<tr><td>${k}</td>${dates}<td>${esc(a.prenom)}</td><td>Étudiant</td><td class="meta">Géré par l’administrateur</td></tr>`;
  const dem = a.statut === "en_attente" && a.demande ? a.demande : null;
  const veut = dem && dem.role ? dem.role : a.role;
  if (dem && dem.role === "etudiant" && !sup) return `<tr><td>${k}</td>${dates}<td>${esc(a.prenom)}</td><td>Étudiant</td><td class="meta">Demande en tant qu’étudiant : validée par l’administrateur${dem.promo ? " (" + esc(dem.promo) + ")" : ""}</td></tr>`;
  const opt = (v, lbl) => `<option value="${v}" ${veut === v ? "selected" : ""}>${lbl}</option>`;
  const roles = (sup ? opt("etudiant", "Étudiant") : "") + opt("formateur", "Formateur");
  const acts = a.statut === "actif"
    ? `<button class="btn sm" data-as="actif">Enregistrer</button> <button class="btn sm sec del" data-as="refuse">Retirer l’accès</button>`
    : a.statut === "en_attente"
      ? `<button class="btn sm" data-as="actif">Valider</button> <button class="btn sm sec del" data-as="refuse">Refuser</button>`
      : `<button class="btn sm" data-as="actif">Réactiver</button>`;
  const suppr = sup ? ` <button class="btn sm sec del" data-del="1" title="Supprimer complètement cet utilisateur">🗑 Supprimer</button>` : "";
  const adresse = sup ? `<td><input data-f="nouvel_email" type="email" value="${k}"></td>` : `<td>${k}</td>`;
  const couleur = sup ? `<td><input data-f="couleur" type="color" value="${esc(a.couleur)}" style="min-width:48px;padding:2px"></td>` : "";
  return `<tr data-k="${k}">${adresse}${dates}<td><input data-f="prenom" maxlength="60" value="${esc(a.prenom)}" placeholder="Prénom">${dem && (dem.promo || dem.role) ? `<div class="meta">Demande : ${esc(dem.role === "etudiant" ? "étudiant" : dem.role === "formateur" ? "formateur" : "")}${dem.promo ? " · " + esc(dem.promo) : ""}</div>` : ""}</td>${couleur}
    <td><select data-f="role">${roles}</select></td><td>${acts}${suppr}</td></tr>`;
}

let renderedAcces = "";
// Le rendu dépend du rôle (étudiant ou administrateur) autant que de la liste : les deux entrent dans la signature.
const signatureAcces = l => (me ? me.role : "") + "|" + JSON.stringify([l, groupesAdmin, structureAdmin]);
function renderAdmin() {
  renderedAcces = signatureAcces(acces) + sigFeedbacks();
  const head = `<tr><th>Adresse</th><th>Demande</th><th>Dernière connexion</th><th>Prénom</th>${isSuper() ? "<th>Couleur</th>" : ""}<th>Rôle</th><th>Actions</th></tr>`;
  const bloc = (titre, list, vide) => `<h3>${titre} (${list.length})</h3>` + (list.length
    ? `<div class="wrap"><table class="adm"><thead>${head}</thead><tbody>${list.map(accesRow).join("")}</tbody></table></div>`
    : `<div class="meta">${vide}</div>`);
  $("adminbox").innerHTML =
    bloc("⏳ Demandes en attente", acces.filter(a => a.statut === "en_attente"), "Aucune demande en attente.") +
    bloc(isSuper() ? "✅ Accès actifs" : "✅ Formateurs de vos groupes", acces.filter(a => a.statut === "actif"), "Aucun accès actif.") +
    (isSuper() ? bloc("⛔ Accès refusés", acces.filter(a => a.statut === "refuse"), "Aucun accès refusé.") : "") +
    (isSuper() ? blocGroupes() + blocFeedbacks() : "");
}

async function supprimerUtilisateur(b) {
  const email = b.closest("tr").dataset.k;
  const a = acces.find(x => x.email === email);
  if (!a) return;
  const n = a.nb_lectures || 0;
  const garde = n ? `\n\nSes ${n} lecture${n > 1 ? "s" : ""} et ses commentaires sont conservés dans le Google Sheet mais ne seront plus affichés (ses commentaires sur les lectures des autres apparaîtront sous « Utilisateur supprimé »).` : "";
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

/* ---------- Exports ---------- */

function exportXlsx() {
  if (typeof XLSX === "undefined") { alert("Module Excel non chargé."); return; }
  const head = ["Groupe", "Étudiant", "Statut", "Titre", "Date de parution", "Auteur", "Qualité de l’auteur", "Nationalité", "Type d’article", "Mots-clés", "Keywords (EN)", "Concepts en sciences infirmières", "Objet / sujet principal", "Opinion de l’auteur", "Controverse", "Libre", "Référence APA", "Date de saisie", "Lien"];
  const rows = filtered().map(i => [i.groupe, i.etudiant, i.statut === "En cours" ? "En cours de lecture" : "Terminée", i.titre, fmtD(i.parution), i.auteur, i.qualite, i.nation, i.type, i.mots, i.kw, i.concepts, i.objet, i.opinion, i.controverse, i.libre, LydiaApa.apa(i).text, fmtD(i.ajoute), urlSure(i.lien)].map(v => v || ""));
  const ws = XLSX.utils.aoa_to_sheet([head, ...rows]);
  ws["!cols"] = [18, 12, 16, 40, 14, 24, 20, 14, 22, 28, 28, 36, 36, 36, 30, 24, 50, 14, 40].map(w => ({ wch: w }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Lectures");
  XLSX.writeFile(wb, "lectures-memoire-" + stamp() + ".xlsx");
}

function exportPdf() {
  if (!window.jspdf) { alert("Module PDF non chargé."); return; }
  const doc = new window.jspdf.jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
  doc.setFontSize(13); doc.text("Lectures du mémoire - IFSI", 10, 10);
  doc.setFontSize(8); doc.text("Export du " + fmtD(new Date().toISOString()), 10, 15);
  const l = filtered();
  const body = l.map(i => [i.etudiant + "\n" + (i.statut === "En cours" ? "(en cours)" : "(terminée)"),
    (i.titre || "") + "\nParution : " + (fmtD(i.parution) || "-") + "\nAuteur : " + (i.auteur || "-") + " (" + (i.qualite || "-") + ")\nNationalité : " + (i.nation || "-") + "\nType : " + (i.type || "-") + "\nSaisi le " + fmtD(i.ajoute) + (urlSure(i.lien) ? "\nLien : " + urlSure(i.lien) : ""),
    i.mots || "", i.kw || "", i.concepts || "", i.objet || "", i.opinion || "", i.controverse || "", i.libre || "", LydiaApa.apa(i).text]);
  doc.autoTable({
    startY: 18,
    head: [["Étudiant", "1 - Article", "2 - Mots-clés", "3 - Keywords", "4 - Concepts", "5 - Objet / sujet", "6 - Opinion", "7 - Controverse", "8 - Libre", "9 - Référence APA"]],
    body,
    styles: { fontSize: 6.5, cellPadding: 1.5, overflow: "linebreak", valign: "top" },
    headStyles: { fillColor: [47, 95, 208] },
    columnStyles: { 0: { cellWidth: 20, textColor: 255, fontStyle: "bold" }, 1: { cellWidth: 50 } },
    didParseCell: d => { if (d.section === "body" && d.column.index === 0) d.cell.styles.fillColor = l[d.row.index].couleur || "#888888"; }
  });
  doc.save("lectures-memoire-" + stamp() + ".pdf");
}

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
    else { msg.dataset.sig = ""; msg.textContent = isSuper() ? "Aucun groupe n’existe encore : créez-en un dans l’onglet « Administration »."
      : "Aucun groupe ne vous est affecté pour le moment : contactez l’administrateur."; }
  }
  msg.classList.toggle("hidden", !(me && !g));
  $("sub").textContent = !g ? "Outil partagé de suivi des lectures de mémoire"
    : ctx.vue === "promo" ? `${g.etablissement} · ${g.promo} — fiches partagées par tous les groupes`
      : `${g.etablissement} · ${g.promo} · ${g.nom} — ${g.membres.filter(m => m.role === "etudiant").map(m => m.prenom).join(", ") || "aucun étudiant"}`;
  if (!g) { bar.classList.add("hidden"); bar.innerHTML = ""; ctxSig = ""; return; }
  bar.classList.remove("hidden");
  const avecVue = !["mine", "suivi", "admin"].includes(tab);   // groupe / promo n'a de sens que pour tableau, commentaires, biblio, synthèse
  const sig = JSON.stringify([avecVue, ctx.gid, ctx.vue, groupes.map(x => [x.id, x.nom, x.promo, x.etablissement, nonLusDe(x, "groupe")]), nonLusDe(g, "promo"), votesAFaire(g), votes.filter(v => v.groupe_id === g.id).length]);
  if (sig === ctxSig && bar.innerHTML) return;
  ctxSig = sig;
  const nvG = nonLusDe(g, "groupe"), nvP = nonLusDe(g, "promo"), vf = votesAFaire(g);
  const pastille = n => n ? ` <span class="count">${n}</span>` : "";
  const choix = groupes.length > 1
    ? `<label class="meta" for="ctxg" style="margin:0">Groupe</label><select id="ctxg" aria-label="Choisir le groupe">${groupes.map(x => { const n = nonLusDe(x, "groupe"); return `<option value="${esc(x.id)}" ${x.id === g.id ? "selected" : ""}>${esc(x.etablissement)} · ${esc(x.promo)} — ${esc(x.nom)}${n ? " (" + n + " non lu" + (n > 1 ? "s" : "") + ")" : ""}</option>`; }).join("")}</select>`
    : `<span class="meta">${esc(g.nom)}</span>`;
  bar.innerHTML = `${choix}
    ${avecVue ? `<span class="seg"><button type="button" class="btn sm sec ${ctx.vue === "promo" ? "" : "on"}" id="vg" aria-pressed="${ctx.vue !== "promo"}">👥 Mon groupe${ctx.vue === "promo" ? pastille(nvG) : ""}</button><button type="button" class="btn sm sec ${ctx.vue === "promo" ? "on" : ""}" id="vp" aria-pressed="${ctx.vue === "promo"}">🌐 Toute la promo${ctx.vue === "promo" ? "" : pastille(nvP)}</button></span>` : ""}
    <button type="button" class="btn sm sec" id="gbtn">⚙️ Membres et votes${pastille(vf)}</button>`;
  if ($("ctxg")) $("ctxg").onchange = e => changerContexte({ gid: e.target.value });
  if ($("vg")) { $("vg").onclick = () => changerContexte({ vue: "groupe" }); $("vp").onclick = () => changerContexte({ vue: "promo" }); }
  $("gbtn").onclick = ouvrirGroupe;
}

function changerContexte(c) {
  if (c.gid !== undefined) ctx.gid = c.gid;
  if (c.vue !== undefined) ctx.vue = c.vue;
  try { localStorage.setItem("lydia_groupe", ctx.gid); localStorage.setItem("lydia_portee", ctx.vue); } catch (e) { /* ignoré */ }
  fermerDiscussion(true); fermerGroupe(true);
  closeDrawer(true);
  openRows.clear();
  Object.assign(F, { q: "", who: "", st: "", type: "", kw: "", kwLabel: "" });
  B.who = "";
  deriver();
  studentsSig = JSON.stringify(students());
  renderCtx();
  renderFilters();
  renderMine(); renderTable(); renderComments();
  if (tab === "biblio") { renderBiblioTools(); renderBiblio(); }
  if (tab === "synth") renderSynth();
}

/* ----- Fenêtre « Membres et votes » ----- */

const GM = { ouvert: false, cand: null };

function ouvrirGroupe() {
  if (!groupeCourant()) return;
  GM.ouvert = true; GM.cand = null; GM.focus = document.activeElement;
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
    : v.type === "retrait" ? `Retirer <b>${esc(v.cible)}</b> du groupe ?` : `Renommer le groupe en <b>« ${esc(v.valeur)} »</b> ?`;
  const etat = `${v.oui} oui · ${v.non} non — ${v.besoin} oui nécessaires sur ${v.n} votant${v.n > 1 ? "s" : ""}`;
  let actions = "";
  if (!canWrite()) actions = "";
  else if (!v.peut_voter) actions = '<div class="meta">Vous êtes concerné(e) par cette proposition : vous ne votez pas.</div>';
  else actions = `<div class="votes"><button type="button" class="btn sm ${v.mon_vote === 1 ? "" : "sec"}" data-vote="${esc(v.id)}" data-oui="1" aria-pressed="${v.mon_vote === 1}">👍 Oui</button><button type="button" class="btn sm ${v.mon_vote === 0 ? "" : "sec"}" data-vote="${esc(v.id)}" data-oui="0" aria-pressed="${v.mon_vote === 0}">👎 Non</button>${v.proposant ? `<button type="button" class="btn sm sec del" data-vcancel="${esc(v.id)}">Annuler ma proposition</button>` : ""}</div>`;
  return `<div class="vote ${v.peut_voter && v.mon_vote === null ? "attente" : ""}"><div>${q}</div><div class="meta">${v.type === "adhesion" ? "Demande de" : "Proposé par"} ${esc(v.propose_par)} · ${etat} · jusqu’au ${esc(dateCourte(v.expire_le))}</div>${actions}</div>`;
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
  $("gtitle").textContent = "👥 " + g.nom;
  $("gsub").textContent = `${g.etablissement} · ${g.promo}`;
  $("gbody").innerHTML = `
    <div class="gsec" style="border-top:0;padding-top:0"><h3>Votes en cours (${mesVotes.length})</h3>
      <div class="cmbox">${mesVotes.length ? mesVotes.map(voteHtml).join("") : '<div class="meta">Aucune proposition en cours.</div>'}</div></div>
    <div class="gsec"><h3>Membres (${g.membres.length})</h3>${membres}
      <div style="margin-top:8px">${ajout}</div>
      ${canWrite() ? `<div class="meta" style="margin-top:6px">Un membre peut en ajouter un autre tout de suite. Pour retirer quelqu’un, les autres étudiants du groupe votent : la majorité simple suffit (la proposition expire après 7 jours${nbEtu < 3 ? " ; à deux étudiants, le retrait passe par l’administrateur" : ""}).</div>` : ""}</div>
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
  if (d.vr) {
    if (!confirm(`Proposer le retrait de ${d.nom} du groupe ?\n\nLes autres étudiants du groupe (hors ${d.nom}) voteront ; la majorité simple suffit.`)) return;
    return actionGroupe(() => api("vote_propose", { groupe_id: g.id, type: "retrait", pid: d.vr }), "Proposition impossible");
  }
  if (b.id === "gcand") {
    try { GM.cand = (await api("member_candidates", { groupe_id: g.id })).candidats; renderGroupe(); }
    catch (err) { if (err.code === "unauthorized") sessionError(err); else alert("Liste indisponible : " + err.message); }
  } else if (b.id === "gcancel") { GM.cand = null; renderGroupe(); }
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
  const blocCode = p => {
    const fmt = c => c.replace(/(.{4})(.{4})/, "$1 $2");
    const actif = p.code && p.code_actif;
    return `<div class="grow admcode" data-pid="${esc(p.id)}">${p.code ? `<span>🔑 Code : <b class="code">${esc(fmt(p.code))}</b> <span class="meta">${actif ? "expire le " + esc(new Date(p.code_expire).toLocaleDateString("fr-FR")) : "expiré"} · ${p.code_usages}/${p.code_max} utilisation${p.code_max > 1 ? "s" : ""}</span></span>
        <button type="button" class="btn sm sec" data-s="code_copy" data-code="${esc(p.code)}">Copier</button><button type="button" class="btn sm sec del" data-s="promo_code_revoke">Révoquer</button>` : '<span class="meta">Aucun code d’invitation.</span>'}
      <label class="meta" style="margin:0">validité (jours)</label><input data-sf="jours" type="number" min="1" max="365" value="30" style="width:70px" aria-label="Validité en jours">
      <label class="meta" style="margin:0">utilisations max.</label><input data-sf="max" type="number" min="1" max="1000" value="150" style="width:80px" aria-label="Nombre d’utilisations maximal">
      <button type="button" class="btn sm" data-s="promo_code">${p.code ? "Générer un nouveau code" : "🔑 Générer un code"}</button></div>`;
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
    <div class="note">Établissement → promo → groupe. Un étudiant n’est que dans un groupe par promo ; un formateur peut être rattaché à plusieurs groupes (il ne voit que ceux-là, et les fiches de lecture terminées de leur promo). Renommer un établissement ou une promo met à jour tous ses groupes. On ne supprime un établissement qu’une fois ses promos supprimées, une promo qu’une fois ses groupes supprimés. Supprimer un groupe conserve ses fiches dans le Google Sheet mais ne les affiche plus.</div>
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
  else if (a === "code_copy") { try { await navigator.clipboard.writeText(b.dataset.code); b.textContent = "Copié ✓"; } catch (e) { prompt("Code d’invitation :", b.dataset.code); } return; }
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
    if (!g || !confirm(`Supprimer le groupe « ${g.nom} » ?\n\nSes membres sont détachés. Ses fiches et commentaires restent dans le Google Sheet mais ne sont plus affichés.`)) return;
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

/* ---------- Démarrage ---------- */

function renderAll() {
  renderMe();
  renderCtx();
  $("tabs").classList.remove("hidden");
  majOnglets();
  setTab(tab);
  if (canWrite()) renderMine();
  renderPending();
  renderComments();
  renderOnline();
  renderFilters();
  renderTable();
  majBarres();
}

renderMeAnonyme();
initGoogle();
