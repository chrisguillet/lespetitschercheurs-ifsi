/* Chat de groupe et de promo : bouton en bas à droite, replié par défaut.
   Script classique : partage la portée globale avec les autres fichiers de js/ (ordre de chargement : voir index.html).
   Limites appliquées par le serveur (Code.gs) : 4 messages par minute glissante, 500 caractères, 1000 messages par groupe et 5000 par promo, 7 jours. */
"use strict";

const CH = { ouvert: false, canal: "groupe", gid: "", msgs: [], total: 0, limite: 100, nouveaux: { groupe: 0, promo: 0 }, libreA: 0, err: "", envoi: false, tic: 0, creeA: false };
const CHAT_MAX_CAR = 500, CHAT_SONDE_OUVERT = 15, CHAT_SONDE_FERME = 60;
const EMOJIS = ["😀", "😃", "😄", "😁", "😅", "😂", "🤣", "🙂", "😉", "😊", "😍", "🥰", "😘", "😎", "🤔", "😬", "😴", "😢", "😭", "😡", "😮", "🙄", "🥳", "🤗",
  "👍", "👎", "👏", "🙌", "🙏", "💪", "👋", "🤝", "✌️", "👌", "❤️", "💙", "💜", "💚", "🔥", "✨", "🎉", "⭐", "✅", "❓", "💡", "📚", "📖", "📝", "☕", "🍀", "🌞", "🩺", "💉", "🏥"];

// Fonctionnalité masquée par défaut : on l'active avec « CHAT_ACTIF: true » dans config.js (le serveur, lui, répond toujours aux actions chat_*).
const chatActif = () => !!(CFG && CFG.CHAT_ACTIF);
const chatGroupe = () => (me && chatActif() ? groupeCourant() : null);
const chatCleVu = t => { const g = chatGroupe(); return g ? "lydia_chat_vu:" + (t === "promo" ? "p:" + g.etablissement + "|" + g.promo : "g:" + g.id) : ""; };
const chatVu = () => { const o = {}; ["groupe", "promo"].forEach(t => { try { o[t] = localStorage.getItem(chatCleVu(t)) || ""; } catch (e) { o[t] = ""; } }); return o; };
function chatMarquerVu() {
  const d = CH.msgs.length ? CH.msgs[CH.msgs.length - 1].date : "";
  if (d) { try { localStorage.setItem(chatCleVu(CH.canal), d); } catch (e) { /* ignoré */ } }
  CH.nouveaux[CH.canal] = 0;
}
const chatHeure = iso => {
  const d = new Date(iso), p = n => String(n).padStart(2, "0"), hm = p(d.getHours()) + ":" + p(d.getMinutes());
  return d.toDateString() === new Date().toDateString() ? hm : p(d.getDate()) + "/" + p(d.getMonth() + 1) + " " + hm;
};

