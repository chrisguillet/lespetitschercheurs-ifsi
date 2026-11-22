/* Filtres, rendu du tableau, déplier/replier, actions sur les lignes.
   Script classique : partage la portée globale avec les autres fichiers de js/ (ordre de chargement : voir index.html). */
"use strict";
const COLS = { 2: "Auteur(s)", 3: "Parution · type", 4: "Fiches de lecture", 5: "Référence APA" };

function applyCols() {
  for (let k = 2; k <= 5; k++) $("tbl").classList.toggle("hc" + k, masquees.has(k));
}

// Filtres cumulatifs : plusieurs valeurs par filtre, combinées en OU (au moins une) ou en ET (le document doit avoir une fiche pour chaque valeur).
const FILTRES_MULTI = ["st", "type", "kw"];
const ET_POSSIBLE = ["st", "kw"];          // le type est propre à l'article : « ET » n'aurait pas de sens
const STATUTS_FILTRE = [["Terminée", "✅ Terminées"], ["En cours", "📖 En cours"], ["À lire", "📌 À lire"]];
const modeFiltre = k => (F.mode[k] === "et" && F[k].length > 1 ? "et" : "ou");
const SEP = k => (modeFiltre(k) === "et" ? " et " : " ou ");
const nbFiltres = () => (F.q ? 1 : 0) + FILTRES_MULTI.filter(k => F[k].length).length;

