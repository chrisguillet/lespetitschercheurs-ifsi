/* Pause ludique : deux mini-jeux (canvas, sans dépendance), ouverts dans une fenêtre.
   Réservés pour l'instant à l'administrateur (voir le menu du compte dans app.js).
   Chaque jeu expose : init(), action(bas) [saut / battement], bas(état) [se baisser], step(dt), draw(ctx). */
(function (root) {
  "use strict";
  const W = 640, H = 260;

  const chevauche = (a, b, marge) => {
    const m = marge || 0;
    return a.x + m < b.x + b.w - m && a.x + a.w - m > b.x + m && a.y + m < b.y + b.h - m && a.y + a.h - m > b.y + m;
  };
  const alea = (a, b) => a + Math.random() * (b - a);
  const record = (cle, v) => {
    try {
      const k = "lydia_jeu_" + cle, cur = +(localStorage.getItem(k) || 0);
      if (v === undefined) return cur;
      if (v > cur) localStorage.setItem(k, String(v));
      return Math.max(cur, v);
    } catch (e) { return v || 0; }
  };
  const emoji = (ctx, e, x, y, taille) => { ctx.font = taille + "px serif"; ctx.textBaseline = "alphabetic"; ctx.fillText(e, x, y); };
  const couleurs = () => {
    const cs = root.getComputedStyle ? root.getComputedStyle(root.document.documentElement) : null;
    const v = (n, d) => (cs && cs.getPropertyValue(n).trim()) || d;
    return { fond: v("--card", "#ffffff"), texte: v("--tx", "#1f2937"), trait: v("--bd", "#d9dee8"), doux: v("--mut", "#6b7280") };
  };

  /* ---------- 1. La course aux transmissions ---------- */
  const SOL = 205;
  const OBSTACLES = [
    { e: "🛒", w: 40, h: 38, haut: false, nom: "chariot de soins" },
    { e: "💧", w: 36, h: 22, haut: false, nom: "flaque" },
    { e: "👪", w: 44, h: 44, haut: false, nom: "famille" },
    { e: "📞", w: 30, h: 28, haut: true, nom: "téléphone" }
  ];
  const course = {
    nom: "course", titre: "🏃 La course aux transmissions",
    aide: "Espace ou ↑ : sauter · ↓ : se baisser (téléphone qui sonne). Sur écran tactile : toucher en haut pour sauter, en bas pour se baisser.",
    fin: "Convoqué·e par la cadre de santé 📋",
    init() { return { y: SOL, vy: 0, bas: false, obs: [], dist: 0, vitesse: 280, prochain: 300, score: 0, mort: false }; },
    action(s) { if (s.y >= SOL) s.vy = -640; },
    bas(s, etat) { s.bas = etat; },
    hauteur(s) { return s.bas && s.y >= SOL ? 24 : 44; },
    boite(s) { const h = this.hauteur(s); return { x: 56, y: s.y - h, w: 30, h }; },
    step(s, dt) {
      s.vy += 1800 * dt; s.y += s.vy * dt;
      if (s.y >= SOL) { s.y = SOL; s.vy = 0; }
      s.vitesse = 280 + Math.min(320, s.dist / 40);
      s.dist += s.vitesse * dt; s.score = Math.floor(s.dist / 12);
      s.obs.forEach(o => { o.x -= s.vitesse * dt; });
      s.obs = s.obs.filter(o => o.x + o.w > -10);
      s.prochain -= s.vitesse * dt;
      if (s.prochain <= 0) {
        const t = OBSTACLES[Math.floor(Math.random() * OBSTACLES.length)];
        s.obs.push({ x: W + 20, y: t.haut ? SOL - 54 : SOL - t.h, w: t.w, h: t.h, e: t.e, haut: t.haut });
        s.prochain = alea(260, 480) + s.vitesse * 0.25;
      }
      const moi = this.boite(s);
      if (s.obs.some(o => chevauche(moi, o, 6))) s.mort = true;
    },
    draw(ctx, s, c) {
      ctx.strokeStyle = c.trait; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(0, SOL + 2); ctx.lineTo(W, SOL + 2); ctx.stroke();
      ctx.setLineDash([10, 14]); ctx.lineDashOffset = -(s.dist % 24);
      ctx.beginPath(); ctx.moveTo(0, SOL + 14); ctx.lineTo(W, SOL + 14); ctx.stroke(); ctx.setLineDash([]);
      s.obs.forEach(o => emoji(ctx, o.e, o.x, o.y + o.h, o.h + 4));
      const h = this.hauteur(s);
      emoji(ctx, "🧑‍⚕️", 50, s.y, h + 4);
      ctx.fillStyle = c.texte; ctx.font = "bold 16px system-ui,sans-serif"; ctx.textAlign = "right";
      ctx.fillText(s.score + " patients vus", W - 12, 24); ctx.textAlign = "left";
    }
  };

  /* ---------- 2. Flappy Seringue ---------- */
  const TROU = 128, LARG = 54, ECART = 210;
  const seringue = {
    nom: "seringue", titre: "💉 Flappy Seringue",
    aide: "Espace, ↑ ou toucher : battre. Passez entre les tuyaux de perfusion sans les toucher.",
    fin: "Aïe : piqûre ratée 🩹",
    init() { return { y: H / 2, vy: 0, tuyaux: [], dx: 0, score: 0, mort: false }; },
    action(s) { s.vy = -370; },
    bas() { /* une seule touche */ },
    boite(s) { return { x: 110, y: s.y - 12, w: 34, h: 24 }; },
    step(s, dt) {
      s.vy += 1300 * dt; s.y += s.vy * dt;
      const v = 160 + Math.min(80, s.score * 4);
      s.dx += v * dt;
      s.tuyaux.forEach(t => { t.x -= v * dt; if (!t.passe && t.x + LARG < 110) { t.passe = true; s.score++; } });
      s.tuyaux = s.tuyaux.filter(t => t.x + LARG > -5);
      if (!s.tuyaux.length || s.tuyaux[s.tuyaux.length - 1].x < W - ECART) s.tuyaux.push({ x: W + 10, haut: alea(30, H - TROU - 30), passe: false });
      const moi = this.boite(s);
      if (s.y < 0 || s.y > H || s.tuyaux.some(t => chevauche(moi, { x: t.x, y: 0, w: LARG, h: t.haut }, 3) || chevauche(moi, { x: t.x, y: t.haut + TROU, w: LARG, h: H }, 3))) s.mort = true;
    },
    draw(ctx, s, c) {
      s.tuyaux.forEach(t => {
        ctx.fillStyle = "#7fb7d9"; ctx.strokeStyle = "#3a7ca5"; ctx.lineWidth = 2;
        [[0, t.haut], [t.haut + TROU, H - t.haut - TROU]].forEach(([y, h]) => { ctx.fillRect(t.x, y, LARG, h); ctx.strokeRect(t.x, y, LARG, h); });
        ctx.fillStyle = "#3a7ca5";
        ctx.fillRect(t.x - 4, t.haut - 10, LARG + 8, 10); ctx.fillRect(t.x - 4, t.haut + TROU, LARG + 8, 10);
        emoji(ctx, "💧", t.x + 14, t.haut - 16, 16);
      });
      ctx.save(); ctx.translate(127, s.y); ctx.rotate(Math.max(-0.5, Math.min(1.1, s.vy / 500)));
      emoji(ctx, "💉", -14, 10, 30); ctx.restore();
      ctx.fillStyle = c.texte; ctx.font = "bold 22px system-ui,sans-serif"; ctx.textAlign = "center";
      ctx.lineWidth = 5; ctx.strokeStyle = c.fond; ctx.strokeText(String(s.score), W / 2, 34);
      ctx.fillText(String(s.score), W / 2, 34); ctx.textAlign = "left";
    }
  };

  const JEUX = { course, seringue };

  /* ---------- Fenêtre et boucle ---------- */
  let actif = null;   // { jeu, s, etat: "pret" | "jeu" | "fini", raf, t0, cv, ctx, nettoyer }

  function dessiner() {
    const { jeu, s, ctx } = actif; if (!ctx) return;
    const c = couleurs();
    ctx.clearRect(0, 0, W, H); ctx.fillStyle = c.fond; ctx.fillRect(0, 0, W, H);
    jeu.draw(ctx, s, c);
    const centre = (txt, y, taille, coul) => { ctx.fillStyle = coul || c.texte; ctx.font = (taille >= 20 ? "bold " : "") + taille + "px system-ui,sans-serif"; ctx.textAlign = "center"; ctx.fillText(txt, W / 2, y); ctx.textAlign = "left"; };
    if (actif.etat === "pret") centre("Espace ou toucher pour commencer", H / 2 - 20, 20);
    if (actif.etat === "fini") {
      ctx.fillStyle = "rgba(0,0,0,.28)"; ctx.fillRect(0, 0, W, H);
      centre(jeu.fin, H / 2 - 24, 24, "#fff"); centre("Score : " + s.score + " · record : " + record(jeu.nom), H / 2 + 8, 18, "#fff"); centre("Espace ou toucher pour rejouer", H / 2 + 40, 15, "#fff");
    }
    if (actif.maj) actif.maj(s.score, record(jeu.nom));
  }

  function boucle(t) {
    if (!actif) return;
    const dt = Math.min(0.05, (t - actif.t0) / 1000); actif.t0 = t;
    if (actif.etat === "jeu") {
      actif.jeu.step(actif.s, dt);
      if (actif.s.mort) { actif.etat = "fini"; record(actif.jeu.nom, actif.s.score); }
    }
    dessiner();
    actif.raf = root.requestAnimationFrame(boucle);
  }

  function appuyer() {
    if (!actif) return;
    if (actif.etat === "pret") { actif.etat = "jeu"; actif.jeu.action(actif.s); }
    else if (actif.etat === "fini") { actif.s = actif.jeu.init(); actif.etat = "jeu"; actif.jeu.action(actif.s); }
    else actif.jeu.action(actif.s);
  }

  function ouvrir(nom, zone, maj) {
    fermer();
    const jeu = JEUX[nom]; if (!jeu || !zone) return false;
    const doc = zone.ownerDocument;
    zone.innerHTML = '<canvas width="' + W + '" height="' + H + '" style="width:100%;max-width:' + W + 'px;border:1px solid var(--bd);border-radius:10px;touch-action:none;background:var(--card)" tabindex="0" aria-label="' + jeu.titre + '"></canvas><div class="meta" style="margin-top:6px"></div>';
    const cv = zone.querySelector("canvas"); zone.querySelector(".meta").textContent = jeu.aide;
    actif = { jeu, s: jeu.init(), etat: "pret", raf: 0, t0: 0, cv, ctx: cv.getContext ? cv.getContext("2d") : null, maj };
    const touche = e => {
      if (!actif) return;
      if (e.key === " " || e.key === "ArrowUp") { e.preventDefault(); if (!e.repeat) appuyer(); }
      else if (e.key === "ArrowDown") { e.preventDefault(); jeu.bas(actif.s, true); }
    };
    const relache = e => { if (actif && e.key === "ArrowDown") jeu.bas(actif.s, false); };
    const doigt = e => {
      e.preventDefault();
      const r = cv.getBoundingClientRect(), bas = nom === "course" && (e.clientY - r.top) > r.height * 0.6;
      if (bas && actif.etat === "jeu") jeu.bas(actif.s, true); else appuyer();
    };
    const leve = () => { if (actif) jeu.bas(actif.s, false); };
    doc.addEventListener("keydown", touche); doc.addEventListener("keyup", relache);
    cv.addEventListener("pointerdown", doigt); cv.addEventListener("pointerup", leve); cv.addEventListener("pointercancel", leve);
    actif.nettoyer = () => { doc.removeEventListener("keydown", touche); doc.removeEventListener("keyup", relache); };
    if (root.requestAnimationFrame) { actif.t0 = root.performance ? root.performance.now() : 0; actif.raf = root.requestAnimationFrame(boucle); }
    try { cv.focus({ preventScroll: true }); } catch (e) { /* ignoré */ }
    return true;
  }

  function fermer() {
    if (!actif) return;
    if (actif.raf && root.cancelAnimationFrame) root.cancelAnimationFrame(actif.raf);
    if (actif.nettoyer) actif.nettoyer();
    actif = null;
  }

  root.LydiaJeux = {
    liste: Object.keys(JEUX).map(k => ({ id: k, titre: JEUX[k].titre })),
    ouvrir, fermer, enCours: () => !!actif, record,
    _test: { JEUX, chevauche, appuyer, etat: () => actif && actif.etat }
  };
})(typeof window !== "undefined" ? window : globalThis);
