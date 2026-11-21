/* Fichiers joints aux documents.
   Script classique : partage la portée globale avec les autres fichiers de js/ (ordre de chargement : voir index.html). */
"use strict";
// Fichiers joints (PDF, images) à un document : partage interne à but pédagogique.
const FICHIER_MAX = 5 * 1024 * 1024;
const AVERT_DROIT = "Droit d’auteur : ces fichiers restent un partage INTERNE, à but PÉDAGOGIQUE, réservé aux personnes de l’outil. Ne déposez que des documents que vous avez le droit de partager dans ce cadre, et ne les diffusez pas en dehors.";
const fichiersDe = k => fichiers.filter(f => f.article_id === k);
const fmtTaille = o => o < 1048576 ? Math.max(1, Math.round(o / 1024)) + " Ko" : (o / 1048576).toFixed(1).replace(".", ",") + " Mo";
const chipFichier = (f, avecSuppr) => `<span class="chip fichier"><button type="button" class="lnk" data-fo="${esc(f.id)}" title="Ouvrir dans un nouvel onglet">${f.type === "application/pdf" ? "📄" : "🖼️"} ${esc(f.nom)}</button> <span class="meta">${esc(fmtTaille(f.taille))} · ${esc(f.par)}</span>${avecSuppr && f.supprimable ? ` <button type="button" class="btn sm sec del" style="padding:0 6px" data-fx="${esc(f.id)}" aria-label="Supprimer ${esc(f.nom)}">✕</button>` : ""}</span>`;
// Tableau commun : consultation seulement (l'ajout et la suppression se font dans l'édition de sa fiche).
function fichiersHtml(i) {
  const l = fichiersDe(cleArt(i));
  return l.length ? `<div class="fichiers">${l.map(f => chipFichier(f, false)).join(" ")}</div>` : "";
}
// Formulaire de ma fiche : un seul fichier par document. En modification, le dépôt est immédiat ;
// à la création, le fichier choisi est gardé en mémoire et envoyé juste après l'enregistrement de la fiche.
let fichierAttente = null;   // { nom, data, taille } choisi avant l'enregistrement d'une nouvelle fiche
let formFich = null;         // { k: article, differe: bool } de la section affichée
function fichiersFormHtml() {
  const { k, differe } = formFich, l = k ? fichiersDe(k) : [];
  const pret = differe && fichierAttente;
  const puces = l.map(f => chipFichier(f, true)).join(" ")
    + (pret ? `<span class="chip fichier">📄 ${esc(fichierAttente.nom)} <span class="meta">${esc(fmtTaille(fichierAttente.taille))} · sera joint à l’enregistrement</span> <button type="button" class="btn sm sec del" style="padding:0 6px" data-fr="1" aria-label="Retirer le fichier">✕</button></span>` : "");
  const libre = !l.length && !pret;
  return `<div class="fichiers">${puces}${libre ? `<button type="button" class="btn sm sec" data-fu="${esc(k)}">📎 Ajouter un fichier</button>` : ""}</div>
    <div class="meta">Un fichier par document (PDF, PNG ou JPEG, 5 Mo maximum), partagé avec la promo. Partage interne à but pédagogique (droit d’auteur) : ne déposez que ce que vous avez le droit de partager dans ce cadre.${l.length ? " Pour le remplacer, supprimez-le d’abord." : ""}</div>`;
}
function majFichiersForm() { const z = $("fichform"); if (z && formFich) z.innerHTML = fichiersFormHtml(); }

let fupCible = "";   // article du fichier en cours d’ajout (formulaire de la fiche)
async function ouvrirFichier(id) {
  const fen = window.open("", "_blank");          // ouverte tout de suite : sinon le navigateur bloque la fenêtre
  try { if (fen) { fen.document.title = "Chargement…"; fen.document.body.innerHTML = '<p style="font:16px system-ui,sans-serif;margin:2em;color:#444">⏳ Chargement du fichier…</p>'; } } catch (_) {}
  try {
    const r = await enCours("Ouverture du fichier…", () => api("file_get", { id }));
    const bin = atob(r.data), o = new Uint8Array(bin.length);
    for (let n = 0; n < bin.length; n++) o[n] = bin.charCodeAt(n);
    const url = URL.createObjectURL(new Blob([o], { type: r.type }));
    if (fen) fen.location.href = url; else window.open(url, "_blank");
    setTimeout(() => URL.revokeObjectURL(url), 120000);
  } catch (e) {
    if (fen) fen.close();
    if (e.code === "unauthorized") sessionError(e); else alert("Ouverture impossible : " + e.message);
  }
}
function choisirFichier(k) {
  if (!confirm(AVERT_DROIT + "\n\nContinuer ?")) return;
  fupCible = k; $("fup").value = ""; $("fup").click();
}
async function envoyerFichier(file) {
  if (!file) return;
  const type = (file.type || "").toLowerCase(), nom = file.name || "";
  if (!/^(application\/pdf|image\/png|image\/jpeg)$/.test(type) && !/\.(pdf|png|jpe?g)$/i.test(nom)) return alert("Format non accepté : PDF, PNG ou JPEG uniquement.");
  if (file.size > FICHIER_MAX) return alert(`Fichier trop volumineux (${fmtTaille(file.size)}) : 5 Mo maximum.`);
  const data = await new Promise((ok, ko) => { const r = new FileReader(); r.onload = () => ok(String(r.result).split(",")[1] || ""); r.onerror = () => ko(new Error("Lecture du fichier impossible")); r.readAsDataURL(file); }).catch(e => { alert(e.message); return ""; });
  if (!data) return;
  if (formFich && formFich.differe) { fichierAttente = { nom, data, taille: file.size }; majFichiersForm(); return; }
  try { applyResult(await enCours("Envoi du fichier…", () => api("file_add", { article_id: fupCible, nom, data }))); majFichiersForm(); }
  catch (e) { if (e.code === "unauthorized") sessionError(e); else alert("Envoi impossible : " + e.message); }
}
async function supprimerFichierCli(id) {
  const f = fichiers.find(x => x.id === id);
  if (f) fupCible = f.article_id;
  if (!f || !confirm(`Supprimer le fichier « ${f.nom} » ?`)) return;
  try { applyResult(await enCours("Suppression…", () => api("file_delete", { id }))); majFichiersForm(); }
  catch (e) { if (e.code === "unauthorized") sessionError(e); else alert("Suppression impossible : " + e.message); }
}
