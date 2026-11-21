/* Lignes du tableau, cartes, APA copiable, commentaires d'une fiche.
   Script classique : partage la portée globale avec les autres fichiers de js/ (ordre de chargement : voir index.html). */
"use strict";
// Bouton discret « ⋯ » et son menu d'options (ajouter ma fiche, À lire, corriger, historique) : même présentation dans le tableau et les cartes.
const optionsDoc = i => `<span class="optwrap"><button type="button" class="btn sm sec optbtn" data-opt="1" aria-haspopup="true" aria-expanded="false" title="Options du document" aria-label="Options du document">⋯</button><div class="optmenu hidden">${actionsArticle(i)}</div></span>`;

// Ligne du document : titre et références objectives, résumé des lecteurs. Les fiches de lecture (partie subjective) sont dans la ligne dépliée dessous.
function artRow(g) {
  const i = g[0], k = cleArt(i), open = artOuvert(k);
  const qn = [i.qualite, i.nation].filter(Boolean).join(" · ");
  return `<tr class="art ${open ? "open" : ""}" data-art="${esc(k)}" tabindex="0" aria-expanded="${open}"><td class="first c1"><div class="artbadges"><span class="chev" aria-hidden="true"></span>${badgesArticle(g)}${optionsDoc(i)}</div>
   <div class="arttitre"><b>${esc(i.titre)}</b>${lienHtml(i, true)}</div>
   ${propHtml(i)}${fichiersHtml(i)}</td>
   <td class="c2">${esc(i.auteur) || "—"}${qn ? `<div class="meta">${esc(qn)}</div>` : ""}</td>
   <td class="c3">${esc(anneeDe(i)) || "—"}<div class="meta">${esc(i.type) || ""}</div></td>
   <td class="c4 artres"><div class="meta" style="margin-bottom:4px"><span class="hint-c">Cliquez pour voir les fiches de lecture</span><span class="hint-o">Fiches de lecture ci-dessous</span></div>${resumeFiches(g)}</td>
   <td class="c5 apa">${apaCell(i)}</td></tr>`;
}

// Ligne dépliée : tableau des fiches de lecture du document (mots-clés, concepts, objet, opinion, controverse, libre).
function fichesRow(g) {
  const k = cleArt(g[0]);
  return `<tr class="fiches-row ${artOuvert(k) ? "show" : ""}" data-fa="${esc(k)}"><td colspan="5"><div class="fichesbox"><table class="inner"><thead><tr><th>Fiche de lecture ${kwSwitch()}</th><th>Concepts</th><th>Objet / sujet</th><th>Opinion</th><th>Controverse</th><th>Libre</th></tr></thead>
   <tbody>${g.map(cells).join("")}</tbody></table></div></td></tr>`;
}

// Fiche de lecture : une ligne du tableau interne.
function cells(i) {
  const c = esc(i.couleur), k = cleArt(i);
  const prog = stInfo(i.statut).cl;
  return `<tr data-id="${esc(i.id)}" data-fa="${esc(k)}" tabindex="0" aria-expanded="${openRows.has(i.id)}" class="fi ${prog} ${openRows.has(i.id) ? "open" : ""}" style="--c:${c}"><td class="first"><span class="chev" aria-hidden="true"></span><span class="badge" style="--c:${c}">${esc(i.etudiant)}</span>${badgeStatut(i, c)}${badgeGroupe(i)}${badgeNouveau(i)}${nbComm(i)}
   <div class="meta">${i.modifie_par ? `Modifiée par ${esc(i.modifie_par)} le ${esc(fmtD(i.modifie_le))} · ` : ""}saisie le ${esc(fmtD(i.ajoute))}</div>
   <div class="rowacts">${actionsHtml(i)}</div>${motsCle(i)}</td>
   <td>${clampTxt(i.id, i.concepts)}</td><td>${clampTxt(i.id, i.objet)}</td><td>${clampTxt(i.id, i.opinion)}</td>
   <td>${clampTxt(i.id, i.controverse)}</td><td>${clampTxt(i.id, i.libre)}</td></tr>`;
}

// Couverture générée : couleur et pictogramme selon le type d'article (pas d'image externe).
const COUVERTURES = { "Article scientifique": ["🔬", "#2563eb"], "Article de recherche": ["🧪", "#7c3aed"], "Revue de littérature": ["📚", "#0d9488"],
  "Article professionnel": ["🩺", "#d97706"], "Rapport / recommandation HAS": ["📋", "#475569"], "Thèse / mémoire": ["🎓", "#be185d"], "Autre": ["📄", "#64748b"] };