function renderFilters(garder) {
  usersChanged = false;
  const ouvert = garder && $("mfilt") && $("mfilt").open, pop = garder && document.querySelector(".pop-filtres"), defil = pop ? pop.scrollTop : 0;
  const actif = garder ? document.activeElement : null, ref = actif && actif.dataset && (actif.dataset.f || actif.dataset.fm) ? { f: actif.dataset.f, v: actif.value, fm: actif.dataset.fm, m: actif.dataset.v } : null;
  const types = [...new Set(TYPES.concat(items.map(i => i.type).filter(Boolean)))];
  const tableau = F.view !== "cartes" && F.view !== "liste";
  const lib = { who: "Étudiant", grp: "Groupe", st: "Statut", type: "Type", kw: "Mots-clés" };
  const valeurLib = (k, v) => k === "kw" ? (F.kwLabels[v] || v) : k === "st" ? (STATUTS_FILTRE.find(x => x[0] === v) || [v, v])[1] : v;
  const nbMotsQ = cleTitre(F.q).split(" ").filter(Boolean).length;
  const actifs = (F.q ? [["q", `« ${F.q} »${nbMotsQ > 1 ? (F.mode.q === "ou" ? " · au moins un mot" : " · tous les mots") : ""}`]] : []).concat(FILTRES_MULTI.filter(k => F[k].length).map(k => [k, `${lib[k]} : ${F[k].map(v => valeurLib(k, v)).join(SEP(k))}`]));
  const nb = nbFiltres();
  const boutonsMode = k => `<span class="seg fmode" role="group" aria-label="Combinaison des choix">
      <button type="button" class="btn sm sec ${modeFiltre(k) === "ou" ? "on" : ""}" data-fm="${k}" data-v="ou" aria-pressed="${modeFiltre(k) === "ou"}" title="Les documents qui correspondent à au moins un des choix cochés">Au moins un</button><button type="button" class="btn sm sec ${modeFiltre(k) === "et" ? "on" : ""}" data-fm="${k}" data-v="et" aria-pressed="${modeFiltre(k) === "et"}" title="Les documents qui ont une fiche de lecture pour chacun des choix cochés">Tous</button></span>`;
  const bloc = (k, options) => `<div class="fgrp"><div class="fhead"><span class="flab">${lib[k]}</span>${ET_POSSIBLE.includes(k) && F[k].length > 1 ? boutonsMode(k) : ""}</div>
      <div class="fopts">${options.map(([v, l]) => `<label class="fopt"><input type="checkbox" data-f="${k}" value="${esc(v)}" ${F[k].includes(v) ? "checked" : ""}> <span>${esc(l)}</span></label>`).join("")}</div></div>`;
  const motsQ = cleTitre(F.q).split(" ").filter(Boolean).length;
  $("filters").innerHTML = `
   <details class="colmenu" id="mfilt"><summary class="btn sm sec" aria-label="Rechercher et filtrer">🔍 Rechercher / filtrer${nb ? ` <span class="count">${nb}</span>` : ""}</summary>
    <div class="colpop pop-filtres">
     <div><label for="q">Recherche</label><input id="q" placeholder="Titre, auteur, mot-clé, commentaire…" value="${esc(F.q)}">
      <div class="fhead" id="qmode"><span class="meta">Plusieurs mots saisis :</span><span class="seg fmode" role="group" aria-label="Combinaison des mots">
       <button type="button" class="btn sm sec ${F.mode.q === "et" ? "on" : ""}" data-fq="et" title="Tous les mots saisis doivent apparaître">Tous</button><button type="button" class="btn sm sec ${F.mode.q === "ou" ? "on" : ""}" data-fq="ou" title="Au moins un des mots saisis doit apparaître">Au moins un</button></span></div></div>
     ${bloc("st", STATUTS_FILTRE)}
     ${bloc("type", types.map(t => [t, t]))}
     ${F.kw.length ? `<div class="fgrp"><div class="fhead"><span class="flab">Mots-clés</span>${F.kw.length > 1 ? boutonsMode("kw") : ""}</div><div class="fopts">${F.kw.map(v => `<label class="fopt"><input type="checkbox" data-f="kw" value="${esc(v)}" checked> <span>${esc(F.kwLabels[v] || v)}</span></label>`).join("")}</div></div>` : '<div class="meta">Mots-clés : cliquez sur un mot-clé dans le tableau pour l’ajouter au filtre.</div>'}
     <div><label for="sort">Tri</label><select id="sort"><option value="ajoute" ${F.sort === "ajoute" ? "selected" : ""}>Date de saisie</option><option value="titre" ${F.sort === "titre" ? "selected" : ""}>Titre</option><option value="parution" ${F.sort === "parution" ? "selected" : ""}>Date de parution</option></select></div>
     <button type="button" class="btn sm sec" id="reset">Réinitialiser les filtres</button>
    </div></details>
   ${actifs.map(([k, v]) => `<button type="button" class="chip on" data-clear="${k}" title="Retirer ce filtre">${esc(v)} ✕</button>`).join("")}
   <span class="meta" id="nbres"></span>
   <span class="spacer"></span>
   <span class="seg"><button type="button" class="btn sm sec ${tableau ? "on" : ""}" id="vt" aria-pressed="${tableau}">▦ Tableau</button><button type="button" class="btn sm sec ${F.view === "cartes" ? "on" : ""}" id="vc" aria-pressed="${F.view === "cartes"}">🗂 Cartes</button><button type="button" class="btn sm sec ${F.view === "liste" ? "on" : ""}" id="vl" aria-pressed="${F.view === "liste"}">☰ Liste</button></span>
   ${tableau ? `<details class="colmenu"><summary class="btn sm sec">Colonnes ▾</summary><div class="colpop">${Object.keys(COLS).map(k => `<label><input type="checkbox" data-col="${k}" ${masquees.has(+k) ? "" : "checked"}> ${COLS[k]}</label>`).join("")}</div></details>` : ""}
   <button type="button" class="btn sm sec" id="expall"></button>
   <button type="button" class="btn sm sec" id="refresh" title="Actualisation automatique toutes les ${CFG.REFRESH_SECONDS || 0} s tant que la page est ouverte" aria-label="Actualiser">↻</button><span class="meta" id="sync"></span>
   ${canWrite() ? '<button type="button" class="btn sm" id="add2">＋ Ajouter une lecture</button>' : ""}
   <details class="colmenu"><summary class="btn sm sec">⬇️ Exporter ▾</summary><div class="colpop right"><button class="btn sm" id="xl" type="button">Excel</button> <button class="btn sm" id="csv" type="button">CSV</button> <button class="btn sm" id="pdf" type="button">PDF</button></div></details>`;
  $("q").oninput = e => {
    F.q = e.target.value; renderTable();
  };
  $("sort").onchange = e => { F.sort = e.target.value; renderTable(); };
  const pf = $("filters").querySelector(".pop-filtres");
  // Cases à cocher et boutons ET / OU : le panneau reste ouvert, seul son contenu est mis à jour.
  pf.onchange = e => {
    const c = e.target.closest("input[data-f]"); if (!c) return;
    const k = c.dataset.f, v = c.value, a = F[k];
    if (c.checked) { if (!a.includes(v)) a.push(v); } else F[k] = a.filter(x => x !== v);
    if (k === "kw" && !c.checked) delete F.kwLabels[v];
    renderFilters(true); renderTable();
  };
  pf.onclick = e => {
    const b = e.target.closest("button"); if (!b) return;
    if (b.dataset.fm) { F.mode[b.dataset.fm] = b.dataset.v; renderFilters(true); renderTable(); }
    else if (b.dataset.fq) { F.mode.q = b.dataset.fq; renderFilters(true); renderTable(); }
  };
  $("mfilt").ontoggle = () => { if ($("mfilt").open && !garder) $("q").focus(); };
  $("reset").onclick = () => { Object.assign(F, filtresVierges()); renderFilters(); renderTable(); };
  $("filters").querySelectorAll("[data-clear]").forEach(b => b.onclick = () => {
    const k = b.dataset.clear;
    if (k === "q") F.q = ""; else { F[k] = []; if (k === "kw") F.kwLabels = {}; }
    renderFilters(); renderTable();
  });
  $("vt").onclick = () => changerVue("tableau");
  $("vc").onclick = () => changerVue("cartes");
  $("vl").onclick = () => changerVue("liste");
  $("filters").querySelectorAll("[data-col]").forEach(cb => cb.onchange = () => {
    if (cb.checked) masquees.delete(+cb.dataset.col); else masquees.add(+cb.dataset.col);
    try { localStorage.setItem("lydia_cols2", JSON.stringify([...masquees])); } catch (e) { /* ignoré */ }
    applyCols();
  });
  $("expall").onclick = toutDeplier;
  $("refresh").onclick = () => refresh(true);
  if ($("add2")) $("add2").onclick = () => { editing = null; artCible = ""; modeArticle = false; forceStatut = ""; openForm(); };
  $("xl").onclick = exportXlsx;
  $("csv").onclick = exportCsv;
  $("pdf").onclick = exportPdf;
  majBoutonDeplier(); majSync();
  if (ouvert) {
    $("mfilt").open = true;
    const p = document.querySelector(".pop-filtres"); if (p) p.scrollTop = defil;
    if (ref) { const sel = ref.f ? `input[data-f="${ref.f}"][value="${CSS.escape(ref.v)}"]` : `button[data-fm="${ref.fm}"][data-v="${ref.m}"]`; const el = $("filters").querySelector(sel); if (el) el.focus(); }
  }
}

