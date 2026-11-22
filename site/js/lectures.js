/* Mes lectures, traduction des mots-clés, aperçu APA, doublons, brouillon.
   Script classique : partage la portée globale avec les autres fichiers de js/ (ordre de chargement : voir index.html). */
"use strict";
/* ---------- Mes lectures ---------- */

const cleTitre = s => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
// Plusieurs métiers possibles dans « Qualité de l’auteur » : virgule, point-virgule, « / », « & », « + », « et » ou retour à la ligne.
// Un même métier écrit deux fois pour une lecture (casse, accents) n'est compté qu'une fois.
const metiersListe = txt => {
  const vus = new Set();
  return String(txt || "").split(/\s*(?:[,;\n/&+]|\s+et\s+)\s*/i).map(x => x.trim()).filter(x => {
    const k = cleTitre(x);
    if (!k || vus.has(k)) return false;
    vus.add(k); return true;
  });
};
const motsListe = txt => String(txt || "").split(/[,;\n]+/).map(x => x.trim()).filter(Boolean);
let forceStatut = "", focusAvant = null, scrollAvant = 0;

function field(id, label, val, opts = {}) {
  const req = opts.req ? '<span class="req"> *</span>' : "";
  if (opts.area) return `<div><label for="${id}">${label}</label><textarea id="${id}" maxlength="2500">${esc(val)}</textarea></div>`;
  if (opts.sel) return `<div><label for="${id}">${label}${req}</label><select id="${id}" ${opts.dis || ""}><option value="">— choisir —</option>${opts.sel.map(o => `<option ${o === val ? "selected" : ""}>${esc(o)}</option>`).join("")}</select></div>`;
  return `<div><label for="${id}">${label}${req}</label><input id="${id}" type="${opts.type || "text"}" maxlength="500" value="${esc(val)}" ${opts.dis || ""} ${opts.ph ? `placeholder="${opts.ph}"` : ""}></div>`;
}

// ---------- Auteurs de la lecture : chacun avec ses nationalités et ses métiers (la lecture et les autres auteurs ne les partagent pas) ----------
let auteursForm = [];   // liste en cours de saisie : [{nom, nation, qualite}]

// Auteurs d'une lecture ; sans liste enregistrée, les auteurs du champ auteur (anciennes lectures).
function auteursDe(i) {
  let l = [];
  try { l = JSON.parse((i && i.auteurs) || "[]") || []; } catch (e) { l = []; }
  if (Array.isArray(l) && l.length) return l.map(a => ({ nom: String(a.nom || ""), nation: String(a.nation || ""), qualite: String(a.qualite || "") }));
  return i && i.auteur ? LydiaApa.listeAuteurs(i.auteur).map(nom => ({ nom, nation: String(i.nation || ""), qualite: String(i.qualite || "") })) : [];
}
// Auteurs pour l'affichage (aperçu, PDF, tableau) : chacun avec son métier et sa nationalité, en caractères sûrs pour le PDF.
const auteurTexte = a => (a.nom || "-") + " (métier : " + (a.qualite || "-") + " ; nationalité : " + (a.nation || "-") + ")";
function auteursLignes(i) {
  const l = auteursDe(i);
  if (!l.length) return ["Auteur : -"];
  return l.length === 1 ? ["Auteur : " + auteurTexte(l[0])] : ["Auteurs :", ...l.map(a => "  - " + auteurTexte(a))];
}
// Lignes renseignées (les lignes vides ne sont pas envoyées).
const auteursPropres = () => auteursForm.map(a => ({ nom: (a.nom || "").trim(), nation: (a.nation || "").trim(), qualite: (a.qualite || "").trim() }))
  .filter(a => a.nom || a.nation || a.qualite);
