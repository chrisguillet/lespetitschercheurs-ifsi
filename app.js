"use strict";

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
let editing = null, override = false, tab = "all", timer = null;
const drafts = {};          // brouillons de commentaires, par lecture
const openCm = new Set();   // lectures dont les commentaires sont dépliés
const lsGet = (k, d) => { try { return localStorage.getItem(k) || d; } catch (e) { return d; } };
const F = { q: "", who: "", st: "", type: "", kw: "", kwLabel: "", sort: "ajoute",
  view: lsGet("lydia_vue", matchMedia("(max-width:700px)").matches ? "cartes" : "tableau") };
const masquees = new Set((() => { try { return JSON.parse(lsGet("lydia_cols", "[]")); } catch (e) { return []; } })());

// etudiant : écrit et administre ; formateur : lit et commente ; lecteur : lit.
const canWrite = () => !!me && me.role === "etudiant";
const canComment = () => !!me && me.role === "formateur";
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
    throw err;
  }
  return j;
}

/* ---------- Connexion ---------- */

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
  $("gate").classList.remove("hidden");
  $("app").classList.add("hidden");
  $("tabs").classList.add("hidden");
  renderMeAnonyme();
  $("retry").classList.toggle("hidden", !retry);
  if (msg) $("gatemsg").textContent = msg;
}