function creerChat() {
  if (CH.creeA || !document.body) return;
  CH.creeA = true;
  const r = document.createElement("div");
  r.id = "chat"; r.className = "hidden";
  r.innerHTML = `<button type="button" id="chatbtn" class="chatbtn" aria-expanded="false" aria-controls="chatpanel">💬 Chat<span id="chatbadge" class="chatbadge hidden"></span></button>
  <section id="chatpanel" class="chatpanel hidden" role="dialog" aria-label="Chat">
    <header class="chhead"><div class="chtabs" role="tablist"><button type="button" role="tab" data-ct="groupe">👥 Groupe<i class="chdot hidden"></i></button><button type="button" role="tab" data-ct="promo">🌐 Promo<i class="chdot hidden"></i></button></div><button type="button" id="chatclose" class="btn sm sec" aria-label="Replier le chat">✕</button></header>
    <div id="chsub" class="meta chsub"></div>
    <div id="chlist" class="chlist" role="log" aria-live="polite"></div>
    <div id="chemoji" class="chemoji hidden">${EMOJIS.map(e => `<button type="button" data-em="${e}" aria-label="${e}">${e}</button>`).join("")}</div>
    <div id="cherr" class="meta cherr" role="alert"></div>
    <form id="chform" class="chform"><button type="button" id="chemo" class="btn sm sec" aria-label="Insérer un smiley" aria-expanded="false">😀</button><textarea id="chtxt" rows="2" maxlength="${CHAT_MAX_CAR}" placeholder="Votre message…" aria-label="Votre message"></textarea><button type="submit" id="chsend" class="btn sm">Envoyer</button></form>
    <div class="meta chnote" id="chnote"></div>
  </section>`;
  document.body.appendChild(r);
  $("chatbtn").onclick = () => (CH.ouvert ? fermerChat() : ouvrirChat());
  $("chatclose").onclick = () => fermerChat();
  r.querySelectorAll("[data-ct]").forEach(b => b.onclick = () => chatCanal(b.dataset.ct));
  $("chemo").onclick = () => { const o = $("chemoji").classList.toggle("hidden") === false; $("chemo").setAttribute("aria-expanded", String(o)); };
  $("chemoji").onclick = e => {
    const b = e.target.closest("[data-em]"); if (!b) return;
    const t = $("chtxt"), a = t.selectionStart ?? t.value.length, z = t.selectionEnd ?? a;
    if (t.value.length + b.dataset.em.length > CHAT_MAX_CAR) return;
    t.value = t.value.slice(0, a) + b.dataset.em + t.value.slice(z); t.focus(); t.selectionStart = t.selectionEnd = a + b.dataset.em.length; chatMajEnvoi();
  };
  $("chtxt").addEventListener("input", chatMajEnvoi);
  $("chtxt").addEventListener("keydown", e => { if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); $("chform").requestSubmit ? $("chform").requestSubmit() : chatEnvoyer(); } });
  $("chform").addEventListener("submit", e => { e.preventDefault(); chatEnvoyer(); });
  $("chlist").addEventListener("click", e => {
    const b = e.target.closest("button"); if (!b) return;
    if (b.dataset.chdel) chatSupprimer(b.dataset.chdel);
    else if (b.dataset.chplus !== undefined) { CH.limite = Math.min(CH.limite + 100, CH.canal === "promo" ? 5000 : 1000); chatCharger(); }
  });
  r.addEventListener("keydown", e => { if (e.key === "Escape" && CH.ouvert) { fermerChat(); $("chatbtn").focus(); } });
  setInterval(chatTic, 1000);
}

const chatCorps = extra => Object.assign({ type: CH.canal, groupe_id: CH.gid, limite: CH.limite, vu: chatVu() }, extra || {});

function chatCharger() {
  const g = chatGroupe(); if (!g) return Promise.resolve();
  const canal = CH.canal, gid = g.id;
  return api("chat_list", chatCorps({ groupe_id: gid })).then(j => chatRecu(j, canal, gid)).catch(e => {
    if (e.code === "forbidden" && canal === "promo") chatCanal("groupe");
    else if (e.code === "unauthorized") { /* la session est gérée par l'actualisation principale */ }
    else if (CH.ouvert) { CH.err = e.message || "Chat indisponible"; chatRendu(); }
  });
}
function chatRecu(j, canal, gid) {
  if (!j || !j.ok || canal !== CH.canal || gid !== CH.gid) return;   // réponse périmée : salon ou groupe changé entre-temps
  const bas = chatEnBas();
  CH.msgs = j.messages || []; CH.total = j.total || 0; CH.nouveaux = j.nouveaux || { groupe: 0, promo: 0 };
  CH.libreA = Date.now() + (j.restant || 0) * 1000; CH.err = "";
  if (CH.ouvert) chatMarquerVu();
  chatRendu(bas);
}
const chatEnBas = () => { const l = $("chlist"); return !l || l.scrollHeight - l.scrollTop - l.clientHeight < 40; };

function chatRendu(bas) {
  if (!$("chat")) return;
  const nb = CH.nouveaux.groupe + CH.nouveaux.promo, b = $("chatbadge");
  b.textContent = nb > 9 ? "9+" : String(nb); b.classList.toggle("hidden", !nb || CH.ouvert);
  $("chat").querySelectorAll("[data-ct]").forEach(t => {
    const on = t.dataset.ct === CH.canal; t.classList.toggle("on", on); t.setAttribute("aria-selected", String(on));
    t.querySelector(".chdot").classList.toggle("hidden", on || !CH.nouveaux[t.dataset.ct]);
  });
  if (!CH.ouvert) return;
  const g = chatGroupe();
  $("chsub").textContent = g ? (CH.canal === "promo" ? `${g.etablissement} · ${g.promo} : toute la promo` : `${g.nom} : votre groupe`) : "";
  const l = $("chlist"), jeune = !CH.msgs.length;
  l.innerHTML = (CH.total > CH.msgs.length ? `<button type="button" class="btn sm sec chplus" data-chplus>↑ Messages plus anciens (${CH.total - CH.msgs.length})</button>` : "")
    + (jeune ? '<div class="meta chvide">Aucun message pour le moment. Dites bonjour 👋</div>' : CH.msgs.map(m =>
      `<div class="chmsg ${m.moi ? "moi" : ""}"><div class="chmeta"><b style="color:${esc(m.couleur)}">${esc(m.auteur)}</b> <span>${esc(chatHeure(m.date))}</span>${m.moi || (me && me.role === "admin") ? `<button type="button" class="chdel" data-chdel="${esc(m.id)}" aria-label="Retirer ce message" title="Retirer ce message">✕</button>` : ""}</div><div class="chtxt">${esc(m.texte)}</div></div>`).join(""));
  if (bas !== false) l.scrollTop = l.scrollHeight;
  $("cherr").textContent = CH.err;
  $("chnote").textContent = "4 messages par minute · 500 caractères · conservés 7 jours (1000 messages au plus par groupe, 5000 par promo)";
  chatMajEnvoi();
}
function chatMajEnvoi() {
  const b = $("chsend"); if (!b) return;
  const reste = Math.ceil((CH.libreA - Date.now()) / 1000), vide = !$("chtxt").value.trim();
  b.disabled = CH.envoi || vide || reste > 0;
  b.textContent = reste > 0 ? `Envoyer (${reste} s)` : "Envoyer";
}

