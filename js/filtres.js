/* Filtres, rendu du tableau, déplier/replier, actions sur les lignes.
   Script classique : partage la portée globale avec les autres fichiers de js/ (ordre de chargement : voir index.html). */
"use strict";
const COLS = { 2: "Mots-clés", 3: "Keywords (EN)", 4: "Concepts", 5: "Objet / sujet", 6: "Opinion", 7: "Controverse", 8: "Libre", 9: "Référence APA" };

function applyCols() {
  for (let k = 2; k <= 9; k++) $("tbl").classList.toggle("hc" + k, masquees.has(k));
}

function renderFilters() {
  usersChanged = false;
  const types = [...new Set(TYPES.concat(items.map(i => i.type).filter(Boolean)))];
  const tableau = F.view !== "cartes" && F.view !== "liste";
  const actifs = [["q", F.q ? `« ${F.q} »` : ""], ["who", F.who], ["grp", F.grp], ["st", F.st], ["type", F.type]].filter(x => x[1]);
  const nb = actifs.length + (F.kw ? 1 : 0);
  $("filters").innerHTML = `
   <details class="colmenu" id="mfilt"><summary class="btn sm sec" aria-label="Rechercher et filtrer">🔍 Rechercher / filtrer${nb ? ` <span class="count">${nb}</span>` : ""}</summary>
    <div class="colpop pop-filtres">
     <div><label for="q">Recherche</label><input id="q" placeholder="Titre, auteur, mot-clé, commentaire…" value="${esc(F.q)}"></div>
     <div><label for="who">Étudiant</label><select id="who"><option value="">Tous les étudiants</option>${students().map(s => `<option ${F.who === s.prenom ? "selected" : ""}>${esc(s.prenom)}</option>`).join("")}</select></div>
     ${groupesListe().length > 1 ? `<div><label for="grp">Groupe</label><select id="grp"><option value="">Tous les groupes</option>${groupesListe().map(n => `<option ${F.grp === n ? "selected" : ""}>${esc(n)}</option>`).join("")}</select></div>` : ""}
     <div><label for="st">Statut</label><select id="st"><option value="">Tous les statuts</option><option value="Terminée" ${F.st === "Terminée" ? "selected" : ""}>✅ Terminées</option><option value="En cours" ${F.st === "En cours" ? "selected" : ""}>📖 En cours</option><option value="À lire" ${F.st === "À lire" ? "selected" : ""}>📌 À lire</option></select></div>
     <div><label for="type">Type d’article</label><select id="type"><option value="">Tous les types</option>${types.map(t => `<option ${F.type === t ? "selected" : ""}>${esc(t)}</option>`).join("")}</select></div>
     <div><label for="sort">Tri</label><select id="sort"><option value="ajoute" ${F.sort === "ajoute" ? "selected" : ""}>Date de saisie</option><option value="etudiant" ${F.sort === "etudiant" ? "selected" : ""}>Étudiant</option><option value="titre" ${F.sort === "titre" ? "selected" : ""}>Titre</option><option value="parution" ${F.sort === "parution" ? "selected" : ""}>Date de parution</option></select></div>
     <button type="button" class="btn sm sec" id="reset">Réinitialiser les filtres</button>
    </div></details>
   ${actifs.map(([k, v]) => `<button type="button" class="chip on" data-clear="${k}" title="Retirer ce filtre">${esc(v)} ✕</button>`).join("")}
   ${F.kw ? `<button type="button" class="chip on" id="kwoff" title="Retirer le filtre">Mot-clé : ${esc(F.kwLabel)} ✕</button>` : ""}
   <span class="meta" id="nbres"></span>
   <span class="spacer"></span>
   <span class="seg"><button type="button" class="btn sm sec ${tableau ? "on" : ""}" id="vt" aria-pressed="${tableau}">▦ Tableau</button><button type="button" class="btn sm sec ${F.view === "cartes" ? "on" : ""}" id="vc" aria-pressed="${F.view === "cartes"}">🗂 Cartes</button><button type="button" class="btn sm sec ${F.view === "liste" ? "on" : ""}" id="vl" aria-pressed="${F.view === "liste"}">☰ Liste</button></span>
   ${tableau ? `<details class="colmenu"><summary class="btn sm sec">Colonnes ▾</summary><div class="colpop">${Object.keys(COLS).map(k => `<label><input type="checkbox" data-col="${k}" ${masquees.has(+k) ? "" : "checked"}> ${COLS[k]}</label>`).join("")}</div></details>` : ""}
   <button type="button" class="btn sm sec" id="expall"></button>
   <button type="button" class="btn sm sec" id="refresh" title="Actualisation automatique toutes les ${CFG.REFRESH_SECONDS || 0} s tant que la page est ouverte" aria-label="Actualiser">↻</button><span class="meta" id="sync"></span>
   ${canWrite() ? '<button type="button" class="btn sm" id="add2">＋ Ajouter une lecture</button>' : ""}
   <details class="colmenu"><summary class="btn sm sec">⬇️ Exporter ▾</summary><div class="colpop right"><button class="btn sm" id="xl" type="button">Excel</button> <button class="btn sm" id="csv" type="button">CSV</button> <button class="btn sm" id="pdf" type="button">PDF</button></div></details>`;
  $("q").oninput = e => { F.q = e.target.value; renderTable(); };
  ["who", "grp", "st", "type", "sort"].forEach(k => $(k) && ($(k).onchange = e => { F[k] = e.target.value; renderTable(); }));
  $("mfilt").ontoggle = () => { if ($("mfilt").open) $("q").focus(); };
  $("reset").onclick = () => { F.q = ""; F.who = ""; F.grp = ""; F.st = ""; F.type = ""; F.kw = ""; F.kwLabel = ""; renderFilters(); renderTable(); };
  $("filters").querySelectorAll("[data-clear]").forEach(b => b.onclick = () => { F[b.dataset.clear] = ""; renderFilters(); renderTable(); });
  if ($("kwoff")) $("kwoff").onclick = () => filtrerMotCle(F.kwLabel);
  $("vt").onclick = () => changerVue("tableau");
  $("vc").onclick = () => changerVue("cartes");
  $("vl").onclick = () => changerVue("liste");
  $("filters").querySelectorAll("[data-col]").forEach(cb => cb.onchange = () => {
    if (cb.checked) masquees.delete(+cb.dataset.col); else masquees.add(+cb.dataset.col);
    try { localStorage.setItem("lydia_cols", JSON.stringify([...masquees])); } catch (e) { /* ignoré */ }
    applyCols();
  });
  $("expall").onclick = toutDeplier;
  $("refresh").onclick = () => refresh(true);
  if ($("add2")) $("add2").onclick = () => { editing = null; artCible = ""; modeArticle = false; forceStatut = ""; openForm(); };
  $("xl").onclick = exportXlsx;
  $("csv").onclick = exportCsv;
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

// Noms des groupes présents dans la vue courante (filtre « Groupe »).
const groupesListe = () => [...new Set(items.map(i => i.groupe).filter(Boolean))].sort((a, b) => a.localeCompare(b, "fr"));

function filtered() {
  const q = cleTitre(F.q);
  const l = items.filter(i => (!F.who || i.etudiant === F.who) && (!F.grp || i.groupe === F.grp) && (!F.st || i.statut === F.st) && (!F.type || i.type === F.type)
    && (!F.kw || motsListe(i.mots).concat(motsListe(i.kw)).some(k => cleTitre(k) === F.kw))
    && (!q || correspond(i, q)));
  l.sort((a, b) => F.sort === "ajoute"
    ? String(b.ajoute).localeCompare(a.ajoute)
    : String(a[F.sort] || "").localeCompare(String(b[F.sort] || ""), "fr"));
  // Les fiches de lecture d'un même document se suivent, à la place de la première.
  const parArt = new Map();
  l.forEach(i => { const k = i.article_id || i.id; if (!parArt.has(k)) parArt.set(k, []); parArt.get(k).push(i); });
  return [...parArt.values()].flat();
}

function renderTable() {
  const l = filtered();
  const cartes = F.view === "cartes" || F.view === "liste";
  $("cards").classList.toggle("compact", F.view === "liste");
  const vide = items.length ? "Aucune lecture ne correspond aux filtres."
    : canWrite() ? "Aucune lecture pour l’instant : utilisez « ＋ Ajouter une lecture »." : "Aucune lecture pour l’instant.";
  $("tablewrap").classList.toggle("hidden", cartes);
  $("cards").classList.toggle("hidden", !cartes);
  // La vue inutilisée est vidée, pas seulement masquée : rien ne peut réapparaître en dessous si une feuille de style périmée est en cache.
  const groupes = groupesArticles(l);
  if (cartes) {
    $("rows").innerHTML = "";
    $("cards").innerHTML = groupes.length ? groupes.map(g => `<div class="artgrp ${artOuvert(cleArt(g[0])) ? "open" : ""}">${artCard(g)}<div class="fiches">${g.map(cardHtml).join("")}</div></div>`).join("") : `<div class="empty">${vide}</div>`;
  } else {
    $("cards").innerHTML = "";
    $("rows").innerHTML = groupes.length ? groupes.map(g => artRow(g) + g.map(cells).join("")).join("") : `<tr><td colspan="9" class="empty">${vide}</td></tr>`;
  }
  applyCols();
  const nbres = $("nbres");
  if (nbres) nbres.textContent = (F.q || F.who || F.grp || F.st || F.type || F.kw) ? `${l.length} / ${items.length} fiches de lecture` : "";
  $("stats").innerHTML = students().map(s => {
    const n = items.filter(i => i.etudiant === s.prenom);
    return `<span class="badge" style="--c:${esc(s.couleur)}">${esc(s.prenom)} : ${n.length} fiche${n.length > 1 ? "s" : ""} de lecture (${n.filter(i => i.statut === "En cours").length} en cours${n.some(i => i.statut === "À lire") ? ` · ${n.filter(i => i.statut === "À lire").length} à lire` : ""})</span>`;
  }).join("");
}

function majBoutonDeplier() {
  const b = $("expall");
  if (b) b.textContent = openRows.size || openArts.size ? "⇱ Tout replier" : "⇲ Tout déplier";
}

function toggleOpen(id, host) {
  if (openRows.has(id)) openRows.delete(id); else openRows.add(id);
  if (host) {
    host.classList.toggle("open", openRows.has(id));
    host.setAttribute("aria-expanded", String(openRows.has(id)));
  }
  majBoutonDeplier();
}

// Déplier / replier un document : on change des classes, sans reconstruire le tableau.
function toggleArt(k) {
  const ouvrir = !artOuvert(k);
  if (ouvrir) { openArts.add(k); fermesArts.delete(k); } else { openArts.delete(k); fermesArts.add(k); }
  const racine = F.view === "cartes" || F.view === "liste" ? $("cards") : $("rows");
  racine.querySelectorAll("tr.art, .cardc.art").forEach(h => {
    if (h.dataset.art !== k) return;
    h.classList.toggle("open", ouvrir); h.setAttribute("aria-expanded", String(ouvrir));
    const g = h.closest(".artgrp"); if (g) g.classList.toggle("open", ouvrir);
  });
  racine.querySelectorAll("tr.fiche").forEach(t => { if (t.dataset.fa === k) t.classList.toggle("show", ouvrir); });
  majBoutonDeplier();
}

function toutDeplier() {
  if (openRows.size || openArts.size) { openRows.clear(); openArts.clear(); if (filtreActif()) filtered().forEach(i => fermesArts.add(cleArt(i))); }
  else { fermesArts.clear(); filtered().forEach(i => { openRows.add(i.id); openArts.add(cleArt(i)); }); }
  renderTable();
  majBoutonDeplier();
}

const onAction = e => {
  const b = e.target.closest("button");
  if (!b) {
    // Clic ailleurs que sur un bouton, un lien ou un commentaire : on déplie / replie la ligne (sauf sélection de texte en cours).
    if (e.target.closest("a, input, select, textarea, label") || (window.getSelection && String(window.getSelection()).length)) return;
    const a = e.target.closest("tr.art, .cardc.art");
    if (a) return toggleArt(a.dataset.art);
    const h = e.target.closest("tr[data-id], .cardc[data-id]");
    if (h) toggleOpen(h.dataset.id, h);
    return;
  }
  const d = b.dataset;
  if (d.fpdf) return exportFichePdf(d.fpdf);
  if (d.nl) return ouvrirNotes({ liens: d.nl.split(",") });
  // Menu « ⋯ » d'un document : on l'ouvre / le ferme ; choisir une option le referme.
  if (d.opt !== undefined) { const m = b.parentElement.querySelector(".optmenu"), ouvert = m.classList.toggle("hidden") === false; b.setAttribute("aria-expanded", String(ouvert)); return; }
  const menu = b.closest(".optmenu"); if (menu) { menu.classList.add("hidden"); const ob = menu.parentElement.querySelector(".optbtn"); if (ob) ob.setAttribute("aria-expanded", "false"); }
  if (d.e) startEdit(d.e, false);
  else if (d.fo) ouvrirFichier(d.fo);
  else if (d.an) startAnalyse(d.an);
  else if (d.ea) startCorrection(d.ea);
  else if (d.alire) mettreALire(d.alire);
  else if (d.hist) { const [k, id] = d.hist.split(":"); ouvrirHistorique(k, id); }
  else if (d.pv) voterProp(d.pv, d.pvo === "1");
  else if (d.pc) annulerProp(d.pc);
  else if (d.apa) copierApa(d.apa);
  else if (d.cu) marquerNonLus([d.cu]);
  else if (d.kw !== undefined) filtrerMotCle(d.kw);
  else if (d.c) ouvrirDiscussion(d.c);
  else if (d.sc) { cmScope = d.sc; renderModal(); const z = $("cmbody").querySelector("textarea"); if (z) z.focus(); }
  else if (d.ca) {
    const t = (drafts[d.ca] || "").trim();
    if (!t) return;
    const [lid, portee] = d.ca.split("|");
    b.disabled = true;
    commentAction(async () => { const j = await api("comment_add", { lecture_id: lid, texte: t, portee }); drafts[d.ca] = ""; return j; }, "Commentaire impossible")
      .then(() => {
        renderModal();                    // la saisie est terminée : on affiche le nouveau commentaire même si la zone avait le focus
        $("cmbody").scrollTop = $("cmbody").scrollHeight;
        const z = $("cmbody").querySelector("textarea"); if (z) z.focus();
      });
  } else if (d.ce) {
    const c = commentsAll.find(x => x.id === d.ce);
    const t = c && prompt("Modifier le commentaire :", c.texte);
    if (t && t.trim()) commentAction(() => api("comment_update", { id: d.ce, texte: t }), "Modification impossible");
  } else if (d.cd) {
    if (confirm("Supprimer ce commentaire ?")) commentAction(() => api("comment_delete", { id: d.cd }), "Suppression impossible");
  }
};
const onDraft = e => { if (e.target.dataset.cm) drafts[e.target.dataset.cm] = e.target.value; };
$("fup").onchange = e => envoyerFichier(e.target.files && e.target.files[0]);
$("rows").onclick = $("cards").onclick = $("cmbody").onclick = onAction;
$("rows").oninput = $("cards").oninput = $("cmbody").oninput = onDraft;
$("rows").onkeydown = $("cards").onkeydown = e => {
  if ((e.key === "Enter" || e.key === " ") && e.target.matches && e.target.matches("tr[data-id], .cardc[data-id], tr.art, .cardc.art")) {
    e.preventDefault();
    if (e.target.dataset.art) toggleArt(e.target.dataset.art); else toggleOpen(e.target.dataset.id, e.target);
  }
};
