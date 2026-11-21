/* Configuration, état partagé, appels à l'API, connexion Google et démarrage de la session.
   Script classique : partage la portée globale avec les autres fichiers de js/ (ordre de chargement : voir index.html). */
"use strict";

// Une erreur de script ne doit pas passer inaperçue : on l'affiche en haut de page (aide au diagnostic).
function signalerErreur(msg, ligne, fichier) {
  const z = document.getElementById("status");
  if (!z) return;
  z.textContent = "Erreur d’affichage : " + msg + (ligne ? " (" + (fichier ? String(fichier).split("/").pop().split("?")[0] : "script") + ", ligne " + ligne + ")" : "") + ". Si elle persiste, notez ce message dans un retour sur l’outil.";
  z.classList.remove("hidden");
}
window.addEventListener("error", e => signalerErreur(e.message || "inconnue", e.lineno, e.filename));
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
let structureAdmin = [], adminFerme = new Set(), reunionsAll = [], jalonsAll = [], termesAll = [], groupes = [], votes = [], itemsAll = [], commentsAll = [], groupesAdmin = [], promosMoi = [], rattachements = [], fichiers = [], stockage = null, feedbacksAdmin = [];
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
const filtresVierges = () => ({ q: "", who: [], grp: [], st: [], type: [], kw: [], kwLabels: {}, mode: { who: "ou", grp: "ou", st: "ou", kw: "ou", q: "et" } });
const F = Object.assign(filtresVierges(), { sort: "ajoute",
  view: lsGet("lydia_vue", matchMedia("(max-width:700px)").matches ? "liste" : "tableau") });
const masquees = new Set((() => { try { return JSON.parse(lsGet("lydia_cols2", "[]")); } catch (e) { return []; } })());

// etudiant : écrit, administre et commente ; formateur : lit et commente (dans ses groupes) ; admin : gère tout.
const canWrite = () => !!me && me.role === "etudiant";
const canComment = () => !!me && (me.role === "formateur" || me.role === "etudiant");
const canAdmin = () => !!me && (me.role === "etudiant" || me.role === "admin" || adminDelegue());   // valide les accès, modère
const isSuper = () => !!me && me.role === "admin";                                // gère aussi les étudiants

/* ---------- API ---------- */

// « Voir en tant que » (administrateur général) : identifiant public de la personne consultée, gardé le temps de l'onglet.
let VUE_AS = null;
const asDemande = () => { try { return sessionStorage.getItem("lpc_as") || undefined; } catch (e) { return undefined; } };