function ouvrirChat() {
  creerChat();
  CH.ouvert = true; $("chatpanel").classList.remove("hidden"); $("chatbtn").setAttribute("aria-expanded", "true"); $("chatbtn").classList.add("hidden");
  chatMarquerVu(); chatRendu(); chatCharger(); $("chtxt").focus();
}
function fermerChat(tout) {
  if (!$("chat")) return;
  CH.ouvert = false; $("chatpanel").classList.add("hidden"); $("chatbtn").setAttribute("aria-expanded", "false"); $("chatbtn").classList.remove("hidden");
  $("chemoji").classList.add("hidden");
  if (tout) { CH.msgs = []; CH.total = 0; CH.gid = ""; CH.nouveaux = { groupe: 0, promo: 0 }; CH.libreA = 0; CH.err = ""; CH.limite = 100; CH.canal = "groupe"; $("chtxt").value = ""; $("chat").classList.add("hidden"); }
  else chatRendu();
}
function chatCanal(c) {
  if (c === CH.canal) return;
  CH.canal = c; CH.msgs = []; CH.total = 0; CH.limite = 100; CH.err = "";
  chatRendu(); chatCharger();
}

async function chatEnvoyer() {
  const t = $("chtxt").value.trim(); if (!t || CH.envoi || Date.now() < CH.libreA) return;
  CH.envoi = true; chatMajEnvoi();
  const canal = CH.canal, gid = CH.gid;
  try {
    const j = await api("chat_send", chatCorps({ texte: t, limite: 100 }));
    $("chtxt").value = ""; $("chemoji").classList.add("hidden"); $("chemo").setAttribute("aria-expanded", "false");
    CH.limite = 100; chatRecu(j, canal, gid);
  } catch (e) {
    CH.err = e.message || "Envoi impossible";
    if (e.code === "rate") { const m = /(\d+) s/.exec(e.message || ""); CH.libreA = Date.now() + (m ? +m[1] : 120) * 1000; }
    $("cherr").textContent = CH.err;
  } finally { CH.envoi = false; chatMajEnvoi(); }
}
async function chatSupprimer(id) {
  try { const canal = CH.canal, gid = CH.gid; chatRecu(await api("chat_delete", chatCorps({ id })), canal, gid); }
  catch (e) { CH.err = e.message || "Suppression impossible"; chatRendu(); }
}

// Appelée à chaque mise à jour des données : affiche ou masque le bouton, et repart de zéro si l'on change de groupe.
function majChat() {
  const g = chatGroupe();
  if (!g) { if ($("chat")) fermerChat(true); return; }
  creerChat();
  $("chat").classList.remove("hidden");
  if (CH.gid !== g.id) {
    CH.gid = g.id; CH.msgs = []; CH.total = 0; CH.limite = 100; CH.nouveaux = { groupe: 0, promo: 0 }; CH.libreA = 0; CH.err = "";
    chatRendu(); chatCharger();
  }
}
// Sondage : toutes les 15 s panneau ouvert, toutes les 60 s replié (pour la pastille de nouveaux messages) ; rien quand l'onglet est caché.
function chatTic() {
  if (!me || !chatGroupe() || !CH.gid) return;
  if (CH.ouvert) chatMajEnvoi();
  if (document.hidden) return;
  CH.tic++;
  if (CH.tic >= (CH.ouvert ? CHAT_SONDE_OUVERT : CHAT_SONDE_FERME)) { CH.tic = 0; chatCharger(); }
}
