/* Mémoire partagé par le groupe : éditeur structuré (titres, paragraphes, citations, références APA, notes de bas de page), aperçu et contrôle des normes.
   Mise en forme saisie avec des marques simples : **gras** et *italique* ; note de bas de page : ^[texte de la note].
   Script classique : portée globale partagée avec js/.
   Normes de la maquette « Consignes de rédaction et de présentation d’un travail écrit » (IFSI Saint-Nazaire). */
"use strict";
/* ---------- Mémoire ---------- */

const MEM = { gid: "", data: null, chargement: false, msg: "" };
const MEM_TYPES = { titre1: "Titre de chapitre", titre2: "Sous-titre", paragraphe: "Paragraphe", citation: "Citation", reference: "Référence APA" };
// Marges de la maquette, en cm : gauche (reliure), droite, haut, bas.
const MEM_MARGES = { g: 3, d: 2.5, h: 2.5, b: 3 };

// Découpe un texte saisi : morceaux de texte ({texte}) et notes de bas de page ({note}), dans l'ordre.
function memMorceaux(texte) {
  return String(texte || "").split(/(\^\[[^\[\]]*\])/).filter(Boolean).map(p => {
    const n = /^\^\[([^\[\]]*)\]$/.exec(p);
    return n ? { note: n[1] } : { texte: p };
  });
}
// Texte saisi (marques **gras** et *italique*) -> HTML sûr pour l'aperçu. Les notes sont numérotées dans la liste `notes`.
function memInline(texte, notes) {
  return memMorceaux(texte).map(m => {
    if (m.note === undefined) return esc(m.texte).replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>").replace(/\*([^*]+)\*/g, "<i>$1</i>");
    if (!notes) return esc(m.note);
    notes.push(m.note);
    return "<sup>" + notes.length + "</sup>";
  }).join("");
}
// HTML d'une référence APA (italique en <i>) -> marques de saisie.
function memDepuisHtml(html) {
  const d = document.createElement("div"); d.innerHTML = html;
  d.querySelectorAll("i").forEach(i => { i.textContent = "*" + i.textContent + "*"; i.replaceWith(i.textContent); });
  return d.textContent.replace(/\s+/g, " ").trim();
}

function memSignature() { return JSON.stringify(MEM.data); }

async function renderMemoire() {
  const box = $("memoirebox"); if (!box) return;
  const g = groupeCourant();
  if (!g) { box.innerHTML = '<div class="card empty">Rejoignez un groupe pour écrire son mémoire.</div>'; return; }
  if (MEM.gid !== g.id || !MEM.data) {
    MEM.gid = g.id;
    box.innerHTML = '<div class="card empty">Chargement du mémoire…</div>';
    try { MEM.data = (await api("memoire_get", { groupe_id: g.id })).memoire; }
    catch (e) { if (e.code === "unauthorized") return sessionError(e); box.innerHTML = '<div class="card empty">Mémoire indisponible : ' + esc(e.message) + "</div>"; return; }
  }
  memDessiner();
}

