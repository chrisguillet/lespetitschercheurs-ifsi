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
// Bouton soleil / lune hors du menu : l'icône montre le mode vers lequel on bascule.
function majLibelleTheme() {
  const b = $("themebtn"); if (!b) return;
  const sombre = themeSombre(), lib = sombre ? "Passer en mode clair" : "Passer en mode sombre";
  b.textContent = sombre ? "☀️" : "🌙"; b.title = lib; b.setAttribute("aria-label", lib);
}
const BOUTON_THEME = '<button type="button" class="btn sm sec themebtn" id="themebtn"></button>';
function basculerTheme() {
  const next = themeSombre() ? "light" : "dark";
  document.documentElement.dataset.theme = next;
  try { localStorage.setItem("lydia_theme", next); } catch (e) { /* ignoré */ }
  majLibelleTheme();
}

// En haut à droite : menu du compte (statut de connexion, thème, déconnexion).
function renderMe() {
  const init = esc(String(me.prenom || "?").trim().charAt(0).toUpperCase());
  $("me").innerHTML = BOUTON_THEME + `<details class="colmenu acct"><summary class="btn sm sec acctbtn" aria-label="Menu du compte : ${esc(me.prenom)}">
      <span class="avatar" style="--c:${esc(me.couleur)}">${init}</span><span class="acctname">${esc(me.prenom)}</span> ▾</summary>
    <div class="colpop right acctpop">
      <div class="acctwho"><span class="avatar big" style="--c:${esc(me.couleur)}">${init}</span><div><b>${esc(me.prenom)}</b><div class="meta">${esc(ROLE_NOM[me.role] || me.role)}</div></div></div>
      <div class="acctgrp"><button type="button" class="acctitem" id="profilbtn">👤 Mon profil</button><button type="button" class="acctitem" id="notesbtn">📝 Mes notes</button><button type="button" class="acctitem" id="mydatabtn" title="Télécharger tout ce que l’application garde sur vous (droit d’accès)">📦 Télécharger mes données</button></div>
      ${isSuper() && !VUE_AS ? '<div class="acctgrp"><button type="button" class="acctitem" id="asbtn" title="Consulter l’application comme une autre personne (lecture seule)">👁 Voir en tant que…</button></div>' : ""}
      ${window.LydiaJeux ? `<div class="acctgrp"><button type="button" class="acctitem" id="jeuxbtn">🎮 Pause ludique</button></div>` : ""}
      <div class="acctgrp"><button type="button" class="acctitem danger" id="logout">⎋ Se déconnecter</button></div>
    </div></details>`;
  if ($("jeuxbtn")) $("jeuxbtn").onclick = () => { $("me").querySelector("details").removeAttribute("open"); ouvrirChoixJeu(); };
  $("logout").onclick = logout;
  if ($("asbtn")) $("asbtn").onclick = () => { $("me").querySelector("details").removeAttribute("open"); ouvrirChoixAs(); };
  $("mydatabtn").onclick = async () => {
    $("me").querySelector("details").removeAttribute("open");
    try {
      const j = await enCours("Préparation de vos données…", () => api("mes_donnees"));
      telecharger(new Blob([JSON.stringify(j.export, null, 2)], { type: "application/json" }), "mes-donnees-lectures-ifsi-" + new Date().toISOString().slice(0, 10) + ".json");
    } catch (e) { if (e.code === "unauthorized") sessionError(e); else alert("Téléchargement impossible : " + e.message); }
  };
  $("profilbtn").onclick = () => { $("me").querySelector("details").removeAttribute("open"); ouvrirProfil(); };
  $("notesbtn").onclick = () => { $("me").querySelector("details").removeAttribute("open"); ouvrirNotes(); };
  $("themebtn").onclick = basculerTheme;
  majLibelleTheme();
}

// Pause ludique (toute personne connectée) : une fenêtre de choix (miniature, nom et description de chaque jeu), puis le jeu dans sa propre fenêtre, arrêté à la fermeture.
let jeuOuvert = false;
function ouvrirChoixJeu() {
  if (!me || !window.LydiaJeux || !$("jeuchoix")) return;
  const liste = LydiaJeux.liste.filter(j => !j.admin || isSuper());
  $("jeuchoixbody").innerHTML = liste.map(j => {
    const [icone, ...nom] = j.titre.split(" ");
    return `<button type="button" class="jeucarte" data-jeu="${esc(j.id)}"><span class="jeuvign"><canvas width="640" height="260" aria-hidden="true"></canvas><span class="jeuicone" aria-hidden="true">${esc(icone)}</span></span><b>${esc(nom.join(" "))}</b><span class="meta">${esc(j.desc)}</span></button>`;
  }).join("");
  $("jeuchoixbody").querySelectorAll(".jeucarte").forEach(b => {
    if (LydiaJeux.miniature(b.dataset.jeu, b.querySelector("canvas"))) b.querySelector(".jeuvign").classList.add("avecvue");
    b.onclick = () => { fermerChoixJeu(); ouvrirJeu(b.dataset.jeu); };
  });
  $("jeuchoix").classList.remove("hidden"); document.body.classList.add("modalopen");
}
function fermerChoixJeu() { $("jeuchoix")?.classList.add("hidden"); if (!jeuOuvert) document.body.classList.remove("modalopen"); }
$("jeuchoixclose")?.addEventListener("click", fermerChoixJeu);
$("jeuchoix")?.addEventListener("click", e => { if (e.target === $("jeuchoix")) fermerChoixJeu(); });
$("jeuretour")?.addEventListener("click", () => { fermerJeu(); ouvrirChoixJeu(); });
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