// Les menus déroulants (recherche, colonnes, export) se ferment au clic en dehors ou avec Échap.
// Un menu redessiné pendant le clic (changement de choix ET / OU, case cochée) reste ouvert : on le reconnaît à son identifiant ou à son libellé.
document.addEventListener("click", e => {
  const chemin = e.composedPath(), cle = n => n && (n.id || ((n.querySelector && n.querySelector("summary")) || {}).textContent);
  const cliquee = chemin.find(n => n.classList && n.classList.contains("colmenu"));
  document.querySelectorAll("details.colmenu[open]").forEach(d => { if (!chemin.includes(d) && !(cliquee && cle(cliquee) === cle(d))) d.removeAttribute("open"); });
});

function changerVue(v) {
  F.view = v;
  try { localStorage.setItem("lydia_vue", v); } catch (e) { /* ignoré */ }
  renderFilters();
  renderTable();
}

// Mot-clé cliqué dans le tableau : ajouté au filtre (ou retiré s'il y est déjà).
function filtrerMotCle(label) {
  const k = cleTitre(label);
  if (F.kw.includes(k)) { F.kw = F.kw.filter(x => x !== k); delete F.kwLabels[k]; } else { F.kw.push(k); F.kwLabels[k] = label; }
  renderFilters(true);
  renderTable();
}