function memDessiner() {
  const box = $("memoirebox"), m = MEM.data; if (!box || !m) return;
  const ecrit = !!m.modifiable;
  const refs = itemsAll.filter(i => i.groupe_id === MEM.gid && i.statut !== "À lire");
  box.innerHTML = `<div class="memlayout">
    <div class="memedit">
      <div class="card">
        <h2 style="font-size:16px;margin:0 0 8px">🎓 Mémoire du groupe</h2>
        <div class="meta">Le mémoire est partagé par le groupe : chaque bloc garde l’auteur de sa dernière modification. Mise en forme : <b>**gras**</b>, <i>*italique*</i> ; note de bas de page : <b>^[texte de la note]</b>.</div>
        <div class="memen">
          <div><label for="mem_titre">Titre du travail</label><input id="mem_titre" maxlength="200" value="${esc(m.titre)}" ${ecrit ? "" : "disabled"}></div>
          <div><label for="mem_ue">UE et intitulé</label><input id="mem_ue" maxlength="200" value="${esc(m.ue)}" ${ecrit ? "" : "disabled"}></div>
          <div><label for="mem_ref">Référent pédagogique</label><input id="mem_ref" maxlength="120" value="${esc(m.referent)}" ${ecrit ? "" : "disabled"}></div>
          <div style="grid-column:1/-1"><label for="mem_auteurs">Auteur(s) de la couverture <span class="meta">(NOM – Prénom, séparés par ;)</span></label><input id="mem_auteurs" maxlength="300" value="${esc(m.auteurs)}" placeholder="ex. Dupont – Ana ; Martin – Ben" ${ecrit ? "" : "disabled"}></div>
          <div><label for="mem_date">Date de rendu</label><input id="mem_date" type="date" value="${esc(m.date_rendu)}" ${ecrit ? "" : "disabled"}></div>
        </div>
        <div id="mem_msg" class="meta" role="status">${esc(MEM.msg)}</div>
        <div class="memexp"><span class="meta">Exporter :</span> <button type="button" class="btn sm" data-mem-exp="pdf">⬇️ PDF</button> <button type="button" class="btn sm sec" data-mem-exp="docx">Word (DOCX)</button> <button type="button" class="btn sm sec" data-mem-exp="odt">OpenDocument (ODT)</button></div>
      </div>
      ${ecrit ? `<div class="card memajout"><b>Ajouter :</b>
        ${["titre1", "titre2", "paragraphe", "citation"].map(t => `<button type="button" class="btn sm sec" data-mem-new="${t}">＋ ${esc(MEM_TYPES[t])}</button>`).join(" ")}
        ${refs.length ? `<button type="button" class="btn sm sec" id="mem_refbtn">＋ Référence APA</button>` : ""}
        <button type="button" class="btn sm sec" data-mem-note title="Insère ^[ ] à la place du curseur, dans le bloc en cours">＋ Note de bas de page</button>
        <div id="mem_refs" class="hidden">${refs.map(i => `<button type="button" class="memref" data-mem-ref="${esc(i.id)}">${esc(i.titre)} <span class="meta">${esc(i.auteur || "")}</span></button>`).join("")}</div></div>` : '<div class="card meta">Lecture seule : seules les membres du groupe modifient le mémoire.</div>'}
      <div class="memblocs">${m.blocs.length ? m.blocs.map((b, i) => memBlocHtml(b, i, ecrit)).join("") : '<div class="card empty">Le mémoire est vide. Commencez par un titre de chapitre.</div>'}</div>
    </div>
    <div class="memcote">
      <div class="card"><h3 style="font-size:14px;margin:0 0 8px">Contrôle des normes</h3><div id="mem_controle">${memControleHtml()}</div></div>
      <div class="card"><h3 style="font-size:14px;margin:0 0 8px">Aperçu</h3><div class="memfeuille" id="mem_apercu">${memApercuHtml()}</div></div>
    </div></div>`;
}

function memBlocHtml(b, i, ecrit) {
  const dis = ecrit ? "" : "disabled";
  return `<div class="card memblc" data-bid="${esc(b.id)}">
    <div class="memtete"><select data-mem-type ${dis} aria-label="Type du bloc">${Object.keys(MEM_TYPES).map(k => `<option value="${k}" ${k === b.type ? "selected" : ""}>${esc(MEM_TYPES[k])}</option>`).join("")}</select>
      <span class="meta">${esc(b.par)}${b.par ? " · " : ""}${esc(fmtDT(b.modifie_le))}</span>
      ${ecrit ? `<span class="memops"><button type="button" class="btn sm sec" data-mem-mv="-1" aria-label="Monter" ${i === 0 ? "disabled" : ""}>↑</button><button type="button" class="btn sm sec" data-mem-mv="1" aria-label="Descendre">↓</button><button type="button" class="btn sm sec del" data-mem-del aria-label="Supprimer">🗑</button></span>` : ""}</div>
    <textarea class="memtxt memtxt-${esc(b.type)}" rows="${b.type === "paragraphe" || b.type === "citation" || b.type === "reference" ? 4 : 1}" ${dis} aria-label="Texte du bloc">${esc(b.texte)}</textarea>
  </div>`;
}