// Champs dérivés (auteur, nation, qualite de la lecture), calculés comme côté serveur.
function auteursDerives(liste) {
  const uniques = cle => { const vues = []; liste.forEach(a => String(a[cle] || "").split(",").map(s => s.trim()).filter(Boolean).forEach(m => { if (!vues.some(x => x.toLowerCase() === m.toLowerCase())) vues.push(m); })); return vues.join(", "); };
  return { auteur: liste.map(a => a.nom).filter(Boolean).join("; "), nation: uniques("nation"), qualite: uniques("qualite") };
}
function auteursFormHtml(dis) {
  const lignes = auteursForm.map((a, k) => `<div class="grid" style="grid-template-columns:2fr 1.2fr 1.5fr auto;gap:8px;align-items:end;margin-bottom:6px">
      <div><label for="af_nom_${k}">Auteur ${k + 1}</label><input id="af_nom_${k}" data-ak="${k}" data-af="nom" maxlength="300" value="${esc(a.nom)}" placeholder="Nom, Prénom" ${dis}></div>
      <div><label for="af_nation_${k}">Nationalité(s)</label><input id="af_nation_${k}" data-ak="${k}" data-af="nation" maxlength="300" value="${esc(a.nation)}" placeholder="française, belge" ${dis}></div>
      <div><label for="af_qualite_${k}">Métier(s)</label><input id="af_qualite_${k}" data-ak="${k}" data-af="qualite" maxlength="300" value="${esc(a.qualite)}" placeholder="IDE, cadre de santé" ${dis}></div>
      ${dis ? "" : `<button type="button" class="btn sm sec del" data-afdel="${k}" aria-label="Retirer cet auteur">✕</button>`}</div>`).join("");
  return `<div class="meta" style="margin-bottom:4px">Auteur(s) <span class="req" style="color:#d33">*</span> · nationalités et métiers propres à chaque auteur (séparés par des virgules)</div>`
    + (lignes || '<div class="meta">Aucun auteur pour l’instant.</div>')
    + (dis ? "" : `<button type="button" class="btn sm sec" id="afadd">＋ Ajouter un auteur</button>`);
}
function rafraichirAuteurs() {
  const bloc = $("auteursbloc");
  if (bloc) bloc.innerHTML = auteursFormHtml(bloc.querySelector("[disabled]") ? "disabled" : "");
}
// Saisie et boutons de la liste des auteurs (délégation : la liste est redessinée à l'ajout ou à la suppression).
document.addEventListener("input", e => {
  const t = e.target;
  if (t.dataset && t.dataset.af && t.dataset.ak !== undefined && auteursForm[Number(t.dataset.ak)]) {
    auteursForm[Number(t.dataset.ak)][t.dataset.af] = t.value;
    if (typeof majApercu === "function") majApercu();
  }
});
document.addEventListener("click", e => {
  const b = e.target.closest && e.target.closest("button"); if (!b) return;
  if (b.id === "afadd") { auteursForm.push({ nom: "", nation: "", qualite: "" }); rafraichirAuteurs(); }
  else if (b.dataset.afdel !== undefined) { auteursForm.splice(Number(b.dataset.afdel), 1); rafraichirAuteurs(); }
});