function renderMeAnonyme() {
  $("me").innerHTML = BOUTON_THEME;
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
  const g = groupeCourant(), nb = (pendingCount || 0) + (g && canWrite() ? votesAFaire(g) : 0);   // demandes d'accès à valider + votes du groupe à donner
  el.textContent = nb || "";
  el.classList.toggle("hidden", !(canAdmin() && nb));
}

// Navigation à deux niveaux : cinq sections, chacune avec ses pages. Les pages gardent leur identifiant (data-t) ; la section d'une page se déduit de lui.
// « Administration » est la gestion des accès : pour un étudiant elle concerne son groupe, pour l'administrateur c'est du pilotage.
const SECTION_DE = { home: "home", mine: "mine", all: "lectures", cmts: "lectures", biblio: "lectures", synth: "lectures", suivi: "groupe", glossaire: "groupe", dash: "pilotage" };
const sectionDe = t => t === "admin" ? (isSuper() ? "pilotage" : "groupe") : SECTION_DE[t];
let section = "lectures";
const derniereDeSection = { lectures: "all", groupe: "suivi", pilotage: "dash" };
const ongletVisible = t => !document.querySelector(`.tab[data-t="${t}"]`).classList.contains("hidden");
const ordreOnglets = () => [...document.querySelectorAll("#subtabs .tab")].map(b => b.dataset.t);

function majSections() {
  const adm = document.querySelector('.tab[data-t="admin"]');
  $("adminlbl").textContent = isSuper() ? "👥 Administration" : "👥 Membres et accès";
  adm.dataset.g = sectionDe("admin");
  const gt = document.querySelector('.gtab[data-g="groupe"]');
  if (gt) { const c = gt.querySelector(".gcount"); gt.firstChild.textContent = isSuper() ? "🗓️ Groupes " : "🗓️ Mon groupe "; if (c) gt.appendChild(c); }
  document.querySelectorAll("#subtabs .tab").forEach(b => b.classList.toggle("hors", sectionDe(b.dataset.t) !== section));
  const pages = ordreOnglets().filter(t => sectionDe(t) === section && ongletVisible(t));
  $("subtabs").classList.toggle("hidden", pages.length < 2);
  document.querySelectorAll(".gtab").forEach(b => {
    const g = b.dataset.g, on = g === section;
    b.classList.toggle("on", on);
    b.setAttribute("aria-selected", String(on));
    b.classList.toggle("hidden", !ordreOnglets().some(t => sectionDe(t) === g && ongletVisible(t)));
  });
  majPastillesSections();
}
// Les pastilles des pages (commentaires non lus, alertes du rétroplanning, demandes en attente) remontent sur leur section.
function majPastillesSections() {
  document.querySelectorAll(".gtab").forEach(b => {
    const n = ordreOnglets().filter(t => sectionDe(t) === b.dataset.g)
      .reduce((s, t) => { const c = document.querySelector(`.tab[data-t="${t}"] .count:not(.hidden)`); return s + (c ? parseInt(c.textContent, 10) || 0 : 0); }, 0);
    const c = b.querySelector(".gcount");
    if (c) { c.textContent = n || ""; c.classList.toggle("hidden", !n); }
  });
}
new MutationObserver(majPastillesSections).observe($("subtabs"), { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ["class"] });
document.querySelectorAll(".gtab").forEach(b => b.onclick = () => {
  const g = b.dataset.g;
  if (g === "home" || g === "mine") return setTab(g);
  const prefere = derniereDeSection[g];
  setTab(prefere && sectionDe(prefere) === g && ongletVisible(prefere) ? prefere : ordreOnglets().find(t => sectionDe(t) === g && ongletVisible(t)));
});

const ONGLETS = ["home", "all", "mine", "cmts", "suivi", "glossaire", "biblio", "synth", "dash", "admin"];
function setTab(t) {
  tab = t;
  try { sessionStorage.setItem("lpc_tab", t); } catch (e) { /* ignoré */ }
  section = sectionDe(t);
  if (derniereDeSection[section] !== undefined) derniereDeSection[section] = t;
  document.querySelectorAll(".tab").forEach(b => {
    const on = b.dataset.t === t;
    b.classList.toggle("on", on);
    b.setAttribute("aria-selected", String(on));
  });
  ONGLETS.forEach(x => $(x).classList.toggle("hidden", t !== x));
  majSections();
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

// Page affichée avant l'actualisation (propre à l'onglet du navigateur), si elle existe et reste accessible ; sinon l'accueil.
function ongletMemorise() {
  try {
    const t = sessionStorage.getItem("lpc_tab");
    if (t && ONGLETS.includes(t)) return t;
  } catch (e) { /* ignoré */ }
  return "";
}