// Promotion au format de la maquette : « Promo 24-27 » -> « PROMOTION 2024-2027 ».
function memPromoMaquette(promo) {
  const m = /(\d{2})\s*-\s*(\d{2})/.exec(promo || "");
  return m ? "PROMOTION 20" + m[1] + "-20" + m[2] : String(promo || "").toUpperCase();
}
// Page de couverture selon le modèle : établissement en haut, UE et titre au centre, auteurs et promotion, référent et date en bas.
function memCouvertureHtml() {
  const m = MEM.data, g = groupeCourant() || {};
  return `<section class="memcouv">
    <div class="memcouv-haut">INSTITUT DE FORMATION EN SOINS INFIRMIERS<br>SAINT-NAZAIRE</div>
    <div class="memcouv-centre">${m.ue ? esc(m.ue) + "<br>" : ""}<b>${esc(m.titre || "TITRE DU TRAVAIL").toUpperCase()}</b></div>
    <div class="memcouv-auteurs">${esc(m.auteurs || "NOM – Prénom de l’étudiant(e)")}<br>${esc(memPromoMaquette(g.promo))}</div>
    <div class="memcouv-bas">Référent pédagogique : ${esc(m.referent)}<br>Date : ${esc(m.date_rendu ? fmtD(m.date_rendu) : "")}</div>
  </section>`;
}
// Pied de page de la maquette, sur chaque page sauf la couverture.
function memPiedHtml(page) {
  const m = MEM.data, g = groupeCourant() || {};
  return `<footer class="mempied">IFSI GAVY – SAINT-NAZAIRE – ${esc(m.ue || "UE")} – ${esc(m.titre || "Titre du document")} – ${esc(memPromoMaquette(g.promo))} – ${esc(m.auteurs || "NOM Prénom")} – ${esc(m.date_rendu ? fmtD(m.date_rendu) : "Date")} – Page ${page}</footer>`;
}
function memApercuHtml() {
  const m = MEM.data; if (!m) return "";
  const notes = [];
  const corps = m.blocs.map(b => {
    const t = memInline(b.texte, notes);
    if (b.type === "titre1") return `<h2 class="mh1">${t}</h2>`;
    if (b.type === "titre2") return `<h3 class="mh2">${t}</h3>`;
    if (b.type === "citation") return `<blockquote class="mcit">${t}</blockquote>`;
    if (b.type === "reference") return `<p class="mref">${t}</p>`;
    return `<p class="mpar">${t}</p>`;
  }).join("");
  // Notes de bas de page (corps 10) au bas de la feuille, numérotées comme les appels.
  const liste = notes.length ? `<ol class="mnotes" style="font-size:10pt;line-height:1.2;margin:18px 0 0;padding:6px 0 0 18px;border-top:1px solid #000;list-style:decimal">${notes.map(n => `<li>${memInline(n)}</li>`).join("")}</ol>` : "";
  // L'aperçu montre une seule feuille de contenu : la pagination exacte se fait à l'export.
  return memCouvertureHtml() + `<section class="memcontenu">${corps || '<p class="meta">Le contenu apparaîtra ici.</p>'}${liste}${memPiedHtml(2)}</section>`;
}