function renderForm() {
  if (!canWrite()) return;
  const d = editing ? itemsAll.find(i => i.id === editing) || {} : {};
  const art = artCible || modeArticle ? itemsAll.find(i => i.article_id === (artCible || modeArticle)) : null;
  const base = editing ? d : art || {};
  auteursForm = auteursDe(base);
  const gc = groupeCourant();
  // La partie commune de l'article est figée dans une fiche (ajout ou modification) ; seuls les champs encore vides restent saisissables.
  // Pour la corriger : bouton « Corriger l’article » (correction directe ou proposition soumise à la promo).
  const objDesact = k => (artCible && String(art && art[k] || "").trim()) || (editing && String(d[k] || "").trim()) ? "disabled" : "";
  $("ftitle").textContent = modeArticle ? "Corriger l’article" : artCible ? "Ajouter ma fiche de lecture" : editing ? "Modifier ma fiche de lecture" : "Ajouter une lecture";
  $("fnote").textContent = modeArticle
    ? "La partie objective (identification, références) est commune à toute la promo : votre correction sera proposée, puis appliquée quand 3 étudiants de la promo l’auront approuvée (vous comptez pour un)."
    : artCible
      ? "Cet article existe déjà dans la base de la promo : sa partie objective est commune. Ajoutez votre propre fiche de lecture (colonnes 2 à 8) ; elle sera partagée avec la promo dès qu’elle sera « Terminée »."
      : editing && !forceStatut
      ? "La partie commune de l’article (première partie) est figée ici : pour la corriger, utilisez le bouton « Corriger l’article » (elle peut alors être proposée à la promo). Les champs encore vides restent modifiables."
      : forceStatut
      ? "Pour passer cette lecture à « Terminée », complétez d’abord les champs obligatoires de la première partie."
      : "Choisissez « 📌 À lire » pour la file d’attente, ou « 📖 En cours de lecture » si vous n’avez pas fini : seul le titre est alors obligatoire. Pour une lecture « ✅ Terminée », toute la première partie est obligatoire.";
  const statut = forceStatut || (editing ? d.statut : "") || "En cours";
  $("form").innerHTML = `
  <div id="draftnote" class="meta" style="display:none;margin-bottom:10px"></div>
  ${!editing && !artCible && !modeArticle ? `<div class="doibox"><div class="doihead"><span class="doiico" aria-hidden="true">✨</span><div><b>Gagnez du temps : préremplissez avec le DOI</b><div class="meta">Collez le DOI (ou le lien doi.org) de l’article : le titre, les auteurs, l’année, la revue, le volume, le numéro et les pages sont remplis pour vous. À vérifier avant d’enregistrer.</div></div></div>
    <div class="grow"><input id="f_doipre" type="text" maxlength="300" autocomplete="off" placeholder="ex. 10.1016/j.ijnurstu.2020.103601 ou https://doi.org/…" aria-label="DOI de l’article"><button type="button" class="btn" id="doibtn">Préremplir</button></div>
    <div id="doimsg" class="meta" role="status" aria-live="polite">La qualité de l’auteur et la nationalité restent à compléter. Pas de DOI (rapport, thèse, article de presse) ? Saisissez la fiche à la main.</div></div>` : ""}
  <details class="sec" open><summary>Colonne 1 · Identification de l’article <span class="req" style="color:#d33">(obligatoire)</span></summary>
   <div style="margin-bottom:12px;${modeArticle ? "display:none" : ""}"><label for="f_statut">Statut</label><select id="f_statut">
     <option value="Terminée" ${statut === "Terminée" ? "selected" : ""}>✅ Terminée</option>
     <option value="En cours" ${statut === "En cours" ? "selected" : ""}>📖 En cours de lecture</option>
     <option value="À lire" ${statut === "À lire" ? "selected" : ""}>📌 À lire (file d’attente)</option></select></div>
   <div id="prioblk" style="margin-bottom:12px;${statut === "À lire" && !modeArticle ? "" : "display:none"}"><label for="f_priorite">Priorité</label><select id="f_priorite">${Object.keys(PRIO).map(k => `<option value="${k}" ${(editing ? d.priorite || "normale" : "normale") === k ? "selected" : ""}>${esc(PRIO[k])}</option>`).join("")}</select>
    <div class="meta">Votre file d’attente est personnelle : vous seul(e) voyez les documents « À lire ».</div></div>
   <div class="grid">
    ${field("f_titre", "Titre de l’article", base.titre, { dis: objDesact("titre"), req: 1 })}
    ${field("f_parution", "Date de parution", fmtD(base.parution), { dis: objDesact("parution"), req: 1, ph: "2021, mars 2021 ou 04/03/2021" })}
    <div style="grid-column:1/-1" id="auteursbloc">${auteursFormHtml(objDesact("auteurs"))}</div>
    ${field("f_type", "Type d’article", base.type, { dis: objDesact("type"), req: 1, sel: TYPES })}
   </div>
   <div id="dup" style="display:none;margin-top:10px;color:#b45309;font-weight:600"></div></details>
  ${modeArticle ? "" : `<details class="sec" open><summary>Partage</summary>
   <div class="meta">Cette fiche de lecture est rattachée au groupe <b>${esc(editing ? (d.groupe || "") : gc ? gc.nom : "")}</b>. <b>En cours</b> : seul votre groupe la voit. <b>Terminée</b> : elle est partagée automatiquement avec toute la promo, qui peut la commenter ; les commentaires du groupe restent réservés au groupe.</div>
  </details>`}
  <details class="sec" open><summary>Compléments pour la référence APA (facultatifs, mais recommandés pour les articles)</summary>
   <div class="grid">
    ${field("f_source", "Revue / éditeur / établissement", base.source, { dis: objDesact("source"), ph: "revue de l’article, éditeur du rapport, université de la thèse" })}
    ${field("f_volume", "Volume", d.volume)}
    ${field("f_numero", "Numéro", d.numero)}
    ${field("f_pages", "Pages", base.pages, { dis: objDesact("pages"), ph: "ex. 12-25" })}
    ${field("f_doi", "DOI ou URL", base.doi, { dis: objDesact("doi"), ph: "10.xxxx/xxxxx ou https://…" })}
    ${field("f_lien", "Lien vers la fiche ou l’article", base.lien, { dis: objDesact("lien"), ph: "https://… (cliquable dans le tableau commun)" })}
   </div>
   <div id="apaprev" class="meta" style="margin-top:12px;padding:10px 12px;border:1px dashed var(--bd);border-radius:8px"></div>
  </details>
  ${(formFich = !modeArticle && (editing ? d.mine : true) ? { k: editing ? d.article_id : artCible || "", differe: !editing } : null) ? `<details class="sec" open><summary>Document joint (facultatif)</summary><div id="fichform">${fichiersFormHtml()}</div></details>` : ""}
  ${modeArticle ? "" : `<p class="note rgpdnote" role="note">🩺 <b>Ne saisissez jamais d’information permettant d’identifier un patient</b> (nom, âge précis, service, date, situation reconnaissable) : ces fiches sont lisibles de votre groupe et, une fois terminées, de toute la promo.</p><details class="sec" open><summary>Colonnes 2 à 8 · Libres (à remplir comme vous voulez, modifiable à tout moment)</summary>
   <div class="grid">
    ${field("f_mots", "Mots-clés", d.mots, { area: 1 })}
    <div><label for="f_kw">Mots-clés en anglais</label><textarea id="f_kw" maxlength="2500">${esc(d.kw)}</textarea>
     <div class="tr"><button type="button" class="btn sm sec" id="trad">🌐 Traduire les mots-clés français</button><span id="tradmsg" class="meta"></span></div>
     <div id="tradres" aria-live="polite"></div></div>
    ${field("f_concepts", "Concepts en sciences infirmières développés", d.concepts, { area: 1 })}
    ${field("f_objet", "Objet / sujet principal du texte", d.objet, { area: 1 })}
    ${field("f_opinion", "Opinion de l’auteur", d.opinion, { area: 1 })}
    ${field("f_controverse", "Controverse", d.controverse, { area: 1 })}
    ${field("f_libre", "Colonne libre", d.libre, { area: 1 })}
   </div></details>`}
  <div class="savebar"><div id="ferr" class="err" role="alert"></div>
   <button class="btn" id="save" type="button">${modeArticle ? "Proposer la correction" : editing ? "Enregistrer les modifications" : artCible ? "Enregistrer ma fiche de lecture" : "Enregistrer la lecture"}</button>
   <button class="btn sec" id="cancel" type="button">Annuler</button></div>`;
  $("save").onclick = save;
  if ($("trad")) $("trad").onclick = traduire;
  $("cancel").onclick = () => { effacerBrouillon(); closeDrawer(true); };
  formBase = JSON.stringify(snapshot());
  restaurerBrouillon();
  $("form").oninput = $("form").onchange = surSaisie;
  $("form").onclick = e => {
    const b = e.target.closest("[data-fu],[data-fo],[data-fx],[data-fr]"); if (!b) return;
    if (b.dataset.fr) { fichierAttente = null; majFichiersForm(); } else if (b.dataset.fu) choisirFichier(b.dataset.fu); else if (b.dataset.fo) ouvrirFichier(b.dataset.fo); else supprimerFichierCli(b.dataset.fx);
  };
  majApercu(); majDoublon();
}