// Recherche : champs visibles + commentaires, sans accents ni casse ; tous les mots saisis (ET) ou au moins un (OU) doivent apparaître.
const CHAMPS_RECHERCHE = ["etudiant", "titre", "parution", "auteur", "qualite", "nation", "type", "mots", "kw", "concepts", "objet",
  "opinion", "controverse", "libre", "source", "volume", "numero", "pages", "doi"];
function correspond(i, q) {
  const texte = cleTitre(CHAMPS_RECHERCHE.map(k => i[k]).concat(comments.filter(c => c.lecture_id === i.id).map(c => c.texte)).join(" "));
  const mots = q.split(" ").filter(Boolean);
  return F.mode.q === "ou" ? mots.some(m => texte.includes(m)) : mots.every(m => texte.includes(m));
}

// Noms des groupes présents dans la vue courante (filtre « Groupe »).
const groupesListe = () => [...new Set(items.map(i => i.groupe).filter(Boolean))].sort((a, b) => a.localeCompare(b, "fr"));

// Un filtre sur une valeur qui n'existe pas dans la vue courante (autre groupe, étudiant absent) est invisible dans le panneau mais
// resterait appliqué : on le retire dès que la vue change. Renvoie vrai si quelque chose a été retiré.
function nettoyerFiltres() {
  const etus = students().map(s => s.prenom), grps = groupesListe();
  const who = F.who.filter(n => etus.includes(n)), grp = F.grp.filter(n => grps.includes(n));
  const change = who.length !== F.who.length || grp.length !== F.grp.length;
  F.who = who; F.grp = grp;
  return change;
}

function filtered() {
  nettoyerFiltres();
  const q = cleTitre(F.q);
  const valeurs = { who: i => [i.etudiant], grp: i => [i.groupe], st: i => [i.statut], type: i => [i.type],
    kw: i => motsListe(i.mots).concat(motsListe(i.kw)).map(cleTitre) };
  // 1. Fiche par fiche : au moins une des valeurs choisies pour chaque filtre.
  let l = items.filter(i => FILTRES_MULTI.every(k => !F[k].length || valeurs[k](i).some(v => F[k].includes(v))) && (!q || correspond(i, q)));
  // 2. Filtres en « ET » : le document doit avoir, parmi les fiches restantes, une fiche pour chaque valeur choisie ; on ne garde que ces fiches.
  ET_POSSIBLE.filter(k => modeFiltre(k) === "et").forEach(k => {
    const parArt = new Map();
    l.forEach(i => { const a = i.article_id || i.id; if (!parArt.has(a)) parArt.set(a, []); parArt.get(a).push(i); });
    const gardes = new Set([...parArt.entries()].filter(([, fiches]) => F[k].every(v => fiches.some(f => valeurs[k](f).includes(v)))).map(([a]) => a));
    l = l.filter(i => gardes.has(i.article_id || i.id) && valeurs[k](i).some(v => F[k].includes(v)));
  });
  l.sort((a, b) => F.sort === "ajoute"
    ? String(b.ajoute).localeCompare(a.ajoute)
    : String(a[F.sort] || "").localeCompare(String(b[F.sort] || ""), "fr"));
  // Les fiches de lecture d'un même document se suivent, à la place de la première.
  const parArt = new Map();
  l.forEach(i => { const k = i.article_id || i.id; if (!parArt.has(k)) parArt.set(k, []); parArt.get(k).push(i); });
  return [...parArt.values()].flat();
}