const couverture = i => COUVERTURES[i.type] || ["📄", "#64748b"];
const initiales = n => esc(String(n || "?").trim().slice(0, 2));
// Avancement d'une fiche : colonnes d'analyse remplies sur 7 (mots-clés, keywords, concepts, objet, opinion, controverse, libre).
const COL_ANALYSE = ["mots", "kw", "concepts", "objet", "opinion", "controverse", "libre"];
const avancement = i => Math.round(100 * COL_ANALYSE.filter(k => String(i[k] || "").trim()).length / COL_ANALYSE.length);
function artCard(g) {
  const i = g[0], k = cleArt(i), open = artOuvert(k);
  const [ico, col] = couverture(i);
  const avatars = g.map(x => `<span class="av" style="--c:${esc(x.couleur)}" title="${esc(x.etudiant)} · ${esc(stInfo(x.statut).long)}">${initiales(x.etudiant)}</span>`).join("");
  const jauges = g.filter(x => x.statut !== "À lire").map(x => `<span class="jauge" title="Fiche de ${esc(x.etudiant)} : ${avancement(x)} % renseignée"><i style="width:${avancement(x)}%;background:${esc(x.couleur)}"></i></span>`).join("");
  return `<article class="cardc art ${open ? "open" : ""}" data-art="${esc(k)}" tabindex="0" aria-expanded="${open}">
   <div class="couv" style="--cv:${col}"><span class="couvico" aria-hidden="true">${ico}</span><span class="avs">${avatars}</span></div>
   ${jauges ? `<div class="jauges">${jauges}</div>` : ""}
   <div class="artbadges">${badgesArticle(g)}${optionsDoc(i)}</div>
   <h3><span class="chev" aria-hidden="true"></span>${esc(i.titre)}</h3>${lienHtml(i)}
   <div class="meta">${esc([i.auteur, anneeDe(i), i.type].filter(Boolean).join(" · ")) || "—"}</div>
   <div class="chipsc" style="max-height:none">${resumeFiches(g)}</div>
   <div class="sect"><b>Référence APA</b>${apaCell(i)}</div>
   ${propHtml(i)}${fichiersHtml(i)}
  </article>`;
}

function cardHtml(i) {
  const c = esc(i.couleur);
  const prog = stInfo(i.statut).cl;
  const sect = (t, v) => String(v || "").trim() ? `<div class="sect"><b>${t}</b>${clampTxt(i.id, v)}</div>` : "";
  return `<article class="cardc fiche ${prog} ${openRows.has(i.id) ? "open" : ""}" data-id="${esc(i.id)}" tabindex="0" aria-expanded="${openRows.has(i.id)}" style="--c:${c}">
   <div><span class="badge" style="--c:${c}">${esc(i.etudiant)}</span>${badgeStatut(i, c)}${badgeGroupe(i)}${badgeNouveau(i)}</div>
   <h3><span class="chev" aria-hidden="true"></span>Fiche de lecture de ${esc(i.etudiant)}</h3>
   ${kwLang !== "en" && motsListe(i.mots).length ? `<div class="sect"><b>Mots-clés</b><div class="chipsc">${chips(i.mots)}</div></div>` : ""}${kwLang !== "fr" && motsListe(i.kw).length ? `<div class="sect"><b>Keywords (EN)</b><div class="chipsc">${chips(i.kw)}</div></div>` : ""}
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

// Mots-clés : en français par défaut ; le sélecteur FR / EN / les deux (mémorisé) change l'affichage partout.
let kwLang = "fr";
try { const v = localStorage.getItem("lpc_kwlang"); if (v === "en" || v === "both") kwLang = v; } catch (e) { /* ignoré */ }
const kwSwitch = () => `<span class="kwsw" role="group" aria-label="Langue des mots-clés">${[["fr", "FR"], ["en", "EN"], ["both", "FR+EN"]].map(([v, l]) =>
  `<button type="button" class="kwl ${kwLang === v ? "on" : ""}" data-kwl="${v}" aria-pressed="${kwLang === v}" title="Mots-clés : ${v === "fr" ? "français" : v === "en" ? "anglais" : "les deux"}">${l}</button>`).join("")}</span>`;
document.addEventListener("click", e => {
  const b = e.target.closest("[data-kwl]");
  if (!b) return;
  kwLang = b.dataset.kwl;
  try { localStorage.setItem("lpc_kwlang", kwLang); } catch (x) { /* ignoré */ }
  renderTable();
});

// Mots-clés et keywords : sous les boutons de la première colonne, pour laisser la largeur aux colonnes de texte.
function motsCle(i) {
  const bloc = (t, v) => motsListe(v).length ? `<div class="kwbloc"><span class="kwt">${t}</span><div class="chipsc">${chips(v)}</div></div>` : "";
  const html = (kwLang !== "en" ? bloc("Mots-clés", i.mots) : "") + (kwLang !== "fr" ? bloc("Keywords (EN)", i.kw) : "");
  return html ? `<div class="kwzone">${html}</div>` : "";
}