function openForm() {
  if (!canWrite()) return;
  focusAvant = document.activeElement;
  scrollAvant = window.scrollY;
  fichierAttente = null;
  renderForm();
  $("drawer").classList.remove("hidden");
  document.body.classList.add("formmode");          // page à part : le reste de l'interface est masqué
  window.scrollTo(0, 0);
  const f = $("f_titre"); if (f) f.focus();
}

function closeDrawer(sansBrouillon) {
  if ($("drawer").classList.contains("hidden")) return;
  if (!sansBrouillon && $("f_titre")) { clearTimeout(brouillonTimer); sauverBrouillon(); }
  $("drawer").classList.add("hidden");
  document.body.classList.remove("formmode");
  editing = null; artCible = ""; modeArticle = false; forceStatut = ""; fichierAttente = null; formFich = null;
  window.scrollTo(0, scrollAvant);
  if (focusAvant && focusAvant.focus) { try { focusAvant.focus({ preventScroll: true }); } catch (e) { /* ignoré */ } }
}
$("drawerclose").onclick = () => closeDrawer();
document.addEventListener("keydown", e => {
  if (e.key !== "Escape") return;
  const ouvert = document.querySelector("details.colmenu[open]");
  if (ouvert) ouvert.removeAttribute("open"); else if (jeuOuvert) fermerJeu(); else if ($("jeuchoix") && !$("jeuchoix").classList.contains("hidden")) fermerChoixJeu(); else if (N.ouvert) fermerNotes(); else if (HI.ouvert) fermerHistorique(); else if (FB.ouvert) fermerFeedback(); else if (cmId) fermerDiscussion(); else if (GM.ouvert) fermerGroupe(); else closeDrawer();
});
$("addbtn").onclick = () => { editing = null; artCible = ""; modeArticle = false; forceStatut = ""; openForm(); };

/* ---------- Traduction des mots-clés ---------- */

const ICONE_FIAB = { haute: "🟢", moyenne: "🟠", faible: "🔴" };
const LIBELLE_FIAB = { haute: "fiable", moyenne: "à vérifier", faible: "douteux" };

async function traduire() {
  const msg = $("tradmsg");
  const src = $("f_mots").value.trim();
  if (!src) { msg.textContent = "Saisissez d’abord les mots-clés en français."; return; }
  if ($("f_kw").value.trim() && !confirm("Le champ anglais contient déjà du texte. Le remplacer par la traduction ?")) return;
  $("trad").disabled = true;
  msg.textContent = "⏳ Traduction…";
  try {
    const r = await api("translate", { texte: src });
    $("f_kw").value = r.items.map(i => i.en).filter(Boolean).join(", ");
    $("tradres").innerHTML = r.items.map(i =>
      `<span class="fiab fiab-${esc(i.niveau)}" title="${esc(i.raison)}">${ICONE_FIAB[i.niveau] || ""} ${esc(i.fr)} → ${esc(i.en)} <span class="meta">(${LIBELLE_FIAB[i.niveau] || ""})</span></span>`).join("")
      + '<div class="legende">🟢 fiable · 🟠 à vérifier · 🔴 douteux. Indice automatique fondé sur le glossaire et sur la retraduction en français : ce n’est pas une garantie, relisez les termes importants (survolez une pastille pour le détail).</div>';
    msg.textContent = r.avertissement ? "⚠️ " + r.avertissement : "";
    msg.classList.toggle("err", !!r.avertissement);
    planifierBrouillon();
  } catch (e) {
    if (e.code === "unauthorized") sessionError(e);
    msg.textContent = "Traduction impossible : " + e.message;
  } finally { if ($("trad")) $("trad").disabled = false; }
}

/* ---------- Aperçu APA, doublons, brouillon ---------- */

const CHAMPS_FORM = ["statut", "titre", "parution", "auteur", "qualite", "nation", "type", "source", "volume", "numero",
  "pages", "doi", "lien", "mots", "kw", "concepts", "objet", "opinion", "controverse", "libre", "priorite"];
let formBase = "", brouillonTimer = null;

