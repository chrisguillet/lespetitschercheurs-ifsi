/* Historique des versions d'un article ou de sa fiche.
   Script classique : partage la portée globale avec les autres fichiers de js/ (ordre de chargement : voir index.html). */
"use strict";
/* ---------- Historique des versions d'un article ou de sa propre fiche ---------- */

const HI = { ouvert: false, kind: "", id: "", liste: null, focus: null };
const LIB_HIST = { ...CHAMP_LIB, statut: "statut", mots: "mots-clés", kw: "keywords", concepts: "concepts", objet: "objet / sujet", opinion: "opinion de l’auteur", controverse: "controverse", libre: "colonne libre", priorite: "priorité" };
const coupe = (t, n) => { t = String(t || ""); return t.length > n ? t.slice(0, n) + "…" : t; };

function ouvrirHistorique(kind, id) {
  if (!$("hmodal")) return;
  HI.ouvert = true; HI.kind = kind; HI.id = id; HI.liste = null; HI.focus = document.activeElement;
  $("hmodal").classList.remove("hidden"); document.body.classList.add("modalopen");
  $("htitle").textContent = kind === "article" ? "🕘 Historique de l’article" : "🕘 Historique de ma fiche de lecture";
  renderHistorique();
  api("history_get", { kind, id }).then(r => { if (!HI.ouvert || HI.id !== id) return; HI.liste = r.historique || []; renderHistorique(); })
    .catch(e => { if (e.code === "unauthorized") sessionError(e); else if (HI.ouvert) $("hbody").innerHTML = `<div class="err">Chargement impossible : ${esc(e.message)}</div>`; });
}
function fermerHistorique() {
  if (!$("hmodal")) return;
  HI.ouvert = false;
  $("hmodal").classList.add("hidden"); $("hbody").innerHTML = "";
  if (!cmId && !GM.ouvert && !FB.ouvert) document.body.classList.remove("modalopen");
  if (HI.focus && HI.focus.isConnected && HI.focus.focus) { try { HI.focus.focus({ preventScroll: true }); } catch (e) { /* ignoré */ } }
}
function peutRestaurer() {
  if (!canWrite()) return false;
  if (HI.kind === "lecture") { const it = itemsAll.find(x => x.id === HI.id); return !!it && it.mine && it.modifiable; }
  const it = itemsAll.find(x => x.article_id === HI.id);
  return !!it && !!it.article_modifiable;
}
function renderHistorique() {
  const box = $("hbody");
  if (HI.liste === null) { box.innerHTML = '<div class="meta">Chargement…</div>'; return; }
  if (!HI.liste.length) { box.innerHTML = '<div class="empty">Aucune modification enregistrée pour l’instant.</div>'; return; }
  const peut = peutRestaurer();
  const note = HI.kind === "article" && peut ? '<div class="meta" style="margin-bottom:8px">Restaurer une version d’un article est une correction comme une autre : elle est appliquée tout de suite si vous en êtes le créateur isolé, sinon proposée à la promo (3 approbations).</div>' : "";
  box.innerHTML = note + HI.liste.map((h, n) => `<div class="hrow"><div><b>${esc(h.par || "?")}</b> <span class="meta">· ${esc(fmtDT(h.date))}</span></div>
    ${h.champs.map(c => `<div class="hdiff"><span class="meta">${esc(LIB_HIST[c.k] || c.k)}</span> <span class="hav">${esc(coupe(c.avant, 160)) || "—"}</span> <span class="meta">→</span> <span class="hap">${esc(coupe(c.apres, 160)) || "—"}</span></div>`).join("")}
    ${peut ? `<button type="button" class="btn sm sec" data-hr="${n}">↩ Revenir à la version d’avant cette modification</button>` : ""}</div>`).join("");
  box.querySelectorAll("[data-hr]").forEach(b => b.onclick = () => restaurerVersion(HI.liste[+b.dataset.hr]));
}
async function restaurerVersion(h) {
  if (!h || !confirm("Revenir à cette version ? Votre restauration sera elle-même notée dans l’historique.")) return;
  const kind = HI.kind, id = HI.id;
  try {
    const res = await enCours("Restauration…", () => kind === "article"
      ? api("article_update", { article_id: id, data: h.valeurs })
      : api("update", { id, data: h.valeurs }));
    applyResult(res);
    if (kind === "article" && (res.propositions || []).some(p => p.mine && p.article_id === id)) alert("Votre correction est proposée à la promo : elle sera appliquée quand 3 étudiants (vous compris) l’auront approuvée.");
    ouvrirHistorique(kind, id);
  } catch (e) { if (e.code === "unauthorized") sessionError(e); else alert("Restauration impossible : " + e.message); }
}
if ($("hclose")) $("hclose").onclick = () => fermerHistorique();
if ($("hmodal")) $("hmodal").addEventListener("mousedown", e => { if (e.target === $("hmodal")) fermerHistorique(); });
