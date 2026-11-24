/* Suivi de projet : rétroplanning et réunions du groupe.
   Script classique : partage la portée globale avec les autres fichiers de js/ (ordre de chargement : voir index.html). */
"use strict";
/* ---------- Suivi de projet : rétroplanning et réunions du groupe ---------- */

// Statuts d'une lecture : « À lire » est la file d'attente (visible du groupe : c'est aussi la réservation).
const ST = {
  "Terminée": { ico: "✅", lib: "Terminée", long: "Terminée", cl: "" },
  "En cours": { ico: "📖", lib: "En cours", long: "En cours de lecture", cl: "prog" },
  "À lire": { ico: "📌", lib: "À lire", long: "À lire", cl: "lire" }
};
const stInfo = x => ST[x] || ST["Terminée"];
const PRIO = { haute: "🔥 Haute", normale: "Normale", basse: "💤 Basse" };
const ORDRE_PRIO = { haute: 0, normale: 1, basse: 2 };
const badgeStatut = (i, c) => `<span class="badge ${stInfo(i.statut).cl}" style="--c:${c}">${stInfo(i.statut).ico} ${stInfo(i.statut).lib}</span>${i.statut === "À lire" && i.priorite ? `<span class="badge prio ${esc(i.priorite)}" title="Priorité">${esc(PRIO[i.priorite] || i.priorite)}</span>` : ""}`;
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

