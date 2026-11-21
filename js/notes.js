/* Notes personnelles (privées : jamais visibles du groupe, ni des formateurs, ni de l'administrateur).
   Script classique : partage la portée globale avec les autres fichiers de js/ (ordre de chargement : voir index.html). */
"use strict";

const N = { ouvert: false, notes: [], q: "", tag: "", liens: null, d: null, pq: "", err: "", foc: null, charge: false };
const aujourdhuiISO = () => { const d = new Date(); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); };
const ficheLiee = id => itemsAll.find(i => i.id === id);
const copieNote = n => ({ id: n.id, titre: n.titre, date: n.date, texte: n.texte, liens: n.liens.slice(), etiquettes: (n.etiquettes || []).slice(), epingle: !!n.epingle });
const notesLiees = ids => N.notes.filter(n => n.liens.some(l => ids.includes(l)));
const toutesEtiquettes = () => [...new Set(N.notes.flatMap(n => n.etiquettes || []))].sort((a, b) => a.localeCompare(b, "fr"));

// Ouvre la vue de la fiche : bon groupe (ou bonne promo pour une fiche terminée d'un autre groupe), filtre sur son titre.
function allerALecture(id) {
  const it = ficheLiee(id); if (!it) return false;
  const miens = groupes.map(g => g.id);
  if (it.groupe_id && miens.includes(it.groupe_id)) changerContexte({ gid: it.groupe_id, vue: "groupe" });
  else { const g = groupes.find(x => it.portee === "promo" && memePromo(it, x)); if (g) changerContexte({ gid: g.id, vue: "promo" }); }
  setTab("all"); F.q = it.titre; renderFilters(); renderTable();
  return true;
}

// Chargées en tâche de fond après la connexion : les pastilles « 📝 n » des documents en ont besoin. Échec silencieux (pastilles absentes).
function chargerNotes() {
  api("notes_list").then(j => { N.notes = j.notes || []; N.charge = true; if (typeof renderTable === "function" && me) renderTable(); }).catch(() => {});
}
function majNotes(j) { N.notes = j.notes || []; N.charge = true; if (me) renderTable(); }

function ouvrirNotes(opt) {
  if (!me || !$("notemodal")) return;
  N.ouvert = true; N.foc = document.activeElement; N.d = null; N.q = ""; N.tag = ""; N.err = ""; N.liens = opt && opt.liens ? opt.liens : null;
  $("notemodal").classList.remove("hidden"); document.body.classList.add("modalopen");
  if (N.charge) renderNotes(); else $("notebody").innerHTML = '<div class="meta" style="padding:14px">Chargement…</div>';
  api("notes_list").then(j => { N.notes = j.notes || []; N.charge = true; if (N.ouvert) renderNotes(); })
    .catch(e => { if (N.ouvert && !N.charge) $("notebody").innerHTML = `<div class="err" style="padding:14px">Chargement impossible : ${esc(e.message)}</div>`; });
}
function fermerNotes() {
  if (!N.ouvert) return;
  N.ouvert = false; N.d = null;
  $("notemodal").classList.add("hidden"); $("notebody").innerHTML = ""; document.body.classList.remove("modalopen");
  if (N.foc && N.foc.focus) { try { N.foc.focus(); } catch (e) { /* ignoré */ } }
}
$("noteclose")?.addEventListener("click", fermerNotes);
$("notemodal")?.addEventListener("click", e => { if (e.target === $("notemodal")) fermerNotes(); });