function renderTable() {
  if (nettoyerFiltres()) renderFilters(true);
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
    $("rows").innerHTML = groupes.length ? groupes.map(g => artRow(g) + fichesRow(g)).join("") : `<tr><td colspan="5" class="empty">${vide}</td></tr>`;
  }
  applyCols();
  const nbres = $("nbres");
  if (nbres) nbres.textContent = nbFiltres() ? `${l.length} / ${items.length} fiches de lecture` : "";
  // Les compteurs par personne n'ont de sens que pour le groupe : en vue « toute la promo », on ne les montre pas.
  $("stats").innerHTML = ctx.vue === "promo" ? "" : students().map(s => {
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
  racine.querySelectorAll("tr.fiches-row").forEach(t => { if (t.dataset.fa === k) t.classList.toggle("show", ouvrir); });
  majBoutonDeplier();
}

function toutDeplier() {
  if (openRows.size || openArts.size) { openRows.clear(); openArts.clear(); if (filtreActif()) filtered().forEach(i => fermesArts.add(cleArt(i))); }
  else { fermesArts.clear(); filtered().forEach(i => { openRows.add(i.id); openArts.add(cleArt(i)); }); }
  renderTable();
  majBoutonDeplier();
}

// Ferme tout menu « ⋯ » ouvert (clic ailleurs, défilement, redimensionnement).
function fermerMenusOptions() {
  document.querySelectorAll(".optmenu:not(.hidden)").forEach(m => { m.classList.add("hidden"); const td = m.closest("td"); if (td) td.classList.remove("menuopen"); const ob = m.parentElement.querySelector(".optbtn"); if (ob) ob.setAttribute("aria-expanded", "false"); });
}
document.addEventListener("click", e => { if (!e.target.closest(".optwrap")) fermerMenusOptions(); });
window.addEventListener("resize", fermerMenusOptions);
window.addEventListener("scroll", fermerMenusOptions, true);
const onAction = e => {
  const b = e.target.closest("button");
  if (!b) {
    // Clic ailleurs que sur un bouton, un lien ou un commentaire : on déplie / replie la ligne (sauf sélection de texte en cours).
    if (e.target.closest("a, input, select, textarea, label") || (window.getSelection && String(window.getSelection()).length)) return;
    const a = e.target.closest("tr.art, .cardc.art");
    if (a) return toggleArt(a.dataset.art);
    const h = e.target.closest("tr[data-id], .cardc[data-id]");
    if (h && h.dataset.apercu) return ouvrirCompteRendu(h.dataset.id, "fiche");   // fiche du tableau : aperçu et actions
    if (h) toggleOpen(h.dataset.id, h);
    return;
  }
  const d = b.dataset;
  if (d.fpdf) return ouvrirCompteRendu(d.fpdf, "fiche");
  if (d.nl) return ouvrirNotes({ liens: d.nl.split(",") });
  // Menu « ⋯ » d'un document : on l'ouvre / le ferme ; choisir une option le referme.
  if (d.opt !== undefined) {
    const m = b.parentElement.querySelector(".optmenu"), ouvrir = m.classList.contains("hidden");
    fermerMenusOptions();
    if (ouvrir) {
      m.classList.remove("hidden"); b.setAttribute("aria-expanded", "true");
      const td = b.closest("td"); if (td) td.classList.add("menuopen");   // la cellule collante forme sa propre couche : on la passe au-dessus des lignes suivantes
      // Position fixe : le menu n'est ni coupé par le défilement du tableau, ni recouvert par la ligne suivante.
      const r = b.getBoundingClientRect(), h = m.offsetHeight, w = m.offsetWidth;
      m.style.top = Math.max(4, r.bottom + 4 + h > window.innerHeight ? r.top - h - 4 : r.bottom + 4) + "px";
      m.style.left = Math.max(4, Math.min(r.right - w, window.innerWidth - w - 4)) + "px";
    }
    return;
  }
  const menu = b.closest(".optmenu"); if (menu) { menu.classList.add("hidden"); const tdm = menu.closest("td"); if (tdm) tdm.classList.remove("menuopen"); const ob = menu.parentElement.querySelector(".optbtn"); if (ob) ob.setAttribute("aria-expanded", "false"); }
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
    if (e.target.dataset.art) toggleArt(e.target.dataset.art);
    else if (e.target.dataset.apercu) ouvrirCompteRendu(e.target.dataset.id, "fiche");
    else toggleOpen(e.target.dataset.id, e.target);
  }
};
