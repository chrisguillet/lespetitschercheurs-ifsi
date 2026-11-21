/* Accueil, tableau de bord des groupes, fête de fin de lecture.
   Script classique : partage la portée globale avec les autres fichiers de js/ (ordre de chargement : voir index.html). */
"use strict";
/* ---------- Accueil : le résumé du jour ---------- */

const joursDepuis = iso => { const t = Date.parse(iso || ""); return isNaN(t) ? null : Math.floor((Date.now() - t) / 864e5); };
const nomGroupe = id => (groupes.find(g => g.id === id) || {}).nom || "";

// Mini-calendrier en jours glissants : aujourd'hui et les 13 jours à venir, avec les jalons non faits (échéance, ou plage de dates).
function miniCalendrier(jalons) {
  const NB = 14, ajd = new Date(); ajd.setHours(0, 0, 0, 0);
  const iso = d => d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  const jrs = ["dim", "lun", "mar", "mer", "jeu", "ven", "sam"];
  const cases = [...Array(NB)].map((_, k) => {
    const d = new Date(ajd); d.setDate(ajd.getDate() + k);
    const s = iso(d);
    const lies = jalons.filter(j => j.echeance && s >= (j.debut || j.echeance) && s <= j.echeance);
    const fin = lies.filter(j => j.echeance === s).length, titres = lies.map(j => j.titre + (j.echeance === s ? " (échéance)" : "")).join("\n");
    const cls = ["mc", k === 0 ? "today" : "", d.getDay() === 0 || d.getDay() === 6 ? "we" : "", lies.length ? "has" : "", fin ? "fin" : ""].filter(Boolean).join(" ");
    return `<button type="button" class="${cls}" data-mcj="${s}" ${titres ? `title="${esc(titres)}"` : ""}><small>${jrs[d.getDay()]}</small><b>${d.getDate()}</b><span class="mcp">${lies.length ? "●".repeat(Math.min(lies.length, 3)) : "&nbsp;"}</span></button>`;
  }).join("");
  const retard = jalons.filter(j => ecartJours(j.echeance) !== null && ecartJours(j.echeance) < 0).length;
  return `<div class="minical" role="img" aria-label="Jalons des 14 prochains jours">${cases}</div>${retard ? `<div class="late">⚠ ${retard} jalon${retard > 1 ? "s" : ""} en retard</div>` : ""}`;
}