// Contrôles automatiques : ce qui se vérifie sur le contenu. Les marges, la police et l’interligne sont fixés par la feuille d’aperçu.
function memControleHtml() {
  const m = MEM.data;
  const mots = m.blocs.reduce((n, b) => n + (b.texte.trim() ? b.texte.trim().split(/\s+/).length : 0), 0);
  const ok = (c, txt) => `<li class="${c ? "okk" : "ko"}">${c ? "✅" : "⚠️"} ${esc(txt)}</li>`;
  const titres = m.blocs.filter(b => b.type === "titre1").length;
  const vides = m.blocs.filter(b => !b.texte.trim()).length;
  const notes = m.blocs.reduce((n, b) => n + memMorceaux(b.texte).filter(x => x.note !== undefined).length, 0);
  return `<ul class="memcheck">
    ${ok(!!m.titre, "Titre du travail renseigné")}
    ${ok(!!m.ue, "UE et intitulé renseignés")}
    ${ok(!!m.referent, "Référent pédagogique renseigné")}
    ${ok(!!m.auteurs, "Auteur(s) de la couverture renseigné(s)")}
    ${ok(!!m.date_rendu, "Date de rendu renseignée")}
    ${ok(titres > 0, "Au moins un titre de chapitre")}
    ${ok(vides === 0, vides ? vides + " bloc(s) vide(s) à compléter ou supprimer" : "Aucun bloc vide")}
    ${ok(m.blocs.some(b => b.type === "reference"), "Références bibliographiques ajoutées (APA 7e)")}
    <li class="info">📝 ${mots} mot${mots > 1 ? "s" : ""} · ${notes} note${notes > 1 ? "s" : ""} de bas de page</li>
  </ul>
  <div class="meta">Marges : gauche ${MEM_MARGES.g} cm, droite ${MEM_MARGES.d} cm, haut ${MEM_MARGES.h} cm, bas ${MEM_MARGES.b} cm. Times New Roman noir : corps 12, titres 16 et 14, interligne 1,5, texte justifié, notes de bas de page en 10.</div>`;
}

function memRafraichirApercu() {
  if ($("mem_apercu")) $("mem_apercu").innerHTML = memApercuHtml();
  if ($("mem_controle")) $("mem_controle").innerHTML = memControleHtml();
}

// Enregistre le bloc après modification (bloc par bloc, pour ne rien écraser chez les autres).
async function memSauverBloc(bid, data) {
  $("mem_msg") && ($("mem_msg").textContent = "Enregistrement…");
  try {
    const res = await api("memoire_bloc", { groupe_id: MEM.gid, id: bid || undefined, data });
    MEM.data = res.memoire; MEM.msg = "Enregistré."; memRafraichirApercu();
    if ($("mem_msg")) $("mem_msg").textContent = MEM.msg;
  } catch (e) { if (e.code === "unauthorized") return sessionError(e); MEM.msg = "Enregistrement impossible : " + e.message; if ($("mem_msg")) $("mem_msg").textContent = MEM.msg; }
}

// Mémorise l'en-tête (titre, UE, référent, date).
async function memSauverEntete() {
  const data = { titre: $("mem_titre").value, ue: $("mem_ue").value, referent: $("mem_ref").value, auteurs: $("mem_auteurs").value, date_rendu: $("mem_date").value };
  try {
    const res = await api("memoire_entete", { groupe_id: MEM.gid, data });
    MEM.data = res.memoire; MEM.msg = "En-tête enregistré."; memRafraichirApercu();
    if ($("mem_msg")) $("mem_msg").textContent = MEM.msg;
  } catch (e) { if (e.code === "unauthorized") return sessionError(e); MEM.msg = "Enregistrement impossible : " + e.message; if ($("mem_msg")) $("mem_msg").textContent = MEM.msg; }
}

// Ajout, suppression, déplacement : la structure change, on redessine tout.
async function memStructure(appel) {
  try { const res = await enCours("Enregistrement…", appel); MEM.data = res.memoire; memDessiner(); }
  catch (e) { if (e.code === "unauthorized") return sessionError(e); alert("Action impossible : " + e.message); }
}

