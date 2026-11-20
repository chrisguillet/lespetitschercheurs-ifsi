/* Interface générale : thème, menu du compte, nom affiché, pause ludique.
   Script classique : partage la portée globale avec les autres fichiers de js/ (ordre de chargement : voir index.html). */
"use strict";
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
      <div class="acctwho"><span class="avatar big" style="--c:${esc(me.couleur)}">${init}</span><div><b>${esc(me.prenom)}</b> <button type="button" class="acctedit" id="namebtn" title="Modifier mon nom" aria-label="Modifier mon nom">✏️</button><div class="meta">${esc(ROLE_NOM[me.role] || me.role)}</div></div></div>
      <div class="acctgrp"><button type="button" class="acctitem" id="notesbtn">📝 Mes notes</button><button type="button" class="acctitem" id="mydatabtn" title="Télécharger tout ce que l’application garde sur vous (droit d’accès)">📦 Télécharger mes données</button></div>
      <div class="acctgrp"><div class="acctlabel">Affichage</div><button type="button" class="acctitem" id="themebtn"></button></div>
      ${window.LydiaJeux ? `<div class="acctgrp"><div class="acctlabel">🎮 Pause ludique</div>${LydiaJeux.liste.filter(j => !j.admin || isSuper()).map(j => `<button type="button" class="acctitem" data-jeu="${esc(j.id)}">${esc(j.titre)}</button>`).join("")}</div>` : ""}
      <div class="acctgrp"><button type="button" class="acctitem danger" id="logout">⎋ Se déconnecter</button></div>
    </div></details>`;
  $("me").querySelectorAll("[data-jeu]").forEach(b => b.onclick = () => { b.closest("details").removeAttribute("open"); ouvrirJeu(b.dataset.jeu); });
  $("logout").onclick = logout;
  $("mydatabtn").onclick = async () => {
    $("me").querySelector("details").removeAttribute("open");
    try {
      const j = await enCours("Préparation de vos données…", () => api("mes_donnees"));
      telecharger(new Blob([JSON.stringify(j.export, null, 2)], { type: "application/json" }), "mes-donnees-lectures-ifsi-" + new Date().toISOString().slice(0, 10) + ".json");
    } catch (e) { if (e.code === "unauthorized") sessionError(e); else alert("Téléchargement impossible : " + e.message); }
  };
  $("notesbtn").onclick = () => { $("me").querySelector("details").removeAttribute("open"); ouvrirNotes(); };
  $("namebtn").onclick = () => { $("me").querySelector("details").removeAttribute("open"); ouvrirNom(); };
  $("themebtn").onclick = basculerTheme;
  majLibelleTheme();
}

// Pause ludique (toute personne connectée) : un jeu dans une fenêtre, arrêté à la fermeture.
let jeuOuvert = false;
function ouvrirJeu(id) {
  if (!me || !window.LydiaJeux || !$("jeumodal")) return;
  const j = LydiaJeux.liste.find(x => x.id === id); if (!j || (j.admin && !isSuper())) return;
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

// Changer son nom affiché : le serveur vérifie la longueur et l'unicité ; le « vu » local (commentaires lus) suit le nouveau nom.
function ouvrirNom() {
  if (!me || !$("nmodal")) return;
  $("nerr").textContent = ""; $("nom").value = me.prenom || "";
  $("nmodal").classList.remove("hidden"); document.body.classList.add("modalopen"); $("nom").focus(); $("nom").select();
}
function fermerNom() { $("nmodal")?.classList.add("hidden"); document.body.classList.remove("modalopen"); }
$("nclose")?.addEventListener("click", fermerNom);
$("nmodal")?.addEventListener("click", e => { if (e.target === $("nmodal")) fermerNom(); });
$("nbody")?.addEventListener("submit", async e => {
  e.preventDefault();
  const nom = $("nom").value.trim().replace(/\s+/g, " "), ancien = me.prenom;
  if (!nom) { $("nerr").textContent = "Le nom ne peut pas être vide."; return; }
  if (nom === ancien) { fermerNom(); return; }
  try {
    const res = await enCours("Enregistrement…", () => api("profile_update", { data: { prenom: nom } }));
    try { const v = localStorage.getItem("lydia_vu:" + ancien); if (v !== null) localStorage.setItem("lydia_vu:" + res.me.prenom, v); } catch (x) { /* ignoré */ }
    me = res.me; fermerNom();
    applyResult(res); renderMe(); renderAll();
  } catch (x) { $("nerr").textContent = (x && x.message) || "Échec de l'enregistrement."; }
});


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

const ONGLETS = ["home", "all", "mine", "cmts", "suivi", "glossaire", "biblio", "synth", "dash", "admin"];
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
  if (t === "glossaire") renderGlossaire();
  if (t === "home") renderHome();
  if (t === "dash") renderDash();
  majAlertes();
  if (t === "biblio") { renderBiblioTools(); renderBiblio(); }
  if (t === "synth") renderSynth();
}
document.querySelectorAll(".tab").forEach(b => b.onclick = () => setTab(b.dataset.t));
