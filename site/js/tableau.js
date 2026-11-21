/* Aides communes du tableau et des cartes.
   Script classique : partage la portée globale avec les autres fichiers de js/ (ordre de chargement : voir index.html). */
"use strict";
/* ---------- Tableau commun, cartes et commentaires ---------- */

const openRows = new Set();   // lectures dont les textes longs sont dépliés

const chips = txt => motsListe(txt).map(k =>
  `<button type="button" class="chip ${F.kw.includes(cleTitre(k)) ? "on" : ""}" data-kw="${esc(k)}" title="Filtrer sur ce mot-clé">${esc(k)}</button>`).join("");

function clampTxt(id, txt) { return `<div class="clamp">${esc(txt)}</div>`; }

// Seuls les liens http(s) sont rendus cliquables (jamais javascript: ni data:), et s'ouvrent dans un nouvel onglet.
const urlSure = u => /^https?:\/\/[^\s<>"']+$/i.test(String(u || "").trim()) ? String(u).trim() : "";
const lienHtml = (i, compact) => urlSure(i.lien) && compact
  ? `<a class="lien lc" href="${esc(urlSure(i.lien))}" target="_blank" rel="noopener noreferrer" title="Ouvrir le lien : ${esc(urlSure(i.lien))}" aria-label="Ouvrir le lien">🔗</a>`
  : urlSure(i.lien)
  ? `<a class="lien" href="${esc(urlSure(i.lien))}" target="_blank" rel="noopener noreferrer" title="${esc(urlSure(i.lien))}">🔗 Ouvrir le lien</a>` : "";

// Dans la vue promo on indique le groupe d'origine ; dans la vue du groupe, une fiche partagée porte une pastille.
const badgeGroupe = i => ctx.vue === "promo"
  ? `<span class="badge grp" title="Groupe de ${esc(i.etudiant)}">👥 ${esc(i.groupe)}</span>`
  : i.portee === "promo" ? '<span class="badge share" title="Cette fiche est aussi visible de toute la promo">🌐 Partagée</span>' : "";

const anneeDe = i => (/^(\d{4})/.exec(i.parution || "") || [])[1] || "";

function badgeNouveau(i) {
  if (!vuDepuis || i.mine) return "";
  if (String(i.ajoute || "") > vuDepuis) return '<span class="new">🆕 Nouveau</span>';
  if (String(i.modifie_le || "") > vuDepuis) return '<span class="new">✏️ Modifié</span>';
  return "";
}

const nonLu = c => !c.mine && !lusSet.has(c.id);
const nbNonLus = id => comments.filter(c => c.lecture_id === id && nonLu(c)).length;

// Marque des commentaires comme lus (immédiatement à l'écran, puis confirmé par le serveur).
async function marquerLus(ids, tous) {
  const aMarquer = tous ? comments.filter(nonLu).map(c => c.id) : ids.filter(id => !lusSet.has(id));
  if (!aMarquer.length) return;
  aMarquer.forEach(id => { lusSet.add(id); lusEnvoi.add(id); nonLusEnvoi.delete(id); });
  renderComments();
  try {
    const j = await api("comments_read", { ids: aMarquer });
    aMarquer.forEach(id => lusEnvoi.delete(id));
    applyResult(j);
  } catch (e) {
    aMarquer.forEach(id => lusEnvoi.delete(id));
    if (e.code === "unauthorized") sessionError(e);
    // Autre erreur : ils redeviendront non lus à la prochaine actualisation, sans autre conséquence.
  }
}

// Remet des commentaires en « non lu » (par exemple pour y revenir plus tard).
async function marquerNonLus(ids) {
  const cibles = ids.filter(id => lusSet.has(id));
  if (!cibles.length) return;
  cibles.forEach(id => { lusSet.delete(id); lusEnvoi.delete(id); nonLusEnvoi.add(id); frais.delete(id); });
  renderComments(); renderTable();
  if (cmId) {   // action de l'utilisateur : on reconstruit la fenêtre même si la zone de saisie a le focus (le brouillon est conservé)
    const haut = $("cmbody").scrollTop; renderModal(); $("cmbody").scrollTop = haut;
  }
  try {
    applyResult(await api("comments_unread", { ids: cibles }));
  } catch (e) {
    if (e.code === "unauthorized") sessionError(e);
  } finally { cibles.forEach(id => nonLusEnvoi.delete(id)); }
}

// Discussion d'une lecture : fenêtre au-dessus de la page (tableau, cartes ou onglet Commentaires).
function ouvrirDiscussion(id, scope) {
  const it = items.find(i => i.id === id);
  if (!it) return;
  cmFocus = document.activeElement;
  cmId = id;
  cmScope = scope || (ctx.vue === "promo" ? "promo" : "groupe");
  const nv = fil(id, cmScope).filter(nonLu).map(c => c.id);
  nv.forEach(x => frais.add(x));      // surlignés tant que la fenêtre reste ouverte
  marquerLus(nv);
  renderModal();
  const t = $("cmbody").querySelector("textarea");
  if (t) t.focus(); else $("cmclose").focus();
}

function fermerDiscussion(silencieux) {
  if (cmId) commentsAll.filter(c => c.lecture_id === cmId).forEach(c => frais.delete(c.id));
  cmId = null;
  $("cmodal").classList.add("hidden");
  document.body.classList.remove("modalopen");
  $("cmbody").innerHTML = "";          // vidée, pas seulement masquée
  if (silencieux) return;
  renderTable(); renderComments();
  if (cmFocus && cmFocus.isConnected && cmFocus.focus) { try { cmFocus.focus({ preventScroll: true }); } catch (e) { /* ignoré */ } }
  cmFocus = null;
}

// Deux fils par fiche : celui du groupe (réservé à ses membres) et celui de la promo (si la fiche est partagée).
const fil = (id, scope) => commentsAll.filter(c => c.lecture_id === id && (scope === "promo" ? c.portee === "promo" : c.portee !== "promo"));
const monGroupe = i => groupes.some(g => g.id === i.groupe_id);
const filsDe = i => (monGroupe(i) ? ["groupe"] : []).concat(i.portee === "promo" ? ["promo"] : []);

function renderModal() {
  const it = cmId && (items.find(i => i.id === cmId) || itemsAll.find(i => i.id === cmId));
  if (!it) { if (cmId) fermerDiscussion(); return; }   // lecture supprimée entre-temps
  const fils = filsDe(it);
  if (!fils.includes(cmScope)) cmScope = fils[0] || "groupe";   // fiche retirée de la promo, ou groupe quitté
  $("cmtitle").textContent = it.titre;
  $("cmsub").textContent = [it.groupe, it.etudiant, it.auteur, anneeDe(it)].filter(Boolean).join(" · ");
  $("cmbody").innerHTML = (fils.length > 1 ? `<div class="seg" role="tablist"><button type="button" class="btn sm sec ${cmScope === "groupe" ? "on" : ""}" data-sc="groupe" role="tab" aria-selected="${cmScope === "groupe"}">👥 Mon groupe (${fil(it.id, "groupe").length})</button><button type="button" class="btn sm sec ${cmScope === "promo" ? "on" : ""}" data-sc="promo" role="tab" aria-selected="${cmScope === "promo"}">🌐 Toute la promo (${fil(it.id, "promo").length})</button></div>` : "")
    + `<div class="meta">${cmScope === "promo" ? "Discussion ouverte à toute la promo." : "Discussion réservée aux membres du groupe."}</div>`
    + commentsBox(it, cmScope);
  $("cmodal").classList.remove("hidden");
  document.body.classList.add("modalopen");
}

// Pas de reconstruction pendant la saisie d'un commentaire (actualisation automatique).
function majModal() {
  if (!cmId) return;
  const a = document.activeElement;
  if (a && a.tagName === "TEXTAREA" && $("cmbody").contains(a)) return;
  const haut = $("cmbody").scrollTop;
  renderModal();
  $("cmbody").scrollTop = haut;
}

$("cmclose").onclick = () => fermerDiscussion();
$("cmodal").addEventListener("mousedown", e => { if (e.target === $("cmodal")) fermerDiscussion(); });

const nbComm = i => { const n = comments.filter(x => x.lecture_id === i.id).length; const u = nbNonLus(i.id); return n ? `<span class="cn" title="${n} commentaire${n > 1 ? "s" : ""}${u ? ", " + u + " non lu" + (u > 1 ? "s" : "") : ""}">💬 ${n}</span>${u ? `<span class="new">${u} non lu${u > 1 ? "s" : ""}</span>` : ""}` : ""; };

// Actions d'une fiche de lecture : la modifier (la sienne) et la commenter.
function actionsHtml(i) {
  const edit = canWrite() && i.mine && i.modifiable ? `<button class="btn sm sec" data-e="${esc(i.id)}">Modifier ma fiche de lecture</button> <button class="btn sm sec" data-hist="lecture:${esc(i.id)}" title="Versions précédentes de ma fiche">🕘</button> ` : "";
  const n = comments.filter(x => x.lecture_id === i.id).length, u = nbNonLus(i.id);
  return `${edit}<button class="btn sm sec" data-fpdf="${esc(i.id)}" title="Aperçu de la fiche, puis impression ou enregistrement en PDF">PDF</button> <button class="btn sm sec" data-c="${esc(i.id)}" aria-label="Commentaires (${n}${u ? ", " + u + " non lus" : ""})">💬 ${canComment() ? "Commenter" : "Commentaires"} (${n})${u ? ` · <b>${u} nouveau${u > 1 ? "x" : ""}</b>` : ""}</button>`;
}

// Actions du document : ajouter sa fiche de lecture, corriger la partie objective.
function actionsArticle(i) {
  const hist = `<button class="btn sm sec" data-hist="article:${esc(i.article_id)}" title="Versions précédentes de l’article">🕘 Historique</button>`;
  if (!canWrite() || !i.article_modifiable) return hist;
  const dejaMienne = itemsAll.some(x => x.mine && x.article_id === i.article_id);
  return (!dejaMienne ? `<button class="btn sm" data-an="${esc(i.article_id)}">＋ Ajouter ma fiche de lecture</button> <button class="btn sm sec" data-alire="${esc(i.article_id)}" title="Le mettre dans ma file d’attente personnelle">📌 À lire</button> ` : "")
    + `<button class="btn sm sec" data-ea="${esc(i.article_id)}">Corriger l’article</button> ` + hist;
}

function infosHtml(i) {
  return `Parution : ${esc(fmtD(i.parution)) || "—"}<br>Auteur : ${esc(i.auteur) || "—"} (${esc(i.qualite) || "—"})<br>Nationalité : ${esc(i.nation) || "—"}<br>Type : ${esc(i.type) || "—"}<br><i>Saisi le ${esc(fmtD(i.ajoute))}</i>${i.modifie_par ? `<br><i>Modifié par ${esc(i.modifie_par)} le ${esc(fmtD(i.modifie_le))}</i>` : ""}`;
}

// Un document (article) par ligne ; ses fiches de lecture se déplient en dessous.
const openArts = new Set(), fermesArts = new Set();     // documents dépliés ; documents repliés à la main malgré un filtre actif
const filtreActif = () => nbFiltres() > 0;
const artOuvert = k => openArts.has(k) || (filtreActif() && !fermesArts.has(k));   // une recherche déplie les documents trouvés
const cleArt = i => i.article_id || i.id;
const libFiches = n => `${n} fiche${n > 1 ? "s" : ""} de lecture`;

function groupesArticles(l) {
  const m = new Map();
  l.forEach(i => { const k = cleArt(i); if (!m.has(k)) m.set(k, []); m.get(k).push(i); });
  return [...m.values()];
}

// Résumé d'un document : qui a fait une fiche, et où elle en est.
function resumeFiches(g) {
  return g.map(x => `<span class="badge ${stInfo(x.statut).cl}" style="--c:${esc(x.couleur)}" title="${stInfo(x.statut).long}">${esc(x.etudiant)} ${stInfo(x.statut).ico}${x.groupe ? ` <span class="grpn">· ${esc(x.groupe)}</span>` : ""}</span>`).join(" ");
}
function badgesArticle(g) {
  const nc = g.reduce((n, x) => n + comments.filter(c => c.lecture_id === x.id).length, 0);
  const nl = g.reduce((n, x) => n + nbNonLus(x.id), 0);
  const nf = fichiersDe(cleArt(g[0])).length;
  const nn = typeof notesLiees === "function" ? notesLiees(g.map(x => x.id)).length : 0;
  // Chaque pastille a son emplacement (vide si elle n'existe pas) : en vue liste, les colonnes restent alignées d'une ligne à l'autre.
  const slot = (cl, html) => `<span class="slot ${cl}">${html}</span>`;
  return slot("sl-fi", `<span class="badge grp" title="${libFiches(g.length)}">📚 ${g.length}</span>`)
    + slot("sl-no", nn ? `<button type="button" class="badge grp notebadge" data-nl="${esc(g.map(x => x.id).join(","))}" title="Mes notes personnelles liées à ce document">📝 ${nn}</button>` : "")
    + slot("sl-fj", nf ? `<span class="badge grp" title="Fichiers joints">📎 ${nf}</span>` : "")
    + slot("sl-cm", nc ? `<span class="cn" title="${nc} commentaire${nc > 1 ? "s" : ""}">💬 ${nc}</span>` : "")
    + slot("sl-nl", nl ? `<span class="new">${nl} non lu${nl > 1 ? "s" : ""}</span>` : "");
}

const CHAMP_LIB = { titre: "titre", parution: "parution", auteur: "auteur", qualite: "qualité", nation: "nationalité", type: "type",
  source: "revue", volume: "volume", numero: "numéro", pages: "pages", doi: "DOI", lien: "lien" };
function propHtml(i, sub) {
  if (sub) return "";
  return props.filter(p => p.article_id === i.article_id).map(p => {
    const champs = Object.keys(p.valeurs).filter(k => String(p.valeurs[k] || "") !== String(i[k] || "")).map(k => `${CHAMP_LIB[k] || k} → « ${esc(String(p.valeurs[k] || "—"))} »`).join(" ; ");
    const vote = !canWrite() ? "" : p.mine
      ? `<button type="button" class="btn sm sec del" data-pc="${esc(p.id)}">Annuler ma proposition</button>`
      : `<button type="button" class="btn sm ${p.monVote === 1 ? "" : "sec"}" data-pv="${esc(p.id)}" data-pvo="1" aria-pressed="${p.monVote === 1}">👍 Approuver</button> <button type="button" class="btn sm ${p.monVote === 0 ? "" : "sec"}" data-pv="${esc(p.id)}" data-pvo="0" aria-pressed="${p.monVote === 0}">👎 Refuser</button>`;
    return `<div class="vote" style="margin-top:6px">✏️ <b>${esc(p.par)}</b> propose de corriger l’article : ${champs || "—"} <span class="meta">(${p.pour} approbation${p.pour > 1 ? "s" : ""} sur ${p.seuil} nécessaires)</span> ${vote}</div>`;
  }).join("");
}

async function voterProp(id, oui) {
  try { applyResult(await enCours("Vote…", () => api("article_vote", { id, vote: oui }))); }
  catch (e) { if (e.code === "unauthorized") sessionError(e); else alert("Vote impossible : " + e.message); }
}
async function annulerProp(id) {
  try { applyResult(await enCours("Annulation…", () => api("article_cancel", { id }))); }
  catch (e) { if (e.code === "unauthorized") sessionError(e); else alert("Annulation impossible : " + e.message); }
}