// Insère ^[ ] à la place du curseur dans le bloc en cours d’écriture ; le curseur se place dans la note.
function memInsererNote() {
  const t = document.activeElement;
  if (!t || !t.matches || !t.matches(".memtxt")) {
    MEM.msg = "Placez le curseur dans un bloc de texte, puis ajoutez la note.";
    if ($("mem_msg")) $("mem_msg").textContent = MEM.msg;
    return;
  }
  const debut = t.selectionStart, fin = t.selectionEnd, sel = t.value.slice(debut, fin);
  t.value = t.value.slice(0, debut) + "^[" + sel + "]" + t.value.slice(fin);
  t.selectionStart = t.selectionEnd = debut + 2 + sel.length;
  t.dispatchEvent(new Event("input", { bubbles: true }));
  t.focus();
}

$("memoirebox")?.addEventListener("change", e => {
  const t = e.target;
  if (t.closest && t.closest("#mem_titre, #mem_ue, #mem_ref, #mem_auteurs, #mem_date")) return memSauverEntete();
  const bloc = t.closest && t.closest("[data-bid]");
  if (!bloc) return;
  const bid = bloc.dataset.bid, b = MEM.data.blocs.find(x => x.id === bid); if (!b) return;
  if (t.matches("[data-mem-type]")) return memStructure(() => api("memoire_bloc", { groupe_id: MEM.gid, id: bid, data: { type: t.value, texte: b.texte } }));
});

$("memoirebox")?.addEventListener("input", e => {
  const t = e.target;
  if (t.matches && t.matches(".memtxt")) {
    const bloc = t.closest("[data-bid]"), b = MEM.data.blocs.find(x => x.id === bloc.dataset.bid);
    if (b) { b.texte = t.value; memRafraichirApercu(); }
  }
});

// Enregistre le texte quand on quitte la zone (pas à chaque frappe).
$("memoirebox")?.addEventListener("focusout", e => {
  const t = e.target;
  if (!t.matches || !t.matches(".memtxt")) return;
  const bloc = t.closest("[data-bid]"), b = MEM.data.blocs.find(x => x.id === bloc.dataset.bid);
  if (b) memSauverBloc(b.id, { type: b.type, texte: t.value });
});

// Le bouton de note ne doit pas prendre le curseur au bloc de texte.
$("memoirebox")?.addEventListener("mousedown", e => {
  if (e.target.closest && e.target.closest("[data-mem-note]")) e.preventDefault();
});