function renderHome() {
  const box = $("home");
  if (!me || !box) return;
  const mes = mesGroupesIds();
  const jours = ["dimanche", "lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi"][new Date().getDay()];
  const bloc = (titre, corps, action) => corps ? `<section class="hcard"><h3>${titre}</h3>${corps}${action || ""}</section>` : "";
  const aller = (t, txt, extra) => `<button type="button" class="btn sm sec" data-go="${t}" ${extra || ""}>${txt}</button>`;
  // Jalons de mes groupes : en retard ou dans les 14 jours.
  const jal = jalonsAll.filter(j => mes.has(j.groupe_id) && j.statut !== "fait" && ecartJours(j.echeance) !== null && ecartJours(j.echeance) <= 14)
    .sort((a, b) => a.echeance.localeCompare(b.echeance));
  const jalHtml = jal.length ? miniCalendrier(jalonsAll.filter(j => mes.has(j.groupe_id) && j.statut !== "fait")) + `<ul class="hlist">${jal.slice(0, 3).map(j => `<li><b>${esc(j.titre)}</b>${groupes.length > 1 ? ` <span class="meta">(${esc(nomGroupe(j.groupe_id))})</span>` : ""} <span class="meta">${esc(fmtDatesJalon(j))}</span> ${delaiJalon(j)}</li>`).join("")}</ul>${jal.length > 3 ? `<div class="meta">+ ${jal.length - 3} autre(s)</div>` : ""}` : "";
  // Votes qui attendent ma réponse.
  const vf = groupes.reduce((n, g) => n + votesAFaire(g), 0), pf = canWrite() ? props.filter(p => !p.mine && p.monVote == null).length : 0;
  const voteGroupe = groupes.find(g => votesAFaire(g));
  const voteHtml = vf || pf ? `<ul class="hlist">${vf ? `<li>${vf} vote${vf > 1 ? "s" : ""} de groupe à donner</li>` : ""}${pf ? `<li>${pf} correction${pf > 1 ? "s" : ""} d’article à approuver ou refuser</li>` : ""}</ul>` : "";
  const nl = commentsAll.filter(nonLu).length;
  const parLect = new Map(itemsAll.map(i => [i.id, i]));
  const derniers = commentsAll.filter(c => parLect.has(c.lecture_id)).sort((a, b) => String(b.date).localeCompare(String(a.date))).slice(0, 4);
  const comHtml = nl || derniers.length ? `${nl ? `<div>${nl} commentaire${nl > 1 ? "s" : ""} non lu${nl > 1 ? "s" : ""}.</div>` : ""}${derniers.map(c => { const it = parLect.get(c.lecture_id); return `<button type="button" class="hcom ${nonLu(c) ? "fresh" : ""}" data-hc="${esc(c.lecture_id)}" data-hp="${esc(c.portee === "promo" ? "promo" : "groupe")}"><b>${esc(c.auteur)}</b> <span class="meta">${esc(fmtDT(c.date))}</span> ${nomGroupe(it.groupe_id) ? `<span class="hgrp">${esc(nomGroupe(it.groupe_id))}</span>` : ""}<div class="meta">sur <b>${esc(it.titre)}</b></div><div class="cmtxt">${esc(c.texte)}</div></button>`; }).join("")}` : "";
  // Mes lectures : file d'attente et en cours.
  const miennes = itemsAll.filter(i => i.mine), lire = miennes.filter(i => i.statut === "À lire").sort((a, b) => (ORDRE_PRIO[a.priorite] ?? 1) - (ORDRE_PRIO[b.priorite] ?? 1)), enc = miennes.filter(i => i.statut === "En cours");
  const lectHtml = canWrite() && (lire.length || enc.length) ? `<ul class="hlist">${enc.slice(0, 3).map(i => `<li>📖 <b>${esc(i.titre)}</b> <span class="meta">en cours</span></li>`).join("")}${lire.slice(0, 3).map(i => `<li>📌 <b>${esc(i.titre)}</b> <span class="meta">${esc(PRIO[i.priorite] || "")}</span></li>`).join("")}</ul>` : "";
  // Nouveautés : fiches des autres, saisies depuis moins d'une semaine.
  const nouv = itemsAll.filter(i => !i.mine && mes.has(i.groupe_id) && i.statut !== "À lire" && joursDepuis(i.ajoute) !== null && joursDepuis(i.ajoute) < 7).sort((a, b) => String(b.ajoute).localeCompare(a.ajoute));
  const nouvHtml = nouv.length ? `<ul class="hlist">${nouv.slice(0, 5).map(i => `<li><span class="av sm" style="--c:${esc(i.couleur)}">${initiales(i.etudiant)}</span> <b>${esc(i.etudiant)}</b> · ${esc(i.titre)} ${nomGroupe(i.groupe_id) ? `<span class="hgrp">${esc(nomGroupe(i.groupe_id))}</span> ` : ""}<span class="meta">${esc(stInfo(i.statut).lib.toLowerCase())}</span></li>`).join("")}</ul>` : "";
  const attente = isSuper() && pendingCount ? `<div>${pendingCount} demande${pendingCount > 1 ? "s" : ""} d’accès en attente.</div>` : "";
  const blocs = [
    bloc("⏰ Rétroplanning", jalHtml, aller("suivi", "Ouvrir le suivi de projet")),
    bloc("🗳 À voter", voteHtml, voteGroupe ? `<button type="button" class="btn sm sec" data-gv="${esc(voteGroupe.id)}">Ouvrir les votes</button>` : ""),
    bloc("💬 Derniers commentaires", comHtml, aller("cmts", "Tous les commentaires")),
    bloc("✍️ Mes lectures", lectHtml, aller("mine", "Mes lectures")),
    bloc("🆕 Cette semaine", nouvHtml, aller("all", "Voir le tableau commun")),
    bloc("👥 Accès", attente, aller("admin", "Administration"))
  ].filter(Boolean);
  const dash = me.role === "formateur" || isSuper() ? aller("dash", "🧭 Tableau de bord des groupes") : "";
  box.innerHTML = `<div class="hhead"><h2>Bonjour ${esc(me.prenom)} 👋</h2><div class="meta">Nous sommes ${jours} ${esc(fmtD(new Date().toISOString()))}.</div></div>
    <div class="hgrid">${blocs.length ? blocs.join("") : '<div class="hcard"><h3>✨ Tout est à jour</h3><div class="meta">Rien d’urgent aujourd’hui : jalons, votes et commentaires sont à jour.</div></div>'}</div>
    <div class="hacts">${canWrite() ? '<button type="button" class="btn" data-go="add">＋ Ajouter une lecture</button> ' : ""}${aller("all", "📊 Tableau commun")} ${dash}</div>`;
}
// Ouvre la discussion d'une fiche depuis l'accueil, dans le bon groupe (ou la bonne promo pour un commentaire de promo).
function ouvrirDiscussionDe(id, portee) {
  const it = ficheLiee(id); if (!it) return;
  const g = portee === "promo" ? groupes.find(x => memePromo(it, x)) : groupes.find(x => x.id === it.groupe_id);
  if (!g) return;
  changerContexte({ gid: g.id, vue: portee });
  ouvrirDiscussion(id, portee);
}
$("home").onclick = e => {
  const b = e.target.closest("button"); if (!b) return;
  if (b.dataset.hc) { ouvrirDiscussionDe(b.dataset.hc, b.dataset.hp); return; }
  if (b.dataset.go === "add") { editing = null; artCible = ""; modeArticle = false; forceStatut = ""; openForm(); }
  else if (b.dataset.go) setTab(b.dataset.go);
  else if (b.dataset.gv) { changerContexte({ gid: b.dataset.gv }); setTab("all"); ouvrirGroupe(); }
};