const snapshot = () => ({ ...Object.fromEntries(CHAMPS_FORM.map(k => [k, $("f_" + k) ? $("f_" + k).value : ""])), ...auteursDerives(auteursPropres()), auteurs: auteursPropres() });

function lireForm() {
  const v = snapshot();
  Object.keys(v).forEach(k => { if (typeof v[k] === "string") v[k] = v[k].trim(); });
  // « www.exemple.fr/page » collé sans le début : on ajoute https://
  if (v.lien && !/^[a-z][a-z0-9+.-]*:/i.test(v.lien) && /^[^\s/]+\.[^\s/]{2,}(\/\S*)?$/.test(v.lien)) v.lien = "https://" + v.lien;
  const norm = LydiaApa.normaliserDate(v.parution);
  return { data: { ...v, parution: norm === null ? v.parution : norm }, dateOk: norm !== null };
}

function majApercu() {
  const box = $("apaprev");
  if (!box) return;
  const { data, dateOk } = lireForm();
  if (!data.titre) { box.innerHTML = "📚 La référence APA apparaîtra ici au fil de la saisie."; return; }
  const r = LydiaApa.apa(data);
  box.innerHTML = `<b>Aperçu APA</b><br><span style="color:var(--tx)">${r.html}</span>`
    + (data.parution && !dateOk ? '<br><span style="color:#b45309">⚠ Date non reconnue (ex. 2021, mars 2021, 04/03/2021)</span>' : "")
    + (r.incomplet ? '<br>⚠ À compléter : revue et pages' : "")
    + (!data.auteur ? '<br>⚠ Sans auteur, le titre passe en tête de la référence' : "");
}