$("memoirebox")?.addEventListener("click", e => {
  const b = e.target.closest("button"); if (!b) return;
  if (b.hasAttribute("data-mem-note")) return memInsererNote();
  if (b.id === "mem_refbtn") { $("mem_refs").classList.toggle("hidden"); return; }
  if (b.dataset.memExp) return b.dataset.memExp === "pdf" ? memPdf() : memExporter(b.dataset.memExp);
  if (b.dataset.memNew) return memStructure(() => api("memoire_bloc", { groupe_id: MEM.gid, data: { type: b.dataset.memNew, texte: "" } }));
  if (b.dataset.memRef) {
    const i = itemsAll.find(x => x.id === b.dataset.memRef); if (!i) return;
    const texte = memDepuisHtml(LydiaApa.apa(i).html);
    return memStructure(() => api("memoire_bloc", { groupe_id: MEM.gid, data: { type: "reference", texte } }));
  }
  const bloc = b.closest("[data-bid]"); if (!bloc) return;
  const bid = bloc.dataset.bid;
  if (b.hasAttribute("data-mem-del")) {
    if (!confirm("Supprimer ce bloc du mémoire ?")) return;
    return memStructure(() => api("memoire_bloc_supprimer", { groupe_id: MEM.gid, id: bid }));
  }
  if (b.dataset.memMv) {
    const ids = MEM.data.blocs.map(x => x.id), i = ids.indexOf(bid), j = i + Number(b.dataset.memMv);
    if (j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    return memStructure(() => api("memoire_ordre", { groupe_id: MEM.gid, ids }));
  }
});

/* ---------- Export : PDF (dans le navigateur), DOCX et ODT (sur le serveur) ---------- */

// Nom de fichier de la maquette : NOM.Prénom_UE_Titre_AAAAMMJJ.ext (même règle que le serveur).
function memNomFichier(ext) {
  const id = me.identite || {}, m = MEM.data;
  const nom = String(id.nom || me.prenom || "").toUpperCase(), prenom = id.prenom || me.prenom || "";
  const ue = String(m.ue || ""), u = /UE\s*(\d+(?:\.\d+)?)/i.exec(ue);
  const code = u ? "UE" + u[1] : (ue.trim() || "UE");
  const net = s => String(s).replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-+|-+$/g, "");
  const jour = m.date_rendu ? m.date_rendu.replace(/-/g, "") : new Date().toISOString().slice(0, 10).replace(/-/g, "");
  return `${net(nom)}.${net(prenom)}_${net(code)}_${net(m.titre || "").slice(0, 60)}_${jour}.${ext}`;
}
const memDateFr = d => (/^(\d{4})-(\d{2})-(\d{2})$/.exec(d || "") ? d.slice(8, 10) + "/" + d.slice(5, 7) + "/" + d.slice(0, 4) : "");
// Pied de page : même texte que dans les fichiers Word et OpenDocument (le numéro de page est ajouté).
function memTexteArrierePlan() {
  const m = MEM.data, g = groupeCourant() || {};
  return `IFSI GAVY – SAINT-NAZAIRE – ${m.ue || "UE"} – ${m.titre || ""} – ${memPromoMaquette(g.promo)} – ${m.auteurs || "NOM Prénom"} – ${memDateFr(m.date_rendu) || "Date"}`;
}

