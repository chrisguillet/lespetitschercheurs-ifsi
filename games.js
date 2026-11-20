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
  // Les emojis suivent la transparence de la couleur de remplissage courante : on la fixe, sinon ils clignotent selon le dernier élément dessiné.
const emoji = (ctx, e, x, y, taille) => { ctx.save(); ctx.globalAlpha = 1; ctx.fillStyle = "#000"; ctx.font = taille + "px serif"; ctx.textBaseline = "alphabetic"; ctx.fillText(e, x, y); ctx.restore(); };
  const couleurs = () => {
    const cs = root.getComputedStyle ? root.getComputedStyle(root.document.documentElement) : null;
    const v = (n, d) => (cs && cs.getPropertyValue(n).trim()) || d;
    return { fond: v("--card", "#ffffff"), texte: v("--tx", "#1f2937"), trait: v("--bd", "#d9dee8"), doux: v("--mut", "#6b7280") };
  };

  /* ---------- 1. La course aux transmissions ---------- */
  const SOL = 205;
  const OBSTACLES = [
    { e: "chariot", w: 44, h: 40, haut: false, nom: "chariot de soins" },
    { e: "sang", w: 46, h: 14, haut: false, nom: "flaque de sang" },
    { e: "👪", w: 44, h: 44, haut: false, nom: "famille" },
    { e: "enseigne", w: 50, h: SOL - 28, haut: true, nom: "enseigne suspendue" }
  ];
  // Chariot de soins dessiné à la main : plateau métallique, tiroirs, croix rouge, poignée et roulettes.
  function chariot(ctx, x, y, w, h) {
    ctx.fillStyle = "#cfd8e3"; ctx.strokeStyle = "#5b6b7f"; ctx.lineWidth = 2;
    ctx.fillRect(x, y, w, 6); ctx.strokeRect(x, y, w, 6);                       // plateau
    ctx.fillStyle = "#eef2f7"; ctx.fillRect(x + 3, y + 6, w - 6, h - 16); ctx.strokeRect(x + 3, y + 6, w - 6, h - 16);   // corps
    ctx.beginPath(); ctx.moveTo(x + 3, y + 6 + (h - 16) / 2); ctx.lineTo(x + w - 3, y + 6 + (h - 16) / 2); ctx.stroke();   // séparation des tiroirs
    ctx.fillStyle = "#d33a3a"; const cx = x + w / 2, cy = y + 6 + (h - 16) / 4;
    ctx.fillRect(cx - 1.5, cy - 5, 3, 10); ctx.fillRect(cx - 5, cy - 1.5, 10, 3);   // croix
    ctx.strokeStyle = "#5b6b7f"; ctx.beginPath(); ctx.moveTo(x + w, y + 3); ctx.lineTo(x + w + 6, y + 3); ctx.lineTo(x + w + 6, y + 14); ctx.stroke();   // poignée
    ctx.fillStyle = "#2b3340"; [x + 8, x + w - 8].forEach(r => { ctx.beginPath(); ctx.arc(r, y + h - 4, 4, 0, 7); ctx.fill(); });   // roulettes
  }
  // Flaque de sang : ellipse sombre avec reflet, éclaboussures autour.
  function flaque(ctx, x, y, w, h) {
    ctx.fillStyle = "#9b1c1c"; ctx.beginPath(); ctx.ellipse(x + w / 2, y + h - 5, w / 2, 6, 0, 0, 7); ctx.fill();
    ctx.beginPath(); ctx.ellipse(x + w * 0.3, y + h - 8, w * 0.22, 4, 0, 0, 7); ctx.fill();
    ctx.fillStyle = "#c0392b"; ctx.beginPath(); ctx.ellipse(x + w * 0.55, y + h - 6, w * 0.25, 3, 0, 0, 7); ctx.fill();
    ctx.fillStyle = "rgba(255,255,255,.45)"; ctx.beginPath(); ctx.ellipse(x + w * 0.62, y + h - 7, 5, 1.5, 0, 0, 7); ctx.fill();
    ctx.fillStyle = "#9b1c1c"; [[2, 3, 2.5], [w - 4, 5, 2], [w * 0.15, h - 12, 1.8]].forEach(p => { ctx.beginPath(); ctx.arc(x + p[0], y + p[1] + h - 14, p[2], 0, 7); ctx.fill(); });
  }

  // Enseigne de service suspendue au plafond (impossible à sauter : il faut passer dessous).
  function enseigne(ctx, x, bas, w) {
    const h = 28, y = bas - h;
    ctx.fillStyle = "#8696aa"; ctx.fillRect(x + 6, 16, 4, y - 16); ctx.fillRect(x + w - 10, 16, 4, y - 16);   // tiges
    ctx.fillStyle = "#c93a3a"; ctx.strokeStyle = "#8f2424"; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.roundRect ? ctx.roundRect(x, y, w, h, 6) : ctx.rect(x, y, w, h); ctx.fill(); ctx.stroke();
    ctx.fillStyle = "#fff"; ctx.fillRect(x + w / 2 - 2, y + 5, 4, 18); ctx.fillRect(x + w / 2 - 9, y + 12, 18, 4);   // croix blanche
  }

  // Décor : couloir d'hôpital en défilement parallaxe (plafond et néons, mur avec portes, fenêtres, horloge, affiches, plantes, sol carrelé).
  function decor(ctx, d) {
    const mur = "rgba(127,150,180,", cl = (a) => mur + a + ")";
    ctx.fillStyle = cl(".08"); ctx.fillRect(0, 16, W, SOL - 14);              // mur
    ctx.fillStyle = cl(".22"); ctx.fillRect(0, 0, W, 16);                      // plafond
    for (let i = -1; i <= 5; i++) { const x = i * 150 - ((d * 0.6) % 150); ctx.fillStyle = "rgba(190,215,245,.75)"; ctx.fillRect(x + 30, 4, 70, 6); }   // néons
    ctx.fillStyle = cl(".28"); ctx.fillRect(0, 150, W, 6);                     // main courante
    ctx.fillStyle = cl(".16"); ctx.fillRect(0, SOL - 10, W, 12);               // plinthe
    const F = 0.35, E = 220, k0 = Math.floor(d * F / E) - 1;
    for (let idx = k0; idx <= k0 + 5; idx++) {
      const x = idx * E - d * F, t = ((idx % 6) + 6) % 6;
      ctx.lineWidth = 2; ctx.strokeStyle = cl(".5");
      if (t === 0 || t === 3) {                                                // porte de chambre avec hublot
        ctx.fillStyle = cl(".2"); ctx.fillRect(x + 20, 46, 58, SOL - 46); ctx.strokeRect(x + 20, 46, 58, SOL - 46);
        ctx.fillStyle = "rgba(190,215,245,.7)"; ctx.fillRect(x + 36, 58, 26, 30); ctx.strokeRect(x + 36, 58, 26, 30);
        ctx.fillStyle = cl(".6"); ctx.fillRect(x + 68, 120, 5, 12);
      } else if (t === 1) {                                                    // fenêtre
        ctx.fillStyle = "rgba(170,210,245,.55)"; ctx.fillRect(x + 20, 40, 84, 70); ctx.strokeRect(x + 20, 40, 84, 70);
        ctx.beginPath(); ctx.moveTo(x + 62, 40); ctx.lineTo(x + 62, 110); ctx.moveTo(x + 20, 75); ctx.lineTo(x + 104, 75); ctx.stroke();
      } else if (t === 2) {                                                    // pictogramme croix verte
        ctx.fillStyle = cl(".2"); ctx.fillRect(x + 30, 50, 60, 60); ctx.strokeRect(x + 30, 50, 60, 60);
        ctx.fillStyle = "#3aa76d"; ctx.fillRect(x + 56, 62, 8, 36); ctx.fillRect(x + 42, 76, 36, 8);
      } else if (t === 4) {                                                    // horloge
        ctx.fillStyle = "rgba(255,255,255,.7)"; ctx.beginPath(); ctx.arc(x + 60, 66, 20, 0, 7); ctx.fill(); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(x + 60, 66); ctx.lineTo(x + 60, 54); ctx.moveTo(x + 60, 66); ctx.lineTo(x + 70, 70); ctx.stroke();
      } else {                                                                 // plante
        emoji(ctx, "🪴", x + 40, SOL - 4, 44);
      }
    }
    ctx.fillStyle = cl(".12"); ctx.fillRect(0, SOL + 2, W, H - SOL);           // sol
    ctx.strokeStyle = cl(".25"); ctx.lineWidth = 1;
    for (let i = -1; i <= 12; i++) { const x = i * 64 - (d % 64); ctx.beginPath(); ctx.moveTo(x, SOL + 2); ctx.lineTo(x - 22, H); ctx.stroke(); }
    ctx.beginPath(); ctx.moveTo(0, SOL + 28); ctx.lineTo(W, SOL + 28); ctx.stroke();
  }

  const course = {
    nom: "course-m", unite: " m", titre: "🏃 La course aux transmissions",
    aide: "Espace ou ↑ : sauter les chariots, flaques de sang et familles · ↓ (maintenu) : se baisser sous l’enseigne suspendue. Sur écran tactile : toucher en haut pour sauter, en bas pour se baisser.",
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
      s.dist += s.vitesse * dt; s.score = Math.floor(s.dist / 50);   // en mètres
      s.obs.forEach(o => { o.x -= s.vitesse * dt; });
      s.obs = s.obs.filter(o => o.x + o.w > -10);
      s.prochain -= s.vitesse * dt;
      if (s.prochain <= 0) {
        const t = OBSTACLES[Math.floor(Math.random() * OBSTACLES.length)];
        s.obs.push({ x: W + 20, y: t.haut ? 0 : SOL - t.h, w: t.w, h: t.h, e: t.e, haut: t.haut });
        s.prochain = alea(260, 480) + s.vitesse * 0.25;
      }
      const moi = this.boite(s);
      if (s.obs.some(o => chevauche(moi, o, 6))) s.mort = true;
    },
    draw(ctx, s, c) {
      decor(ctx, s.dist);
      ctx.strokeStyle = c.trait; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(0, SOL + 2); ctx.lineTo(W, SOL + 2); ctx.stroke();
      s.obs.forEach(o => {
        if (o.e === "chariot") chariot(ctx, o.x, o.y, o.w, o.h);
        else if (o.e === "sang") flaque(ctx, o.x, o.y, o.w, o.h);
        else if (o.haut) enseigne(ctx, o.x, o.h, o.w);
        else emoji(ctx, o.e, o.x, o.y + o.h, o.h + 4);
      });
      const h = this.hauteur(s);
      emoji(ctx, avatar, 50, s.y, h + 4);
      ctx.fillStyle = c.texte; ctx.font = "bold 16px system-ui,sans-serif"; ctx.textAlign = "right";
      ctx.fillText(s.score + " m", W - 12, 24); ctx.textAlign = "left";
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

  // Avatar de la course (choix mémorisé dans le navigateur).
  const AVATARS = [{ e: "👩‍⚕️", nom: "Femme" }, { e: "👨‍⚕️", nom: "Homme" }, { e: "🧑‍⚕️", nom: "Neutre" }];
  const lireAvatar = () => { try { const v = localStorage.getItem("lydia_jeu_avatar"); return AVATARS.some(a => a.e === v) ? v : AVATARS[0].e; } catch (e) { return AVATARS[0].e; } };
  let avatar = lireAvatar();

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
      centre(jeu.fin, H / 2 - 24, 24, "#fff"); centre("Score : " + s.score + (jeu.unite || "") + " · record : " + record(jeu.nom) + (jeu.unite || ""), H / 2 + 8, 18, "#fff"); centre("Espace ou toucher pour rejouer", H / 2 + 40, 15, "#fff");
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
    if (nom === "course") {
      avatar = lireAvatar();
      const bar = doc.createElement("div"); bar.className = "jeuavatar"; bar.style.cssText = "display:flex;gap:8px;align-items:center;flex-wrap:wrap";
      bar.innerHTML = AVATARS.map(a => '<button type="button" class="btn sm sec" data-avatar="' + a.e + '" aria-label="' + a.nom + '" aria-pressed="' + (a.e === avatar) + '" title="' + a.nom + '" style="font-size:20px;line-height:1;' + (a.e === avatar ? "outline:2px solid var(--pri)" : "") + '">' + a.e + "</button>").join("");
      bar.addEventListener("click", e => {
        const b = e.target.closest("[data-avatar]"); if (!b) return;
        avatar = b.dataset.avatar; try { localStorage.setItem("lydia_jeu_avatar", avatar); } catch (x) { /* ignoré */ }
        bar.querySelectorAll("[data-avatar]").forEach(o => { const on = o === b; o.setAttribute("aria-pressed", String(on)); o.style.outline = on ? "2px solid var(--pri)" : ""; });
        try { cv.focus({ preventScroll: true }); } catch (x) { /* ignoré */ }
      });
      zone.insertBefore(bar, cv);
    }
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
    ouvrir, fermer, enCours: () => !!actif, record, avatar: () => avatar,
    _test: { JEUX, chevauche, appuyer, etat: () => actif && actif.etat }
  };
})(typeof window !== "undefined" ? window : globalThis);
