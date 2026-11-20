/* Pause ludique : quatre mini-jeux (canvas, sans dépendance), ouverts dans une fenêtre depuis le menu du compte (js/menu.js).
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
  const TROU = 124, LARG = 54, ECART = 210, BANDE = 30, SOL2 = H - BANDE, SX = 127;
  const LIQUIDES = ["#4fc3f7", "#66bb6a", "#f06292", "#ffca28"];   // la couleur du liquide change tous les 10 points

  // Éléments solides d'un obstacle : poche suspendue au plafond (tube + poche) et potence à perfusion (poche + mât + pied à roulettes).
  function solides(t) {
    const cx = t.x + LARG / 2, r = [], hb = Math.min(70, t.haut), y0 = t.haut + TROU, bb = Math.min(70, SOL2 - y0);
    if (t.haut - hb > 0) r.push({ x: cx - 4, y: 0, w: 8, h: t.haut - hb });
    r.push({ x: t.x, y: t.haut - hb, w: LARG, h: hb });
    r.push({ x: t.x, y: y0, w: LARG, h: bb });
    r.push({ x: cx - 4, y: y0 + bb, w: 8, h: SOL2 - (y0 + bb) });
    r.push({ x: cx - 24, y: SOL2 - 9, w: 48, h: 9 });
    return r;
  }
  const bord = (ctx, x, y, w, h, r) => { ctx.beginPath(); if (ctx.roundRect) ctx.roundRect(x, y, w, h, r); else ctx.rect(x, y, w, h); };
  function poche(ctx, x, y, w, h, niveau) {
    ctx.fillStyle = "rgba(225,242,255,.92)"; ctx.strokeStyle = "#7aa6c4"; ctx.lineWidth = 2; bord(ctx, x, y, w, h, 10); ctx.fill(); ctx.stroke();
    ctx.fillStyle = "rgba(110,185,230,.9)"; bord(ctx, x + 3, y + h * (1 - niveau), w - 6, h * niveau - 3, 7); ctx.fill();
    ctx.strokeStyle = "rgba(60,110,150,.6)"; ctx.lineWidth = 1;
    for (let i = 1; i < 5; i++) { ctx.beginPath(); ctx.moveTo(x + w - 12, y + (h * i) / 5); ctx.lineTo(x + w - 5, y + (h * i) / 5); ctx.stroke(); }
  }
  function obstacle(ctx, t) {
    const cx = t.x + LARG / 2, hb = Math.min(70, t.haut), y0 = t.haut + TROU, bb = Math.min(70, SOL2 - y0);
    ctx.fillStyle = "#b8c4d2";
    if (t.haut - hb > 0) ctx.fillRect(cx - 3, 0, 6, t.haut - hb);                       // tube / support du plafond
    poche(ctx, t.x, t.haut - hb, LARG, hb, 0.7);
    ctx.fillStyle = "#8796a8"; ctx.fillRect(cx - 3, y0 + bb, 6, SOL2 - (y0 + bb));        // mât de la potence
    poche(ctx, t.x, y0, LARG, bb, 0.55);
    ctx.fillStyle = "#6f7f92"; ctx.fillRect(cx - 24, SOL2 - 9, 48, 5);                   // pied
    ctx.fillStyle = "#2b3340"; [cx - 17, cx + 17].forEach(x => { ctx.beginPath(); ctx.arc(x, SOL2 - 3, 3.5, 0, 7); ctx.fill(); });
  }

  // Décor : salle de soins en parallaxe + bandeau d'ECG en bas (plat à la défaite).
  function decorSalle(ctx, dx, mort) {
    const cl = a => "rgba(127,150,180," + a + ")";
    ctx.fillStyle = cl(".09"); ctx.fillRect(0, 16, W, SOL2 - 16);
    ctx.fillStyle = cl(".22"); ctx.fillRect(0, 0, W, 16);
    for (let i = -1; i <= 5; i++) { const x = i * 150 - ((dx * 0.5) % 150); ctx.fillStyle = "rgba(190,215,245,.75)"; ctx.fillRect(x + 30, 4, 70, 6); }
    const F = 0.3, E = 230, k0 = Math.floor(dx * F / E) - 1;
    for (let idx = k0; idx <= k0 + 4; idx++) {
      const x = idx * E - dx * F, t = ((idx % 4) + 4) % 4;
      ctx.lineWidth = 2; ctx.strokeStyle = cl(".5");
      if (t === 0) { ctx.fillStyle = "rgba(170,210,245,.55)"; ctx.fillRect(x + 20, 40, 84, 80); ctx.strokeRect(x + 20, 40, 84, 80); ctx.beginPath(); ctx.moveTo(x + 62, 40); ctx.lineTo(x + 62, 120); ctx.moveTo(x + 20, 80); ctx.lineTo(x + 104, 80); ctx.stroke(); }
      else if (t === 1) { ctx.fillStyle = cl(".2"); ctx.fillRect(x + 25, 60, 70, 120); ctx.strokeRect(x + 25, 60, 70, 120); ctx.beginPath(); ctx.moveTo(x + 60, 60); ctx.lineTo(x + 60, 180); ctx.stroke(); ctx.fillStyle = "#3aa76d"; ctx.fillRect(x + 56, 74, 8, 26); ctx.fillRect(x + 47, 83, 26, 8); }
      else if (t === 2) { ctx.fillStyle = "rgba(255,255,255,.7)"; ctx.beginPath(); ctx.arc(x + 60, 70, 22, 0, 7); ctx.fill(); ctx.stroke(); ctx.beginPath(); ctx.moveTo(x + 60, 70); ctx.lineTo(x + 60, 56); ctx.moveTo(x + 60, 70); ctx.lineTo(x + 72, 76); ctx.stroke(); }
      else { ctx.fillStyle = cl(".2"); ctx.fillRect(x + 20, 70, 76, 56); ctx.strokeRect(x + 20, 70, 76, 56); ctx.strokeStyle = cl(".35"); for (let i = 0; i < 3; i++) { ctx.beginPath(); ctx.moveTo(x + 28, 86 + i * 14); ctx.lineTo(x + 88, 86 + i * 14); ctx.stroke(); } }
    }
    // bandeau d'ECG
    ctx.fillStyle = "#0f1b2a"; ctx.fillRect(0, SOL2, W, BANDE);
    ctx.strokeStyle = "#3ddc84"; ctx.lineWidth = 2; ctx.beginPath(); const yc = SOL2 + BANDE / 2;
    for (let x = 0; x <= W; x += 3) {
      let v = 0;
      if (!mort) {
        const ph = (x + dx * 0.9) % 150;
        v = ph < 40 ? 0 : ph < 52 ? -4 * Math.sin((ph - 40) / 12 * Math.PI) : ph < 60 ? 0 : ph < 64 ? 5 * (ph - 60) / 4 : ph < 70 ? 5 - 22 * (ph - 64) / 6 : ph < 76 ? -17 + 22 * (ph - 70) / 6 : ph < 80 ? 5 * (1 - (ph - 76) / 4) : ph < 110 ? 0 : ph < 130 ? -6 * Math.sin((ph - 110) / 20 * Math.PI) : 0;
      }
      if (x) ctx.lineTo(x, yc + v); else ctx.moveTo(x, yc + v);
    }
    ctx.stroke();
  }

  function seringueDessin(ctx, x, y, angle, couleur, piston) {
    ctx.save(); ctx.translate(x, y); ctx.rotate(angle);
    ctx.fillStyle = "#9aa7b5"; ctx.fillRect(-24 - piston, -2, 9, 4); ctx.fillRect(-26 - piston, -7, 3, 14);   // piston
    ctx.fillStyle = "rgba(235,245,255,.95)"; ctx.strokeStyle = "#5b7da0"; ctx.lineWidth = 1.5; bord(ctx, -16, -7, 30, 14, 3); ctx.fill(); ctx.stroke();   // corps
    ctx.fillStyle = couleur; ctx.fillRect(-14 + piston, -5, 26 - piston, 10);                                  // liquide
    ctx.strokeStyle = "rgba(40,70,100,.55)"; ctx.lineWidth = 1; for (let i = 0; i < 4; i++) { ctx.beginPath(); ctx.moveTo(-8 + i * 6, -7); ctx.lineTo(-8 + i * 6, -3); ctx.stroke(); }
    ctx.fillStyle = "#c9d3df"; ctx.fillRect(14, -3, 4, 6);                                                     // embout
    ctx.fillStyle = "#e8edf3"; ctx.beginPath(); ctx.moveTo(18, -1); ctx.lineTo(32, 0); ctx.lineTo(18, 1); ctx.closePath(); ctx.fill(); ctx.strokeStyle = "#7d8fa3"; ctx.stroke();   // aiguille
    ctx.restore();
  }

  const seringue = {
    nom: "seringue", titre: "💉 Flappy Seringue",
    aide: "Espace, ↑ ou toucher : battre. Passez entre les poches et les potences à perfusion. Attrapez les gouttes qui tombent des poches : +2 points.",
    fin: "Aïe : piqûre ratée 🩹",
    init() { return { y: H / 2, vy: 0, tuyaux: [], dx: 0, score: 0, mort: false, piston: 0, part: [], textes: [], rec: record("seringue") }; },
    action(s) { s.vy = -370; s.piston = 5; for (let i = 0; i < 4; i++) s.part.push({ x: SX - 18, y: s.y + alea(-4, 4), vx: alea(-70, -20), vy: alea(-20, 40), vie: alea(0.35, 0.7), coul: LIQUIDES[Math.floor(s.score / 10) % 4] }); },
    bas() { /* une seule touche */ },
    boite(s) { return { x: 110, y: s.y - 8, w: 36, h: 16 }; },
    step(s, dt) {
      s.vy += 1300 * dt; s.y += s.vy * dt; s.piston = Math.max(0, s.piston - 22 * dt);
      const v = 160 + Math.min(80, s.score * 4);
      s.dx += v * dt;
      s.tuyaux.forEach(t => {
        t.x -= v * dt;
        if (!t.passe && t.x + LARG < 110) { t.passe = true; s.score++; }
        const g = t.g;   // goutte qui tombe de la poche du haut
        if (g.etat === "attente") { g.delai -= dt; if (g.delai <= 0) { g.etat = "tombe"; g.y = t.haut + 4; g.vy = 18; } }
        else if (g.etat === "tombe") {
          g.vy += 40 * dt; g.y += g.vy * dt;
          if (g.y > t.haut + TROU) g.etat = "perdue";
          else if (chevauche(this.boite(s), { x: t.x + LARG / 2 - 9, y: g.y - 9, w: 18, h: 18 })) { g.etat = "prise"; s.score += 2; s.textes.push({ x: t.x + LARG / 2, y: g.y, txt: "+2", vie: 0.9 }); }
        }
      });
      s.part.forEach(p => { p.x += p.vx * dt; p.y += p.vy * dt; p.vie -= dt; }); s.part = s.part.filter(p => p.vie > 0);
      s.textes.forEach(t => { t.y -= 30 * dt; t.vie -= dt; }); s.textes = s.textes.filter(t => t.vie > 0);
      s.tuyaux = s.tuyaux.filter(t => t.x + LARG > -5);
      if (!s.tuyaux.length || s.tuyaux[s.tuyaux.length - 1].x < W - ECART) s.tuyaux.push({ x: W + 10, haut: alea(28, SOL2 - TROU - 28), passe: false, g: { etat: Math.random() < 0.55 ? "attente" : "aucune", delai: alea(0.2, 1.2), y: 0, vy: 0 } });
      const moi = this.boite(s);
      if (s.y < 8 || s.y > SOL2 - 8 || s.tuyaux.some(t => solides(t).some(r => chevauche(moi, r, 2)))) {
        s.mort = true;
        for (let i = 0; i < 16; i++) s.part.push({ x: SX, y: s.y, vx: alea(-110, 110), vy: alea(-130, 60), vie: 99, coul: LIQUIDES[Math.floor(s.score / 10) % 4] });
        s.part.forEach(p => { if (p.vie === 99) { p.x += p.vx * 0.25; p.y += p.vy * 0.25; } });   // éclaboussure figée sur l'écran de fin
      }
    },
    draw(ctx, s, c) {
      decorSalle(ctx, s.dx, s.mort);
      s.tuyaux.forEach(t => {
        obstacle(ctx, t);
        if (t.g.etat === "tombe") { const gx = t.x + LARG / 2; ctx.fillStyle = "#4fa6dd"; ctx.beginPath(); ctx.moveTo(gx, t.g.y - 8); ctx.quadraticCurveTo(gx + 6, t.g.y + 1, gx, t.g.y + 6); ctx.quadraticCurveTo(gx - 6, t.g.y + 1, gx, t.g.y - 8); ctx.fill(); ctx.strokeStyle = "rgba(255,255,255,.7)"; ctx.lineWidth = 1; ctx.stroke(); }
      });
      s.part.forEach(p => { ctx.globalAlpha = Math.min(1, p.vie * 2.5); ctx.fillStyle = p.coul; ctx.beginPath(); ctx.arc(p.x, p.y, 2.5, 0, 7); ctx.fill(); }); ctx.globalAlpha = 1;
      const coul = LIQUIDES[Math.floor(s.score / 10) % 4];
      seringueDessin(ctx, SX, s.y, s.mort ? 1.1 : Math.max(-0.5, Math.min(1.1, s.vy / 500)), coul, s.piston);
      ctx.textAlign = "center"; ctx.font = "bold 16px system-ui,sans-serif";
      s.textes.forEach(t => { ctx.globalAlpha = Math.min(1, t.vie * 2); ctx.fillStyle = "#e0a800"; ctx.strokeStyle = "#fff"; ctx.lineWidth = 3; ctx.strokeText(t.txt, t.x, t.y); ctx.fillText(t.txt, t.x, t.y); }); ctx.globalAlpha = 1;
      ctx.fillStyle = c.texte; ctx.font = "bold 22px system-ui,sans-serif";
      ctx.lineWidth = 5; ctx.strokeStyle = c.fond; ctx.strokeText(String(s.score), W / 2, 36);
      ctx.fillText(String(s.score), W / 2, 36);
      ctx.textAlign = "left"; ctx.font = "13px system-ui,sans-serif"; ctx.fillStyle = c.doux; ctx.fillText("Record : " + Math.max(s.rec, s.score), 10, 36);
    }
  };

  /* ---------- 3. Urgences ---------- */
  const HU = 440, VIES = 3;
  const SOINS = {
    constantes: { e: "🌡️", nom: "Constantes" }, ecg: { e: "📈", nom: "ECG" }, oxygene: { e: "💨", nom: "Oxygène" }, perfusion: { e: "💧", nom: "Perfusion" },
    antalgique: { e: "💊", nom: "Antalgique" }, injection: { e: "💉", nom: "Injection" }, pansement: { e: "🩹", nom: "Pansement" }, transfusion: { e: "🩸", nom: "Transfusion" }
  };
  const SOINS_ORDRE = Object.keys(SOINS);
  const PATHOS = [
    { m: "Douleur après une chute", g: 1, s: [["antalgique", "Antalgique : paracétamol IV (douleur 7/10)"]] },
    { m: "Plaie profonde de la main", g: 1, s: [["pansement", "Nettoyer et faire un pansement compressif"], ["antalgique", "Antalgique avant la suture"]] },
    { m: "Gastro-entérite, déshydraté", g: 1, s: [["perfusion", "Perfusion de NaCl 0,9 % (réhydratation)"], ["antalgique", "Antiémétique + antalgique"]] },
    { m: "Crise d'asthme", g: 2, s: [["oxygene", "Oxygène au masque (SpO₂ 86 %)"], ["injection", "Bronchodilatateur (salbutamol)"]] },
    { m: "Malaise, hypoglycémie", g: 2, s: [["constantes", "Glycémie capillaire : 0,4 g/L"], ["injection", "Injection de glucose G30 %"]] },
    { m: "Fièvre, suspicion de sepsis", g: 2, s: [["constantes", "Constantes : T° 39,8, tension basse"], ["perfusion", "Remplissage vasculaire (perfusion)"], ["injection", "Antibiotique IV"]] },
    { m: "Douleur thoracique", g: 3, bloc: true, s: [["ecg", "ECG 12 dérivations : sus-décalage ST"], ["injection", "Anticoagulant + aspirine (injection)"], ["bloc", "Coronarographie au bloc"], ["constantes", "Surveillance post-opératoire"]] },
    { m: "Hémorragie (accident de route)", g: 3, bloc: true, s: [["pansement", "Compression de la plaie"], ["transfusion", "Transfusion de culots globulaires"], ["bloc", "Chirurgie d'hémostase au bloc"], ["perfusion", "Perfusion de relais"]] },
    { m: "Douleur abdominale aiguë", g: 3, bloc: true, s: [["perfusion", "À jeun + perfusion"], ["antalgique", "Antalgique IV"], ["bloc", "Appendicectomie au bloc"], ["constantes", "Surveillance post-opératoire"]] }
  ];
  const VISAGES = ["👵", "👴", "👩", "👨", "🧒", "👧", "🧑", "👩‍🦰", "👨‍🦳"];
  // Plus de lits = plus d'arrivées (plus vite) et des patients qui se dégradent un peu plus vite : le service doit rester plus difficile à gérer.
  const NIVEAUX = { 3: { debut: 8, mini: 4.8, usure: 1, depart: 1 }, 6: { debut: 6, mini: 3.6, usure: 1.05, depart: 2 }, 9: { debut: 4.6, mini: 3, usure: 1.1, depart: 2 } };
  const DUREE_BLOC = 7, PATIENCE = 40;
  const niveauLits = () => { try { const v = +localStorage.getItem("lydia_jeu_lits"); return NIVEAUX[v] ? v : 3; } catch (e) { return 3; } };
  // Disposition : lits à gauche (3 colonnes), bloc et salle d'attente à droite, fiche du patient puis plateau de soins en bas.
  const lit = (s, i) => { const lignes = Math.ceil(s.lits / 3), h = lignes === 1 ? 126 : lignes === 2 ? 118 : 100, pas = h + 6, haut = lignes * pas - 6, y0 = 38 + Math.max(0, (312 - haut) / 2); return { x: 8 + (i % 3) * 160, y: y0 + Math.floor(i / 3) * pas, w: 154, h }; };
  const BTN_BLOC = { x: 490, y: 356, w: 142, h: 36 }, BLOC = { x: 490, y: 38, w: 142, h: 150 }, ATTENTE = { x: 490, y: 194, w: 142, h: 156 };
  const outils = () => SOINS_ORDRE.map((k, i) => ({ k, x: 8 + i * 78.5, y: 398, w: 74, h: 40 }));
  const dedans = (r, x, y) => x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;

  function nouveauPatient(s) {
    const usure = NIVEAUX[s.lits].usure;
    const gros = Math.random() < Math.min(0.45, 0.12 + s.t / 400);
    const choix = PATHOS.filter(p => !!p.bloc === gros), p = choix[Math.floor(Math.random() * choix.length)];
    return { motif: p.m, g: p.g, etapes: p.s.map(e => ({ k: e[0], t: e[1] })), i: 0, vie: 100, taux: (1 + 0.9 * p.g) * usure, visage: VISAGES[Math.floor(Math.random() * VISAGES.length)], vu: false, etat: "attente", patience: PATIENCE, reste: 0 };
  }
  const libre = s => { for (let i = 0; i < s.lits; i++) if (!s.lit[i]) return i; return -1; };
  function perdre(s, txt, x, y) {
    s.morts++; s.textes.push({ x, y, txt, vie: 1.6, coul: "#d33a3a" });
    if (s.morts >= VIES) s.mort = true;
  }
  function soigner(s, p) {
    p.i++; p.vie = Math.min(100, p.vie + 22);
    const idx = s.lit.indexOf(p), r = idx >= 0 ? lit(s, idx) : BLOC;
    if (p.i >= p.etapes.length) {
      s.lit[idx] = null; if (s.sel === p) s.sel = null; s.score++;
      s.textes.push({ x: r.x + r.w / 2, y: r.y + r.h / 2, txt: "✔ Soigné", vie: 1.3, coul: "#2f9e5b" });
    } else s.textes.push({ x: r.x + r.w / 2, y: r.y + 24, txt: "✔", vie: 0.8, coul: "#2f9e5b" });
  }
  function appliquer(s, k) {
    const p = s.sel;
    if (!p) { s.msg = { txt: "Choisissez d'abord un patient.", vie: 2 }; return false; }
    if (p.etat !== "lit") return false;
    const e = p.etapes[p.i];
    if (e.k === k) { soigner(s, p); return true; }
    p.vie = Math.max(1, p.vie - 6);
    s.msg = { txt: "Ce n'est pas ce dont il a besoin (" + SOINS[k].nom + ").", vie: 2 };
    return false;
  }
  function versBloc(s) {
    const p = s.sel;
    if (!p || p.etat !== "lit" || p.etapes[p.i].k !== "bloc") { s.msg = { txt: "Ce patient n'a pas besoin du bloc maintenant.", vie: 2 }; return false; }
    if (s.bloc) { s.msg = { txt: "Le bloc est occupé : un seul patient à la fois !", vie: 2 }; return false; }
    p.etat = "bloc"; p.reste = DUREE_BLOC; s.bloc = p; s.sel = null; return true;
  }
  function clic(s, x, y) {
    if (dedans(BTN_BLOC, x, y)) return versBloc(s);
    for (let i = 0; i < s.lits; i++) if (dedans(lit(s, i), x, y)) { const p = s.lit[i]; if (p && p.etat === "lit") { s.sel = p; p.vu = true; } return true; }
    const o = outils().find(o => dedans(o, x, y)); if (o) return appliquer(s, o.k);
    return false;
  }
  const humeur = v => v > 66 ? "🙂" : v > 33 ? "😟" : "😣";

  const urgences = {
    nom: "urgences", titre: "🏥 Urgences", h: HU, unite: " soignés", cle: s => "urgences" + s.lits, niveaux: [3, 6, 9], niveau: niveauLits,
    aide: "Cliquez un patient pour savoir ce dont il a besoin, puis cliquez le bon soin en bas (ou touches 1 à 8). Les cas critiques passent au bloc (un seul patient à la fois) : bouton « Envoyer au bloc » (ou touche B) quand c'est leur tour. Trois décès ou départs et c'est fini.",
    fin: "Service débordé 🚑",
    init() { const lits = niveauLits(); const s0 = { lits, lit: new Array(lits).fill(null), attente: [], bloc: null, sel: null, t: 0, prochain: 1, score: 0, morts: 0, mort: false, textes: [], msg: null, rec: record("urgences" + lits) };
      for (let i = 0; i < NIVEAUX[lits].depart; i++) { const p = nouveauPatient(s0); p.etat = "lit"; s0.lit[i] = p; }   // le service n'est pas vide au départ
      return s0; },
    action() { /* le jeu se joue à la souris / au doigt */ },
    bas() { /* inutilisé */ },
    clic,
    touche(s, key) { const i = +key - 1; if (i >= 0 && i < SOINS_ORDRE.length) appliquer(s, SOINS_ORDRE[i]); else if (key === "b" || key === "B") versBloc(s); },
    step(s, dt) {
      s.t += dt;
      const n = NIVEAUX[s.lits];
      s.prochain -= dt;
      if (s.prochain <= 0) {
        s.prochain = Math.max(n.mini, n.debut - s.t * 0.035) * (0.8 + Math.random() * 0.4);
        if (s.attente.length < 3 || libre(s) >= 0) s.attente.push(nouveauPatient(s));
      }
      // admission dans un lit libre (le plus ancien d'abord)
      let k;
      while (s.attente.length && (k = libre(s)) >= 0) { const p = s.attente.shift(); p.etat = "lit"; s.lit[k] = p; }
      s.attente.forEach(p => { p.patience -= dt; });
      for (let j = s.attente.length - 1; j >= 0; j--) if (s.attente[j].patience <= 0) { s.attente.splice(j, 1); perdre(s, "Parti sans soins", ATTENTE.x + 70, ATTENTE.y + 70); }
      for (let i = 0; i < s.lits; i++) {
        const p = s.lit[i]; if (!p) continue;
        if (p.etat === "bloc") {
          p.reste -= dt;
          if (p.reste <= 0) { s.bloc = null; p.etat = "lit"; p.i++; p.vie = Math.min(100, p.vie + 18); s.textes.push({ x: BLOC.x + 70, y: BLOC.y + 60, txt: "Opéré ✔", vie: 1.2, coul: "#2f9e5b" }); }
        } else {
          p.vie -= p.taux * dt;
          if (p.vie <= 0) { const r = lit(s, i); s.lit[i] = null; if (s.sel === p) s.sel = null; perdre(s, "💀", r.x + r.w / 2, r.y + r.h / 2); }
        }
      }
      s.textes.forEach(t => { t.y -= 22 * dt; t.vie -= dt; }); s.textes = s.textes.filter(t => t.vie > 0);
      if (s.msg) { s.msg.vie -= dt; if (s.msg.vie <= 0) s.msg = null; }
    },
    draw(ctx, s, c) {
      const txt = (t, x, y, taille, coul, gras, al) => { ctx.fillStyle = coul || c.texte; ctx.font = (gras ? "bold " : "") + taille + "px system-ui,sans-serif"; ctx.textAlign = al || "left"; ctx.fillText(t, x, y); ctx.textAlign = "left"; };
      const court = (t, w, taille) => { ctx.font = taille + "px system-ui,sans-serif"; if (ctx.measureText(t).width <= w) return t; while (t.length > 1 && ctx.measureText(t + "…").width > w) t = t.slice(0, -1); return t + "…"; };
      const barre = (x, y, w, v, coul) => { ctx.fillStyle = "rgba(127,150,180,.25)"; bord(ctx, x, y, w, 7, 3); ctx.fill(); if (v > 0) { ctx.fillStyle = coul; bord(ctx, x, y, Math.max(4, w * v), 7, 3); ctx.fill(); } };
      const couleurVie = v => v > 66 ? "#3aa76d" : v > 33 ? "#e0a020" : "#d33a3a";
      // bandeau du haut
      txt("✔ Soignés : " + s.score, 10, 24, 16, c.texte, true);
      txt("Record : " + Math.max(s.rec, s.score), 190, 24, 13, c.doux);
      for (let i = 0; i < VIES; i++) emoji(ctx, i < VIES - s.morts ? "❤️" : "🖤", 520 + i * 28, 26, 20);
      // lits : un vrai lit (tête de lit, matelas, oreiller, couverture), la tête du patient sur l'oreiller
      for (let i = 0; i < s.lits; i++) {
        const r = lit(s, i), p = s.lit[i], enBloc = p && p.etat === "bloc", critique = p && !enBloc && p.vie < 30 && Math.floor(s.t * 3) % 2 === 0;
        if (p && s.sel === p) { ctx.strokeStyle = "#2f7de1"; ctx.lineWidth = 3; bord(ctx, r.x, r.y, r.w, r.h, 10); ctx.stroke(); ctx.fillStyle = "rgba(47,125,225,.07)"; ctx.fill(); }
        else if (critique) { ctx.strokeStyle = "#d33a3a"; ctx.lineWidth = 3; bord(ctx, r.x, r.y, r.w, r.h, 10); ctx.stroke(); }
        const bx = r.x + 6, bw = r.w - 12, by = r.y + 24, bh = r.h - 24 - 24;
        ctx.fillStyle = "#7f93ab"; bord(ctx, bx, by + bh * 0.02, 7, bh * 0.92, 3); ctx.fill();                                   // tête de lit
        ctx.fillRect(bx + bw - 6, by + bh * 0.3, 5, bh * 0.64);                                                                // pied de lit
        ctx.fillStyle = "#9fb2c8"; bord(ctx, bx + 4, by + bh * 0.52, bw - 8, bh * 0.28, 4); ctx.fill();                          // sommier
        ctx.fillStyle = "#eaf2fb"; ctx.strokeStyle = "#a9bdd3"; ctx.lineWidth = 1.5; bord(ctx, bx + 8, by + bh * 0.3, bw - 16, bh * 0.36, 6); ctx.fill(); ctx.stroke();   // matelas
        ctx.fillStyle = "#6f7f92"; ctx.fillRect(bx + 10, by + bh * 0.8, 4, bh * 0.2); ctx.fillRect(bx + bw - 14, by + bh * 0.8, 4, bh * 0.2);   // pieds
        txt("Lit " + (i + 1), r.x + 8, r.y + 15, 11, c.doux);
        if (!p) { txt("libre", r.x + r.w / 2, by + bh * 0.52, 12, c.doux, false, "center"); continue; }
        if (enBloc) { txt("au bloc 🏥", r.x + r.w / 2, by + bh * 0.52, 12, c.doux, false, "center"); continue; }
        ctx.fillStyle = "#fff"; ctx.strokeStyle = "#cfdbe8"; bord(ctx, bx + 14, by + bh * 0.2, 36, bh * 0.3, 8); ctx.fill(); ctx.stroke();   // oreiller
        const tete = Math.min(34, Math.round(bh * 0.62)); emoji(ctx, p.visage, bx + 32 - tete * 0.55, by + bh * 0.5, tete);
        ctx.globalAlpha = 0.9; ctx.fillStyle = p.vie > 66 ? "#8fd1ac" : p.vie > 33 ? "#f2cf7d" : "#ef9a9a"; bord(ctx, bx + 54, by + bh * 0.26, bw - 66, bh * 0.4, 7); ctx.fill(); ctx.globalAlpha = 1;   // couverture selon l'état
        emoji(ctx, humeur(p.vie), r.x + r.w - 24, r.y + 18, 17);
        if (p.vu) { const e = p.etapes[p.i]; emoji(ctx, SOINS_ICONE(e), r.x + r.w - 46, r.y + 18, 17); }
        txt(court(p.vu ? p.motif : "À examiner (cliquez)", r.w - 12, 10), r.x + 6, r.y + r.h - 13, 10, c.doux);
        barre(r.x + 6, r.y + r.h - 9, r.w - 12, p.vie / 100, couleurVie(p.vie));
      }
      // bloc opératoire
      ctx.fillStyle = s.bloc ? "rgba(211,58,58,.12)" : c.fond; ctx.strokeStyle = s.bloc ? "#d33a3a" : c.trait; ctx.lineWidth = 2; bord(ctx, BLOC.x, BLOC.y, BLOC.w, BLOC.h, 8); ctx.fill(); ctx.stroke();
      txt("🏥 Bloc opératoire", BLOC.x + 8, BLOC.y + 18, 12, c.texte, true);
      if (s.bloc) { emoji(ctx, s.bloc.visage, BLOC.x + 50, BLOC.y + 90, 44); barre(BLOC.x + 10, BLOC.y + 124, BLOC.w - 20, 1 - s.bloc.reste / DUREE_BLOC, "#2f7de1"); txt("opération en cours…", BLOC.x + BLOC.w / 2, BLOC.y + 116, 10.5, c.doux, false, "center"); }
      else txt("libre", BLOC.x + BLOC.w / 2, BLOC.y + 86, 13, c.doux, false, "center");
      // salle d'attente
      ctx.fillStyle = c.fond; ctx.strokeStyle = c.trait; ctx.lineWidth = 2; bord(ctx, ATTENTE.x, ATTENTE.y, ATTENTE.w, ATTENTE.h, 8); ctx.fill(); ctx.stroke();
      txt("Salle d'attente", ATTENTE.x + 8, ATTENTE.y + 18, 12, c.texte, true);
      s.attente.slice(0, 3).forEach((p, i) => { const y = ATTENTE.y + 30 + i * 41; emoji(ctx, p.visage, ATTENTE.x + 8, y + 26, 26); barre(ATTENTE.x + 44, y + 14, ATTENTE.w - 54, p.patience / PATIENCE, couleurVie(p.patience / PATIENCE * 100)); });
      if (!s.attente.length) txt("personne", ATTENTE.x + ATTENTE.w / 2, ATTENTE.y + 80, 12, c.doux, false, "center");
      // fiche du patient sélectionné
      ctx.fillStyle = c.fond; ctx.strokeStyle = c.trait; ctx.lineWidth = 2; bord(ctx, 8, 354, 474, 40, 8); ctx.fill(); ctx.stroke();
      const p = s.sel, auBloc = p && p.etat === "lit" && p.etapes[p.i].k === "bloc";
      if (s.msg) txt(court(s.msg.txt, 450, 13), 18, 379, 13, "#d33a3a", true);
      else if (!p) txt("Cliquez sur un patient pour voir ce dont il a besoin.", 18, 379, 13, c.doux);
      else {
        txt(p.motif, 18, 370, 12.5, c.texte, true);
        let x = 18 + ctx.measureText(p.motif).width + 14;
        p.etapes.forEach((e, i) => {
          if (i < p.i) txt("✔", x + 8, 370, 13, "#2f9e5b", true, "center");
          else { emoji(ctx, SOINS_ICONE(e), x, 371, 15); if (i === p.i) { ctx.fillStyle = "#2f7de1"; ctx.fillRect(x, 374, 18, 2); } }
          x += 24;
        });
        const e = p.etapes[p.i]; txt(court("À faire : " + SOINS_ICONE(e) + " " + e.t, 450, 12), 18, 388, 12, "#2f7de1", true);
      }
      // bouton d'envoi au bloc : actif quand le patient choisi en a besoin
      const prêt = auBloc && !s.bloc;
      ctx.fillStyle = prêt ? "#d33a3a" : auBloc ? "rgba(211,58,58,.25)" : "rgba(127,150,180,.15)"; bord(ctx, BTN_BLOC.x, BTN_BLOC.y, BTN_BLOC.w, BTN_BLOC.h, 8); ctx.fill();
      txt(auBloc && s.bloc ? "Bloc occupé" : "🏥 Envoyer au bloc", BTN_BLOC.x + BTN_BLOC.w / 2, BTN_BLOC.y + 23, 13, prêt ? "#fff" : c.doux, true, "center");
      // plateau de soins : icône au-dessus, nom dessous, numéro de touche en coin
      outils().forEach((o, i) => {
        ctx.fillStyle = c.fond; ctx.strokeStyle = c.trait; ctx.lineWidth = 2; bord(ctx, o.x, o.y, o.w, o.h, 8); ctx.fill(); ctx.stroke();
        emoji(ctx, SOINS[o.k].e, o.x + o.w / 2 - 11, o.y + 22, 20);
        txt((i + 1) + "", o.x + 8, o.y + 12, 9.5, c.doux);
        txt(SOINS[o.k].nom, o.x + o.w / 2, o.y + 36, 10, c.texte, false, "center");
      });
      ctx.textAlign = "center"; ctx.font = "bold 16px system-ui,sans-serif";
      s.textes.forEach(t => { ctx.globalAlpha = Math.min(1, t.vie * 2); ctx.fillStyle = t.coul; ctx.strokeStyle = c.fond; ctx.lineWidth = 3; ctx.strokeText(t.txt, t.x, t.y); ctx.fillText(t.txt, t.x, t.y); }); ctx.globalAlpha = 1; ctx.textAlign = "left";
    }
  };
  const SOINS_ICONE = e => e.k === "bloc" ? "🏥" : SOINS[e.k].e;


  /* ---------- 4. Le couloir ---------- */
  // Vue en perspective d'un couloir : z va de 0 (fond) à 1 (devant nous), lx de -1 (mur gauche) à +1 (mur droit).
  const HC = 300, HORIZON = 104, CX = W / 2, DEMI = 250, VIES_C = 5;
  const PORTES = [0.3, 0.5, 0.7, 0.88];
  const echelle = z => 0.07 + 0.93 * Math.pow(Math.max(0, Math.min(1, z)), 1.6);
  const pied = z => HORIZON + (HC - HORIZON) * echelle(z);
  const plafond = z => HORIZON - HORIZON * echelle(z);
  const abscisse = (lx, z) => CX + lx * DEMI * echelle(z);
  const taille = z => 118 * echelle(z);
  const boite = e => { const t = taille(e.z), x = abscisse(e.lx, e.z); return { x: x - t * 0.36, y: pied(e.z) - t * 0.95, w: t * 0.72, h: t * 0.95 }; };
  const BTN_DOSSIER = { x: 8, y: HC - 36, w: 150, h: 30 }, BTN_SECU = { x: 166, y: HC - 36, w: 150, h: 30 };
  const VISAGES_CO = ["🧓", "👵", "🧑‍🦱", "👨‍🦳", "🧔", "👩‍🦰"];
  const CD_TIR = 0.28, CD_SECU = 3, CD_DOSSIER = 0.5;

  const texteC = (s, txt, x, y, coul) => s.textes.push({ x, y, txt, vie: 1.1, coul: coul || "#d33a3a" });
  function perdreC(s, pts, coeur, txt, x, y) {
    s.score = Math.max(0, s.score - pts);
    if (coeur) { s.vies--; s.secousse = 0.25; if (s.vies <= 0) s.mort = true; }
    texteC(s, txt + (pts ? " −" + pts : ""), x, y);
  }
  function gagnerC(s, pts, txt, x, y) { s.score += pts; texteC(s, txt + " +" + pts, x, y, "#2f9e5b"); }

  function nouveauPatientC(s, porte, cote) {
    const lc = cote === undefined ? (Math.random() < 0.5 ? -1 : 1) : cote;
    const z = porte === undefined ? PORTES[Math.floor(Math.random() * PORTES.length)] : porte;
    const e = { k: "p", etat: "sort", z, lx: lc * 1.0, cote: lc, cible: alea(-0.45, 0.45), visage: VISAGES_CO[Math.floor(Math.random() * VISAGES_CO.length)], t: 0 };
    s.ents.push(e); return e;
  }
  const nouveauMedecin = s => { const e = { k: "d", etat: "vient", z: 0.08, lx: alea(-0.25, 0.25), t: 0 }; s.ents.push(e); return e; };
  const nouvelAgite = s => { const e = { k: "a", etat: "fonce", z: 0.08, lx: alea(-0.35, 0.35), t: 0 }; s.ents.push(e); return e; };

  function tirer(s, x, y) {
    if (s.cdTir > 0) return;
    s.cdTir = CD_TIR; s.tirs.push({ x, y, vie: 0.14 });
    const cible = s.ents.filter(e => e.etat !== "retour" && e.etat !== "plaque" && chevauche({ x: x - 4, y: y - 4, w: 8, h: 8 }, boite(e))).sort((a, b) => b.z - a.z)[0];
    if (!cible) return;
    const b = boite(cible), cx = b.x + b.w / 2;
    if (cible.k === "p") { cible.etat = "retour"; cible.t = 0; gagnerC(s, 10, "Retour en chambre 💤", cx, b.y); }
    else if (cible.k === "d") { if (!cible.fache) { cible.fache = true; perdreC(s, 10, false, "Pas le médecin !", cx, b.y); } }
    else texteC(s, "Trop agité : la sécu !", cx, b.y, "#e0a020");
  }
  function dossier(s) {
    if (s.cdDossier > 0) return; s.cdDossier = CD_DOSSIER;
    const d = s.ents.filter(e => e.k === "d" && !e.servi && e.z >= 0.4).sort((a, b) => b.z - a.z)[0];
    if (!d) { texteC(s, "Pas de médecin à portée", CX, 130, "#e0a020"); return; }
    d.servi = true; const b = boite(d); gagnerC(s, 15, "Dossier remis ✔", b.x + b.w / 2, b.y);
  }
  function secu(s) {
    if (s.cdSecu > 0) return;
    const cibles = s.ents.filter(e => e.k === "a" && e.etat === "fonce" && e.z >= 0.12);
    if (!cibles.length) { s.cdSecu = 1; texteC(s, "Personne à plaquer", CX, 130, "#e0a020"); return; }
    s.cdSecu = CD_SECU;
    cibles.forEach(a => { a.etat = "plaque"; a.t = 0; const b = boite(a); gagnerC(s, 20, "Plaqué par la sécu 🛡️", b.x + b.w / 2, b.y); });
  }

  const couloir = {
    nom: "couloir", titre: "🚪 Couloir", h: HC, unite: " pts", fin: "Service débordé 🚑", curseur: "crosshair",
    aide: "Cliquez sur un patient qui sort de sa chambre pour lui envoyer un calmant et le renvoyer se coucher. Un médecin passe : bouton « Dossier » (touche D) quand il est assez près, sans lui tirer dessus. Un patient agité fonce sur vous : bouton « Sécu » (touche S) pour le faire plaquer. Chaque fugue ou agité qui vous touche coûte un cœur et des points.",
    init() { return { t: 0, score: 0, vies: VIES_C, mort: false, ents: [], tirs: [], textes: [], cdTir: 0, cdSecu: 0, cdDossier: 0, secousse: 0, mx: CX, my: 150, prochainP: 0.6, prochainD: 20, prochainA: 32, rec: record("couloir") }; },
    action() { /* se joue à la souris / au doigt */ },
    bas() { /* inutilisé */ },
    bouge(s, x, y) { s.mx = x; s.my = y; },
    clic(s, x, y) {
      s.mx = x; s.my = y;
      if (chevauche({ x, y, w: 1, h: 1 }, BTN_DOSSIER)) return dossier(s);
      if (chevauche({ x, y, w: 1, h: 1 }, BTN_SECU)) return secu(s);
      tirer(s, x, y);
    },
    touche(s, key) { if (key === "d" || key === "D" || key === "2") dossier(s); else if (key === "s" || key === "S" || key === "3") secu(s); },
    step(s, dt) {
      s.t += dt; s.cdTir = Math.max(0, s.cdTir - dt); s.cdSecu = Math.max(0, s.cdSecu - dt); s.cdDossier = Math.max(0, s.cdDossier - dt); s.secousse = Math.max(0, s.secousse - dt);
      // Apparitions : seulement des patients au début, puis des médecins, puis des patients agités ; le rythme monte avec le temps.
      s.prochainP -= dt;
      if (s.prochainP <= 0) { s.prochainP = Math.max(0.8, 2.3 - s.t * 0.02) * alea(0.8, 1.2); if (s.ents.filter(e => e.k === "p" && e.etat !== "retour").length < 8) nouveauPatientC(s); }
      s.prochainD -= dt; if (s.prochainD <= 0) { s.prochainD = alea(12, 20); nouveauMedecin(s); }
      s.prochainA -= dt; if (s.prochainA <= 0) { s.prochainA = Math.max(6, 14 - s.t * 0.06) * alea(0.8, 1.2); nouvelAgite(s); }
      const vp = Math.min(0.2, 0.1 + s.t * 0.0006);
      s.ents.forEach(e => {
        e.t += dt;
        if (e.k === "p") {
          if (e.etat === "sort") { e.lx += Math.sign(e.cible - e.lx) * Math.min(Math.abs(e.cible - e.lx), 1.3 * dt); e.z -= vp * dt; if (e.z <= 0.06) { e.etat = "parti"; const b = boite(e); perdreC(s, 10, true, "Patient en fuite !", b.x + b.w / 2, b.y + 20); } }
          else if (e.etat === "retour") { e.lx += e.cote * 2 * dt; if (e.t > 0.7) e.etat = "parti"; }
        } else if (e.k === "d") {
          e.z += 0.1 * dt;
          if (e.z >= 1) { e.etat = "parti"; if (!e.servi) perdreC(s, 5, false, "Médecin sans dossier", CX, 150); }
        } else {
          if (e.etat === "fonce") { e.z += 0.4 * dt; if (e.z >= 1) { e.etat = "parti"; perdreC(s, 15, true, "Touché !", CX, 160); } }
          else if (e.etat === "plaque" && e.t > 0.9) e.etat = "parti";
        }
      });
      s.ents = s.ents.filter(e => e.etat !== "parti");
      s.tirs.forEach(t => { t.vie -= dt; }); s.tirs = s.tirs.filter(t => t.vie > 0);
      s.textes.forEach(t => { t.y -= 24 * dt; t.vie -= dt; }); s.textes = s.textes.filter(t => t.vie > 0);
    },
    draw(ctx, s, c) {
      const poly = (pts, coul) => { ctx.fillStyle = coul; ctx.beginPath(); pts.forEach((p, i) => i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])); ctx.closePath(); ctx.fill(); };
      const txt = (t, x, y, tl, coul, gras, al) => { ctx.fillStyle = coul; ctx.font = (gras ? "bold " : "") + tl + "px system-ui,sans-serif"; ctx.textAlign = al || "left"; ctx.fillText(t, x, y); ctx.textAlign = "left"; };
      ctx.save();
      if (s.secousse > 0) ctx.translate(Math.sin(s.t * 80) * 4, 0);
      // décor : plafond, sol, murs, porte du fond
      const z0 = 0, s0 = echelle(z0);
      poly([[0, 0], [W, 0], [CX + DEMI * s0, plafond(z0)], [CX - DEMI * s0, plafond(z0)]], "#dfe7ef");
      poly([[0, HC], [W, HC], [CX + DEMI * s0, pied(z0)], [CX - DEMI * s0, pied(z0)]], "#c4ccd6");
      poly([[0, 0], [CX - DEMI * s0, plafond(z0)], [CX - DEMI * s0, pied(z0)], [0, HC]], "#eef3f8");
      poly([[W, 0], [CX + DEMI * s0, plafond(z0)], [CX + DEMI * s0, pied(z0)], [W, HC]], "#e4ecf4");
      poly([[CX - DEMI * s0, plafond(z0)], [CX + DEMI * s0, plafond(z0)], [CX + DEMI * s0, pied(z0)], [CX - DEMI * s0, pied(z0)]], "#b9c6d4");
      for (let k = 1; k < 14; k++) { const z = Math.pow(k / 14, 1.2); ctx.strokeStyle = "rgba(120,135,155,.35)"; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(CX - DEMI * echelle(z), pied(z)); ctx.lineTo(CX + DEMI * echelle(z), pied(z)); ctx.stroke(); }
      PORTES.forEach(z => [-1, 1].forEach(cote => {
        const z1 = z - 0.05, z2 = z + 0.05, h1 = (pied(z1) - plafond(z1)) * 0.62, h2 = (pied(z2) - plafond(z2)) * 0.62;
        poly([[abscisse(cote, z1), pied(z1)], [abscisse(cote, z2), pied(z2)], [abscisse(cote, z2), pied(z2) - h2], [abscisse(cote, z1), pied(z1) - h1]], "#7d8fa6");
      }));
      txt("SORTIE", CX, HORIZON + 14, 9, "#e04b4b", true, "center");
      // personnages, du plus loin au plus proche
      s.ents.slice().sort((a, b) => a.z - b.z).forEach(e => {
        const t = taille(e.z), x = abscisse(e.lx, e.z), y = pied(e.z);
        ctx.fillStyle = "rgba(0,0,0,.18)"; ctx.beginPath(); ctx.ellipse(x, y, t * 0.3, t * 0.07, 0, 0, Math.PI * 2); ctx.fill();
        ctx.save();
        if (e.etat === "retour") ctx.globalAlpha = Math.max(0.2, 1 - e.t / 0.8);
        if (e.etat === "plaque") { ctx.translate(x, y); ctx.rotate(Math.min(1.4, e.t * 3)); ctx.translate(-x, -y); }
        const ic = e.k === "p" ? (e.etat === "retour" ? "😴" : e.visage) : e.k === "d" ? (e.servi ? "🧑‍⚕️" : "🧑‍⚕️") : (e.etat === "plaque" ? "🛡️" : "🏃");
        emoji(ctx, ic, x - t * 0.52, y - t * 0.1, t * 0.95);
        ctx.restore();
        if (e.k === "d" && !e.servi && e.z >= 0.4) { ctx.fillStyle = "#2f7de1"; ctx.font = "bold " + Math.max(10, t * 0.2) + "px system-ui,sans-serif"; ctx.textAlign = "center"; ctx.fillText("📋 ?", x, y - t * 1.02); ctx.textAlign = "left"; }
        if (e.k === "d" && e.servi) txt("✔", x, y - t * 1.02, Math.max(12, t * 0.25), "#2f9e5b", true, "center");
        if (e.k === "a" && e.etat === "fonce") txt("❗", x, y - t * 1.02, Math.max(12, t * 0.3), "#d33a3a", true, "center");
      });
      s.tirs.forEach(t => { ctx.strokeStyle = "rgba(47,125,225," + Math.min(1, t.vie * 7) + ")"; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(CX, HC - 40); ctx.lineTo(t.x, t.y); ctx.stroke(); emoji(ctx, "💉", t.x - 9, t.y + 7, 18); });
      ctx.restore();
      // viseur
      ctx.strokeStyle = s.cdTir > 0 ? "rgba(224,160,32,.9)" : "rgba(211,58,58,.95)"; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(s.mx, s.my, 11, 0, Math.PI * 2); ctx.moveTo(s.mx - 17, s.my); ctx.lineTo(s.mx - 5, s.my); ctx.moveTo(s.mx + 5, s.my); ctx.lineTo(s.mx + 17, s.my); ctx.moveTo(s.mx, s.my - 17); ctx.lineTo(s.mx, s.my - 5); ctx.moveTo(s.mx, s.my + 5); ctx.lineTo(s.mx, s.my + 17); ctx.stroke();
      // bandeau, cœurs, boutons
      txt("Score : " + s.score, 10, 22, 16, "#1f2937", true);
      txt("Record : " + Math.max(s.rec, s.score), 150, 22, 12, "#52627a");
      for (let i = 0; i < VIES_C; i++) emoji(ctx, i < s.vies ? "❤️" : "🖤", 480 + i * 30, 26, 20);
      const bouton = (r, lib, cd, cdMax, actif) => {
        ctx.fillStyle = cd > 0 ? "rgba(127,150,180,.55)" : actif; bord(ctx, r.x, r.y, r.w, r.h, 8); ctx.fill();
        if (cd > 0) { ctx.fillStyle = "rgba(255,255,255,.35)"; bord(ctx, r.x, r.y, Math.max(6, r.w * (1 - cd / cdMax)), r.h, 8); ctx.fill(); }
        txt(lib, r.x + r.w / 2, r.y + 20, 13, "#fff", true, "center");
      };
      bouton(BTN_DOSSIER, "📋 Dossier (D)", s.cdDossier, CD_DOSSIER, "#2f7de1");
      bouton(BTN_SECU, "🛡️ Sécu (S)", s.cdSecu, CD_SECU, "#d33a3a");
      ctx.textAlign = "center"; ctx.font = "bold 15px system-ui,sans-serif";
      s.textes.forEach(t => { ctx.globalAlpha = Math.min(1, t.vie * 2); ctx.fillStyle = t.coul; ctx.strokeStyle = "#fff"; ctx.lineWidth = 3; ctx.strokeText(t.txt, t.x, t.y); ctx.fillText(t.txt, t.x, t.y); }); ctx.globalAlpha = 1; ctx.textAlign = "left";
    }
  };

  const JEUX = { course, seringue, urgences, couloir };

  // Avatar de la course (choix mémorisé dans le navigateur).
  const AVATARS = [{ e: "👩‍⚕️", nom: "Femme" }, { e: "👨‍⚕️", nom: "Homme" }, { e: "🧑‍⚕️", nom: "Neutre" }];
  const lireAvatar = () => { try { const v = localStorage.getItem("lydia_jeu_avatar"); return AVATARS.some(a => a.e === v) ? v : AVATARS[0].e; } catch (e) { return AVATARS[0].e; } };
  let avatar = lireAvatar();

  /* ---------- Fenêtre et boucle ---------- */
  let actif = null;   // { jeu, s, etat: "pret" | "jeu" | "fini", raf, t0, cv, ctx, nettoyer }

  function dessiner() {
    const { jeu, s, ctx } = actif; if (!ctx) return;
    const c = couleurs(), H = jeu.h || 260, cle = jeu.cle ? jeu.cle(s) : jeu.nom;
    ctx.clearRect(0, 0, W, H); ctx.fillStyle = c.fond; ctx.fillRect(0, 0, W, H);
    jeu.draw(ctx, s, c);
    const centre = (txt, y, taille, coul) => { ctx.fillStyle = coul || c.texte; ctx.font = (taille >= 20 ? "bold " : "") + taille + "px system-ui,sans-serif"; ctx.textAlign = "center"; ctx.fillText(txt, W / 2, y); ctx.textAlign = "left"; };
    if (actif.etat === "pret") centre("Espace ou toucher pour commencer", H / 2 - 20, 20);
    if (actif.etat === "fini") {
      ctx.fillStyle = "rgba(0,0,0,.35)"; ctx.fillRect(0, 0, W, H);
      centre(jeu.fin, H / 2 - 24, 24, "#fff"); centre("Score : " + s.score + (jeu.unite || "") + " · record : " + record(cle) + (jeu.unite || ""), H / 2 + 8, 18, "#fff"); 
    }
    if (actif.maj) actif.maj(s.score, record(cle));
  }

  function boucle(t) {
    if (!actif) return;
    const dt = Math.min(0.05, (t - actif.t0) / 1000); actif.t0 = t;
    if (actif.etat === "jeu") {
      actif.jeu.step(actif.s, dt);
      if (actif.s.mort) { actif.etat = "fini"; record(actif.jeu.cle ? actif.jeu.cle(actif.s) : actif.jeu.nom, actif.s.score); if (actif.rej) actif.rej.style.display = "block"; }
    }
    dessiner();
    actif.raf = root.requestAnimationFrame(boucle);
  }

  function appuyer() {
    if (!actif) return;
    if (actif.etat === "pret") { actif.etat = "jeu"; actif.jeu.action(actif.s); }
    // « fini » : ni Espace ni toucher ne relancent la partie (on risquerait d'enchaîner), seul le bouton « Rejouer » le fait.
    else actif.jeu.action(actif.s);
  }

  function ouvrir(nom, zone, maj) {
    fermer();
    const jeu = JEUX[nom]; if (!jeu || !zone) return false;
    const doc = zone.ownerDocument;
    zone.innerHTML = '<div style="position:relative;max-width:' + W + 'px"><canvas width="' + W + '" height="' + (jeu.h || H) + '" style="display:block;width:100%;border:1px solid var(--bd);border-radius:10px;touch-action:none;background:var(--card)" tabindex="0" aria-label="' + jeu.titre + '"></canvas><div class="jeurejouer" style="display:none;position:absolute;left:50%;top:68%;transform:translateX(-50%)"><button type="button" class="btn">↻ Rejouer</button></div></div><div class="meta" style="margin-top:6px"></div>';
    const cv = zone.querySelector("canvas"); zone.querySelector(".meta").textContent = jeu.aide;
    const rej = zone.querySelector(".jeurejouer");
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
      zone.insertBefore(bar, zone.firstChild);
    }
    if (jeu.niveaux) {
      const bar = doc.createElement("div"); bar.className = "jeuniveau"; bar.style.cssText = "display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:6px";
      const cur = jeu.niveau();
      bar.innerHTML = '<span class="meta">Nombre de lits :</span>' + jeu.niveaux.map(n => '<button type="button" class="btn sm sec" data-lits="' + n + '" aria-pressed="' + (n === cur) + '"' + (n === cur ? ' style="outline:2px solid var(--pri)"' : "") + ">" + n + "</button>").join("");
      bar.addEventListener("click", e => {
        const b = e.target.closest("[data-lits]"); if (!b || !actif) return;
        try { localStorage.setItem("lydia_jeu_lits", b.dataset.lits); } catch (x) { /* ignoré */ }
        bar.querySelectorAll("[data-lits]").forEach(o => { const on = o === b; o.setAttribute("aria-pressed", String(on)); o.style.outline = on ? "2px solid var(--pri)" : ""; });
        actif.s = jeu.init(); actif.etat = "pret"; actif.rej.style.display = "none";
      });
      zone.insertBefore(bar, zone.firstChild);
    }
    actif = { jeu, s: jeu.init(), etat: "pret", raf: 0, t0: 0, cv, ctx: cv.getContext ? cv.getContext("2d") : null, maj, rej };
    rej.querySelector("button").addEventListener("click", () => {
      if (!actif || actif.etat !== "fini") return;
      actif.s = jeu.init(); actif.etat = "pret"; rej.style.display = "none";
      try { cv.focus({ preventScroll: true }); } catch (e) { /* ignoré */ }
    });
    const touche = e => {
      if (!actif) return;
      if (jeu.touche && actif.etat === "jeu" && e.key !== " ") { jeu.touche(actif.s, e.key); return; }
      if (e.key === " " || e.key === "ArrowUp") { e.preventDefault(); if (!e.repeat) appuyer(); }
      else if (e.key === "ArrowDown") { e.preventDefault(); jeu.bas(actif.s, true); }
    };
    const relache = e => { if (e.key === " " && actif && actif.etat === "fini" && e.target && e.target.tagName === "BUTTON") e.preventDefault(); if (actif && e.key === "ArrowDown") jeu.bas(actif.s, false); };
    const doigt = e => {
      e.preventDefault();
      const r = cv.getBoundingClientRect();
      if (jeu.clic && actif.etat === "jeu") { jeu.clic(actif.s, (e.clientX - r.left) * W / r.width, (e.clientY - r.top) * (jeu.h || H) / r.height); return; }
      const bas = nom === "course" && (e.clientY - r.top) > r.height * 0.6;
      if (bas && actif.etat === "jeu") jeu.bas(actif.s, true); else appuyer();
    };
    const leve = () => { if (actif) jeu.bas(actif.s, false); };
    const vise = e => { if (!jeu.bouge || !actif) return; const r = cv.getBoundingClientRect(); jeu.bouge(actif.s, (e.clientX - r.left) * W / r.width, (e.clientY - r.top) * (jeu.h || H) / r.height); };
    if (jeu.bouge) { cv.addEventListener("pointermove", vise); cv.style.cursor = jeu.curseur || ""; }
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
    liste: Object.keys(JEUX).map(k => ({ id: k, titre: JEUX[k].titre, admin: !!JEUX[k].admin })),
    ouvrir, fermer, enCours: () => !!actif, record, avatar: () => avatar,
    _test: { JEUX, SOINS, chevauche, appuyer, etat: () => actif && actif.etat, finir: () => { actif.etat = "fini"; actif.rej.style.display = "block"; } }
  };
})(typeof window !== "undefined" ? window : globalThis);