function renderNotes() {
  $("notebody").innerHTML = `<div class="nwrap"><div class="nlist"><div class="nbar"><input id="nq" type="search" placeholder="Rechercher dans mes notes…" aria-label="Rechercher dans mes notes" value="${esc(N.q)}"><button type="button" class="btn sm" data-nnew>＋ Nouvelle</button><button type="button" class="btn sm sec" data-nexport title="Télécharger toutes mes notes (texte)" aria-label="Exporter mes notes">⬇️</button></div><div id="nfiltres"></div><div id="nitems"></div></div><div class="nedit" id="nedit"></div></div>`;
  renderNListe(); renderNEdit();
}
function renderNListe() {
  const q = cleTitre(N.q);
  const l = N.notes.filter(n => (!q || cleTitre(n.titre + " " + n.texte + " " + (n.etiquettes || []).join(" ")).includes(q))
    && (!N.tag || (n.etiquettes || []).includes(N.tag)) && (!N.liens || n.liens.some(x => N.liens.includes(x))));
  const tags = toutesEtiquettes();
  $("nfiltres").innerHTML = (N.liens ? `<div class="nfchip">Notes liées à ce document <button type="button" class="btn sm sec" data-nunfilter aria-label="Retirer le filtre">✕</button></div>` : "")
    + (tags.length ? `<div class="ntags">${tags.map(t => `<button type="button" class="ntag ${N.tag === t ? "on" : ""}" data-ntag="${esc(t)}" aria-pressed="${N.tag === t}">#${esc(t)}</button>`).join("")}</div>` : "");
  $("nitems").innerHTML = l.map(n => `<button type="button" class="nitem ${N.d && N.d.id === n.id ? "on" : ""}" data-nopen="${esc(n.id)}"><b>${n.epingle ? "📌 " : ""}${esc(n.titre)}</b><span class="meta">${esc(fmtD(n.date))}${n.liens.length ? " · 🔗 " + n.liens.length : ""}${(n.etiquettes || []).length ? " · " + n.etiquettes.map(t => "#" + esc(t)).join(" ") : ""}</span><span class="meta nex">${esc(n.texte.replace(/\s+/g, " ").slice(0, 90))}</span></button>`).join("")
    || `<div class="note">${N.notes.length ? "Aucune note ne correspond." : "Aucune note pour le moment. Elles sont invisibles des autres membres et des formateurs."}</div>`;
}
function renderNEdit() {
  const d = N.d, box = $("nedit");
  if (!d) { box.innerHTML = '<div class="note">Choisissez une note ou créez-en une. 🔒 Vos notes sont invisibles des autres membres, des formateurs et de l’application ; seul l’administrateur du Google Sheet pourrait techniquement les lire. 🩺 N’y mettez aucune information permettant d’identifier un patient.</div>'; return; }
  const liens = d.liens.map(id => { const it = ficheLiee(id);
    return `<span class="nlien">${it ? `<button type="button" class="btn sm sec" data-ngo="${esc(id)}" title="Ouvrir cette fiche dans le tableau">📄 ${esc(it.titre)} <span class="meta">${esc(it.etudiant)}</span></button>` : '<span class="meta">📄 fiche indisponible</span>'}<button type="button" class="btn sm sec" data-nunlink="${esc(id)}" aria-label="Retirer le lien">✕</button></span>`; }).join("");
  const proposees = toutesEtiquettes().filter(t => !d.etiquettes.includes(t));
  box.innerHTML = `<label for="nt">Titre</label><input id="nt" maxlength="120" value="${esc(d.titre)}">
    <div class="nrow"><div><label for="nd">Date</label><input id="nd" type="date" value="${esc(d.date)}"></div>
      <label class="chk"><input type="checkbox" id="nep" ${d.epingle ? "checked" : ""}> 📌 Épingler en haut de la liste</label></div>
    <label for="ntx">Note</label><textarea id="ntx" rows="9" maxlength="20000" placeholder="Vos réflexions, pistes, citations à retrouver…">${esc(d.texte)}</textarea>
    <label for="nte">Étiquettes <span class="meta">(séparées par des virgules)</span></label><input id="nte" maxlength="200" placeholder="éthique, stage, entretien…" value="${esc(d.etiquettes.join(", "))}">
    ${proposees.length ? `<div class="ntags">${proposees.map(t => `<button type="button" class="ntag" data-nadd="${esc(t)}">+ #${esc(t)}</button>`).join("")}</div>` : ""}
    <div class="nliens"><b>Fiches de lecture liées</b>${liens ? `<div>${liens}</div>` : '<div class="meta">Aucune pour le moment.</div>'}
      <input id="npq" type="search" placeholder="Lier une fiche (titre, auteur, mot-clé)…" aria-label="Lier une fiche de lecture" value="${esc(N.pq)}"><div id="nres"></div></div>
    <div id="nerr" class="meta" role="alert" style="color:var(--bad,#c0392b)">${esc(N.err)}</div>
    <div class="nacts"><button type="button" class="btn" data-nsave>Enregistrer</button>${d.id ? ' <button type="button" class="btn sm sec" data-ndel>Supprimer</button>' : ""}</div>`;
  renderNRes();
}
function renderNRes() {
  const q = cleTitre(N.pq), res = $("nres"); if (!res) return;
  if (q.length < 2) { res.innerHTML = ""; return; }
  const l = itemsAll.filter(i => !N.d.liens.includes(i.id) && cleTitre([i.titre, i.etudiant, i.mots, i.kw].join(" ")).includes(q)).slice(0, 8);
  res.innerHTML = l.map(i => `<button type="button" class="nres" data-nlink="${esc(i.id)}">${esc(i.titre)} <span class="meta">${esc(i.etudiant)} · ${esc(stInfo(i.statut).lib)}</span></button>`).join("") || '<div class="meta">Aucune fiche trouvée.</div>';
}
const lireEtiquettes = v => [...new Set(String(v).split(",").map(t => t.trim().replace(/\s+/g, " ")).filter(Boolean))];
$("notebody")?.addEventListener("input", e => {
  const id = e.target.id;
  if (id === "nq") { N.q = e.target.value; renderNListe(); }
  else if (id === "nt") N.d.titre = e.target.value;
  else if (id === "nd") N.d.date = e.target.value;
  else if (id === "ntx") N.d.texte = e.target.value;
  else if (id === "nte") N.d.etiquettes = lireEtiquettes(e.target.value);
  else if (id === "npq") { N.pq = e.target.value; renderNRes(); }
});
$("notebody")?.addEventListener("change", e => { if (e.target.id === "nep") N.d.epingle = e.target.checked; });
$("notebody")?.addEventListener("click", async e => {
  const b = e.target.closest("button"); if (!b) return;
  if (b.dataset.nnew !== undefined) { N.d = { id: "", titre: "", date: aujourdhuiISO(), texte: "", liens: [], etiquettes: [], epingle: false }; N.pq = ""; N.err = ""; renderNListe(); renderNEdit(); $("nt").focus(); }
  else if (b.dataset.nopen) { const n = N.notes.find(x => x.id === b.dataset.nopen); if (n) { N.d = copieNote(n); N.pq = ""; N.err = ""; renderNListe(); renderNEdit(); } }
  else if (b.dataset.nexport !== undefined) exportNotes();
  else if (b.dataset.ntag !== undefined) { N.tag = N.tag === b.dataset.ntag ? "" : b.dataset.ntag; renderNListe(); }
  else if (b.dataset.nunfilter !== undefined) { N.liens = null; renderNListe(); }
  else if (b.dataset.nadd) { N.d.etiquettes = lireEtiquettes(N.d.etiquettes.concat(b.dataset.nadd).join(",")); renderNEdit(); }
  else if (b.dataset.nlink) { N.d.liens.push(b.dataset.nlink); N.pq = ""; renderNEdit(); $("npq").focus(); }
  else if (b.dataset.nunlink) { N.d.liens = N.d.liens.filter(x => x !== b.dataset.nunlink); renderNEdit(); }
  else if (b.dataset.ngo) { const id = b.dataset.ngo; fermerNotes(); allerALecture(id); }
  else if (b.dataset.nsave !== undefined) {
    N.d.titre = $("nt").value.trim(); N.d.etiquettes = lireEtiquettes($("nte").value);
    if (!N.d.titre) { N.err = "Donnez un titre à la note."; $("nerr").textContent = N.err; return; }
    const avant = new Set(N.notes.map(n => n.id));
    try {
      const j = await enCours("Enregistrement…", () => api("note_save", { data: N.d }));
      N.err = ""; majNotes(j);
      const n = N.d.id ? N.notes.find(x => x.id === N.d.id) : N.notes.find(x => !avant.has(x.id));
      N.d = n ? copieNote(n) : null;
      renderNListe(); renderNEdit();
      if (N.d) $("nerr").textContent = "✔ Enregistré";
    } catch (x) { N.err = x.message || "Échec de l'enregistrement."; if ($("nerr")) $("nerr").textContent = N.err; }
  }
  else if (b.dataset.ndel !== undefined) {
    if (!confirm("Supprimer cette note ?")) return;
    try { const j = await enCours("Suppression…", () => api("note_delete", { id: N.d.id })); majNotes(j); N.d = null; renderNListe(); renderNEdit(); }
    catch (x) { N.err = x.message || "Échec de la suppression."; if ($("nerr")) $("nerr").textContent = N.err; }
  }
});