function logout() {
  marquerVu();
  closeDrawer(true);
  token = null; me = null; items = []; comments = []; acces = []; editing = null; override = false;
  try { sessionStorage.removeItem("lydia_token"); } catch (e) { /* ignoré */ }
  if (timer) clearInterval(timer);
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

let derniereSync = null;
function majSync() {
  const el = $("sync");
  if (el && derniereSync) el.textContent = "mis à jour à " + derniereSync.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
}

function applyData(j) {
  derniereSync = new Date();
  majSync();
  items = j.lectures;
  comments = j.commentaires || [];
  pendingCount = j.enAttente || 0;
}

// Les écritures renvoient les données à jour : on les applique sans second appel.
function applyResult(j) {
  if (!j || !j.lectures) return;
  applyData(j);
  renderData();
}

function renderData() {
  renderMine();
  renderTable();
  renderPending();
  if (tab === "biblio") renderBiblio();
  if (tab === "synth") renderSynth();
}

// Affiche l'attente le temps d'une écriture (l'API peut mettre quelques secondes à répondre).
async function enCours(msg, fn) {
  showStatus("⏳ " + msg);
  try { return await fn(); } finally { clearStatus(); }
}

async function boot() {
  try {
    const j = await api("init");
    me = j.me; users = j.utilisateurs;
    chargerVu();
    applyData(j);
    $("gate").classList.add("hidden");
    $("app").classList.remove("hidden");
    clearStatus();
    renderAll();
    startPolling();
  } catch (e) {
    if (e.code === "unauthorized") sessionError(e);
    else if (e.code === "pending") showGate(e.message, true);
    else if (e.code === "forbidden") showGate(e.message + ". Changez de compte si besoin.");
    else showGate("Erreur : " + e.message);
  }
}

async function refresh(manuel) {
  if (!token || !me) return;
  if (manuel === true) showStatus("⏳ Actualisation…");
  try {
    applyData(await api("list"));
    // On ne reconstruit pas le tableau pendant qu'un commentaire est en cours de saisie.
    const a = document.activeElement;
    const typing = a && a.tagName === "TEXTAREA" && a.closest("#rows, #cards");
    renderMine();
    if (!typing) renderTable();
    renderPending();
    if (tab === "biblio") renderBiblio();
    if (tab === "synth") renderSynth();
    if (tab === "admin" && canAdmin()) await loadAdmin();
    clearStatus();
  } catch (e) {
    if (e.code === "unauthorized") sessionError(e);
    else showStatus("Actualisation impossible : " + e.message);
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

const students = () => users.filter(u => u.role === "etudiant");

const ROLE_NOM = { etudiant: "Étudiant", formateur: "Formateur · lecture et commentaires", lecteur: "Lecteur · lecture seule", admin: "Administrateur" };

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
  $("me").innerHTML = `<details class="colmenu acct"><summary class="btn sm sec acctbtn" aria-label="Menu du compte : ${esc(me.prenom)}">
      <span class="avatar" style="--c:${esc(me.couleur)}">${esc(String(me.prenom || "?").trim().charAt(0).toUpperCase())}</span><span class="acctname">${esc(me.prenom)}</span> ▾</summary>
    <div class="colpop right acctpop">
      <div class="acctwho"><span class="meta">Connecté(e) :</span> <b>${esc(me.prenom)}</b><div class="meta">${esc(ROLE_NOM[me.role] || me.role)}</div></div>
      <button type="button" class="btn sm sec" id="themebtn"></button>
      <button type="button" class="btn sm sec" id="logout">Se déconnecter</button>
    </div></details>`;
  $("logout").onclick = logout;
  $("themebtn").onclick = basculerTheme;
  majLibelleTheme();
}

function renderMeAnonyme() {
  $("me").innerHTML = '<button type="button" class="btn sm sec" id="themebtn"></button>';
  $("themebtn").onclick = basculerTheme;
  majLibelleTheme();
}

function renderPending() {
  const el = $("pending");
  el.textContent = pendingCount || "";
  el.classList.toggle("hidden", !(canAdmin() && pendingCount));
}

const ONGLETS = ["all", "mine", "biblio", "synth", "admin"];
function setTab(t) {
  tab = t;
  document.querySelectorAll(".tab").forEach(b => {
    const on = b.dataset.t === t;
    b.classList.toggle("on", on);
    b.setAttribute("aria-selected", String(on));
  });
  ONGLETS.forEach(x => $(x).classList.toggle("hidden", t !== x));
  if (t === "admin" && canAdmin()) loadAdmin();
  if (t === "biblio") { renderBiblioTools(); renderBiblio(); }
  if (t === "synth") renderSynth();
}
document.querySelectorAll(".tab").forEach(b => b.onclick = () => setTab(b.dataset.t));

/* ---------- Mes lectures ---------- */

const cleTitre = s => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const motsListe = txt => String(txt || "").split(/[,;\n]+/).map(x => x.trim()).filter(Boolean);
let forceStatut = "", focusAvant = null, scrollAvant = 0;

function field(id, label, val, opts = {}) {
  const req = opts.req ? '<span class="req"> *</span>' : "";
  if (opts.area) return `<div><label for="${id}">${label}</label><textarea id="${id}" maxlength="2500">${esc(val)}</textarea></div>`;
  if (opts.sel) return `<div><label for="${id}">${label}${req}</label><select id="${id}"><option value="">— choisir —</option>${opts.sel.map(o => `<option ${o === val ? "selected" : ""}>${esc(o)}</option>`).join("")}</select></div>`;
  return `<div><label for="${id}">${label}${req}</label><input id="${id}" type="${opts.type || "text"}" maxlength="500" value="${esc(val)}" ${opts.ph ? `placeholder="${opts.ph}"` : ""}></div>`;
}

function renderForm() {
  if (!canWrite()) return;
  const d = editing ? items.find(i => i.id === editing) || {} : {};
  $("ftitle").textContent = editing ? (override ? `Contribuer à la lecture de ${d.etudiant}` : "Modifier la lecture") : "Ajouter une lecture";
  $("fnote").textContent = override
    ? `⚠️ Cette lecture appartient à ${d.etudiant}. Vos modifications seront visibles de tous et l’ancienne version est conservée dans l’historique.`
    : forceStatut
      ? "Pour passer cette lecture à « Terminée », complétez d’abord les champs obligatoires de la première partie."
      : "Choisissez « 📖 En cours de lecture » si vous n’avez pas fini : seul le titre est alors obligatoire. Pour une lecture « ✅ Terminée », toute la première partie est obligatoire.";
  const statut = forceStatut || d.statut || "Terminée";
  $("form").innerHTML = `
  <div id="draftnote" class="meta" style="display:none;margin-bottom:10px"></div>
  <details class="sec" open><summary>Colonne 1 · Identification de l’article <span class="req" style="color:#d33">(obligatoire)</span></summary>
   <div style="margin-bottom:12px"><label for="f_statut">Statut</label><select id="f_statut">
     <option value="Terminée" ${statut === "Terminée" ? "selected" : ""}>✅ Terminée</option>
     <option value="En cours" ${statut === "En cours" ? "selected" : ""}>📖 En cours de lecture</option></select></div>
   <div class="grid">
    ${field("f_titre", "Titre de l’article", d.titre, { req: 1 })}
    ${field("f_parution", "Date de parution", fmtD(d.parution), { req: 1, ph: "2021, mars 2021 ou 04/03/2021" })}
    ${field("f_auteur", "Auteur(s)", d.auteur, { req: 1, ph: "Nom, Prénom ; Nom, Prénom" })}
    ${field("f_qualite", "Qualité de l’auteur", d.qualite, { req: 1, ph: "chercheur, IDE, cadre de santé…" })}
    ${field("f_nation", "Nationalité", d.nation, { req: 1 })}
    ${field("f_type", "Type d’article", d.type, { req: 1, sel: TYPES })}
   </div>
   <div id="dup" style="display:none;margin-top:10px;color:#b45309;font-weight:600"></div></details>
  <details class="sec" open><summary>Compléments pour la référence APA (facultatifs, mais recommandés pour les articles)</summary>
   <div class="grid">
    ${field("f_source", "Revue / éditeur / établissement", d.source, { ph: "revue de l’article, éditeur du rapport, université de la thèse" })}
    ${field("f_volume", "Volume", d.volume)}
    ${field("f_numero", "Numéro", d.numero)}
    ${field("f_pages", "Pages", d.pages, { ph: "ex. 12-25" })}
    ${field("f_doi", "DOI ou URL", d.doi, { ph: "10.xxxx/xxxxx ou https://…" })}
   </div>
   <div id="apaprev" class="meta" style="margin-top:12px;padding:10px 12px;border:1px dashed var(--bd);border-radius:8px"></div>
  </details>
  <details class="sec" open><summary>Colonnes 2 à 8 · Libres (à remplir comme vous voulez, modifiable à tout moment)</summary>
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
   </div></details>
  <div class="savebar"><div id="ferr" class="err" role="alert"></div>
   <button class="btn" id="save" type="button">${editing ? "Enregistrer les modifications" : "Enregistrer la lecture"}</button>
   <button class="btn sec" id="cancel" type="button">Annuler</button></div>`;
  $("save").onclick = save;
  $("trad").onclick = traduire;
  $("cancel").onclick = () => { effacerBrouillon(); closeDrawer(true); };
  formBase = JSON.stringify(snapshot());
  restaurerBrouillon();
  $("form").oninput = $("form").onchange = surSaisie;
  majApercu(); majDoublon();
}

function openForm() {
  if (!canWrite()) return;
  focusAvant = document.activeElement;
  scrollAvant = window.scrollY;
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
  editing = null; override = false; forceStatut = "";
  window.scrollTo(0, scrollAvant);
  if (focusAvant && focusAvant.focus) { try { focusAvant.focus({ preventScroll: true }); } catch (e) { /* ignoré */ } }
}
$("drawerclose").onclick = () => closeDrawer();
document.addEventListener("keydown", e => {
  if (e.key !== "Escape") return;
  const ouvert = document.querySelector("details.colmenu[open]");
  if (ouvert) ouvert.removeAttribute("open"); else closeDrawer();
});
$("addbtn").onclick = () => { editing = null; override = false; forceStatut = ""; openForm(); };

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
  "pages", "doi", "mots", "kw", "concepts", "objet", "opinion", "controverse", "libre"];
let formBase = "", brouillonTimer = null;

const snapshot = () => Object.fromEntries(CHAMPS_FORM.map(k => [k, $("f_" + k) ? $("f_" + k).value : ""]));

function lireForm() {
  const v = snapshot();
  Object.keys(v).forEach(k => { v[k] = v[k].trim(); });
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
  const autre = (t.length >= 8 || d) ? items.find(i => i.id !== editing && ((d && cleDoi(i.doi) === d) || (t.length >= 8 && cleTitre(i.titre) === t))) : null;
  if (!autre) { box.style.display = "none"; return; }
  box.textContent = autre.mine
    ? "⚠ Vous avez déjà saisi cet article. Vérifiez qu’il ne s’agit pas d’un doublon."
    : `⚠ Cet article est déjà dans le tableau (saisi par ${autre.etudiant}). Vérifiez avant d’enregistrer un doublon.`;
  box.style.display = "block";
}

const cleBrouillon = () => "lydia_brouillon:" + (me ? me.prenom : "") + ":" + (editing || "new") + (override ? ":o" : "");
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
  CHAMPS_FORM.forEach(k => { if ($("f_" + k) && b.v[k] !== undefined) $("f_" + k).value = b.v[k]; });
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

async function save() {
  clearTimeout(brouillonTimer);
  const { data, dateOk } = lireForm();
  if (!dateOk) { $("ferr").textContent = "Date de parution non reconnue (exemples : 2021, mars 2021, 04/03/2021)"; return; }
  const need = data.statut === "En cours" ? ["titre"] : FIN;
  const miss = need.filter(k => !data[k]);
  if (miss.length) { $("ferr").textContent = "À compléter : " + miss.map(k => LAB[k]).join(", "); return; }
  $("save").disabled = true;
  try {
    const res = await enCours("Enregistrement…", () => editing
      ? api("update", { id: editing, override, data })
      : api("add", { data }));
    effacerBrouillon();
    closeDrawer(true);
    applyResult(res);
  } catch (e) {
    $("ferr").textContent = "Enregistrement impossible : " + e.message;
    if (e.code === "unauthorized") sessionError(e);
    $("save").disabled = false;
  }
}

async function del(id) {
  if (!confirm("Supprimer cette lecture et ses commentaires ?")) return;
  try { applyResult(await enCours("Suppression…", () => api("delete", { id }))); }
  catch (e) { alert("Suppression impossible : " + e.message); }
}

function startEdit(id, ov, statut) {
  const it = items.find(i => i.id === id);
  if (!it) return;
  if (ov && !confirm(`Cette lecture appartient à ${it.etudiant}.\n\nVoulez-vous vraiment la modifier ? L’ancienne version sera conservée dans l’historique.`)) return;
  editing = id; override = ov; forceStatut = statut || "";
  openForm();
}

// « Terminée » en un clic quand tous les champs obligatoires sont déjà remplis ; sinon on ouvre le formulaire.
async function marquerTerminee(id) {
  const it = items.find(x => x.id === id);
  if (!it) return;
  if (FIN.some(k => !String(it[k] || "").trim())) { startEdit(id, false, "Terminée"); return; }
  const data = Object.fromEntries(CHAMPS_FORM.map(k => [k, String(it[k] || "")]));
  data.statut = "Terminée";
  try { applyResult(await enCours("Enregistrement…", () => api("update", { id, override: false, data }))); }
  catch (e) { if (e.code === "unauthorized") sessionError(e); else alert("Enregistrement impossible : " + e.message); }
}

function renderMine() {
  if (!canWrite()) return;
  const mine = items.filter(i => i.mine).sort((a, b) =>
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

const anneeDe = i => (/^(\d{4})/.exec(i.parution || "") || [])[1] || "";

function badgeNouveau(i) {
  if (!vuDepuis || i.mine) return "";
  if (String(i.ajoute || "") > vuDepuis) return '<span class="new">🆕 Nouveau</span>';
  if (String(i.modifie_le || "") > vuDepuis) return '<span class="new">✏️ Modifié</span>';
  return "";
}

const nbComm = i => { const n = comments.filter(x => x.lecture_id === i.id).length; return n ? `<span class="cn" title="${n} commentaire${n > 1 ? "s" : ""}">💬 ${n}</span>` : ""; };

function actionsHtml(i) {
  const edit = !canWrite() ? "" : i.mine
    ? `<button class="btn sm sec" data-e="${esc(i.id)}">Modifier</button> `
    : `<button class="btn sm sec" data-o="${esc(i.id)}">Contribuer</button> `;
  const n = comments.filter(x => x.lecture_id === i.id).length;
  return `${edit}<button class="btn sm sec" data-c="${esc(i.id)}" aria-label="Commentaires (${n})">💬 ${n}</button>`;
}

function infosHtml(i) {
  return `Parution : ${esc(fmtD(i.parution)) || "—"}<br>Auteur : ${esc(i.auteur) || "—"} (${esc(i.qualite) || "—"})<br>Nationalité : ${esc(i.nation) || "—"}<br>Type : ${esc(i.type) || "—"}<br><i>Saisi le ${esc(fmtD(i.ajoute))}</i>${i.modifie_par ? `<br><i>Modifié par ${esc(i.modifie_par)} le ${esc(fmtD(i.modifie_le))}</i>` : ""}`;
}

function cells(i) {
  const c = esc(i.couleur);
  const prog = i.statut === "En cours";
  const main = `<tr data-id="${esc(i.id)}" tabindex="0" aria-expanded="${openRows.has(i.id)}" class="${prog ? "prog" : ""} ${openRows.has(i.id) ? "open" : ""}" style="--c:${c}"><td class="first"><span class="chev" aria-hidden="true"></span><span class="badge" style="--c:${c}">${esc(i.etudiant)}</span><span class="badge ${prog ? "prog" : ""}" style="--c:${c}">${prog ? "📖 En cours" : "✅ Terminée"}</span>${badgeNouveau(i)}${nbComm(i)}
   <b>${esc(i.titre)}</b>
   <div class="meta short">${esc([i.auteur, anneeDe(i), i.type].filter(Boolean).join(" · ")) || "—"}</div>
   <div class="meta full">${infosHtml(i)}</div>
   <div class="rowacts">${actionsHtml(i)}</div></td>
   <td class="c2 nowrapc"><div class="chipsc">${chips(i.mots)}</div></td><td class="c3 nowrapc"><div class="chipsc">${chips(i.kw)}</div></td>
   <td class="c4">${clampTxt(i.id, i.concepts)}</td><td class="c5">${clampTxt(i.id, i.objet)}</td><td class="c6">${clampTxt(i.id, i.opinion)}</td>
   <td class="c7">${clampTxt(i.id, i.controverse)}</td><td class="c8">${clampTxt(i.id, i.libre)}</td><td class="apa c9">${apaCell(i)}</td></tr>`;
  return main + (openCm.has(i.id) ? commentsRow(i) : "");
}

function cardHtml(i) {
  const c = esc(i.couleur);
  const prog = i.statut === "En cours";
  const sect = (t, v) => String(v || "").trim() ? `<div class="sect"><b>${t}</b>${clampTxt(i.id, v)}</div>` : "";
  return `<article class="cardc ${prog ? "prog" : ""} ${openRows.has(i.id) ? "open" : ""}" data-id="${esc(i.id)}" tabindex="0" aria-expanded="${openRows.has(i.id)}" style="--c:${c}">
   <div><span class="badge" style="--c:${c}">${esc(i.etudiant)}</span><span class="badge ${prog ? "prog" : ""}" style="--c:${c}">${prog ? "📖 En cours de lecture" : "✅ Terminée"}</span>${badgeNouveau(i)}</div>
   <h3><span class="chev" aria-hidden="true"></span>${esc(i.titre)}</h3>
   <div class="meta short">${esc([i.auteur, anneeDe(i), i.type].filter(Boolean).join(" · ")) || "—"}</div>
   <div class="meta full">${infosHtml(i)}</div>
   ${motsListe(i.mots).length || motsListe(i.kw).length ? `<div class="chipsc">${chips(i.mots)}${chips(i.kw)}</div>` : ""}
   ${sect("Concepts en sciences infirmières", i.concepts)}${sect("Objet / sujet principal", i.objet)}${sect("Opinion de l’auteur", i.opinion)}${sect("Controverse", i.controverse)}${sect("Libre", i.libre)}
   <div class="sect"><b>Référence APA</b>${apaCell(i)}</div>
   <div class="acts">${actionsHtml(i)}</div>
   ${openCm.has(i.id) ? `<div class="cmbox">${commentsBox(i)}</div>` : ""}
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

function commentsBox(i) {
  const l = comments.filter(c => c.lecture_id === i.id).sort((a, b) => String(a.date).localeCompare(b.date));
  const list = l.length ? l.map(c => {
    const own = c.mine && canComment();
    const acts = own
      ? `<button class="btn sm sec" data-ce="${esc(c.id)}">Modifier</button> <button class="btn sm sec del" data-cd="${esc(c.id)}">Supprimer</button>`
      : canAdmin() ? `<button class="btn sm sec del" data-cd="${esc(c.id)}">Supprimer</button>` : "";
    return `<div class="cm"><b>${esc(c.auteur)}</b> <span class="meta">${esc(fmtDT(c.date))}${c.modifie_le ? " · modifié" : ""}</span>
      <div class="cmtxt">${esc(c.texte)}</div>${acts}</div>`;
  }).join("") : '<div class="meta">Aucun commentaire.</div>';
  const form = canComment()
    ? `<div><textarea data-cm="${esc(i.id)}" maxlength="2000" placeholder="Ajouter un commentaire…" aria-label="Nouveau commentaire">${esc(drafts[i.id] || "")}</textarea>
       <button class="btn sm" data-ca="${esc(i.id)}" style="margin-top:6px">Publier</button></div>` : "";
  return list + form;
}

function commentsRow(i) {
  return `<tr class="cmrow"><td colspan="9"><div class="cmbox">${commentsBox(i)}</div></td></tr>`;
}

async function commentAction(fn, errLabel) {
  try { applyResult(await enCours("Enregistrement…", fn)); }
  catch (e) { if (e.code === "unauthorized") sessionError(e); else alert(errLabel + " : " + e.message); }
}

const COLS = { 2: "Mots-clés", 3: "Keywords (EN)", 4: "Concepts", 5: "Objet / sujet", 6: "Opinion", 7: "Controverse", 8: "Libre", 9: "Référence APA" };

function applyCols() {
  for (let k = 2; k <= 9; k++) $("tbl").classList.toggle("hc" + k, masquees.has(k));
}

function renderFilters() {
  const types = [...new Set(TYPES.concat(items.map(i => i.type).filter(Boolean)))];
  const tableau = F.view !== "cartes";
  const actifs = [["q", F.q ? `« ${F.q} »` : ""], ["who", F.who], ["st", F.st], ["type", F.type]].filter(x => x[1]);
  const nb = actifs.length + (F.kw ? 1 : 0);
  $("filters").innerHTML = `
   <details class="colmenu" id="mfilt"><summary class="btn sm sec" aria-label="Rechercher et filtrer">🔍 Rechercher / filtrer${nb ? ` <span class="count">${nb}</span>` : ""}</summary>
    <div class="colpop pop-filtres">
     <div><label for="q">Recherche</label><input id="q" placeholder="Titre, auteur, mot-clé, commentaire…" value="${esc(F.q)}"></div>
     <div><label for="who">Étudiant</label><select id="who"><option value="">Tous les étudiants</option>${students().map(s => `<option ${F.who === s.prenom ? "selected" : ""}>${esc(s.prenom)}</option>`).join("")}</select></div>
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
  ["who", "st", "type", "sort"].forEach(k => $(k).onchange = e => { F[k] = e.target.value; renderTable(); });
  $("mfilt").ontoggle = () => { if ($("mfilt").open) $("q").focus(); };
  $("reset").onclick = () => { F.q = ""; F.who = ""; F.st = ""; F.type = ""; F.kw = ""; F.kwLabel = ""; renderFilters(); renderTable(); };
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
  if ($("add2")) $("add2").onclick = () => { editing = null; override = false; forceStatut = ""; openForm(); };
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

function filtered() {
  const q = cleTitre(F.q);
  const l = items.filter(i => (!F.who || i.etudiant === F.who) && (!F.st || i.statut === F.st) && (!F.type || i.type === F.type)
    && (!F.kw || motsListe(i.mots).concat(motsListe(i.kw)).some(k => cleTitre(k) === F.kw))
    && (!q || correspond(i, q)));
  return l.sort((a, b) => F.sort === "ajoute"
    ? String(b.ajoute).localeCompare(a.ajoute)
    : String(a[F.sort] || "").localeCompare(String(b[F.sort] || ""), "fr"));
}

function renderTable() {
  const l = filtered();
  const cartes = F.view === "cartes";
  const vide = items.length ? "Aucune lecture ne correspond aux filtres."
    : canWrite() ? "Aucune lecture pour l’instant : utilisez « ＋ Ajouter une lecture »." : "Aucune lecture pour l’instant.";
  $("tablewrap").classList.toggle("hidden", cartes);
  $("cards").classList.toggle("hidden", !cartes);
  if (cartes) $("cards").innerHTML = l.length ? l.map(cardHtml).join("") : `<div class="empty">${vide}</div>`;
  else $("rows").innerHTML = l.length ? l.map(cells).join("") : `<tr><td colspan="9" class="empty">${vide}</td></tr>`;
  applyCols();
  const nbres = $("nbres");
  if (nbres) nbres.textContent = (F.q || F.who || F.st || F.type || F.kw) ? `${l.length} / ${items.length} lectures` : "";
  $("stats").innerHTML = students().map(s => {
    const n = items.filter(i => i.etudiant === s.prenom);
    return `<span class="badge" style="--c:${esc(s.couleur)}">${esc(s.prenom)} : ${n.length} lecture${n.length > 1 ? "s" : ""} (${n.filter(i => i.statut === "En cours").length} en cours)</span>`;
  }).join("");
}

function majBoutonDeplier() {
  const b = $("expall");
  if (b) b.textContent = openRows.size ? "⇱ Tout replier" : "⇲ Tout déplier";
}

function toggleOpen(id, host) {
  if (openRows.has(id)) openRows.delete(id); else openRows.add(id);
  if (host) {
    host.classList.toggle("open", openRows.has(id));
    host.setAttribute("aria-expanded", String(openRows.has(id)));
  }
  majBoutonDeplier();
}

function toutDeplier() {
  if (openRows.size) openRows.clear(); else filtered().forEach(i => openRows.add(i.id));
  renderTable();
  majBoutonDeplier();
}

const onAction = e => {
  const b = e.target.closest("button");
  if (!b) {
    // Clic ailleurs que sur un bouton, un lien ou un commentaire : on déplie / replie la ligne (sauf sélection de texte en cours).
    if (e.target.closest("a, input, select, textarea, label, .cmbox") || (window.getSelection && String(window.getSelection()).length)) return;
    const h = e.target.closest("tr[data-id], .cardc[data-id]");
    if (h) toggleOpen(h.dataset.id, h);
    return;
  }
  const d = b.dataset;
  if (d.e) startEdit(d.e, false);
  else if (d.o) startEdit(d.o, true);
  else if (d.apa) copierApa(d.apa);
  else if (d.kw !== undefined) filtrerMotCle(d.kw);
  else if (d.c) { if (openCm.has(d.c)) openCm.delete(d.c); else openCm.add(d.c); renderTable(); }
  else if (d.ca) {
    const t = (drafts[d.ca] || "").trim();
    if (!t) return;
    b.disabled = true;
    commentAction(async () => { const j = await api("comment_add", { lecture_id: d.ca, texte: t }); drafts[d.ca] = ""; return j; }, "Commentaire impossible");
  } else if (d.ce) {
    const c = comments.find(x => x.id === d.ce);
    const t = c && prompt("Modifier le commentaire :", c.texte);
    if (t && t.trim()) commentAction(() => api("comment_update", { id: d.ce, texte: t }), "Modification impossible");
  } else if (d.cd) {
    if (confirm("Supprimer ce commentaire ?")) commentAction(() => api("comment_delete", { id: d.cd }), "Suppression impossible");
  }
};
const onDraft = e => { if (e.target.dataset.cm) drafts[e.target.dataset.cm] = e.target.value; };
$("rows").onclick = $("cards").onclick = onAction;
$("rows").oninput = $("cards").oninput = onDraft;
$("rows").onkeydown = $("cards").onkeydown = e => {
  if ((e.key === "Enter" || e.key === " ") && e.target.matches && e.target.matches("tr[data-id], .cardc[data-id]")) {
    e.preventDefault();
    toggleOpen(e.target.dataset.id, e.target);
  }
};

/* ---------- Bibliographie ---------- */

const B = { who: "", enCours: false };

function biblioListe() {
  return LydiaApa.bibliographie(items.filter(i => (!B.who || i.etudiant === B.who) && (B.enCours || i.statut === "Terminée")));
}

function renderBiblioTools() {
  $("bibtools").innerHTML = `<label for="bwho" class="meta" style="margin:0">Étudiant</label>
   <select id="bwho"><option value="">Tous</option>${students().map(s => `<option ${B.who === s.prenom ? "selected" : ""}>${esc(s.prenom)}</option>`).join("")}</select>
   <label style="display:flex;gap:6px;align-items:center;margin:0;font-weight:400;color:var(--tx)"><input type="checkbox" id="ben" style="width:auto" ${B.enCours ? "checked" : ""}> Inclure les lectures en cours</label>
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
  items.forEach(i => { const a = (/^(\d{4})/.exec(i.parution || "") || [])[1]; if (a) annees.set(a, (annees.get(a) || 0) + 1); });
  const parAnnee = [...annees.entries()].sort((a, b) => a[0].localeCompare(b[0])).slice(-12);
  const kpi = (n, t) => `<div class="kpi"><b>${n}</b>${t}</div>`;
  $("synthbox").innerHTML = `<div class="kpis">${kpi(items.length, "lectures")}${kpi(fin, "terminées")}${kpi(items.length - fin, "en cours")}${kpi(comments.length, "commentaires")}</div>
   <div class="synth">
   ${barres("Lectures par étudiant", students().map(s => [s.prenom, items.filter(i => i.etudiant === s.prenom).length, s.couleur]), "var(--pri)")}
   ${barres("Types d’articles", compter(items.map(i => i.type), 8), "var(--pri)")}
   ${barres("Nationalité des auteurs", compter(items.map(i => i.nation), 10), "var(--pri)")}
   ${barres("Qualité des auteurs", compter(items.map(i => i.qualite), 8), "var(--pri)")}
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
    const next = (await api("admin_list")).acces;
    // Pas de reconstruction si rien n'a changé ou si une saisie est en cours (sinon elle serait perdue).
    const a = document.activeElement;
    const typing = a && a.closest && a.closest("#adminbox") && (a.tagName === "INPUT" || a.tagName === "SELECT");
    acces = next;
    if (JSON.stringify(next) !== renderedAcces && !typing) renderAdmin();
  } catch (e) { if (e.code === "unauthorized") sessionError(e); else showStatus("Administration indisponible : " + e.message); }
}

function accesRow(a) {
  const sup = isSuper();
  const k = esc(a.email);
  const dates = `<td>${esc(fmtDT(a.demande_le))}</td><td>${esc(fmtDT(a.derniere_connexion))}</td>`;
  // Un étudiant ne peut pas gérer les étudiants ; l'administrateur, si.
  if (a.protege && !sup) return `<tr><td>${k}</td>${dates}<td>${esc(a.prenom)}</td><td>Étudiant</td><td class="meta">Géré par l’administrateur</td></tr>`;
  const opt = (v, lbl) => `<option value="${v}" ${a.role === v ? "selected" : ""}>${lbl}</option>`;
  const roles = (sup ? opt("etudiant", "Étudiant") : "") + opt("lecteur", "Lecteur") + opt("formateur", "Formateur");
  const acts = a.statut === "actif"
    ? `<button class="btn sm" data-as="actif">Enregistrer</button> <button class="btn sm sec del" data-as="refuse">Retirer l’accès</button>`
    : a.statut === "en_attente"
      ? `<button class="btn sm" data-as="actif">Valider</button> <button class="btn sm sec del" data-as="refuse">Refuser</button>`
      : `<button class="btn sm" data-as="actif">Réactiver</button>`;
  const adresse = sup ? `<td><input data-f="nouvel_email" type="email" value="${k}"></td>` : `<td>${k}</td>`;
  const couleur = sup ? `<td><input data-f="couleur" type="color" value="${esc(a.couleur)}" style="min-width:48px;padding:2px"></td>` : "";
  return `<tr data-k="${k}">${adresse}${dates}<td><input data-f="prenom" maxlength="60" value="${esc(a.prenom)}" placeholder="Prénom"></td>${couleur}
    <td><select data-f="role">${roles}</select></td><td>${acts}</td></tr>`;
}

let renderedAcces = "";
function renderAdmin() {
  renderedAcces = JSON.stringify(acces);
  const head = `<tr><th>Adresse</th><th>Demande</th><th>Dernière connexion</th><th>Prénom</th>${isSuper() ? "<th>Couleur</th>" : ""}<th>Rôle</th><th>Actions</th></tr>`;
  const bloc = (titre, list, vide) => `<h3>${titre} (${list.length})</h3>` + (list.length
    ? `<div class="wrap"><table class="adm"><thead>${head}</thead><tbody>${list.map(accesRow).join("")}</tbody></table></div>`
    : `<div class="meta">${vide}</div>`);
  $("adminbox").innerHTML =
    bloc("⏳ Demandes en attente", acces.filter(a => a.statut === "en_attente"), "Aucune demande en attente.") +
    bloc("✅ Accès actifs", acces.filter(a => a.statut === "actif"), "Aucun accès actif.") +
    bloc("⛔ Accès refusés", acces.filter(a => a.statut === "refuse"), "Aucun accès refusé.");
}

$("adminbox").onclick = async e => {
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
  const head = ["Étudiant", "Statut", "Titre", "Date de parution", "Auteur", "Qualité de l’auteur", "Nationalité", "Type d’article", "Mots-clés", "Keywords (EN)", "Concepts en sciences infirmières", "Objet / sujet principal", "Opinion de l’auteur", "Controverse", "Libre", "Référence APA", "Date de saisie"];
  const rows = filtered().map(i => [i.etudiant, i.statut === "En cours" ? "En cours de lecture" : "Terminée", i.titre, fmtD(i.parution), i.auteur, i.qualite, i.nation, i.type, i.mots, i.kw, i.concepts, i.objet, i.opinion, i.controverse, i.libre, LydiaApa.apa(i).text, fmtD(i.ajoute)].map(v => v || ""));
  const ws = XLSX.utils.aoa_to_sheet([head, ...rows]);
  ws["!cols"] = [12, 16, 40, 14, 24, 20, 14, 22, 28, 28, 36, 36, 36, 30, 24, 50, 14].map(w => ({ wch: w }));
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
    (i.titre || "") + "\nParution : " + (fmtD(i.parution) || "-") + "\nAuteur : " + (i.auteur || "-") + " (" + (i.qualite || "-") + ")\nNationalité : " + (i.nation || "-") + "\nType : " + (i.type || "-") + "\nSaisi le " + fmtD(i.ajoute),
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

/* ---------- Démarrage ---------- */

function renderAll() {
  renderMe();
  $("tabs").classList.remove("hidden");
  document.querySelector('.tab[data-t="mine"]').classList.toggle("hidden", !canWrite());
  document.querySelector('.tab[data-t="admin"]').classList.toggle("hidden", !canAdmin());
  if ((!canWrite() && tab === "mine") || (!canAdmin() && tab === "admin")) setTab("all");
  else setTab(tab);
  if (canWrite()) renderMine();
  renderPending();
  renderFilters();
  renderTable();
}

renderMeAnonyme();
initGoogle();
