/* Mémoire partagé par le groupe : éditeur structuré (titres, paragraphes, citations, références APA), aperçu et contrôle des normes.
   Mise en forme saisie avec des marques simples : **gras** et *italique*. Script classique : portée globale partagée avec js/.
   Normes de la maquette « Consignes de rédaction et de présentation d’un travail écrit » (IFSI Saint-Nazaire). */
"use strict";
/* ---------- Mémoire ---------- */

const MEM = { gid: "", data: null, chargement: false, msg: "" };
const MEM_TYPES = { titre1: "Titre de chapitre", titre2: "Sous-titre", paragraphe: "Paragraphe", citation: "Citation", reference: "Référence APA" };
// Marges de la maquette, en cm : gauche (reliure), droite, haut, bas.
const MEM_MARGES = { g: 3, d: 2.5, h: 2.5, b: 3 };

// Texte saisi (marques **gras** et *italique*) -> HTML sûr pour l'aperçu.
function memInline(texte) {
  return esc(texte || "").replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>").replace(/\*([^*]+)\*/g, "<i>$1</i>");
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
        <div class="meta">Le mémoire est partagé par le groupe : chaque bloc garde l’auteur de sa dernière modification. Mise en forme : <b>**gras**</b>, <i>*italique*</i>.</div>
        <div class="memen">
          <div><label for="mem_titre">Titre du travail</label><input id="mem_titre" maxlength="200" value="${esc(m.titre)}" ${ecrit ? "" : "disabled"}></div>
          <div><label for="mem_ue">UE et intitulé</label><input id="mem_ue" maxlength="200" value="${esc(m.ue)}" ${ecrit ? "" : "disabled"}></div>
          <div><label for="mem_ref">Référent pédagogique</label><input id="mem_ref" maxlength="120" value="${esc(m.referent)}" ${ecrit ? "" : "disabled"}></div>
          <div style="grid-column:1/-1"><label for="mem_auteurs">Auteur(s) de la couverture <span class="meta">(NOM – Prénom, séparés par ;)</span></label><input id="mem_auteurs" maxlength="300" value="${esc(m.auteurs)}" placeholder="ex. Dupont – Ana ; Martin – Ben" ${ecrit ? "" : "disabled"}></div>
          <div><label for="mem_date">Date de rendu</label><input id="mem_date" type="date" value="${esc(m.date_rendu)}" ${ecrit ? "" : "disabled"}></div>
        </div>
        <div id="mem_msg" class="meta" role="status">${esc(MEM.msg)}</div>
      </div>
      ${ecrit ? `<div class="card memajout"><b>Ajouter :</b>
        ${["titre1", "titre2", "paragraphe", "citation"].map(t => `<button type="button" class="btn sm sec" data-mem-new="${t}">＋ ${esc(MEM_TYPES[t])}</button>`).join(" ")}
        ${refs.length ? `<button type="button" class="btn sm sec" id="mem_refbtn">＋ Référence APA</button>` : ""}
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
  const corps = m.blocs.map(b => {
    const t = memInline(b.texte);
    if (b.type === "titre1") return `<h2 class="mh1">${t}</h2>`;
    if (b.type === "titre2") return `<h3 class="mh2">${t}</h3>`;
    if (b.type === "citation") return `<blockquote class="mcit">${t}</blockquote>`;
    if (b.type === "reference") return `<p class="mref">${t}</p>`;
    return `<p class="mpar">${t}</p>`;
  }).join("");
  // L'aperçu montre une seule feuille de contenu : la pagination exacte se fait à l'export.
  return memCouvertureHtml() + `<section class="memcontenu">${corps || '<p class="meta">Le contenu apparaîtra ici.</p>'}${memPiedHtml(2)}</section>`;
}

// Contrôles automatiques : ce qui se vérifie sur le contenu. Les marges, la police et l’interligne sont fixés par la feuille d’aperçu.
function memControleHtml() {
  const m = MEM.data;
  const mots = m.blocs.reduce((n, b) => n + (b.texte.trim() ? b.texte.trim().split(/\s+/).length : 0), 0);
  const ok = (c, txt) => `<li class="${c ? "okk" : "ko"}">${c ? "✅" : "⚠️"} ${esc(txt)}</li>`;
  const titres = m.blocs.filter(b => b.type === "titre1").length;
  const vides = m.blocs.filter(b => !b.texte.trim()).length;
  return `<ul class="memcheck">
    ${ok(!!m.titre, "Titre du travail renseigné")}
    ${ok(!!m.ue, "UE et intitulé renseignés")}
    ${ok(!!m.referent, "Référent pédagogique renseigné")}
    ${ok(!!m.auteurs, "Auteur(s) de la couverture renseigné(s)")}
    ${ok(!!m.date_rendu, "Date de rendu renseignée")}
    ${ok(titres > 0, "Au moins un titre de chapitre")}
    ${ok(vides === 0, vides ? vides + " bloc(s) vide(s) à compléter ou supprimer" : "Aucun bloc vide")}
    ${ok(m.blocs.some(b => b.type === "reference"), "Références bibliographiques ajoutées (APA 7e)")}
    <li class="info">📝 ${mots} mot${mots > 1 ? "s" : ""}</li>
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

$("memoirebox")?.addEventListener("click", e => {
  const b = e.target.closest("button"); if (!b) return;
  if (b.id === "mem_refbtn") { $("mem_refs").classList.toggle("hidden"); return; }
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
