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
      centre(jeu.fin, H / 2 - 24, 24, "#fff"); centre("Score : " + s.score + (jeu.unite || "") + " · record : " + record(jeu.nom) + (jeu.unite || ""), H / 2 + 8, 18, "#fff"); centre("Cliquez sur « Rejouer » pour recommencer", H / 2 + 40, 15, "#fff");
    }
    if (actif.maj) actif.maj(s.score, record(jeu.nom));
  }

  function boucle(t) {
    if (!actif) return;
    const dt = Math.min(0.05, (t - actif.t0) / 1000); actif.t0 = t;
    if (actif.etat === "jeu") {
      actif.jeu.step(actif.s, dt);
      if (actif.s.mort) { actif.etat = "fini"; record(actif.jeu.nom, actif.s.score); if (actif.rej) actif.rej.style.display = "block"; }
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
    zone.innerHTML = '<canvas width="' + W + '" height="' + H + '" style="width:100%;max-width:' + W + 'px;border:1px solid var(--bd);border-radius:10px;touch-action:none;background:var(--card)" tabindex="0" aria-label="' + jeu.titre + '"></canvas><div class="jeurejouer" style="display:none;margin-top:8px"><button type="button" class="btn">↻ Rejouer</button></div><div class="meta" style="margin-top:6px"></div>';
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
      zone.insertBefore(bar, cv);
    }
    actif = { jeu, s: jeu.init(), etat: "pret", raf: 0, t0: 0, cv, ctx: cv.getContext ? cv.getContext("2d") : null, maj, rej };
    rej.querySelector("button").addEventListener("click", () => {
      if (!actif || actif.etat !== "fini") return;
      actif.s = jeu.init(); actif.etat = "pret"; rej.style.display = "none";
      try { cv.focus({ preventScroll: true }); } catch (e) { /* ignoré */ }
    });
    const touche = e => {
      if (!actif) return;
      if (e.key === " " || e.key === "ArrowUp") { e.preventDefault(); if (!e.repeat) appuyer(); }
      else if (e.key === "ArrowDown") { e.preventDefault(); jeu.bas(actif.s, true); }
    };
    const relache = e => { if (e.key === " " && actif && actif.etat === "fini" && e.target && e.target.tagName === "BUTTON") e.preventDefault(); if (actif && e.key === "ArrowDown") jeu.bas(actif.s, false); };
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
    _test: { JEUX, chevauche, appuyer, etat: () => actif && actif.etat, finir: () => { actif.etat = "fini"; actif.rej.style.display = "block"; } }
  };
})(typeof window !== "undefined" ? window : globalThis);