async function api(action, payload = {}) {
  let j;
  try {
    const res = await fetch(CFG.API_URL, {
      method: "POST",
      // text/plain évite la requête de pré-vérification CORS, non gérée par Apps Script
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({ action, token, as: asDemande(), ...payload })
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
  dernierEtat = null;
  closeDrawer(true);
  token = null; me = null; users = []; items = []; comments = []; acces = []; pendingCount = 0;
  groupes = []; votes = []; promosMoi = []; rattachements = []; fichiers = []; stockage = null; feedbacksAdmin = []; fermerFeedback(true); fermerHistorique(); fermerJeu(); $("fbopen")?.classList.add("hidden"); dataSig = ""; itemsAll = []; commentsAll = []; groupesAdmin = []; structureAdmin = []; studentsSig = ""; ctxSig = ""; GM.cand = null; GM.fcand = null; fermerGroupe(true);
  try { fermerNotes(); N.notes = []; } catch (e) { /* pas encore défini */ }
  try { fermerChat(true); } catch (e) { /* pas encore défini */ }
  editing = null; artCible = ""; modeArticle = false; forceStatut = "";
  openRows.clear(); openArts.clear(); fermesArts.clear(); fermerDiscussion(true); lusSet = new Set(); lusEnvoi.clear(); nonLusEnvoi.clear(); frais.clear(); Object.assign(CM, { nonLus: false, miennes: false });
  Object.keys(drafts).forEach(k => delete drafts[k]);
  Object.assign(F, filtresVierges(), { sort: "ajoute" });
  B.who = ""; B.enCours = false;
  enLigne = []; enLigneSig = "";
  tab = "all"; try { sessionStorage.removeItem("lpc_tab"); } catch (e) { /* ignoré */ } vuDepuis = null; renderedAcces = ""; derniereSync = null; usersChanged = false;
  ["rows", "cards", "mylist", "mysum", "adminbox", "bibtools", "biblist", "synthbox", "cmtsbox", "cmbody", "online", "filters", "stats", "form", "ctxbar", "gbody"].forEach(id => { $(id).innerHTML = ""; });
  $("pending").textContent = ""; $("cmtcount").textContent = "";
  document.body.classList.remove("nogroup");
  $("nogroup").innerHTML = ""; $("nogroup").dataset.sig = ""; $("accueil").innerHTML = ""; $("accueil").classList.add("hidden");
  $("sub").textContent = "Outil partagé de suivi des lectures de mémoire";
}

function logout() {
  marquerVu();
  if (token && !VUE_AS) api("bye").catch(() => {});
  try { sessionStorage.removeItem("lpc_as"); } catch (e) { /* ignoré */ }
  VUE_AS = null; document.getElementById("asbar")?.remove(); document.body.classList.remove("avec-asbar");   // disparaît tout de suite de la liste des personnes en ligne
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
  if (isSuper()) ctx.vue = "promo";   // l'administrateur voit toujours toute la promo
  // Vue promo : les fiches terminées de toute la promo, plus celles (même en cours) du groupe affiché, déjà visibles de ses membres.
  const monG = groupes.some(x => x.id === g.id);
  items = ctx.vue === "promo" ? itemsAll.filter(i => (i.portee === "promo" && memePromo(i, g)) || (monG && i.groupe_id === g.id)) : itemsAll.filter(i => i.groupe_id === g.id);
  const ids = new Set(items.map(i => i.id));
  comments = commentsAll.filter(c => ids.has(c.lecture_id) && (ctx.vue === "promo" ? c.portee === "promo" : c.portee !== "promo"));
}

// Signature des données utiles (hors « en ligne ») : une actualisation qui ne change rien ne reconstruit pas le tableau.
let dataSig = "";
// Dernier état complet reçu : une écriture ne renvoie que les sections modifiées (j.partiel), on les fusionne avec lui.
let dernierEtat = null;
function applyData(j) {
  if (j.partiel) j = Object.assign({}, dernierEtat, j);
  dernierEtat = j;
  const sig = JSON.stringify([j.utilisateurs, j.groupes, j.votes, j.propositions, j.promosMoi, j.rattachements, j.fichiers, j.reunions, j.jalons, j.termes, j.lectures, j.commentaires, j.lus, j.enAttente]);
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
  rattachements = j.rattachements || [];
  fichiers = j.fichiers || [];
  itemsAll = j.lectures;
  props = j.propositions || [];
  reunionsAll = j.reunions || [];
  jalonsAll = j.jalons || [];
  termesAll = j.termes || [];
  commentsAll = j.commentaires || [];
  deriver();
  // La liste des étudiants (filtres, statistiques) dépend de la vue : on ne reconstruit les filtres que si elle change.
  const sig = JSON.stringify(students());
  usersChanged = sig !== studentsSig;
  studentsSig = sig;
  // Un filtre sur un étudiant qui n'est plus dans la vue n'a plus de sens.
  F.who = F.who.filter(n => students().some(u => u.prenom === n));
  F.grp = F.grp.filter(n => groupesListe().includes(n));
  if (B.who && !students().some(u => u.prenom === B.who)) B.who = "";
  enLigne = j.enLigne || [];
  lusSet = new Set((j.lus || []).concat([...lusEnvoi]).filter(id => !nonLusEnvoi.has(id)));
  pendingCount = j.enAttente || 0;
}

// Les écritures renvoient les données à jour : on les applique sans second appel.
function applyResult(j) {
  if (!j || !(j.lectures || (j.partiel && dernierEtat))) return;
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
  etape("chat", majChat);
  etape("onglet", () => {
    if (tab === "biblio") renderBiblio();
    if (tab === "synth") renderSynth();
    if (tab === "home") renderHome();
    if (tab === "dash") renderDash();
    if (tab === "suivi") renderSuivi();
    if (tab === "glossaire") renderGlossaire();
  });
  etape("barres", majBarres);
}

// Onglet de suivi (selon le groupe), alertes du rétroplanning, lien de retour : à rafraîchir après CHAQUE affichage
// (première connexion, actualisation automatique, action), pas seulement après une action.
// Onglets selon la personne : « Mes lectures » réservé aux étudiants, « Suivi de projet » à qui a un groupe,
// « Administration » à l'administrateur et aux étudiants qui ont un groupe (un formateur ne l'a jamais).
function majOnglets() {
  const vis = { mine: canWrite(), dash: !!me && (me.role === "formateur" || isSuper()), suivi: !!groupeCourant(), glossaire: !!groupeCourant(), admin: canAdmin() && (isSuper() || adminDelegue() || !!groupeCourant()) };
  Object.keys(vis).forEach(t => document.querySelector(`.tab[data-t="${t}"]`).classList.toggle("hidden", !vis[t]));
  if (vis[tab] === false) setTab("all");
  majSections();
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

// Demande en attente : la page revérifie toute seule, sans qu'il faille recharger ou cliquer.
let essaiTimer = null;
function programmerNouvelEssai() {
  clearTimeout(essaiTimer);
  essaiTimer = setTimeout(() => { if (!me && token && !document.hidden) boot(); else if (!me && token) programmerNouvelEssai(); }, 30000);
}
const MSG_ATTENTE = " Cette page vérifie toutes les 30 secondes si votre demande a été validée.";

let bootEnCours = false;
async function boot() {
  if (bootEnCours) return;                      // évite un second « init » si on reclique pendant l'attente
  bootEnCours = true;
  gateAttente("Connexion en cours… vérification de votre compte");
  try {
    const j = await api("init");
    clearTimeout(essaiTimer);
    me = j.me;
    VUE_AS = j.vue_en_tant_que || null;
    if (VUE_AS) bandeauAs(VUE_AS.nom);
    chargerVu();
    applyData(j);
    clearTimeout(attenteTimer);
    $("gate").classList.add("hidden");
    $("app").classList.remove("hidden");
    clearStatus();
    const retour = ongletMemorise();   // lue avant renderAll, qui réaffiche l'onglet par défaut
    renderAll();
    setTab(retour && ongletVisible(retour) ? retour : "home");   // une actualisation de la page garde la page affichée (accueil à la première connexion)
    if (!VUE_AS) chargerNotes();
    startPolling();
    if (me.consentement === false && !VUE_AS) demanderConsentement(me.consent_version);
  } catch (e) {
    if (asDemande() && e.code !== "unauthorized" && e.code !== "network") {   // « voir en tant que » impossible : on revient à sa propre vue
      try { sessionStorage.removeItem("lpc_as"); } catch (x) { /* ignoré */ }
      showGate("Vue « en tant que » impossible (" + e.message + "). Rechargez la page pour revenir à votre compte.");
    } else if (e.code === "unauthorized") sessionError(e);
    else if (e.code === "pending") { showGate(e.message + MSG_ATTENTE, true); afficherAccueil(); programmerNouvelEssai(); }
    else if (e.code === "forbidden") {   // accès refusé : le jeton est oublié, la reconnexion automatique coupée, pour pouvoir changer de compte
      token = null;
      try { sessionStorage.removeItem("lydia_token"); } catch (x) { /* ignoré */ }
      if (window.google) google.accounts.id.disableAutoSelect();
      showGate(e.message + ". Connectez-vous avec un autre compte Google si besoin.");
    }
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
    if (tab === "home") renderHome();
    if (tab === "dash") renderDash();
    renderOnline();
    majModal();
    if (tab === "biblio") renderBiblio();
    if (tab === "synth") renderSynth();
    if (tab === "suivi") renderSuivi();
    if (tab === "glossaire") renderGlossaire();
    majBarres();
    if (tab === "admin" && canAdmin()) await loadAdmin();
    clearStatus();
  } catch (e) {
    if (e.code === "unauthorized") sessionError(e);
    else if (e.code === "forbidden" || e.code === "pending") {   // l'accès a été retiré ou suspendu pendant la session
      if (timer) clearInterval(timer);
      reinitialiserEtat();
      showGate(e.code === "pending" ? e.message + MSG_ATTENTE : e.message, e.code === "pending");
      if (e.code === "pending") { afficherAccueil(); programmerNouvelEssai(); }
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