/* ---------- Alertes : une petite cloche discrète, avec report possible (mémorisé dans ce navigateur) ---------- */
const cleReports = () => "lpc_reports:" + (me ? me.prenom : "");
function lireReports() { try { return JSON.parse(localStorage.getItem(cleReports()) || "{}") || {}; } catch (e) { return {}; } }
function ecrireReports(o) { try { localStorage.setItem(cleReports(), JSON.stringify(o)); } catch (e) { /* ignoré */ } }
// Reporte l'alerte d'une entrée jusqu'à une date (« 9999-12-31 » : ne plus rappeler).
function reporterAlerte(id, jours) {
  const o = lireReports(), d = aujourdhui();
  if (jours === null) o[id] = "9999-12-31"; else { d.setDate(d.getDate() + jours); o[id] = isoJour(d); }
  ecrireReports(o); majAlertes();
}
// Alertes à montrer : celles qui ne sont pas reportées (un report échu les ramène).
function alertesVisibles() {
  const o = lireReports(), auj = isoJour(aujourdhui());
  return alertesJalons().filter(j => !(o[j.id] && o[j.id] > auj));
}
let alertePop = false;
function majAlertes() {
  const nb = $("alertnb"), zone = $("alertbell");
  if (nb) nb.classList.add("hidden");
  if (!zone) return;
  const l = me ? alertesVisibles() : [];
  if (nb) { nb.textContent = l.length; nb.classList.toggle("hidden", !l.length); }
  if (!l.length) { alertePop = false; zone.innerHTML = ""; return; }
  const nomG = j => groupes.length > 1 ? ` <span class="meta">(${esc((groupes.find(g => g.id === j.groupe_id) || {}).nom || "")})</span>` : "";
  const ligne = j => `<div class="alrow ${alerteJalon(j) === "retard" ? "retard" : ""}"><div class="alt"><span class="alico">${esc(typeEntree(j).ico)}</span> <b>${esc(j.titre)}</b>${nomG(j)}<div class="meta">${esc(fmtDatesJalon(j))} · ${delaiJalon(j)}</div></div>
      <details class="alsnooze"><summary class="btn sm sec" aria-label="Reporter cette alerte">Reporter ▾</summary><div class="colpop right">
        <button type="button" data-alr="${esc(j.id)}" data-j="1">Demain</button><button type="button" data-alr="${esc(j.id)}" data-j="3">Dans 3 jours</button><button type="button" data-alr="${esc(j.id)}" data-j="7">Dans 1 semaine</button><button type="button" data-alr="${esc(j.id)}" data-j="x">Ne plus me le rappeler</button></div></details></div>`;
  zone.innerHTML = `<button type="button" class="alertbtn" id="alertbtn" aria-expanded="${alertePop}" aria-label="${l.length} alerte${l.length > 1 ? "s" : ""} du rétroplanning" title="Alertes du rétroplanning">🔔<span class="alertpt">${l.length}</span></button>
    ${alertePop ? `<div class="alertpop" role="dialog" aria-label="Alertes du rétroplanning"><div class="alhead"><b>Rétroplanning</b><button type="button" class="btn sm sec" data-alr-fermer="1" aria-label="Fermer">✕</button></div>${l.slice(0, 8).map(ligne).join("")}${l.length > 8 ? `<div class="meta">+ ${l.length - 8} autre(s)</div>` : ""}<div class="alfoot"><button type="button" class="btn sm" data-alr-voir="1">Voir le rétroplanning</button></div></div>` : ""}`;
  // Téléphone : le panneau est fixe sous la cloche et prend la largeur de l’écran (voir style.css).
  const pop = zone.querySelector(".alertpop");
  if (pop && window.innerWidth <= 640) pop.style.top = Math.round(zone.getBoundingClientRect().bottom + 8) + "px";
}
$("alertbell")?.addEventListener("click", e => {
  const b = e.target.closest("button"); if (!b) return;
  if (b.id === "alertbtn") { alertePop = !alertePop; majAlertes(); }
  else if (b.dataset.alrFermer) { alertePop = false; majAlertes(); }
  else if (b.dataset.alrVoir) { alertePop = false; majAlertes(); setTab("suivi"); }
  else if (b.dataset.alr) reporterAlerte(b.dataset.alr, b.dataset.j === "x" ? null : +b.dataset.j);
});
// Fermeture au clic ailleurs. composedPath() : le bouton cliqué a déjà été remplacé par le nouveau rendu, closest() ne le retrouverait plus.
document.addEventListener("click", e => { if (alertePop && !e.composedPath().includes($("alertbell"))) { alertePop = false; majAlertes(); } });

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
  renderRetro();
  $("addreunion").classList.toggle("hidden", !(canWrite() && groupes.some(x => x.id === g.id)));
  const reu = reunionsAll.filter(x => x.groupe_id === g.id).sort((a, b) => b.date.localeCompare(a.date));
  const sect = (t, v) => String(v || "").trim() ? `<div class="sect"><b>${t}</b><div style="white-space:pre-wrap">${esc(v)}</div></div>` : "";
  $("reunions").innerHTML = reu.length ? reu.map(x => `<article class="cardc reunion"><div class="tools" style="justify-content:space-between"><h3 style="margin:0">${esc(fmtD(x.date))}${x.titre ? " · " + esc(x.titre) : ""}</h3>
    <div><button type="button" class="btn sm sec" data-rcr="${esc(x.id)}" title="Aperçu avant impression ou enregistrement en PDF">📄 Aperçu / PDF</button>${x.modifiable ? ` <button type="button" class="btn sm sec" data-red="${esc(x.id)}">Modifier</button> <button type="button" class="btn sm sec del" data-rdel="${esc(x.id)}">Supprimer</button>` : ""}</div></div>
    <div class="meta">${x.participants ? "Participants : " + esc(x.participants) + " · " : ""}saisi par ${esc(x.par)}${x.modifie_par ? ` · modifié par ${esc(x.modifie_par)}` : ""}</div>
    ${sect("Objectifs", x.objectifs)}${sect("Ce qui a été vu", x.vu)}${sect("Ce qui est attendu", x.attendu)}${suiviForm && suiviForm.type === "reunion" && suiviForm.id === x.id
      ? '<div class="meta">✏️ Tâches, liens et pièces jointes : dans le formulaire de modification ci-dessus.</div>' : reunionDetailHtml(x)}</article>`).join("")
    : `<div class="empty">Aucun compte rendu pour l’instant.</div>`;
  if (suiviForm && suiviForm.type === "reunion") crAttenteRafraichir();
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
      <div><label for="r_objectifs">Objectifs</label><textarea id="r_objectifs" maxlength="2500" placeholder="ex. choisir la question de recherche, répartir les lectures">${esc(x.objectifs)}</textarea></div>
      <div class="grid"><div><label for="r_vu">Ce qui a été vu</label><textarea id="r_vu" maxlength="2500">${esc(x.vu)}</textarea></div>
      <div><label for="r_attendu">Ce qui est attendu</label><textarea id="r_attendu" maxlength="2500">${esc(x.attendu)}</textarea></div>
      </div>
      <div id="r_saisie" class="meta" role="status" aria-live="polite"></div>
      <div id="cr_attente"></div>
      <div id="r_conflit"></div><div id="r_histo"></div>
      <div class="savebar"><div id="rerr" class="err" role="alert"></div><button class="btn" id="rsave" type="button">Enregistrer le compte rendu</button> <button class="btn sec" id="rcancel" type="button">Annuler</button>${id ? ' <button class="btn sec" id="rhisto" type="button" title="Retrouver un état récent écrasé">🕘 Historique</button>' : ""}</div></div>`;
    suiviForm.base = id ? { version: x.version, champs: crChampsDe(x) } : null;   // l'état ouvert : sert à repérer ce qui change entre-temps
    if (id) $("rhisto").onclick = () => crAfficherHistorique(id);
    crAttenteReinit(id);
    crDetailSignature = "";
    if (id) renderSuivi(); else crAttenteRafraichir();   // en modification, le détail passe de la fiche au formulaire
    $("rsave").onclick = () => enregistrerCompteRendu(id, g.id, "rerr");
    $("rcancel").onclick = () => fermerSuiviForm();
    saisieDemarrer(g.id, id);
    $("r_objectifs").focus();
  }
}

// ---------- « Untel écrit… » : on signale sa propre saisie et on reçoit celle des autres membres, pendant que le formulaire est ouvert ----------
const SAISIE = { timer: null, derniere: 0, groupe: "", cible: "" };
const SAISIE_ACTIVE_MS = 5000, SAISIE_PERIODE_MS = 4000;

function saisieTexte(noms) {
  if (!noms.length) return "";
  const liste = noms.length === 1 ? noms[0] : noms.slice(0, -1).join(", ") + " et " + noms[noms.length - 1];
  return "✏️ " + liste + (noms.length === 1 ? " est" : " sont") + " en train d’écrire sur ce compte rendu…";
}

async function saisieEnvoyer() {
  if (!SAISIE.cible) return;
  const cible = SAISIE.cible, ecrit = Date.now() - SAISIE.derniere < SAISIE_ACTIVE_MS;
  try {
    const r = await api("saisie_signal", { groupe_id: SAISIE.groupe, cible, ecrit });
    const z = $("r_saisie");
    if (z && SAISIE.cible === cible) z.textContent = saisieTexte(r.ecrivent || []);
  } catch (e) { if (e.code === "unauthorized") sessionError(e); /* autre erreur : l'indicateur est facultatif, on réessaie au prochain tour */ }
}

function saisieDemarrer(gid, id) {
  saisieArreter();
  SAISIE.groupe = gid; SAISIE.cible = id || "nouveau"; SAISIE.derniere = 0;
  $("reunionform").oninput = () => {
    const premiere = Date.now() - SAISIE.derniere >= SAISIE_ACTIVE_MS;
    SAISIE.derniere = Date.now();
    if (premiere) saisieEnvoyer();   // la première frappe se signale tout de suite, la suite au rythme du minuteur
  };
  SAISIE.timer = setInterval(() => { if (!document.hidden) saisieEnvoyer(); }, SAISIE_PERIODE_MS);
  saisieEnvoyer();
}

function saisieArreter() {
  if (SAISIE.timer) clearInterval(SAISIE.timer);
  SAISIE.timer = null;
  const gid = SAISIE.groupe, cible = SAISIE.cible;
  SAISIE.cible = "";
  const f = $("reunionform"); if (f) f.oninput = null;
  if (gid && cible && token) api("saisie_signal", { groupe_id: gid, cible, ecrit: false }).catch(() => {});   // son signal est effacé sans attendre
}

function fermerSuiviForm() {
  const etaitModif = suiviForm && suiviForm.type === "reunion" && suiviForm.id;
  saisieArreter();
  suiviForm = null; $("jalonform").innerHTML = ""; $("reunionform").innerHTML = "";
  if (etaitModif) renderSuivi();   // le détail revient sur la fiche du compte rendu
}

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
  else if (d.rcr) ouvrirCompteRendu(d.rcr);
});