/* ---------- Tableau de bord des groupes (formateurs et administrateur) ---------- */

function resumeGroupe(g) {
  const lect = itemsAll.filter(i => i.groupe_id === g.id);
  const ids = new Set(lect.map(i => i.id));
  const nb = st => lect.filter(i => i.statut === st).length;
  const jal = jalonsAll.filter(j => j.groupe_id === g.id);
  const retard = jal.filter(j => j.statut !== "fait" && ecartJours(j.echeance) !== null && ecartJours(j.echeance) < 0);
  const prochain = jal.filter(j => j.statut !== "fait" && ecartJours(j.echeance) !== null && ecartJours(j.echeance) >= 0).sort((a, b) => a.echeance.localeCompare(b.echeance))[0];
  const coms = commentsAll.filter(c => ids.has(c.lecture_id)).sort((a, b) => String(b.date).localeCompare(a.date));
  const dernier = coms[0] || null;
  const reu = reunionsAll.filter(r => r.groupe_id === g.id).sort((a, b) => String(b.date).localeCompare(a.date))[0];
  const dates = lect.map(i => i.modifie_le || i.ajoute).concat(coms.map(c => c.date)).filter(Boolean).sort();
  const derniereActivite = dates.length ? dates[dates.length - 1] : "";
  return { g, etudiants: g.membres.filter(m => m.role === "etudiant"), formateurs: g.membres.filter(m => m.role === "formateur"), fin: nb("Terminée"), enc: nb("En cours"), lire: nb("À lire"), jal, faits: jal.filter(j => j.statut === "fait").length,
    retard, prochain, dernier, lectDernier: dernier ? lect.find(i => i.id === dernier.lecture_id) : null, reu, derniereActivite, inactif: derniereActivite ? joursDepuis(derniereActivite) : null };
}

