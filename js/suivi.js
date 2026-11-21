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
    <div><button type="button" class="btn sm sec" data-rcr="${esc(x.id)}" title="Aperçu avant impression ou enregistrement en PDF">📄 Aperçu / PDF</button>${x.modifiable ? ` <button type="button" class="btn sm sec" data-red="${esc(x.id)}">Modifier</button> <button type="button" class="btn sm sec del" data-rdel="${esc(x.id)}">Supprimer</button>` : ""}</div></div>
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
  else if (d.rcr) ouvrirCompteRendu(d.rcr);
});