// PDF aux normes : A4, marges 3 cm (gauche), 2,5 cm (droite), 2,5 cm (haut), 3 cm (bas) ; Times ; corps 12, titres 16 et 14 ; interligne 1,5 ; justifié.
// Notes de bas de page en corps 10, numérotées dans l’ordre du texte, posées au bas de la page où se trouve leur appel.
function memPdf() {
  if (!window.jspdf) { alert("Module PDF non chargé."); return; }
  const m = MEM.data, g = groupeCourant() || {};
  const doc = new window.jspdf.jsPDF({ unit: "mm", format: "a4" });
  const W = 210, H = 297, ML = 30, MR = 25, MT = 25, MB = 30, LARG = W - ML - MR, PT = 0.3528, ESP = 1.5;
  const TN = 10, LN = TN * 1.2 * PT;   // notes : corps 10, interligne simple
  const police = (gras, italique) => doc.setFont("times", gras && italique ? "bolditalic" : gras ? "bold" : italique ? "italic" : "normal");
  const centre = (t, y, taille, gras) => { police(gras, false); doc.setFontSize(taille); doc.text(String(t), W / 2, y, { align: "center" }); };
  // Couverture (page 1, sans pied de page)
  centre("INSTITUT DE FORMATION EN SOINS INFIRMIERS", 48, 14, false);
  centre("SAINT-NAZAIRE", 48 + 14 * ESP * PT, 14, false);
  if (m.ue) centre(m.ue, 110, 14, false);
  centre((m.titre || "TITRE DU TRAVAIL").toUpperCase(), 110 + (m.ue ? 2 * 14 * ESP * PT : 0), 14, true);
  centre(m.auteurs || "NOM – Prénom de l’étudiant(e)", 176, 12, false);
  centre(memPromoMaquette(g.promo), 176 + 12 * ESP * PT, 12, false);
  police(false, false); doc.setFontSize(12);
  doc.text("Référent pédagogique : " + (m.referent || ""), ML, 262);
  doc.text("Date : " + memDateFr(m.date_rendu), ML, 262 + 12 * ESP * PT);

  // Mise en page du texte : mots avec leur style, retrait de la première ligne et retrait des suivantes, justification.
  let y = MT, noteNum = 0, notesPage = [], hNotesPage = 0;
  const mot = (t, gras, italique, taille) => { police(gras, italique); doc.setFontSize(taille); return doc.getTextWidth(t); };
  // Hauteur réservée au bas de page pour des notes (filet + espace), 0 s’il n’y en a pas.
  const espaceNotes = h => (h > 0 ? h + 6 : 0);
  const mots = texte => {
    const out = [];
    memMorceaux(texte).forEach(p => {
      if (p.note !== undefined) { noteNum++; out.push({ t: String(noteNum), sup: true, note: p.note }); return; }
      String(p.texte).split(/(\*\*[^*]+\*\*|\*[^*]+\*)/).filter(Boolean).forEach(q => {
        let gras = false, ital = false, t = q;
        if (q.startsWith("**") && q.endsWith("**") && q.length > 4) { gras = true; t = q.slice(2, -2); }
        else if (q.startsWith("*") && q.endsWith("*") && q.length > 2) { ital = true; t = q.slice(1, -1); }
        t.split(/\s+/).filter(Boolean).forEach(w => out.push({ t: w, gras, ital }));
      });
    });
    return out;
  };
  // Lignes d’une note (retrait de 4 mm pour le numéro).
  const lignesNote = texte => {
    const sp = mot(" ", false, false, TN), dispo = LARG - 4;
    const ws = [];
    String(texte || "").split(/(\*\*[^*]+\*\*|\*[^*]+\*)/).filter(Boolean).forEach(q => {
      let gras = false, ital = false, t = q;
      if (q.startsWith("**") && q.endsWith("**") && q.length > 4) { gras = true; t = q.slice(2, -2); }
      else if (q.startsWith("*") && q.endsWith("*") && q.length > 2) { ital = true; t = q.slice(1, -1); }
      t.split(/\s+/).filter(Boolean).forEach(w => ws.push({ t: w, gras, ital, l: mot(w, gras, ital, TN) }));
    });
    const lignes = []; let cur = [], larg = 0;
    ws.forEach(w => {
      if (cur.length && larg + sp + w.l > dispo) { lignes.push(cur); cur = []; larg = 0; }
      larg += (cur.length ? sp : 0) + w.l; cur.push(w);
    });
    if (cur.length) lignes.push(cur);
    return lignes.length ? lignes : [[]];
  };
  const hauteurNote = texte => lignesNote(texte).length * LN;
  // Dessine les notes de la page en cours, au bas de la zone de texte, puis vide la liste.
  const dessinerNotes = () => {
    if (!notesPage.length) return;
    let yn = H - MB - hNotesPage;
    doc.setLineWidth(0.2); doc.line(ML, yn - 3, ML + 50, yn - 3);
    const sp = mot(" ", false, false, TN);
    notesPage.forEach(n => {
      lignesNote(n.texte).forEach((l, k) => {
        if (k === 0) { police(false, false); doc.setFontSize(TN * 0.6); doc.text(n.num, ML, yn + LN * 0.7 - 1.2); }
        let x = ML + 4;
        l.forEach(w => { police(w.gras, w.ital); doc.setFontSize(TN); doc.text(w.t, x, yn + LN * 0.7); x += w.l + sp; });
        yn += LN;
      });
    });
    notesPage = []; hNotesPage = 0;
  };
  const saut = () => { dessinerNotes(); doc.addPage(); y = MT; };
  const paragraphe = (texte, taille, gras, opt) => {
    const lh = taille * ESP * PT, sp = mot(" ", false, false, taille);
    const ws = mots(texte).map(w => ({ ...w, l: w.sup ? mot(w.t, false, false, taille * 0.6) : mot(w.t, gras || w.gras, w.ital, taille) }));
    const lignes = []; let cur = [], larg = 0;
    const gauche = i => (i === 0 ? opt.premiere : opt.suite);
    ws.forEach(w => {
      let dispo = LARG - opt.retrait - gauche(lignes.length);
      if (cur.length && larg + sp + w.l > dispo) { lignes.push(cur); cur = []; larg = 0; dispo = LARG - opt.retrait - gauche(lignes.length); }
      larg += (cur.length ? sp : 0) + w.l; cur.push(w);
    });
    if (cur.length) lignes.push(cur);
    if (opt.avant) y += opt.avant;
    lignes.forEach((l, i) => {
      // Les notes appelées sur cette ligne doivent tenir sur la page : sinon la ligne passe à la page suivante.
      const notesLigne = l.filter(w => w.sup);
      const hN = notesLigne.reduce((s, w) => s + hauteurNote(w.note), 0);
      if (y + taille * ESP * PT > H - MB - espaceNotes(hNotesPage + hN)) saut();
      const lh = taille * ESP * PT;
      notesLigne.forEach(w => notesPage.push({ num: w.t, texte: w.note }));
      hNotesPage += hN;
      const x0 = ML + opt.retrait + gauche(i), dispo = LARG - opt.retrait - gauche(i);
      const somme = l.reduce((n, w) => n + w.l, 0);
      const extra = opt.justifie && i < lignes.length - 1 && l.length > 1 ? (dispo - somme) / (l.length - 1) : 0;
      let x = x0;
      l.forEach(w => {
        if (w.sup) { police(false, false); doc.setFontSize(taille * 0.6); doc.text(w.t, x, y + lh * 0.7 - 1.2); }
        else { police(gras || w.gras, w.ital); doc.setFontSize(taille); doc.text(w.t, x, y + lh * 0.7); }
        x += w.l + sp + extra;
      });
      y += lh;
    });
    y += opt.apres || 0;
  };

  doc.addPage();
  (m.blocs || []).forEach(b => {
    if (b.type === "titre1") paragraphe(b.texte, 16, true, { retrait: 0, premiere: 0, suite: 0, avant: 6, apres: 3, justifie: false });
    else if (b.type === "titre2") paragraphe(b.texte, 14, true, { retrait: 0, premiere: 0, suite: 0, avant: 4, apres: 2, justifie: false });
    else if (b.type === "citation") paragraphe(b.texte, 12, false, { retrait: 15, premiere: 0, suite: 0, justifie: true, apres: 2 });
    else if (b.type === "reference") paragraphe(b.texte, 12, false, { retrait: 0, premiere: 0, suite: 12.5, justifie: true, apres: 2 });
    else paragraphe(b.texte, 12, false, { retrait: 0, premiere: 12.5, suite: 0, justifie: true, apres: 2 });
  });
  dessinerNotes();

  // Pied de page sur toutes les pages sauf la couverture ; numéro de page = rang de la page (couverture = 1)
  const total = doc.getNumberOfPages();
  for (let p = 2; p <= total; p++) {
    doc.setPage(p); police(false, false); doc.setFontSize(9);
    doc.text(memTexteArrierePlan() + " – Page " + p, W / 2, H - 14, { align: "center", maxWidth: LARG });
  }
  doc.save(memNomFichier("pdf"));
}

// DOCX ou ODT : fabriqué par le serveur, téléchargé ici.
async function memExporter(format) {
  try {
    const r = await enCours("Préparation du fichier…", () => api("memoire_export", { groupe_id: MEM.gid, format }));
    const octets = Uint8Array.from(atob(r.contenu), c => c.charCodeAt(0));
    telecharger(new Blob([octets], { type: r.type }), r.nom);
  } catch (e) { if (e.code === "unauthorized") sessionError(e); else alert("Export impossible : " + e.message); }
}