const cleDoi = s => {
  const t = String(s || "").trim().toLowerCase().replace(/^doi:\s*/, "").replace(/^https?:\/\/(dx\.)?doi\.org\//, "");
  return /^10\.\d{4,9}\//.test(t) ? t : "";
};

function majDoublon() {
  const box = $("dup");
  if (!box) return;
  const { data } = lireForm();
  const t = cleTitre(data.titre), d = cleDoi(data.doi);
  const cur = editing ? (itemsAll.find(i => i.id === editing) || {}).article_id : artCible || modeArticle;
  const autre = (t.length >= 8 || d) ? itemsAll.find(i => i.article_id !== cur && ((d && cleDoi(i.doi) === d) || (t.length >= 8 && cleTitre(i.titre) === t))) : null;
  if (!autre) { box.style.display = "none"; return; }
  const peutAjouter = !editing && !artCible && !modeArticle && !autre.mine && autre.article_modifiable
    && !itemsAll.some(i => i.mine && i.article_id === autre.article_id);
  box.innerHTML = autre.mine
    ? "⚠ Vous avez déjà saisi cet article : modifiez plutôt votre fiche de lecture."
    : `⚠ Cet article est déjà dans la base de la promo (déjà analysé par ${esc(autre.etudiant)}).`
      + (peutAjouter ? ' <button type="button" class="btn sm" id="dupuse">Ajouter ma fiche de lecture à cet article</button>' : "");
  box.style.display = "block";
  if ($("dupuse")) $("dupuse").onclick = () => basculerAnalyse(autre.article_id);
}

const cleBrouillon = () => "lydia_brouillon:" + (me ? me.prenom : "") + ":" + (editing || (modeArticle ? "art:" + modeArticle : artCible ? "an:" + artCible : "new"));
function effacerBrouillon() { clearTimeout(brouillonTimer); try { localStorage.removeItem(cleBrouillon()); } catch (e) { /* ignoré */ } }

function sauverBrouillon() {
  try {
    const cur = JSON.stringify(snapshot());
    if (cur === formBase) localStorage.removeItem(cleBrouillon());
    else localStorage.setItem(cleBrouillon(), JSON.stringify({ t: Date.now(), v: snapshot() }));
  } catch (e) { /* stockage indisponible : le brouillon est simplement désactivé */ }
}

function planifierBrouillon() { clearTimeout(brouillonTimer); brouillonTimer = setTimeout(sauverBrouillon, 600); }

function restaurerBrouillon() {
  let b = null;
  try { b = JSON.parse(localStorage.getItem(cleBrouillon()) || "null"); } catch (e) { b = null; }
  if (!b || !b.v || Date.now() - b.t > 30 * 864e5) return;
  CHAMPS_FORM.forEach(k => { if ($("f_" + k) && !$("f_" + k).disabled && b.v[k] !== undefined) $("f_" + k).value = b.v[k]; });
  if (Array.isArray(b.v.auteurs) && b.v.auteurs.length) { auteursForm = b.v.auteurs.map(a => ({ nom: String(a.nom || ""), nation: String(a.nation || ""), qualite: String(a.qualite || "") })); rafraichirAuteurs(); }
  const note = $("draftnote");
  note.innerHTML = `📝 Brouillon non enregistré restauré (${esc(fmtDT(new Date(b.t).toISOString()))}). <button type="button" class="btn sm sec" id="draftreset">Repartir de zéro</button>`;
  note.style.display = "block";
  $("draftreset").onclick = () => { effacerBrouillon(); renderForm(); };
}

function surSaisie(e) {
  if (e && e.target && e.target.id === "f_kw" && $("tradres")) $("tradres").innerHTML = "";   // les pastilles ne décrivent plus le texte
  if (e && e.target && e.target.id === "f_statut" && $("prioblk")) $("prioblk").style.display = e.target.value === "À lire" ? "" : "none";
  majApercu(); majDoublon();
  planifierBrouillon();
}

// Bascule le formulaire de « nouvel article » vers « ma fiche de lecture sur cet article », en gardant ce qui est déjà saisi.
function basculerAnalyse(articleId) {
  const garde = snapshot();
  effacerBrouillon();
  artCible = articleId;
  renderForm();
  ["statut", "mots", "kw", "concepts", "objet", "opinion", "controverse", "libre", "priorite"].forEach(k => { if ($("f_" + k) && garde[k]) $("f_" + k).value = garde[k]; });
  if ($("prioblk")) $("prioblk").style.display = $("f_statut") && $("f_statut").value === "À lire" ? "" : "none";
  majApercu(); majDoublon();
}

const OBJ = ["titre", "parution", "auteurs", "type", "source", "volume", "numero", "pages", "doi", "lien"];
// Auteurs de la lecture d'origine, pour savoir si la partie commune a changé.
const auteursChangent = (orig, data) => JSON.stringify(auteursDe(orig || {}).map(a => [a.nom, a.nation, a.qualite])) !== JSON.stringify((data.auteurs || []).map(a => [a.nom, a.nation, a.qualite]));

async function save() {
  clearTimeout(brouillonTimer);
  const { data, dateOk } = lireForm();
  if (!dateOk) { $("ferr").textContent = "Date de parution non reconnue (exemples : 2021, mars 2021, 04/03/2021)"; return; }
  const orig = editing ? itemsAll.find(i => i.id === editing) : null;
  const need = (modeArticle ? itemsAll.some(i => i.article_id === modeArticle && i.statut === "Terminée") ? FIN : ["titre"]
    : data.statut !== "Terminée" ? ["titre"] : FIN);
  const miss = need.filter(k => !data[k]);
  if (miss.length) { $("ferr").textContent = "À compléter : " + miss.map(k => LAB[k]).join(", "); return; }
  if (data.statut === "Terminée" && data.auteurs.some(a => !a.nom || !a.nation || !a.qualite)) {
    $("ferr").textContent = "À compléter pour chaque auteur : nom, nationalité et métier"; return;
  }
  $("save").disabled = true;
  try {
    const artId = modeArticle || (orig && orig.article_id);
    const origArt = orig || itemsAll.find(i => i.article_id === artId) || {};
    const objChange = !!artId && (auteursChangent(origArt, data) || OBJ.some(k => k !== "auteurs" && String(origArt[k] || "") !== data[k]));
    const jointe = !editing && !modeArticle ? fichierAttente : null, avant = new Set(itemsAll.map(i => i.id));
    const res = await enCours("Enregistrement…", () => modeArticle
      ? api("article_update", { article_id: modeArticle, data: Object.fromEntries(OBJ.map(k => [k, data[k]])) })
      : editing
        ? api("update", { id: editing, data })
        : artCible
          ? api("add", { data: { ...data, article_id: artCible } })
          : api("add", { data: { ...data, groupe_id: (groupeCourant() || {}).id } }));
    effacerBrouillon();
    closeDrawer(true);
    applyResult(res);
    if (data.statut === "Terminée" && !modeArticle && !(orig && orig.statut === "Terminée")) fete();
    if (jointe) await joindreApresCreation(res, jointe, avant);
    if (objChange && (res.propositions || []).some(p => p.mine && p.article_id === artId)) {
      alert("Votre correction de l’article est proposée à la promo : elle sera appliquée quand 3 étudiants (vous compris) l’auront approuvée.");
    }
  } catch (e) {
    $("ferr").textContent = "Enregistrement impossible : " + e.message;
    if (e.code === "duplicate" && e.extra && e.extra.article_id) {
      const lec = (e.extra.lecteurs || []).map(x => `${esc(x.prenom)} (${esc(stInfo(x.statut).lib.toLowerCase())})`).join(", ");
      $("ferr").innerHTML = esc(e.message) + (lec ? ` <span class="meta">Déjà dans les fiches de : ${lec}.</span>` : "") + ' <button type="button" class="btn sm" id="dupgo">Ajouter ma fiche de lecture à cet article</button>';
      $("dupgo").onclick = () => basculerAnalyse(e.extra.article_id);
    }
    if (e.code === "unauthorized") sessionError(e);
    $("save").disabled = false;
  }
}

// Envoie le fichier choisi pendant la création, maintenant que la fiche (donc son article) existe.
async function joindreApresCreation(res, jointe, avant) {
  const nouvelle = (res.lectures || []).find(l => l.mine && !avant.has(l.id));
  if (!nouvelle) return alert("Fiche enregistrée, mais le fichier n’a pas pu être joint : rouvrez la fiche pour l’ajouter.");
  try { applyResult(await enCours("Envoi du fichier…", () => api("file_add", { article_id: nouvelle.article_id, nom: jointe.nom, data: jointe.data }))); }
  catch (e) {
    if (e.code === "unauthorized") return sessionError(e);
    alert("Fiche enregistrée, mais le fichier n’a pas pu être joint (" + e.message + "). Rouvrez la fiche pour le rajouter.");
  }
}

async function del(id) {
  if (!confirm("Supprimer cette lecture et ses commentaires ?")) return;
  try { applyResult(await enCours("Suppression…", () => api("delete", { id }))); }
  catch (e) { alert("Suppression impossible : " + e.message); }
}

function startEdit(id, ov, statut) {
  const it = itemsAll.find(i => i.id === id);
  if (!it) return;
  editing = id; artCible = ""; modeArticle = false; forceStatut = statut || "";
  openForm();
}

function startAnalyse(articleId) { editing = null; artCible = articleId; modeArticle = false; forceStatut = ""; openForm(); }
function startCorrection(articleId) { editing = null; artCible = ""; modeArticle = articleId; forceStatut = ""; openForm(); }

// « Terminée » en un clic quand tous les champs obligatoires sont déjà remplis ; sinon on ouvre le formulaire.
async function marquerTerminee(id) {
  const it = itemsAll.find(x => x.id === id);
  if (!it) return;
  if (FIN.some(k => !String(it[k] || "").trim())) { startEdit(id, false, "Terminée"); return; }
  const data = Object.fromEntries(CHAMPS_FORM.map(k => [k, String(it[k] || "")]));
  data.statut = "Terminée";
  try { applyResult(await enCours("Enregistrement…", () => api("update", { id, data }))); fete(); }
  catch (e) { if (e.code === "unauthorized") sessionError(e); else alert("Enregistrement impossible : " + e.message); }
}

// Modification rapide (statut, priorité) d'une de mes lectures, sans ouvrir le formulaire.
async function majRapide(id, patch) {
  const it = itemsAll.find(x => x.id === id);
  if (!it) return;
  const data = { ...Object.fromEntries(CHAMPS_FORM.map(k => [k, String(it[k] || "")])), ...patch };
  const termine = patch.statut === "Terminée" && it.statut !== "Terminée";
  try { applyResult(await enCours("Enregistrement…", () => api("update", { id, data }))); if (termine) fete(); }
  catch (e) { if (e.code === "unauthorized") sessionError(e); else alert("Enregistrement impossible : " + e.message); }
}
// Réserver un document déjà présent dans la promo (sans ouvrir de formulaire).
async function mettreALire(articleId) {
  try { applyResult(await enCours("Enregistrement…", () => api("add", { data: { article_id: articleId, statut: "À lire", priorite: "normale" } }))); }
  catch (e) { if (e.code === "unauthorized") sessionError(e); else alert("Enregistrement impossible : " + e.message); }
}

function renderMine() {
  if (!canWrite()) return;
  const g = groupeCourant();
  const mine = itemsAll.filter(i => i.mine && g && i.groupe_id === g.id);
  const lire = mine.filter(i => i.statut === "À lire").sort((a, b) => (ORDRE_PRIO[a.priorite] ?? 1) - (ORDRE_PRIO[b.priorite] ?? 1) || String(a.ajoute).localeCompare(b.ajoute));
  const enc = mine.filter(i => i.statut === "En cours").sort((a, b) => String(b.ajoute).localeCompare(a.ajoute));
  const fin = mine.filter(i => i.statut === "Terminée").sort((a, b) => String(b.ajoute).localeCompare(a.ajoute));
  $("mysum").textContent = mine.length ? `${mine.length} lecture${mine.length > 1 ? "s" : ""} · ${lire.length} à lire · ${enc.length} en cours · ${fin.length} terminée${fin.length > 1 ? "s" : ""}` : "";
  if (!mine.length) { $("mylist").innerHTML = '<div class="empty">Aucune lecture pour l’instant.<br>Cliquez sur « ＋ Ajouter une lecture » pour saisir la première, ou mettez un document de côté avec le statut « 📌 À lire ».</div>'; return; }
  const ligne = i => {
    const prio = i.statut === "À lire" ? `<select class="prio-sel" data-prio="${esc(i.id)}" aria-label="Priorité de ${esc(i.titre)}">${Object.keys(PRIO).map(k => `<option value="${k}" ${(i.priorite || "normale") === k ? "selected" : ""}>${esc(PRIO[k])}</option>`).join("")}</select> ` : "";
    const act = i.statut === "À lire" ? `<button class="btn sm" data-start="${esc(i.id)}">▶ Commencer</button> `
      : i.statut === "En cours" ? `<button class="btn sm" data-done="${esc(i.id)}">✅ Marquer terminée</button> ` : "";
    return `<div class="card" style="border-left:6px solid ${esc(i.couleur)};padding:10px 14px"><div class="tools" style="justify-content:space-between"><div><span class="badge ${stInfo(i.statut).cl}" style="--c:${esc(i.couleur)}">${stInfo(i.statut).ico} ${stInfo(i.statut).lib}</span> <b>${esc(i.titre)}</b> <span class="meta">· saisi le ${esc(fmtD(i.ajoute))}${i.modifie_par ? ` · modifié par ${esc(i.modifie_par)}` : ""}</span></div><div>${prio}${act}<button class="btn sm sec" data-ap="${esc(i.id)}" title="Aperçu de la fiche, puis impression ou enregistrement en PDF">👁 Aperçu</button> <button class="btn sm sec" data-e="${esc(i.id)}">Modifier</button> <button class="btn sm sec" data-hist="lecture:${esc(i.id)}" title="Versions précédentes">🕘</button> <button class="btn sm sec del" data-d="${esc(i.id)}">Supprimer</button></div></div></div>`;
  };
  const section = (titre, l, note) => l.length ? `<h3 class="mysec">${titre} <span class="meta">${l.length}${note ? " · " + note : ""}</span></h3>${l.map(ligne).join("")}` : "";
  $("mylist").innerHTML = section("📌 File d’attente", lire, "triée par priorité ; visible de votre groupe") + section("📖 En cours", enc) + section("✅ Terminées", fin);
  $("mylist").querySelectorAll("[data-ap]").forEach(b => b.onclick = () => ouvrirCompteRendu(b.dataset.ap, "fiche"));
  $("mylist").querySelectorAll("[data-e]").forEach(b => b.onclick = () => startEdit(b.dataset.e, false));
  $("mylist").querySelectorAll("[data-d]").forEach(b => b.onclick = () => del(b.dataset.d));
  $("mylist").querySelectorAll("[data-done]").forEach(b => b.onclick = () => marquerTerminee(b.dataset.done));
  $("mylist").querySelectorAll("[data-start]").forEach(b => b.onclick = () => majRapide(b.dataset.start, { statut: "En cours", priorite: "" }));
  $("mylist").querySelectorAll("[data-prio]").forEach(x => x.onchange = () => majRapide(x.dataset.prio, { priorite: x.value }));
  $("mylist").querySelectorAll("[data-hist]").forEach(b => b.onclick = () => { const [k, id] = b.dataset.hist.split(":"); ouvrirHistorique(k, id); });
}

/* ---------- Préremplissage par DOI (Crossref, via le serveur) ---------- */
const CHAMPS_DOI = { titre: "f_titre", parution: "f_parution", auteur: "f_auteur", source: "f_source", volume: "f_volume", numero: "f_numero", pages: "f_pages", doi: "f_doi", type: "f_type" };
async function prerempliDoi() {
  const saisie = $("f_doipre").value.trim(), msg = $("doimsg"), btn = $("doibtn");
  if (!saisie) { msg.textContent = "Collez d’abord un DOI."; msg.classList.add("err"); return; }
  btn.disabled = true; msg.classList.remove("err"); msg.textContent = "Recherche en cours…";
  try {
    const r = await api("doi_lookup", { doi: saisie });
    const remplis = [], gardes = [];
    // Les auteurs trouvés remplissent la liste, seulement si elle est vide (rien n'est écrasé).
    if (r.champs && r.champs.auteur && !auteursPropres().length && !$("auteursbloc")?.querySelector("[disabled]")) {
      auteursForm = LydiaApa.listeAuteurs(String(r.champs.auteur)).map(nom => ({ nom, nation: "", qualite: "" }));
      rafraichirAuteurs(); remplis.push("auteur");
    }
    Object.entries(r.champs || {}).forEach(([k, v]) => {
      if (k === "auteur") return;
      const el = $(CHAMPS_DOI[k]); if (!el || el.disabled) return;
      if (String(el.value || "").trim() && el.value !== v) { gardes.push(k); return; }   // ce qui est déjà saisi n'est jamais écrasé
      el.value = v; remplis.push(k);
    });
    $("form").dispatchEvent(new Event("input", { bubbles: true }));
    if (typeof majApercu === "function") majApercu();
    if (typeof majDoublon === "function") majDoublon();
    msg.textContent = remplis.length
      ? `✅ ${remplis.length} champ${remplis.length > 1 ? "s" : ""} prérempli${remplis.length > 1 ? "s" : ""} (source : Crossref). Vérifiez-les, puis complétez la qualité de l’auteur et la nationalité.${gardes.length ? ` ${gardes.length} champ${gardes.length > 1 ? "s" : ""} déjà saisi${gardes.length > 1 ? "s" : ""} conservé${gardes.length > 1 ? "s" : ""}.` : ""}`
      : "Rien à remplir : les champs concernés sont déjà saisis.";
    const suite = document.querySelector('[data-af="qualite"]'); if (suite && !suite.value) suite.focus();
  } catch (e) {
    if (e.code === "unauthorized") return sessionError(e);
    msg.textContent = e.message || "Préremplissage impossible"; msg.classList.add("err");
  } finally { btn.disabled = false; }
}
document.addEventListener("click", e => { if (e.target.closest("#doibtn")) prerempliDoi(); });
document.addEventListener("keydown", e => { if (e.key === "Enter" && e.target && e.target.id === "f_doipre") { e.preventDefault(); prerempliDoi(); } });
