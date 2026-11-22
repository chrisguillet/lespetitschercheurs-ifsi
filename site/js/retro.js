/* Rétroplanning : calendrier mensuel cliquable, agenda à venir, fenêtre du jour, saisie d'une entrée (tâche, réunion, rappel, évènement, échéance).
   Script classique : partage la portée globale avec les autres fichiers de js/ (ordre de chargement : voir index.html). */
"use strict";
/* ---------- Rétroplanning ---------- */

const TYPES_ENTREE = {
  tache: { ico: "✅", lib: "Tâche", c: "#2563eb" },
  reunion: { ico: "👥", lib: "Réunion", c: "#7c3aed" },
  rappel: { ico: "🔔", lib: "Rappel", c: "#d97706" },
  evenement: { ico: "📅", lib: "Évènement", c: "#0d9488" },
  echeance: { ico: "🚩", lib: "Échéance", c: "#be185d" }
};
const typeEntree = j => TYPES_ENTREE[j.type] || TYPES_ENTREE.echeance;
// Les tâches et les échéances comptent dans l'avancement et peuvent être en retard ; un rappel, une réunion ou un évènement passé est simplement passé.
const estTravail = j => j.type === "tache" || j.type === "echeance" || !j.type;

const RP = { mois: null, jour: "", masques: new Set(), form: null, type: "tache" };
const MOIS_LONG = d => d.toLocaleDateString("fr-FR", { month: "long", year: "numeric" });
const JOUR_LONG = iso => { const d = jourDe(iso); return d ? d.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" }) : ""; };
const parHeure = (a, b) => (a.heure || "99:99").localeCompare(b.heure || "99:99") || a.titre.localeCompare(b.titre, "fr");
const entreesDuJour = (liste, cle) => liste.filter(j => debutJalon(j) <= cle && cle <= j.echeance).sort(parHeure);
const libEntree = j => `${j.heure ? j.heure + " · " : ""}${j.titre}`;

function renderRetro() {
  const g = groupeCourant(), box = $("retro");
  if (!box) return;
  if (!g) { box.innerHTML = ""; return; }
  const ecrit = canWrite() && groupes.some(x => x.id === g.id);
  $("addjalon").classList.toggle("hidden", !ecrit);
  const toutes = jalonsAll.filter(j => j.groupe_id === g.id);
  const liste = toutes.filter(j => !RP.masques.has(j.type || "echeance"));
  const t = aujourdhui();
  if (!RP.mois) RP.mois = { a: t.getFullYear(), m: t.getMonth() };
  const decal = (new Date(RP.mois.a, RP.mois.m, 1).getDay() + 6) % 7;
  const nbSem = Math.ceil((decal + new Date(RP.mois.a, RP.mois.m + 1, 0).getDate()) / 7), auj = isoJour(t);

  // Grille par semaines : les entrées sur plusieurs jours sont de longs bandeaux qui traversent les cases (jamais répétées jour par jour) ;
  // les entrées d'un seul jour sont des pastilles dans leur case.
  const jourIdx = iso => Math.round((jourDe(iso) - new Date(RP.mois.a, RP.mois.m, 1 - decal)) / 864e5);   // numéro de case depuis le début de la grille
  const MAX_VOIES = 4;
  let cases = "";
  for (let w = 0; w < nbSem; w++) {
    const debutSem = w * 7, finSem = w * 7 + 6;
    // Bandeaux de la semaine, rangés sur des voies (lignes) sans chevauchement.
    const segs = liste.filter(estPlage).map(j => ({ j, a: Math.max(jourIdx(j.debut), debutSem), b: Math.min(jourIdx(j.echeance), finSem), avant: jourIdx(j.debut) < debutSem, apres: jourIdx(j.echeance) > finSem }))
      .filter(s => s.a <= s.b).sort((x, y) => x.a - y.a || (y.b - y.a) - (x.b - x.a));
    const voies = [];
    segs.forEach(s => { let v = voies.findIndex(fin => fin < s.a); if (v < 0) { v = voies.length; voies.push(-1); } voies[v] = s.b; s.voie = v; });
    const nbVoies = Math.min(voies.length, MAX_VOIES);
    const bandeaux = segs.filter(s => s.voie < MAX_VOIES).map(s => {
      const j = s.j, retard = estTravail(j) && j.statut !== "fait" && ecartJours(j.echeance) < 0;
      const jc = isoJour(new Date(RP.mois.a, RP.mois.m, 1 - decal + s.a));
      return `<button type="button" class="rbi ${j.statut === "fait" ? "fait" : ""} ${retard ? "retard" : ""} ${s.avant ? "cg" : ""} ${s.apres ? "cd" : ""}" style="--t:${typeEntree(j).c};grid-column:${s.a - debutSem + 1} / ${s.b - debutSem + 2};grid-row:${s.voie + 2}" data-jour="${jc}" title="${esc(typeEntree(j).lib + " · " + libEntree(j) + " · " + fmtDatesJalon(j))}">${s.avant ? "◂ " : ""}${pastPers(j)}${esc(typeEntree(j).ico)} ${esc(libEntree(j))}${s.apres ? " ▸" : ""}</button>`;
    }).join("");
    const cachees = segs.filter(s => s.voie >= MAX_VOIES).length;
    let jours = "";
    for (let n = debutSem; n <= finSem; n++) {
      const jour = new Date(RP.mois.a, RP.mois.m, 1 - decal + n), cle = isoJour(jour);
      const tous = entreesDuJour(liste, cle), simples = tous.filter(j => !estPlage(j));
      const chips = simples.slice(0, 3).map(j => `<span class="rchip ${j.statut === "fait" ? "fait" : ""} ${estTravail(j) && j.statut !== "fait" && ecartJours(j.echeance) < 0 ? "retard" : ""}" style="--t:${typeEntree(j).c}" title="${esc(typeEntree(j).lib + " · " + libEntree(j))}">${pastPers(j)}${esc(typeEntree(j).ico)} ${esc(libEntree(j))}</span>`).join("");
      jours += `<button type="button" class="rc ${jour.getMonth() !== RP.mois.m ? "hors" : ""} ${cle === auj ? "auj" : ""} ${tous.length ? "has" : ""} ${[0, 6].includes(jour.getDay()) ? "we" : ""}" data-jour="${cle}" style="--voies:${nbVoies}" aria-label="${esc(JOUR_LONG(cle))}${tous.length ? " : " + tous.length + " élément" + (tous.length > 1 ? "s" : "") : ""}">
        <span class="rcn">${jour.getDate()}</span>${chips}${simples.length > 3 ? `<span class="rcplus">+${simples.length - 3}</span>` : ""}${n === finSem && cachees ? `<span class="rcplus" title="Autres entrées sur plusieurs jours : cliquez sur un jour">+${cachees} période${cachees > 1 ? "s" : ""}</span>` : ""}</button>`;
    }
    cases += `<div class="rweek"><div class="rdays">${jours}</div><div class="rbars" style="--voies:${nbVoies}">${bandeaux}</div></div>`;
  }

  const legende = Object.keys(TYPES_ENTREE).map(k => `<button type="button" class="rleg ${RP.masques.has(k) ? "off" : ""}" data-rleg="${k}" style="--t:${TYPES_ENTREE[k].c}" aria-pressed="${!RP.masques.has(k)}" title="Afficher ou masquer les ${esc(TYPES_ENTREE[k].lib.toLowerCase())}s"><i></i>${esc(TYPES_ENTREE[k].lib)}</button>`).join("");

  // Colonne de droite : avancement, retards, à venir.
  const trav = toutes.filter(estTravail), faits = trav.filter(j => j.statut === "fait").length;
  const retard = trav.filter(j => j.statut !== "fait" && ecartJours(j.echeance) !== null && ecartJours(j.echeance) < 0).sort((a, b) => a.echeance.localeCompare(b.echeance));
  const venir = [];
  for (let k = 0; k < 14; k++) {
    const d = new Date(t); d.setDate(t.getDate() + k);
    const cle = isoJour(d), el = entreesDuJour(toutes.filter(j => j.statut !== "fait"), cle).filter(j => k === 0 || debutJalon(j) === cle || !estPlage(j) || k === 0);
    if (el.length) venir.push([cle, el, k]);
  }
  const item = j => `<button type="button" class="ritem" data-jour="${esc(j.echeance)}" style="--t:${typeEntree(j).c}"><i></i><span><b>${esc(typeEntree(j).ico)} ${esc(j.titre)}</b>${pastPers(j)}<small>${j.heure ? esc(j.heure) + " · " : ""}${esc(typeEntree(j).lib)}</small></span></button>`;
  const side = `<aside class="rp-side">
    <div class="rcard"><div class="rtit">Avancement</div>${trav.length ? `<div class="rprog"><b>${faits}</b> / ${trav.length} <span class="meta">tâches et échéances faites</span></div><div class="barre" aria-hidden="true"><i style="width:${Math.round(100 * faits / trav.length)}%"></i></div>` : '<div class="meta">Aucune tâche pour l’instant.</div>'}</div>
    ${retard.length ? `<div class="rcard retard"><div class="rtit">⚠ En retard (${retard.length})</div>${retard.slice(0, 5).map(j => `<button type="button" class="ritem" data-jour="${esc(j.echeance)}" style="--t:#d33"><i></i><span><b>${esc(j.titre)}</b>${pastPers(j)}<small>retard de ${-ecartJours(j.echeance)} j · ${esc(fmtD(j.echeance))}</small></span></button>`).join("")}${retard.length > 5 ? `<div class="meta">+ ${retard.length - 5} autre(s)</div>` : ""}</div>` : ""}
    <div class="rcard"><div class="rtit">À venir · 14 jours</div>${venir.length ? venir.slice(0, 7).map(([cle, el, k]) => `<div class="rjour"><div class="rjd">${k === 0 ? "Aujourd’hui" : k === 1 ? "Demain" : esc(JOUR_LONG(cle))}</div>${el.slice(0, 4).map(item).join("")}</div>`).join("") : '<div class="meta">Rien de prévu dans les deux prochaines semaines.</div>'}</div>
  </aside>`;

  box.innerHTML = `<div class="rp"><div class="rp-main">
    <div class="rbar"><div class="rnav"><button type="button" class="btn sm sec" data-rnav="-1" aria-label="Mois précédent">◀</button><button type="button" class="btn sm sec" data-rnav="0">Aujourd’hui</button><button type="button" class="btn sm sec" data-rnav="1" aria-label="Mois suivant">▶</button></div>
      <h3 class="rmois">${esc(MOIS_LONG(new Date(RP.mois.a, RP.mois.m, 1)))}</h3><div class="rlegs">${legende}</div></div>
    <div class="rhead">${["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"].map(x => `<div class="rh">${x}</div>`).join("")}</div><div class="rgrille" role="grid" aria-label="Calendrier du rétroplanning">${cases}</div>
    <div class="meta" style="margin-top:6px">Cliquez sur un jour pour voir son contenu${ecrit ? " ou y ajouter quelque chose" : ""}.</div></div>${side}</div>`;
}

/* ----- Fenêtre d'un jour ----- */

function lignesJour(cle) {
  const g = groupeCourant(); if (!g) return "";
  const ecrit = canWrite() && groupes.some(x => x.id === g.id);
  const el = entreesDuJour(jalonsAll.filter(j => j.groupe_id === g.id), cle);
  const cr = reunionsAll.filter(r => r.groupe_id === g.id && r.date === cle);
  const ligne = j => `<div class="rrow ${j.statut === "fait" ? "fait" : ""}" style="--t:${typeEntree(j).c}"><i></i>
      <div class="rtxt"><div><b>${esc(typeEntree(j).ico)} ${esc(j.titre)}</b>${pastPers(j)} <span class="meta">${esc(typeEntree(j).lib)}${j.heure ? " · " + esc(j.heure) : ""}${estPlage(j) ? " · " + esc(fmtDatesJalon(j)) : ""}</span></div>
        ${j.par ? `<div class="meta"><span class="dot" style="background:${esc(j.par_couleur || "#888")}"></span> ${esc(j.par)}</div>` : ""}
        <div class="meta">${esc(STATUT_JALON[j.statut] || j.statut)} ${delaiJalon(j)}${j.note ? " · " + esc(j.note) : ""}${urlSure(j.visio) ? ` · <a href="${esc(urlSure(j.visio))}" target="_blank" rel="noopener noreferrer">🎥 Visio</a>` : ""}</div></div>
      ${j.tache_id ? `<div class="ract">${j.reunion_id ? `<button type="button" class="btn sm sec" data-rcr="${esc(j.reunion_id)}" title="Aperçu du compte rendu">📄 Compte rendu</button><button type="button" class="btn sm sec" data-red="${esc(j.reunion_id)}" title="Modifier le compte rendu (les tâches se gèrent là-bas)">✏️ Modifier le compte rendu</button>` : ""}</div>`
        : (j.modifiable ? `<div class="ract"><button type="button" class="btn sm sec" data-rpf="${esc(j.id)}" title="${j.statut === "fait" ? "Remettre à faire" : "Marquer comme fait"}">${j.statut === "fait" ? "↩" : "✓"}</button><button type="button" class="btn sm sec" data-rped="${esc(j.id)}">Modifier</button><button type="button" class="btn sm sec del" data-rpdel="${esc(j.id)}" aria-label="Supprimer">🗑</button></div>` : "")}</div>`;
  return (el.length ? el.map(ligne).join("") : '<div class="meta">Rien de prévu ce jour-là.</div>')
    + (cr.length ? `<div class="rtit" style="margin-top:12px">📝 Comptes rendus de réunion</div>${cr.map(r => `<div class="rrow" style="--t:#7c3aed"><i></i><div class="rtxt"><b>${esc(r.titre || "Compte rendu")}</b></div><div class="ract"><button type="button" class="btn sm sec" data-rcr="${esc(r.id)}">📄 Aperçu / PDF</button></div></div>`).join("")}` : "")
    + (ecrit ? `<div style="margin-top:14px"><button type="button" class="btn" data-rpnew="${esc(cle)}">＋ Ajouter ce jour-là</button></div>` : "");
}

function ouvrirJour(cle) {
  if (!$("rpday")) return;
  RP.jour = cle;
  $("rpdaytitle").textContent = JOUR_LONG(cle).replace(/^./, c => c.toUpperCase());
  $("rpdaybody").innerHTML = lignesJour(cle);
  $("rpday").classList.remove("hidden"); document.body.classList.add("modalopen");
}
function fermerJour() {
  if (!RP.jour) return;
  RP.jour = "";
  $("rpday").classList.add("hidden"); $("rpdaybody").innerHTML = "";
  if (!RP.form) document.body.classList.remove("modalopen");
}
const rafraichirRetro = () => { if (tab === "suivi") renderRetro(); if (RP.jour) $("rpdaybody").innerHTML = lignesJour(RP.jour); majAlertes(); };

/* ----- Saisie d'une entrée ----- */

// Pastilles des personnes assignées à une entrée (couleur de chacune).
// Pastilles des personnes assignées : rond de leur couleur avec leurs initiales.
const initPers = s => String(s || "").trim().split(/s+/).map(w => w[0] || "").join("").slice(0, 2).toUpperCase();
const pastPers = j => (j.personnes || []).map(p => `<span class="ppers" style="--c:${esc(p.couleur)}" title="${esc(p.prenom)}">${esc(initPers(p.prenom))}</span>`).join("");
const ALERTES_RP = [["", "Aucune"], ["0", "Le jour même"], ["1", "1 jour avant"], ["3", "3 jours avant"], ["7", "1 semaine avant"], ["14", "2 semaines avant"]];
function ouvrirEntree(id, cleDefaut) {
  if (!$("rpform")) return;
  const j = jalonsAll.find(x => x.id === id) || { type: "tache", statut: "a_faire", echeance: cleDefaut || isoJour(aujourdhui()) };
  RP.form = { id: id || "" }; RP.type = j.type || "echeance";
  const al = j.alerte_jours == null ? "" : String(j.alerte_jours), ale = ALERTES_RP.slice();
  if (!ale.some(a => a[0] === al)) ale.push([al, al + " jours avant"]);
  const deb = debutJalon(j) || "", fin = estPlage(j) ? j.echeance : "";
  $("rpformtitle").textContent = id ? "Modifier" : "Ajouter au rétroplanning";
  $("rpformbody").innerHTML = `<div class="rtypes" role="radiogroup" aria-label="Type">${Object.keys(TYPES_ENTREE).map(k => `<button type="button" role="radio" aria-checked="${k === RP.type}" class="rtype ${k === RP.type ? "on" : ""}" data-rtype="${k}" style="--t:${TYPES_ENTREE[k].c}"><span>${esc(TYPES_ENTREE[k].ico)}</span>${esc(TYPES_ENTREE[k].lib)}</button>`).join("")}</div>
    <div class="grid" style="margin-top:12px">
      <div style="grid-column:1/-1"><label for="e_titre">Titre</label><input id="e_titre" maxlength="200" value="${esc(j.titre || "")}" placeholder="ex. Point avec la formatrice"></div>
      <div><label for="e_date">Date</label><input id="e_date" type="date" value="${esc(deb)}"></div>
      <div><label for="e_fin">Jusqu’au (facultatif)</label><input id="e_fin" type="date" value="${esc(fin)}"></div>
      <div><label for="e_heure">Heure (facultative)</label><input id="e_heure" type="time" value="${esc(j.heure || "")}"></div>
      <div><label for="e_statut">Statut</label><select id="e_statut">${Object.keys(STATUT_JALON).map(k => `<option value="${k}" ${j.statut === k ? "selected" : ""}>${esc(STATUT_JALON[k])}</option>`).join("")}</select></div>
      <div><label for="e_alerte">Alerte dans l’outil</label><select id="e_alerte">${ale.map(a => `<option value="${esc(a[0])}" ${a[0] === al ? "selected" : ""}>${esc(a[1])}</option>`).join("")}</select></div>
      <div style="grid-column:1/-1"><label>Personnes concernées <span class="meta">(une pastille de leur couleur sur l’entrée)</span></label><div class="grow">${(groupeCourant() || {}).membres ? (groupeCourant().membres).map(m => `<label class="chk"><input type="checkbox" data-epers="${esc(m.pid)}" ${(j.personnes || []).some(p => p.pid === m.pid) ? "checked" : ""}> ${esc(m.prenom)}</label>`).join("") : ""}</div></div>
      <div style="grid-column:1/-1"><label for="e_visio">Visio <span class="meta">(lien Google Meet ou autre, en https)</span></label><div class="grow"><input id="e_visio" type="url" maxlength="290" value="${esc(j.visio || "")}" placeholder="https://meet.google.com/…" style="flex:1;min-width:200px"><button type="button" class="btn sm sec" id="e_meet" title="Ouvre Google Meet dans un nouvel onglet : créez la réunion, puis collez ici son lien">🎥 Créer un Meet</button> <button type="button" class="btn sm" id="e_jitsi" title="Crée une salle Jitsi (sans compte pour les invités) et remplit le champ">⚡ Visio Jitsi (1 clic)</button></div></div>
      <div style="grid-column:1/-1"><label for="e_note">Note</label><input id="e_note" maxlength="500" value="${esc(j.note || "")}"></div></div>
    <div class="meta">L’alerte apparaît dans la cloche 🔔 des membres du groupe, tant que l’entrée n’est pas « Fait ». Chacun peut la reporter.</div>
    <div class="savebar"><div id="eerr" class="err" role="alert"></div><button class="btn" id="esave" type="button">Enregistrer</button> <button class="btn sec" id="ecancel" type="button">Annuler</button></div>`;
  $("rpform").classList.remove("hidden"); document.body.classList.add("modalopen");
  $("e_titre").focus();
}
function fermerEntree() {
  if (!RP.form) return;
  RP.form = null;
  $("rpform").classList.add("hidden"); $("rpformbody").innerHTML = "";
  if (!RP.jour) document.body.classList.remove("modalopen");
}
async function enregistrerEntree() {
  const g = groupeCourant(), f = RP.form; if (!g || !f) return;
  const date = $("e_date").value, fin = $("e_fin").value;
  if (!$("e_titre").value.trim()) { $("eerr").textContent = "Donnez un titre."; return; }
  if (!date) { $("eerr").textContent = "Indiquez la date."; return; }
  if (fin && fin < date) { $("eerr").textContent = "La date de fin doit suivre la date de début."; return; }
  const data = { titre: $("e_titre").value, type: RP.type, debut: fin && fin !== date ? date : "", echeance: fin && fin !== date ? fin : date, heure: $("e_heure").value,
    statut: $("e_statut").value, alerte_jours: $("e_alerte").value, note: $("e_note").value, visio: $("e_visio").value.trim(), personnes: [...document.querySelectorAll("[data-epers]:checked")].map(c => c.dataset.epers) };
  $("esave").disabled = true;
  try {
    const res = await enCours("Enregistrement…", () => api("jalon_save", { groupe_id: g.id, id: f.id || undefined, data }));
    fermerEntree();
    applyResult(res);
    rafraichirRetro();
  } catch (e) {
    $("esave").disabled = false;
    if (e.code === "unauthorized") sessionError(e); else $("eerr").textContent = "Enregistrement impossible : " + e.message;
  }
}
async function basculerFait(id) {
  const j = jalonsAll.find(x => x.id === id); if (!j) return;
  const data = { titre: j.titre, type: j.type || "echeance", debut: j.debut || "", echeance: j.echeance, heure: j.heure || "", statut: j.statut === "fait" ? "a_faire" : "fait", alerte_jours: j.alerte_jours == null ? "" : j.alerte_jours, note: j.note || "" };
  try { applyResult(await enCours("Enregistrement…", () => api("jalon_save", { groupe_id: j.groupe_id, id, data }))); rafraichirRetro(); }
  catch (e) { if (e.code === "unauthorized") sessionError(e); else alert("Action impossible : " + e.message); }
}
async function supprimerEntree(id) {
  if (!confirm("Supprimer cet élément du rétroplanning ?")) return;
  try { applyResult(await enCours("Suppression…", () => api("jalon_delete", { id }))); rafraichirRetro(); }
  catch (e) { if (e.code === "unauthorized") sessionError(e); else alert("Suppression impossible : " + e.message); }
}

/* ----- Branchements ----- */

$("retro")?.addEventListener("click", e => {
  const b = e.target.closest("button"); if (!b) return;
  const d = b.dataset;
  if (d.rnav !== undefined) {
    const t = aujourdhui();
    if (d.rnav === "0") RP.mois = { a: t.getFullYear(), m: t.getMonth() };
    else { const n = new Date(RP.mois.a, RP.mois.m + +d.rnav, 1); RP.mois = { a: n.getFullYear(), m: n.getMonth() }; }
    renderRetro();
  } else if (d.rleg) { if (RP.masques.has(d.rleg)) RP.masques.delete(d.rleg); else RP.masques.add(d.rleg); renderRetro(); }
  else if (d.jour) ouvrirJour(d.jour);
});
$("addjalon")?.addEventListener("click", () => ouvrirEntree("", RP.jour || ""));
$("rpday")?.addEventListener("click", e => {
  if (e.target === $("rpday")) return fermerJour();
  const b = e.target.closest("button"); if (!b) return;
  const d = b.dataset;
  if (b.id === "rpdayclose") fermerJour();
  else if (d.rpnew) ouvrirEntree("", d.rpnew);
  else if (d.rped) ouvrirEntree(d.rped);
  else if (d.rpf) basculerFait(d.rpf);
  else if (d.rpdel) supprimerEntree(d.rpdel);
  else if (d.rcr) ouvrirCompteRendu(d.rcr);
});
$("rpform")?.addEventListener("click", e => {
  if (e.target === $("rpform")) return fermerEntree();
  const b = e.target.closest("button"); if (!b) return;
  if (b.dataset.rtype) {
    RP.type = b.dataset.rtype;
    $("rpformbody").querySelectorAll(".rtype").forEach(x => { const on = x.dataset.rtype === RP.type; x.classList.toggle("on", on); x.setAttribute("aria-checked", String(on)); });
  } else if (b.id === "esave") enregistrerEntree();
  else if (b.id === "ecancel" || b.id === "rpformclose") fermerEntree();
});
document.addEventListener("keydown", e => {
  if (e.key !== "Escape") return;
  if (RP.form) fermerEntree(); else if (RP.jour && !CR.ouvert) fermerJour();
});

/* ----- Accueil : petit aperçu d'un jour du mini-calendrier ----- */
function apercuJour(cle, ancre) {
  document.querySelectorAll(".mcpop").forEach(x => x.remove());
  const mes = mesGroupesIds();
  const el = entreesDuJour(jalonsAll.filter(j => mes.has(j.groupe_id) && j.statut !== "fait"), cle);
  const cr = reunionsAll.filter(r => mes.has(r.groupe_id) && r.date === cle);
  const p = document.createElement("div");
  p.className = "mcpop"; p.setAttribute("role", "dialog"); p.setAttribute("aria-label", JOUR_LONG(cle));
  const ligne = j => `<div class="mcl" style="--t:${typeEntree(j).c}"><i></i><span><b>${esc(typeEntree(j).ico)} ${esc(j.titre)}</b>${pastPers(j)}<small>${esc(typeEntree(j).lib)}${j.heure ? " · " + esc(j.heure) : ""}${groupes.length > 1 ? " · " + esc(nomGroupe(j.groupe_id)) : ""}</small></span></div>`;
  p.innerHTML = `<div class="mcph"><b>${esc(JOUR_LONG(cle).replace(/^./, c => c.toUpperCase()))}</b><button type="button" class="btn sm sec" data-mcx="1" aria-label="Fermer">✕</button></div>
    ${el.length ? el.map(ligne).join("") : '<div class="meta">Rien de prévu ce jour-là.</div>'}${cr.length ? `<div class="meta" style="margin-top:4px">📝 ${cr.length} compte${cr.length > 1 ? "s" : ""} rendu${cr.length > 1 ? "s" : ""} de réunion</div>` : ""}
    <div class="mcpf"><button type="button" class="btn sm" data-mcgo="${esc(cle)}">Ouvrir dans le rétroplanning</button></div>`;
  document.body.appendChild(p);
  const r = ancre.getBoundingClientRect(), w = p.offsetWidth;
  p.style.top = Math.min(window.scrollY + r.bottom + 6, window.scrollY + window.innerHeight - p.offsetHeight - 8) + "px";
  p.style.left = Math.max(8, Math.min(window.scrollX + r.left, window.scrollX + document.documentElement.clientWidth - w - 8)) + "px";
  p.addEventListener("click", e => {
    const b = e.target.closest("button"); if (!b) return;
    if (b.dataset.mcgo) { const c = b.dataset.mcgo; p.remove(); const m = jourDe(c); RP.mois = { a: m.getFullYear(), m: m.getMonth() }; setTab("suivi"); ouvrirJour(c); }
    else p.remove();
  });
}
document.addEventListener("click", e => {
  const c = e.target.closest("[data-mcj]");
  if (c) { e.stopPropagation(); apercuJour(c.dataset.mcj, c); return; }
  if (!e.target.closest(".mcpop")) document.querySelectorAll(".mcpop").forEach(x => x.remove());
});
document.addEventListener("keydown", e => { if (e.key === "Escape") document.querySelectorAll(".mcpop").forEach(x => x.remove()); });

// « Créer un Meet » : ouvre Google Meet dans un nouvel onglet (la personne connectée à son compte Google y crée la réunion, puis colle le lien dans le champ).
document.addEventListener("click", e => { if (e.target.closest && e.target.closest("#e_meet")) window.open("https://meet.google.com/new", "_blank", "noopener"); });

// « Visio Jitsi (1 clic) » : crée une salle Jitsi au nom aléatoire et remplit le champ. Pas de compte, pas de clé : le lien suffit pour rejoindre.
document.addEventListener("click", e => {
  if (!(e.target.closest && e.target.closest("#e_jitsi"))) return;
  const b = new Uint8Array(9); crypto.getRandomValues(b);
  const nom = "lpc-" + Array.from(b, x => x.toString(36).padStart(2, "0")).join("");
  $("e_visio").value = "https://meet.jit.si/" + nom;
});