function renderDash() {
  const box = $("dash");
  if (!me || !box) return;
  if (!(me.role === "formateur" || isSuper())) { box.innerHTML = ""; return; }
  if (!groupes.length) { box.innerHTML = '<div class="card empty">Aucun groupe pour le moment.</div>'; return; }
  const l = groupes.map(resumeGroupe).sort((a, b) => b.retard.length - a.retard.length || (a.g.etablissement + a.g.promo + a.g.nom).localeCompare(b.g.etablissement + b.g.promo + b.g.nom, "fr"));
  const tot = l.reduce((t, r) => ({ fin: t.fin + r.fin, enc: t.enc + r.enc, ret: t.ret + r.retard.length }), { fin: 0, enc: 0, ret: 0 });
  const kpi = (n, t) => `<div class="kpi"><b>${n}</b>${t}</div>`;
  const carte = r => {
    const g = r.g;
    const etat = r.retard.length ? ["retard", `⚠ ${r.retard.length} jalon${r.retard.length > 1 ? "s" : ""} en retard`] : r.inactif !== null && r.inactif >= 14 ? ["inactif", `😴 sans activité depuis ${r.inactif} j`] : ["ok", "✅ Dans les temps"];
    const pct = r.jal.length ? Math.round(100 * r.faits / r.jal.length) : null;
    return `<article class="dcard ${etat[0]}">
     <div class="dhead"><h3>${esc(g.nom)}</h3><span class="meta">${esc(g.etablissement)} · ${esc(g.promo)}</span><span class="dflag ${etat[0]}">${esc(etat[1])}</span></div>
     <div class="dmembres">${r.etudiants.map(m => `<span class="av" style="--c:${esc(m.couleur)}" title="${esc(m.prenom)}">${initiales(m.prenom)}</span>`).join("")}<span class="meta">${r.etudiants.map(m => esc(m.prenom)).join(", ") || "aucun étudiant"}</span></div>
     <div class="dstats"><span title="Fiches terminées">✅ ${r.fin}</span><span title="En cours de lecture">📖 ${r.enc}</span><span title="File d’attente">📌 ${r.lire}</span></div>
     <div class="drow"><b>Jalons</b> ${r.jal.length ? `${r.faits}/${r.jal.length} faits${pct !== null ? `<span class="jauge wide"><i style="width:${pct}%"></i></span>` : ""}` : '<span class="meta">aucun jalon</span>'}
       ${r.retard.length ? `<div class="late">${r.retard.slice(0, 3).map(j => `${esc(j.titre)} (${-ecartJours(j.echeance)} j)`).join(" · ")}</div>` : ""}
       ${r.prochain ? `<div class="meta">Prochain : <b>${esc(r.prochain.titre)}</b> ${esc(fmtDatesJalon(r.prochain))} ${delaiJalon(r.prochain)}</div>` : ""}</div>
     <div class="drow"><b>Dernier commentaire</b> ${r.dernier ? `<div class="dcom">« ${esc(coupe(r.dernier.texte, 140))} »</div><div class="meta">${esc(r.dernier.auteur)} · ${esc(fmtDT(r.dernier.date))}${r.lectDernier ? ` · sur ${esc(coupe(r.lectDernier.titre, 50))}` : ""}</div>` : '<span class="meta">aucun</span>'}</div>
     <div class="drow"><b>Dernière réunion</b> ${r.reu ? `${esc(fmtD(r.reu.date))}${r.reu.titre ? ` · ${esc(coupe(r.reu.titre, 50))}` : ""}` : '<span class="meta">aucune</span>'}</div>
     <div class="dacts"><button type="button" class="btn sm" data-dsuivi="${esc(g.id)}">🗓️ Suivi de projet</button> <button type="button" class="btn sm sec" data-dlect="${esc(g.id)}">📊 Lectures</button></div>
    </article>`;
  };
  box.innerHTML = `<div class="kpis">${kpi(l.length, "groupes")}${kpi(tot.fin, "fiches terminées")}${kpi(tot.enc, "en cours")}${kpi(tot.ret, "jalons en retard")}</div>
    <div class="dgrid">${l.map(carte).join("")}</div>`;
}
$("dash").onclick = e => {
  const b = e.target.closest("button"); if (!b) return;
  if (b.dataset.dsuivi) { changerContexte({ gid: b.dataset.dsuivi }); setTab("suivi"); }
  else if (b.dataset.dlect) { changerContexte({ gid: b.dataset.dlect, vue: "groupe" }); setTab("all"); }
};

/* ---------- Petite fête quand une lecture est terminée ---------- */

function fete() {
  if (matchMedia("(prefers-reduced-motion: reduce)").matches || !document.body) return;
  const couleurs = ["#2563eb", "#d97706", "#0d9488", "#be185d", "#7c3aed", "#16a34a"];
  const zone = document.createElement("div");
  zone.className = "fete"; zone.setAttribute("aria-hidden", "true");
  for (let n = 0; n < 28; n++) {
    const c = document.createElement("i");
    c.style.cssText = `left:${40 + Math.random() * 20}%;background:${couleurs[n % couleurs.length]};--dx:${Math.round((Math.random() - .5) * 520)}px;--dy:${Math.round(180 + Math.random() * 220)}px;--r:${Math.round(Math.random() * 720)}deg;animation-delay:${Math.round(Math.random() * 120)}ms`;
    zone.appendChild(c);
  }
  document.body.appendChild(zone);
  setTimeout(() => zone.remove(), 1700);
}
