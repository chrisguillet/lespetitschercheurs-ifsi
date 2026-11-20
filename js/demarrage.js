/* Démarrage.
   Script classique : partage la portée globale avec les autres fichiers de js/ (ordre de chargement : voir index.html). */
"use strict";
/* ---------- Démarrage ---------- */

function renderAll() {
  renderMe();
  renderCtx();
  $("tabs").classList.remove("hidden");
  majOnglets();
  setTab(tab);
  if (canWrite()) renderMine();
  renderPending();
  renderComments();
  renderOnline();
  renderFilters();
  renderTable();
  majBarres();
  etape("chat", majChat);
}

renderMeAnonyme();
initGoogle();
