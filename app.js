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
let editing = null, override = false, tab = "mine", timer = null;
const drafts = {};          // brouillons de commentaires, par lecture
const openCm = new Set();   // lectures dont les commentaires sont dépliés
const F = { q: "", who: "", st: "", sort: "ajoute" };

// etudiant : écrit et administre ; formateur : lit et commente ; lecteur : lit.
const canWrite = () => !!me && me.role === "etudiant";
const canComment = () => !!me && me.role === "formateur";
const canAdmin = () => !!me && (me.role === "etudiant" || me.role === "admin");   // valide les accès, modère
const isSuper = () => !!me && me.role === "admin";                                // gère aussi les étudiants
const ROLE_LABEL = { etudiant: "", formateur: " (formateur : lecture + commentaires)", lecteur: " (lecture seule)",
  admin: " (administrateur)" };

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
  $("me").innerHTML = "";
  $("retry").classList.toggle("hidden", !retry);
  if (msg) $("gatemsg").textContent = msg;
}

function logout() {
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

function applyData(j) {
  items = j.lectures;
  comments = j.commentaires || [];
  pendingCount = j.enAttente || 0;
}

// Les écritures renvoient les données à jour : on les applique sans second appel.
function applyResult(j) {
  if (!j || !j.lectures) return;
  applyData(j);
  renderMine();
  renderTable();
  renderPending();
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

async function refresh() {
  if (!token || !me) return;
  try {
    applyData(await api("list"));
    // On ne reconstruit pas le tableau pendant qu'un commentaire est en cours de saisie.
    const a = document.activeElement;
    const typing = a && a.tagName === "TEXTAREA" && a.closest("#rows");
    renderMine();
    if (!typing) renderTable();
    renderPending();
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

function renderMe() {
  $("me").innerHTML = `<span class="who" style="--c:${esc(me.couleur)}">Connecté(e) : ${esc(me.prenom)}${ROLE_LABEL[me.role] || ""}</span>
    <button class="btn sm sec" id="logout">Se déconnecter</button>`;
  $("logout").onclick = logout;
}

function renderPending() {
  const el = $("pending");
  el.textContent = pendingCount || "";
  el.classList.toggle("hidden", !(canAdmin() && pendingCount));
}

function setTab(t) {
  tab = t;
  document.querySelectorAll(".tab").forEach(b => b.classList.toggle("on", b.dataset.t === t));
  ["mine", "all", "admin"].forEach(s => $(s).classList.toggle("hidden", t !== s));
  if (t === "admin" && canAdmin()) loadAdmin();
}
document.querySelectorAll(".tab").forEach(b => b.onclick = () => setTab(b.dataset.t));

/* ---------- Mes lectures ---------- */

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
    : "Choisissez « 📖 En cours de lecture » si vous n’avez pas fini : seul le titre est alors obligatoire. Pour une lecture « ✅ Terminée », toute la première partie est obligatoire.";
  const statut = d.statut || "Terminée";
  $("form").innerHTML = `
  <div id="draftnote" class="meta" style="display:none;margin-bottom:10px"></div>
  <fieldset><legend>Colonne 1 · Identification de l’article <span class="req" style="color:#d33">(obligatoire)</span></legend>
   <div style="margin-bottom:12px"><label for="f_statut">Statut</label><select id="f_statut">
     <option value="Terminée" ${statut === "Terminée" ? "selected" : ""}>✅ Terminée</option>
     <option value="En cours" ${statut === "En cours" ? "selected" : ""}>📖 En cours de lecture</option></select></div>
   <div class="grid">
    ${field("f_titre", "Titre de l’article", d.titre, { req: 1 })}
    ${field("f_parution", "Date de parution", fmtD(d.parution), { req: 1, ph: "2021, mars 2021 ou 04/03/2021" })}
    ${field("f_auteur", "Auteur(s)", d.auteur, { req: 1 })}
    ${field("f_qualite", "Qualité de l’auteur", d.qualite, { req: 1, ph: "chercheur, IDE, cadre de santé…" })}
    ${field("f_nation", "Nationalité", d.nation, { req: 1 })}
    ${field("f_type", "Type d’article", d.type, { req: 1, sel: TYPES })}
   </div>
   <div id="dup" style="display:none;margin-top:10px;color:#b45309;font-weight:600"></div></fieldset>
  <fieldset><legend>Compléments pour la référence APA (facultatifs, mais recommandés pour les articles)</legend>
   <div class="grid">
    ${field("f_source", "Revue / éditeur / établissement", d.source, { ph: "revue de l’article, éditeur du rapport, université de la thèse" })}
    ${field("f_volume", "Volume", d.volume)}
    ${field("f_numero", "Numéro", d.numero)}
    ${field("f_pages", "Pages", d.pages, { ph: "ex. 12-25" })}
    ${field("f_doi", "DOI ou URL", d.doi, { ph: "10.xxxx/xxxxx ou https://…" })}
   </div>
   <div id="apaprev" class="meta" style="margin-top:12px;padding:10px 12px;border:1px dashed #cbd5e1;border-radius:8px"></div>
  </fieldset>
  <fieldset><legend>Colonnes 2 à 8 · Libres (à remplir comme vous voulez, modifiable à tout moment)</legend>
   <div class="grid">
    ${field("f_mots", "Mots-clés", d.mots, { area: 1 })}
    ${field("f_kw", "Mots-clés en anglais", d.kw, { area: 1 })}
    ${field("f_concepts", "Concepts en sciences infirmières développés", d.concepts, { area: 1 })}
    ${field("f_objet", "Objet / sujet principal du texte", d.objet, { area: 1 })}
    ${field("f_opinion", "Opinion de l’auteur", d.opinion, { area: 1 })}
    ${field("f_controverse", "Controverse", d.controverse, { area: 1 })}
    ${field("f_libre", "Colonne libre", d.libre, { area: 1 })}
   </div></fieldset>
  <div id="ferr" class="err"></div>
  <button class="btn" id="save">${editing ? "Enregistrer les modifications" : "Enregistrer la lecture"}</button>
  ${editing ? '<button class="btn sec" id="cancel">Annuler</button>' : ""}`;
  $("save").onclick = save;
  if (editing) $("cancel").onclick = () => { effacerBrouillon(); editing = null; override = false; renderForm(); };
  formBase = JSON.stringify(snapshot());
  restaurerBrouillon();
  $("form").oninput = $("form").onchange = surSaisie;
  majApercu(); majDoublon();
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
  box.innerHTML = `<b>Aperçu APA</b><br><span style="color:var(--text,inherit)">${r.html}</span>`
    + (data.parution && !dateOk ? '<br><span style="color:#b45309">⚠ Date non reconnue (ex. 2021, mars 2021, 04/03/2021)</span>' : "")
    + (r.incomplet ? '<br>⚠ À compléter : revue et pages' : "")
    + (!data.auteur ? '<br>⚠ Sans auteur, le titre passe en tête de la référence' : "");
}

const cleTitre = s => String(s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
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

function surSaisie() {
  majApercu(); majDoublon();
  clearTimeout(brouillonTimer);
  brouillonTimer = setTimeout(sauverBrouillon, 600);
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
    editing = null; override = false;
    applyResult(res);
    renderForm();
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

function startEdit(id, ov) {
  const it = items.find(i => i.id === id);
  if (!it) return;
  if (ov && !confirm(`Cette lecture appartient à ${it.etudiant}.\n\nVoulez-vous vraiment la modifier ? L’ancienne version sera conservée dans l’historique.`)) return;
  editing = id; override = ov;
  setTab("mine");
  renderForm();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function renderMine() {
  if (!canWrite()) return;
  const mine = items.filter(i => i.mine);
  if (!mine.length) { $("mylist").innerHTML = '<div class="empty">Aucune lecture pour l’instant.</div>'; return; }
  $("mylist").innerHTML = mine.map(i => `<div class="card" style="border-left:6px solid ${esc(i.couleur)};padding:10px 14px"><div class="tools" style="justify-content:space-between"><div><span class="badge ${i.statut === "En cours" ? "prog" : ""}" style="--c:${esc(i.couleur)}">${i.statut === "En cours" ? "📖 En cours" : "✅ Terminée"}</span> <b>${esc(i.titre)}</b> <span class="meta">· saisi le ${esc(fmtD(i.ajoute))}${i.modifie_par ? ` · modifié par ${esc(i.modifie_par)}` : ""}</span></div><div><button class="btn sm sec" data-e="${esc(i.id)}">Modifier</button> <button class="btn sm sec del" data-d="${esc(i.id)}">Supprimer</button></div></div></div>`).join("");
  $("mylist").querySelectorAll("[data-e]").forEach(b => b.onclick = () => startEdit(b.dataset.e, false));
  $("mylist").querySelectorAll("[data-d]").forEach(b => b.onclick = () => del(b.dataset.d));
}

/* ---------- Tableau commun et commentaires ---------- */

function cells(i) {
  const c = esc(i.couleur);
  const prog = i.statut === "En cours";
  const n = comments.filter(x => x.lecture_id === i.id).length;
  const edit = !canWrite() ? "" : i.mine
    ? `<button class="btn sm sec" data-e="${esc(i.id)}">Modifier</button> `
    : `<button class="btn sm sec" data-o="${esc(i.id)}">Contribuer</button> `;
  const cm = `<button class="btn sm sec" data-c="${esc(i.id)}">💬 ${n}</button>`;
  const main = `<tr class="${prog ? "prog" : ""}" style="--c:${c}"><td class="first"><span class="badge" style="--c:${c}">${esc(i.etudiant)}</span><span class="badge ${prog ? "prog" : ""}" style="--c:${c}">${prog ? "📖 En cours de lecture" : "✅ Terminée"}</span>
   <b style="margin-top:6px">${esc(i.titre)}</b>
   <div class="meta">Parution : ${esc(fmtD(i.parution)) || "—"}<br>Auteur : ${esc(i.auteur) || "—"} (${esc(i.qualite) || "—"})<br>Nationalité : ${esc(i.nation) || "—"}<br>Type : ${esc(i.type) || "—"}<br><i>Saisi le ${esc(fmtD(i.ajoute))}</i>${i.modifie_par ? `<br><i>Modifié par ${esc(i.modifie_par)} le ${esc(fmtD(i.modifie_le))}</i>` : ""}</div></td>
   <td>${esc(i.mots)}</td><td>${esc(i.kw)}</td><td>${esc(i.concepts)}</td><td>${esc(i.objet)}</td><td>${esc(i.opinion)}</td><td>${esc(i.controverse)}</td><td>${esc(i.libre)}</td><td class="apa">${apaCell(i)}</td><td>${edit}${cm}</td></tr>`;
  return main + (openCm.has(i.id) ? commentsRow(i) : "");
}

function apaCell(i) {
  const r = LydiaApa.apa(i);
  const note = r.incomplet ? '<div class="meta" style="margin-top:4px">⚠ À compléter : revue et pages (formulaire, section APA)</div>' : "";
  return `<div class="apatxt">${r.html}</div>${note}<button class="btn sm sec" style="margin-top:6px" data-apa="${esc(i.id)}">📋 Copier</button>`;
}

async function copierApa(id) {
  const it = items.find(x => x.id === id);
  if (!it) return;
  const r = LydiaApa.apa(it);
  try {
    if (window.ClipboardItem && navigator.clipboard && navigator.clipboard.write) {
      // HTML pour conserver l'italique dans Word ; texte brut en secours.
      await navigator.clipboard.write([new ClipboardItem({
        "text/html": new Blob([r.html], { type: "text/html" }),
        "text/plain": new Blob([r.text], { type: "text/plain" })
      })]);
    } else await navigator.clipboard.writeText(r.text);
    showStatus("📋 Référence copiée");
    setTimeout(clearStatus, 1500);
  } catch (e) { alert("Copie impossible : sélectionnez le texte à la main.\n\n" + r.text); }
}

function commentsRow(i) {
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
    ? `<div><textarea data-cm="${esc(i.id)}" maxlength="2000" placeholder="Ajouter un commentaire…">${esc(drafts[i.id] || "")}</textarea>
       <button class="btn sm" data-ca="${esc(i.id)}" style="margin-top:6px">Publier</button></div>` : "";
  return `<tr class="cmrow"><td colspan="10"><div class="cmbox">${list}${form}</div></td></tr>`;
}

async function commentAction(fn, errLabel) {
  try { applyResult(await enCours("Enregistrement…", fn)); }
  catch (e) { if (e.code === "unauthorized") sessionError(e); else alert(errLabel + " : " + e.message); }
}

function renderFilters() {
  $("filters").innerHTML = `<input id="q" placeholder="🔍 Rechercher…" value="${esc(F.q)}">
   <select id="who"><option value="">Tous les étudiants</option>${students().map(s => `<option ${F.who === s.prenom ? "selected" : ""}>${esc(s.prenom)}</option>`).join("")}</select>
   <select id="st"><option value="">Tous les statuts</option><option value="Terminée" ${F.st === "Terminée" ? "selected" : ""}>✅ Terminées</option><option value="En cours" ${F.st === "En cours" ? "selected" : ""}>📖 En cours</option></select>
   <select id="sort"><option value="ajoute" ${F.sort === "ajoute" ? "selected" : ""}>Tri : date de saisie</option><option value="etudiant" ${F.sort === "etudiant" ? "selected" : ""}>Tri : étudiant</option><option value="titre" ${F.sort === "titre" ? "selected" : ""}>Tri : titre</option><option value="parution" ${F.sort === "parution" ? "selected" : ""}>Tri : date de parution</option></select>
   <button class="btn sm" id="xl">⬇️ Excel</button> <button class="btn sm" id="pdf">⬇️ PDF</button>`;
  $("q").oninput = e => { F.q = e.target.value; renderTable(); };
  ["who", "st", "sort"].forEach(k => $(k).onchange = e => { F[k] = e.target.value; renderTable(); });
  $("xl").onclick = exportXlsx;
  $("pdf").onclick = exportPdf;
}

function filtered() {
  const q = F.q.toLowerCase();
  const l = items.filter(i => (!F.who || i.etudiant === F.who) && (!F.st || i.statut === F.st)
    && (!q || JSON.stringify(i).toLowerCase().includes(q)));
  return l.sort((a, b) => F.sort === "ajoute"
    ? String(b.ajoute).localeCompare(a.ajoute)
    : String(a[F.sort] || "").localeCompare(String(b[F.sort] || ""), "fr"));
}

function renderTable() {
  const l = filtered();
  $("rows").innerHTML = l.length ? l.map(cells).join("") : '<tr><td colspan="10" class="empty">Aucune lecture à afficher.</td></tr>';
  $("stats").innerHTML = students().map(s => {
    const n = items.filter(i => i.etudiant === s.prenom);
    return `<span class="badge" style="--c:${esc(s.couleur)}">${esc(s.prenom)} : ${n.length} lecture${n.length > 1 ? "s" : ""} (${n.filter(i => i.statut === "En cours").length} en cours)</span>`;
  }).join("");
}

$("rows").onclick = e => {
  const b = e.target.closest("button");
  if (!b) return;
  const d = b.dataset;
  if (d.e) startEdit(d.e, false);
  else if (d.o) startEdit(d.o, true);
  else if (d.apa) copierApa(d.apa);
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
$("rows").oninput = e => { if (e.target.dataset.cm) drafts[e.target.dataset.cm] = e.target.value; };

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
  if (canWrite()) { renderForm(); renderMine(); }
  renderPending();
  renderFilters();
  renderTable();
}

initGoogle();
