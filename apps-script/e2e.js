#!/usr/bin/env node
/* Test de bout en bout sur l'Apps Script réellement déployé.
 *
 * Usage :  node apps-script/e2e.js [URL_DU_WEBAPP] [JETON]
 *   - URL_DU_WEBAPP : par défaut, CFG.API_URL lu dans config.js
 *   - JETON : jeton de connexion Google (sessionStorage « lydia_token » de la page ouverte et connectée),
 *             ou variable d'environnement LYDIA_TOKEN. Il expire au bout d'environ une heure.
 *
 * Le script s'exécute avec TON compte : il lit les données (init, list, notes) puis crée, modifie et supprime
 * une note personnelle « [e2e] … » (privée, supprimée en fin de test, même en cas d'échec). Il ne touche ni aux
 * lectures, ni aux commentaires, ni aux groupes. Nécessite Node 18 ou plus (fetch intégré).
 */
"use strict";
const fs = require("fs"), path = require("path");

let url = process.argv[2], token = process.argv[3] || process.env.LYDIA_TOKEN;
if (!url || !/^https?:/.test(url)) {
  token = token || url;
  try { url = (fs.readFileSync(path.join(__dirname, "..", "config.js"), "utf8").match(/API_URL\s*:\s*["']([^"']+)["']/) || [])[1]; } catch (e) { /* ignoré */ }
}
if (!url || !token) { console.error("Usage : node apps-script/e2e.js [URL_DU_WEBAPP] <JETON>   (voir l'en-tête du fichier)"); process.exit(2); }

let nb = 0, echecs = 0;
async function api(action, payload = {}) {
  const t0 = Date.now();
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "text/plain;charset=utf-8" }, body: JSON.stringify({ action, token, ...payload }), redirect: "follow" });
  const j = await res.json();
  j._ms = Date.now() - t0;
  return j;
}
async function etape(nom, fn) {
  nb++;
  try { const ms = await fn(); console.log("ok   - " + nom + (ms ? " (" + ms + " ms)" : "")); }
  catch (e) { echecs++; console.log("ÉCHEC - " + nom + " : " + (e && e.message || e)); }
}
const verif = (cond, msg) => { if (!cond) throw new Error(msg); };

(async () => {
  const titre = "[e2e] " + new Date().toISOString();
  let noteId = "";
  await etape("init : connexion, profil et données", async () => {
    const j = await api("init");
    verif(j.ok, "réponse : " + (j.message || j.error));
    verif(j.me && j.me.prenom && j.me.role, "profil manquant");
    for (const k of ["lectures", "commentaires", "groupes", "utilisateurs", "lus"]) verif(Array.isArray(j[k]), "section absente : " + k);
    console.log("       connecté : " + j.me.prenom + " (" + j.me.role + "), " + j.lectures.length + " lectures, " + j.groupes.length + " groupe(s)");
    return j._ms;
  });
  await etape("list : même forme que init, réponse complète (non partielle)", async () => {
    const j = await api("list");
    verif(j.ok && !j.partiel && Array.isArray(j.lectures) && Array.isArray(j.groupes), "réponse incomplète");
    return j._ms;
  });
  await etape("jeton invalide refusé", async () => {
    const res = await fetch(url, { method: "POST", headers: { "Content-Type": "text/plain;charset=utf-8" }, body: JSON.stringify({ action: "list", token: "invalide" }) });
    const j = await res.json();
    verif(j.ok === false && j.error === "unauthorized", "attendu unauthorized, reçu " + JSON.stringify(j).slice(0, 80));
  });
  await etape("notes_list : liste de mes notes", async () => {
    const j = await api("notes_list");
    verif(j.ok && Array.isArray(j.notes), "notes absentes");
    return j._ms;
  });
  try {
    await etape("note_save : création (titre, date, texte, étiquettes, épingle)", async () => {
      const j = await api("note_save", { data: { id: "", titre, date: new Date().toISOString().slice(0, 10), texte: "Test automatique, supprimé en fin de test.", liens: [], etiquettes: ["e2e", "test"], epingle: true } });
      verif(j.ok, "refusé : " + (j.message || j.error));
      const n = j.notes.find(x => x.titre === titre);
      verif(n && n.id, "note non retrouvée");
      verif(n.epingle === true && n.etiquettes.join() === "e2e,test", "étiquettes / épingle non conservées");
      noteId = n.id;
      return j._ms;
    });
    await etape("note_save : modification", async () => {
      const j = await api("note_save", { data: { id: noteId, titre, date: new Date().toISOString().slice(0, 10), texte: "Texte modifié", liens: [], etiquettes: ["e2e"], epingle: false } });
      verif(j.ok, "refusé : " + (j.message || j.error));
      const n = j.notes.find(x => x.id === noteId);
      verif(n && n.texte === "Texte modifié" && n.epingle === false && n.etiquettes.join() === "e2e", "modification non enregistrée");
      return j._ms;
    });
    await etape("note_save : titre vide refusé", async () => {
      const j = await api("note_save", { data: { id: "", titre: "", date: "2026-01-01", texte: "x", liens: [] } });
      verif(j.ok === false, "aurait dû être refusé");
    });
  } finally {
    if (noteId) await etape("note_delete : suppression de la note de test", async () => {
      const j = await api("note_delete", { id: noteId });
      verif(j.ok && !j.notes.some(x => x.id === noteId), "note encore présente");
      return j._ms;
    });
  }
  await etape("comments_read : réponse partielle (commentaires + lus seulement)", async () => {
    const j = await api("comments_read", { ids: [] });
    verif(j.ok, "refusé : " + (j.message || j.error));
    verif(j.partiel === true && Array.isArray(j.commentaires) && Array.isArray(j.lus) && j.lectures === undefined, "réponse non partielle (serveur pas à jour ?)");
    return j._ms;
  });
  console.log("\n" + (nb - echecs) + "/" + nb + " étapes réussies" + (echecs ? " — " + echecs + " échec(s)" : ""));
  process.exit(echecs ? 1 : 0);
})().catch(e => { console.error("Erreur inattendue :", e.message); process.exit(1); });
