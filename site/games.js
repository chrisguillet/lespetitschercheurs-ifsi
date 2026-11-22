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
  // Personnes : patients, médecins, familles de toutes couleurs de peau, femmes, hommes et neutres, tirés au hasard.
  const TEINTES = ["\u{1F3FB}", "\u{1F3FC}", "\u{1F3FD}", "\u{1F3FE}", "\u{1F3FF}"];
  const auHasard = l => l[Math.floor(Math.random() * l.length)];
  // Tirage « en sac » : chaque valeur sort une fois avant qu'on remélange. Un vrai hasard fait des séries
  // (quatre peaux foncées sur neuf lits, par exemple) ; le sac garde une répartition égale à l'écran.
  const sac = liste => { let reste = []; return () => { if (!reste.length) { reste = liste.slice(); for (let i = reste.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [reste[i], reste[j]] = [reste[j], reste[i]]; } } return reste.pop(); }; };
  const teinteSuivante = sac(TEINTES);
  // Teinte de peau insérée après le premier caractère (elle s'applique aussi aux emojis composés : 👩‍🦰 → 👩🏾‍🦰).
  const teinte = (e, t) => { const c = [...e]; return c[0] + (t || teinteSuivante()) + c.slice(1).join(""); };
  // Patients des urgences : poules, coqs et poussins de plumages variés, tirés en sac (tous les profils passent avant de recommencer).
  const PLUMAGES = [["#fff8ec", "blanche"], ["#f3d7a8", "crème"], ["#c66b2e", "rousse"], ["#3b3433", "noire"], ["#a3a8b0", "grise"]];
  const COLLIERS = ["#e08a2a", "#b5541e", "#d9b24a", "#6b7a3a", "#e08a2a"];
  const VOLAILLES = [
    ...PLUMAGES.map(([p]) => ({ espece: "poule", plume: p })),
    ...PLUMAGES.map(([p], i) => ({ espece: "coq", plume: p, collier: COLLIERS[i] })),
    ...["#ffd84d", "#ffe680", "#f2c232"].map(p => ({ espece: "poussin", plume: p }))
  ];
  const patientAuHasard = sac(VOLAILLES);
  // Portrait d'un patient à plumes, aux mêmes coordonnées qu'un emoji : x à gauche, y sur la ligne de base, t la taille.
  function volaille(ctx, x, y, t, v) {
    const cx = x + t * 0.5, cy = y - t * 0.36, r = t * (v.espece === "poussin" ? 0.4 : 0.36), k = t / 34;
    const sombre = v.plume === "#3b3433", contour = sombre ? "#1d1817" : "rgba(110,70,30,.65)", rouge = "#e0362c", bec = "#f2a42b";
    const rond = (x0, y0, rr) => { ctx.beginPath(); ctx.arc(x0, y0, rr, 0, Math.PI * 2); };
    ctx.save(); ctx.globalAlpha = 1; ctx.lineCap = "round"; ctx.lineJoin = "round";
    if (v.espece === "coq") { ctx.fillStyle = v.collier; ctx.beginPath(); ctx.ellipse(cx - r * 0.1, cy + r * 0.75, r * 1.05, r * 0.6, 0, 0, Math.PI * 2); ctx.fill(); }   // collerette dorée du coq
    // Crête : petite pour la poule, grande et dentelée pour le coq, houppette pour le poussin.
    ctx.fillStyle = rouge;
    if (v.espece === "poule") [[-0.35, -0.95, 0.24], [0, -1.08, 0.28], [0.32, -0.95, 0.22]].forEach(([dx, dy, rr]) => { rond(cx + dx * r, cy + dy * r, rr * r); ctx.fill(); });
    if (v.espece === "coq") [[-0.6, -0.85, 0.26], [-0.3, -1.12, 0.3], [0.05, -1.25, 0.33], [0.4, -1.1, 0.29], [0.68, -0.82, 0.24]].forEach(([dx, dy, rr]) => { rond(cx + dx * r, cy + dy * r, rr * r); ctx.fill(); });
    // Tête
    ctx.fillStyle = v.plume; ctx.strokeStyle = contour; ctx.lineWidth = Math.max(1, 1.3 * k);
    rond(cx, cy, r); ctx.fill(); ctx.stroke();
    if (v.espece === "poussin") { ctx.strokeStyle = "#d9a520"; ctx.lineWidth = Math.max(1, 1.4 * k); ctx.beginPath(); [-0.25, 0, 0.25].forEach(d => { ctx.moveTo(cx + d * r * 0.6, cy - r * 0.95); ctx.lineTo(cx + d * r * 1.3, cy - r * 1.3); }); ctx.stroke(); }
    // Bec, barbillons
    ctx.fillStyle = bec; ctx.strokeStyle = "#c27a12"; ctx.lineWidth = Math.max(0.8, 1 * k);
    const lb = v.espece === "poussin" ? 0.32 : 0.45;
    ctx.beginPath(); ctx.moveTo(cx + r * 0.62, cy - r * 0.12); ctx.lineTo(cx + r * (0.62 + lb), cy + r * 0.08); ctx.lineTo(cx + r * 0.62, cy + r * 0.26); ctx.closePath(); ctx.fill(); ctx.stroke();
    if (v.espece !== "poussin") { ctx.fillStyle = rouge; ctx.beginPath(); ctx.ellipse(cx + r * 0.62, cy + r * 0.48, r * (v.espece === "coq" ? 0.18 : 0.13), r * (v.espece === "coq" ? 0.32 : 0.22), 0, 0, Math.PI * 2); ctx.fill(); }
    // Œil (cerclé de blanc sur un plumage sombre), cils pour la poule, joue rosée
    const ex = cx + r * 0.22, ey = cy - r * 0.18;
    if (sombre) { ctx.fillStyle = "#f4efe8"; rond(ex, ey, r * 0.24); ctx.fill(); }
    ctx.fillStyle = "#2a1709"; rond(ex, ey, r * (v.espece === "poussin" ? 0.15 : 0.13)); ctx.fill();
    ctx.fillStyle = "#ffffff"; rond(ex + r * 0.05, ey - r * 0.05, r * 0.045); ctx.fill();
    if (v.espece === "poule") { ctx.strokeStyle = sombre ? "#f4efe8" : "#2a1709"; ctx.lineWidth = Math.max(0.8, 0.9 * k); ctx.beginPath(); [-0.12, 0.05, 0.2].forEach(d => { ctx.moveTo(ex + d * r, ey - r * 0.15); ctx.lineTo(ex + d * r * 1.5, ey - r * 0.32); }); ctx.stroke(); }
    if (!sombre) { ctx.fillStyle = "rgba(240,120,110,.35)"; ctx.beginPath(); ctx.ellipse(cx - r * 0.12, cy + r * 0.3, r * 0.2, r * 0.12, 0, 0, Math.PI * 2); ctx.fill(); }
    ctx.restore();
  }
  // Visiteurs (obstacle de la course) : deux personnes, chacune avec sa couleur de peau.
  const visiteursAuHasard = () => auHasard([
    () => teinte("👫"), () => teinte("👭"), () => teinte("👬"),
    () => "🧑" + teinteSuivante() + "‍🤝‍🧑" + teinteSuivante()
  ])();
  const PEAUX = ["#f5d6c0", "#e8b896", "#c98e62", "#9a6440", "#5c3b26"], CHEVEUX = ["#2b2118", "#6b4a32", "#a8743f", "#d8c08a", "#8a8a8a", "#111"];
  const peauSuivante = sac(PEAUX);

  // Le personnage joué : la poule du logo Qocot, en blouse blanche d'infirmier·ère (croix rouge sur la poche).
  // o : h (taille des pattes au haut de la crête), ph (phase de marche), allure (0..1), air, face (1 : regarde à droite),
  // bras (0..1 : ailes levées), penche (radians), mine (grimace), accroupi.
  function soignant(ctx, x, sol, o) {
    const u = (o.h || 56) / 58, f = o.face || 1, marche = o.allure || 0, ph = o.ph || 0;
    const plume = "#fbe7c6", contour = "#b9772f", rouge = "#e0362c", bec = "#f2a42b", queue = ["#7a3f1a", "#a35a2a", "#8c4a20"];
    const rebond = o.air ? 0 : -Math.abs(Math.sin(ph)) * 2 * marche * u;
    const cy = -27 * u + rebond, hy = -45 * u + rebond, hx = f * 4 * u;   // centre du corps, centre de la tête
    const ovale = (x0, y0, rx, ry, rot) => { ctx.beginPath(); ctx.ellipse(x0, y0, rx, ry, rot || 0, 0, Math.PI * 2); };
    ctx.save();
    ctx.translate(x, sol); ctx.rotate(o.penche || 0);
    if (o.accroupi) ctx.scale(1.1, 0.6);
    ctx.lineCap = "round"; ctx.lineJoin = "round";
    // Queue : trois plumes brunes, derrière le corps.
    [[-0.9, 0], [-0.5, 1], [-1.3, 2]].forEach(([a, k]) => {
      ctx.fillStyle = queue[k]; ovale(-f * 13 * u, cy - 6 * u, 4 * u, 11 * u, f * a); ctx.fill();
    });
    // Pattes orange (trois doigts), en balancier quand elle marche, repliées en l'air.
    ctx.strokeStyle = bec; ctx.lineWidth = Math.max(1.8, 2.3 * u);
    [0, Math.PI].forEach((dep, k) => {
      const ang = o.air ? (k ? -0.35 : 0.45) : Math.sin(ph + dep) * 0.6 * marche;
      const hx0 = (k ? -4 : 4) * u, hy0 = cy + 12 * u;
      const px = hx0 + Math.sin(ang) * 14 * u, py = Math.min(0, hy0 + Math.cos(ang) * 14 * u);
      ctx.beginPath(); ctx.moveTo(hx0, hy0); ctx.lineTo(px, py); ctx.stroke();
      ctx.beginPath(); [-0.5, 0, 0.5].forEach(d => { ctx.moveTo(px, py); ctx.lineTo(px + f * Math.cos(d) * 4.5 * u, py + Math.sin(d) * 2 * u); }); ctx.stroke();
    });
    // Corps : boule de plumes crème.
    ctx.fillStyle = plume; ctx.strokeStyle = contour; ctx.lineWidth = Math.max(1.2, 1.5 * u);
    ovale(0, cy, 14 * u, 15 * u); ctx.fill(); ctx.stroke();
    // Blouse blanche : couvre le bas du corps (découpée à sa forme), col en V, boutons, poche à croix rouge.
    ctx.save(); ovale(0, cy, 14.6 * u, 15.6 * u); ctx.clip();
    ctx.fillStyle = "#ffffff"; ctx.fillRect(-16 * u, cy - 7 * u, 32 * u, 24 * u);
    ctx.beginPath(); ctx.moveTo(-9 * u, cy - 7 * u); ctx.lineTo(0, cy + 1 * u); ctx.lineTo(9 * u, cy - 7 * u); ctx.closePath(); ctx.fillStyle = plume; ctx.fill();
    ctx.strokeStyle = "#9aa8bb"; ctx.lineWidth = Math.max(1, 1.2 * u);
    ctx.beginPath(); ctx.moveTo(-16 * u, cy - 7 * u); ctx.lineTo(-9 * u, cy - 7 * u); ctx.lineTo(0, cy + 1 * u); ctx.lineTo(9 * u, cy - 7 * u); ctx.lineTo(16 * u, cy - 7 * u); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, cy + 1 * u); ctx.lineTo(0, cy + 17 * u); ctx.stroke();
    ctx.fillStyle = "#9aa8bb"; [5, 10].forEach(d => { ctx.beginPath(); ctx.arc(-f * 1.8 * u, cy + d * u, 0.9 * u, 0, 7); ctx.fill(); });
    const poche = f * 7 * u;   // centre de la poche, côté vers lequel elle regarde
    ctx.strokeStyle = "#9aa8bb"; ctx.strokeRect(poche - 3 * u, cy + 3.5 * u, 6 * u, 5 * u);
    ctx.fillStyle = "#d33a3a"; ctx.fillRect(poche - 2 * u, cy + 5.45 * u, 4 * u, 1.1 * u); ctx.fillRect(poche - 0.55 * u, cy + 4 * u, 1.1 * u, 4 * u);
    ctx.restore();
    ctx.strokeStyle = contour; ctx.lineWidth = Math.max(1.2, 1.5 * u); ovale(0, cy, 14 * u, 15 * u); ctx.stroke();
    // Ailes : balancier opposé aux pattes ; levées pour attraper, sauter ou au choc. Manche blanche à la base.
    const aile = cote => {
      const repos = cote * 0.5 + Math.sin(ph + (cote > 0 ? Math.PI : 0)) * 0.5 * marche;
      const ang = repos + (cote * 2.5 - repos) * (o.bras || 0);
      const ax = cote * 12 * u, ay = cy - 5 * u;
      ctx.save(); ctx.translate(ax, ay); ctx.rotate(-ang);
      ctx.fillStyle = plume; ctx.strokeStyle = contour; ctx.lineWidth = Math.max(1, 1.3 * u);
      ovale(0, 7 * u, 4.2 * u, 8.5 * u); ctx.fill(); ctx.stroke();
      ctx.strokeStyle = "rgba(185,119,47,.6)"; ctx.beginPath(); ctx.moveTo(-1.5 * u, 10 * u); ctx.lineTo(-1.5 * u, 14 * u); ctx.moveTo(1.5 * u, 10 * u); ctx.lineTo(1.5 * u, 14 * u); ctx.stroke();
      ctx.fillStyle = "#ffffff"; ctx.strokeStyle = "#9aa8bb"; ctx.lineWidth = Math.max(1, 1.1 * u);
      ovale(0, 2 * u, 4.6 * u, 3.6 * u); ctx.fill(); ctx.stroke();
      ctx.restore();
    };
    aile(-f);
    // Tête : crête rouge, bec orange, barbillon, grand œil brun (fermé et plissé au choc), cils, joue rose.
    ctx.fillStyle = rouge;
    [[-6, -8.5, 3.6], [-2, -10.5, 4.2], [2.5, -9.5, 3.6]].forEach(([dx, dy, r]) => { ctx.beginPath(); ctx.arc(hx + f * dx * u, hy + dy * u, r * u, 0, 7); ctx.fill(); });
    ctx.fillStyle = plume; ctx.strokeStyle = contour; ctx.lineWidth = Math.max(1.2, 1.5 * u);
    ctx.beginPath(); ctx.arc(hx, hy, 9.5 * u, 0, 7); ctx.fill(); ctx.stroke();
    ctx.fillStyle = bec; ctx.strokeStyle = "#c27a12"; ctx.lineWidth = Math.max(1, 1.1 * u);
    ctx.beginPath(); ctx.moveTo(hx + f * 8 * u, hy - 2.5 * u); ctx.lineTo(hx + f * 15 * u, hy + 0.5 * u); ctx.lineTo(hx + f * 8 * u, hy + 3 * u); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.fillStyle = rouge; ovale(hx + f * 8.5 * u, hy + 6 * u, 2 * u, 3.2 * u); ctx.fill();
    ctx.fillStyle = "rgba(240,120,110,.35)"; ovale(hx + f * 1 * u, hy + 4 * u, 2.6 * u, 1.6 * u); ctx.fill();
    const ex = hx + f * 4 * u, ey = hy - 2.5 * u;
    if (o.mine) { ctx.strokeStyle = "#3b2414"; ctx.lineWidth = Math.max(1.2, 1.5 * u); ctx.beginPath(); ctx.moveTo(ex - 2.5 * u, ey - 1.5 * u); ctx.lineTo(ex + 2.5 * u, ey); ctx.lineTo(ex - 2.5 * u, ey + 1.5 * u); ctx.stroke(); }
    else {
      ctx.fillStyle = "#ffffff"; ctx.strokeStyle = "#3b2414"; ctx.lineWidth = Math.max(1, 1.1 * u); ovale(ex, ey, 3.2 * u, 3.8 * u); ctx.fill(); ctx.stroke();
      ctx.fillStyle = "#5a2f12"; ovale(ex + f * 0.8 * u, ey + 0.5 * u, 2 * u, 2.6 * u); ctx.fill();
      ctx.fillStyle = "#ffffff"; ctx.beginPath(); ctx.arc(ex + f * 1.4 * u, ey - 0.4 * u, 0.7 * u, 0, 7); ctx.fill();
      ctx.strokeStyle = "#3b2414"; ctx.beginPath(); [-0.6, 0, 0.6].forEach(d => { ctx.moveTo(ex + (d * 3) * u, ey - 3.6 * u); ctx.lineTo(ex + (d * 4.5) * u, ey - 5.4 * u); }); ctx.stroke();
    }
    aile(f);
    ctx.restore();
  }

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
    { e: "visiteurs", w: 44, h: 44, haut: false, nom: "famille" },
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
    nom: "course-m", unite: " m", titre: "🏃 La course aux transmissions", desc: "Sautez et baissez-vous pour éviter les obstacles du service.",
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
        s.obs.push({ x: W + 20, y: t.haut ? 0 : SOL - t.h, w: t.w, h: t.h, e: t.e === "visiteurs" ? visiteursAuHasard() : t.e, haut: t.haut });
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
      const air = s.y < SOL;
      soignant(ctx, 71, s.y, { h: 52, ph: s.dist / 22, allure: 1, air, face: 1, bras: air ? 0.5 : 0, penche: 0.12, accroupi: s.bas && !air, trait: c.texte });
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
    nom: "seringue", titre: "💉 Flappy Seringue", desc: "Battez des ailes entre les poches et les potences à perfusion.",
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
  // Visages des patients : voir PATIENTS (couleurs de peau et sexes variés).
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
    return { motif: p.m, g: p.g, etapes: p.s.map(e => ({ k: e[0], t: e[1] })), i: 0, vie: 100, taux: (1 + 0.9 * p.g) * usure, visage: patientAuHasard(), vu: false, etat: "attente", patience: PATIENCE, reste: 0 };
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
    nom: "urgences", titre: "🏥 Urgences", desc: "Soignez les patients d’un service de 3, 6 ou 9 lits.", h: HU, unite: " soignés", cle: s => "urgences" + s.lits, niveaux: [3, 6, 9], niveau: niveauLits,
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
        const tete = Math.min(34, Math.round(bh * 0.62)); volaille(ctx, bx + 32 - tete * 0.55, by + bh * 0.5, tete, p.visage);
        ctx.globalAlpha = 0.9; ctx.fillStyle = p.vie > 66 ? "#8fd1ac" : p.vie > 33 ? "#f2cf7d" : "#ef9a9a"; bord(ctx, bx + 54, by + bh * 0.26, bw - 66, bh * 0.4, 7); ctx.fill(); ctx.globalAlpha = 1;   // couverture selon l'état
        emoji(ctx, humeur(p.vie), r.x + r.w - 24, r.y + 18, 17);
        if (p.vu) { const e = p.etapes[p.i]; emoji(ctx, SOINS_ICONE(e), r.x + r.w - 46, r.y + 18, 17); }
        txt(court(p.vu ? p.motif : "À examiner (cliquez)", r.w - 12, 10), r.x + 6, r.y + r.h - 13, 10, c.doux);
        barre(r.x + 6, r.y + r.h - 9, r.w - 12, p.vie / 100, couleurVie(p.vie));
      }
      // bloc opératoire
      ctx.fillStyle = s.bloc ? "rgba(211,58,58,.12)" : c.fond; ctx.strokeStyle = s.bloc ? "#d33a3a" : c.trait; ctx.lineWidth = 2; bord(ctx, BLOC.x, BLOC.y, BLOC.w, BLOC.h, 8); ctx.fill(); ctx.stroke();
      txt("🏥 Bloc opératoire", BLOC.x + 8, BLOC.y + 18, 12, c.texte, true);
      if (s.bloc) { volaille(ctx, BLOC.x + 50, BLOC.y + 90, 44, s.bloc.visage); barre(BLOC.x + 10, BLOC.y + 124, BLOC.w - 20, 1 - s.bloc.reste / DUREE_BLOC, "#2f7de1"); txt("opération en cours…", BLOC.x + BLOC.w / 2, BLOC.y + 116, 10.5, c.doux, false, "center"); }
      else txt("libre", BLOC.x + BLOC.w / 2, BLOC.y + 86, 13, c.doux, false, "center");
      // salle d'attente
      ctx.fillStyle = c.fond; ctx.strokeStyle = c.trait; ctx.lineWidth = 2; bord(ctx, ATTENTE.x, ATTENTE.y, ATTENTE.w, ATTENTE.h, 8); ctx.fill(); ctx.stroke();
      txt("Salle d'attente", ATTENTE.x + 8, ATTENTE.y + 18, 12, c.texte, true);
      s.attente.slice(0, 3).forEach((p, i) => { const y = ATTENTE.y + 30 + i * 41; volaille(ctx, ATTENTE.x + 8, y + 26, 26, p.visage); barre(ATTENTE.x + 44, y + 14, ATTENTE.w - 54, p.patience / PATIENCE, couleurVie(p.patience / PATIENCE * 100)); });
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


  /* ---------- 5. Pause déjeuner ---------- */
  // Sur le toit de l'hôpital, l'infirmier·ère en pause se déplace, saute et rattrape fruits et sandwichs, en évitant les dossiers qui tombent et les brancards lancés à pleine vitesse.
  const HD = 300, SOLD = HD - 30, TOITD = HD - 70, VIES_D = 3, GD = 1700, SAUT_D = 610;
  const FRUITS_D = ["🍎", "🍌", "🍊", "🍇", "🍓", "🍐", "🍒", "🥕"];
  const borne = (v, a, b) => Math.max(a, Math.min(b, v));
  const GAUCHE_D = ["ArrowLeft", "q", "Q", "a", "A"], DROITE_D = ["ArrowRight", "d", "D"], SAUT_TOUCHES = ["ArrowUp", "z", "Z", "w", "W"];

  // Dossier patient : chemise cartonnée avec onglet, feuilles qui dépassent et bandeau rouge.
  function dessinDossier(ctx, x, y, rot) {
    ctx.save(); ctx.translate(x, y); ctx.rotate(rot);
    ctx.fillStyle = "#ffffff"; ctx.strokeStyle = "#8a93a3"; ctx.lineWidth = 1;
    ctx.fillRect(-12, -17, 22, 10); ctx.strokeRect(-12, -17, 22, 10);                    // feuilles qui dépassent
    ctx.fillRect(-10, -19, 22, 10); ctx.strokeRect(-10, -19, 22, 10);
    ctx.fillStyle = "#d9a441"; ctx.strokeStyle = "#8d6516"; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(-16, 13); ctx.lineTo(-16, -9); ctx.lineTo(-6, -9); ctx.lineTo(-3, -13); ctx.lineTo(16, -13); ctx.lineTo(16, 13); ctx.closePath(); ctx.fill(); ctx.stroke();   // chemise + onglet
    ctx.fillStyle = "#c0392b"; ctx.fillRect(-16, -3, 32, 6);                              // bandeau
    ctx.fillStyle = "#fff"; ctx.fillRect(-2, -3, 4, 6); ctx.fillRect(-4, -1, 8, 2);       // croix
    ctx.restore();
  }

  // Brancard à roulettes : cadre métallique, matelas, patient endormi sous une couverture, potence à perfusion. dir = sens de la marche (1 : vers la droite).
  function brancard(ctx, x, sol, dir, peau, cheveux) {
    ctx.save(); ctx.translate(x, sol); ctx.scale(dir, 1);
    ctx.fillStyle = "rgba(0,0,0,.18)"; ctx.beginPath(); ctx.ellipse(0, 1, 52, 4, 0, 0, 7); ctx.fill();
    ctx.strokeStyle = "#7d8a9c"; ctx.lineWidth = 3; ctx.lineCap = "round";
    ctx.beginPath(); ctx.moveTo(-40, -20); ctx.lineTo(-40, -8); ctx.moveTo(40, -20); ctx.lineTo(40, -8); ctx.moveTo(-40, -8); ctx.lineTo(40, -8); ctx.stroke();         // piétement
    ctx.fillStyle = "#2b3340"; [-34, 34].forEach(r => { ctx.beginPath(); ctx.arc(r, -4, 4, 0, 7); ctx.fill(); });                                                 // roulettes
    ctx.fillStyle = "#eef2f7"; ctx.strokeStyle = "#7d8a9c"; ctx.lineWidth = 1.5; bord(ctx, -46, -27, 92, 9, 4); ctx.fill(); ctx.stroke();                          // matelas
    ctx.fillStyle = "#4aa3d8"; bord(ctx, -26, -37, 70, 11, 5); ctx.fill();                                                                                         // couverture (le patient dessous)
    ctx.fillStyle = "#ffffff"; bord(ctx, -44, -36, 17, 9, 4); ctx.fill(); ctx.strokeStyle = "#cfd8e3"; ctx.lineWidth = 1; ctx.stroke();                            // oreiller
    ctx.fillStyle = peau || PEAUX[1]; ctx.beginPath(); ctx.arc(-35, -37, 6, 0, 7); ctx.fill();                                                                           // tête
    ctx.fillStyle = cheveux || CHEVEUX[1]; ctx.beginPath(); ctx.arc(-35, -39, 6, Math.PI, 2 * Math.PI); ctx.fill();
    ctx.strokeStyle = "#7d8a9c"; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(44, -20); ctx.lineTo(44, -62); ctx.lineTo(36, -62); ctx.stroke();                   // potence
    ctx.fillStyle = "rgba(200,235,250,.95)"; ctx.strokeStyle = "#6aa6c4"; ctx.lineWidth = 1; bord(ctx, 31, -60, 10, 14, 3); ctx.fill(); ctx.stroke();            // poche de perfusion
    ctx.restore();
  }


  // Décor : le toit-terrasse d'un hôpital en fin de matinée : horizon d'immeubles, héliport peint au sol, croix rouge sur son mât, locaux techniques, rambarde.
  const IMMEUBLES_D = [[0, 52, 40], [38, 78, 34], [70, 46, 44], [112, 90, 30], [140, 60, 42], [180, 40, 50], [228, 84, 34], [260, 58, 40], [300, 96, 28], [326, 50, 46], [370, 72, 36], [404, 44, 44], [446, 88, 32], [476, 56, 42], [516, 70, 38], [552, 48, 46], [596, 82, 44]];
  function decorD(ctx, t) {
    // ciel, soleil, nuages
    ctx.fillStyle = "rgba(120,185,235,.14)"; ctx.fillRect(0, 0, W, TOITD);
    ctx.fillStyle = "rgba(255,206,84,.9)"; ctx.beginPath(); ctx.arc(570, 44, 19, 0, 7); ctx.fill();
    ctx.strokeStyle = "rgba(255,206,84,.55)"; ctx.lineWidth = 3;
    for (let i = 0; i < 10; i++) { const a = i * Math.PI / 5 + t * 0.15; ctx.beginPath(); ctx.moveTo(570 + Math.cos(a) * 25, 44 + Math.sin(a) * 25); ctx.lineTo(570 + Math.cos(a) * 33, 44 + Math.sin(a) * 33); ctx.stroke(); }
    ctx.fillStyle = "rgba(255,255,255,.5)";
    [[80, 46, 1], [300, 30, 0.8], [440, 66, 1.1]].forEach(([x0, y0, k], i) => {
      const x = ((x0 + t * (8 + i * 3)) % (W + 160)) - 80;
      [[x, y0, 34, 12], [x + 20 * k, y0 - 8 * k, 22, 11], [x - 20 * k, y0 - 5 * k, 20, 9]].forEach(([ex, ey, rx, ry]) => { ctx.beginPath(); ctx.ellipse(ex, ey, rx * k, ry * k, 0, 0, 7); ctx.fill(); });
    });
    // horizon : immeubles lointains avec fenêtres
    IMMEUBLES_D.forEach(([x, h, w], i) => {
      ctx.fillStyle = i % 2 ? "rgba(112,128,152,.38)" : "rgba(96,112,140,.42)"; ctx.fillRect(x, TOITD - 14 - h, w, h + 2);
      ctx.fillStyle = "rgba(255,255,255,.22)";
      for (let yy = TOITD - 14 - h + 7; yy < TOITD - 22; yy += 11) for (let xx = x + 5; xx < x + w - 6; xx += 9) ctx.fillRect(xx, yy, 4, 5);
    });
    // mât avec grande croix rouge (à gauche), antenne relais (à droite)
    ctx.strokeStyle = "rgba(125,138,156,.9)"; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(52, TOITD); ctx.lineTo(52, TOITD - 78); ctx.stroke();
    ctx.fillStyle = "#fff"; ctx.strokeStyle = "rgba(125,138,156,.9)"; ctx.lineWidth = 2; bord(ctx, 28, TOITD - 118, 48, 44, 5); ctx.fill(); ctx.stroke();
    ctx.fillStyle = "#d33a3a"; ctx.fillRect(48, TOITD - 112, 8, 32); ctx.fillRect(36, TOITD - 100, 32, 8);
    ctx.strokeStyle = "rgba(125,138,156,.9)"; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(600, TOITD); ctx.lineTo(600, TOITD - 70); ctx.moveTo(590, TOITD - 52); ctx.lineTo(610, TOITD - 52); ctx.moveTo(593, TOITD - 36); ctx.lineTo(607, TOITD - 36); ctx.stroke();
    ctx.fillStyle = Math.floor(t * 1.6) % 2 ? "#ff5a4f" : "rgba(255,90,79,.35)"; ctx.beginPath(); ctx.arc(600, TOITD - 72, 3, 0, 7); ctx.fill();
    // muret du toit avec rambarde
    ctx.fillStyle = "rgba(172,182,198,.95)"; ctx.fillRect(0, TOITD - 12, W, 12);
    ctx.fillStyle = "rgba(205,213,226,.95)"; ctx.fillRect(0, TOITD - 14, W, 3);
    ctx.strokeStyle = "rgba(120,132,150,.8)"; ctx.lineWidth = 1.5;
    for (let x = 6; x < W; x += 30) { ctx.beginPath(); ctx.moveTo(x, TOITD - 14); ctx.lineTo(x, TOITD - 34); ctx.stroke(); }
    ctx.beginPath(); ctx.moveTo(0, TOITD - 34); ctx.lineTo(W, TOITD - 34); ctx.moveTo(0, TOITD - 24); ctx.lineTo(W, TOITD - 24); ctx.stroke();
    // locaux techniques : cage d'escalier avec sa porte, centrale de ventilation, château d'eau
    ctx.fillStyle = "rgba(196,204,218,.95)"; ctx.strokeStyle = "rgba(120,132,150,.9)"; ctx.lineWidth = 1.5; ctx.fillRect(112, TOITD - 40, 62, 44); ctx.strokeRect(112, TOITD - 40, 62, 44);
    ctx.fillStyle = "rgba(95,120,160,.85)"; ctx.fillRect(134, TOITD - 24, 20, 28); ctx.strokeRect(134, TOITD - 24, 20, 28);
    ctx.fillStyle = "#3aa76d"; ctx.fillRect(141, TOITD - 36, 6, 2); ctx.fillRect(143, TOITD - 38, 2, 6);
    ctx.fillStyle = "rgba(190,198,212,.95)"; ctx.fillRect(470, TOITD - 26, 50, 28); ctx.strokeRect(470, TOITD - 26, 50, 28);
    ctx.strokeStyle = "rgba(110,122,140,.9)"; ctx.beginPath(); ctx.arc(486, TOITD - 12, 8, 0, 7); ctx.arc(506, TOITD - 12, 8, 0, 7); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(480, TOITD - 12); ctx.lineTo(492, TOITD - 12); ctx.moveTo(486, TOITD - 18); ctx.lineTo(486, TOITD - 6); ctx.stroke();
    // sol de la terrasse : béton avec joints, héliport peint (en perspective), bande de sécurité jaune au bord
    ctx.fillStyle = "rgba(130,140,156,.38)"; ctx.fillRect(0, TOITD, W, HD - TOITD);
    ctx.strokeStyle = "rgba(100,112,130,.28)"; ctx.lineWidth = 1;
    for (let x = -20; x < W + 40; x += 64) { ctx.beginPath(); ctx.moveTo(x + 20, TOITD); ctx.lineTo(x - 14, HD); ctx.stroke(); }
    ctx.beginPath(); ctx.moveTo(0, TOITD + 22); ctx.lineTo(W, TOITD + 22); ctx.moveTo(0, TOITD + 46); ctx.lineTo(W, TOITD + 46); ctx.stroke();
    ctx.strokeStyle = "rgba(255,255,255,.55)"; ctx.lineWidth = 3; ctx.beginPath(); ctx.ellipse(W / 2, TOITD + 34, 130, 22, 0, 0, 7); ctx.stroke();
    ctx.fillStyle = "rgba(255,255,255,.6)";
    ctx.fillRect(W / 2 - 40, TOITD + 22, 9, 24); ctx.fillRect(W / 2 + 31, TOITD + 22, 9, 24); ctx.fillRect(W / 2 - 40, TOITD + 31, 80, 6);          // grand H
    ctx.fillStyle = "rgba(240,190,40,.75)"; for (let x = 0; x < W; x += 24) { ctx.beginPath(); ctx.moveTo(x, HD - 6); ctx.lineTo(x + 12, HD - 6); ctx.lineTo(x + 6, HD); ctx.lineTo(x - 6, HD); ctx.fill(); }
  }

  const dejeuner = {
    nom: "dejeuner", titre: "🥪 Pause déjeuner", desc: "Sur le toit de l’hôpital : attrapez fruits et sandwichs, évitez dossiers et brancards.", h: HD, unite: " pts", fin: "Fin de la pause : le service vous rappelle 📟",
    aide: "← → (ou Q / D, A / D) : se déplacer · Espace, ↑ ou Z / W : sauter (par-dessus les brancards, ou pour rattraper en hauteur). À la souris ou au doigt : glissez pour être suivi·e, touchez le haut de l’écran pour sauter. Fruits et sandwichs rapportent des points (le temps qui passe aussi), dossiers et brancards font perdre une vie : trois vies. Ne comptez pas sur les bords…",
    init() {
      return { t: 0, x: W / 2, vx: 0, face: 1, phase: 0, allure: 0, h: 0, vh: 0, gauche: false, droite: false, cible: null, vies: VIES_D, inv: 0, joie: 0, mal: 0, pts: 0, score: 0,
        items: [], part: [], textes: [], prochain: 0.8, dernierDossierX: -999, brancard: null, prochainBrancard: 11, rec: record("dejeuner"), mort: false };
    },
    demo(s) {
      s.x = 250; s.vx = 120; s.allure = 1; s.phase = 1.2; s.t = 6; s.pts = 40; s.score = 46;
      s.items = [{ type: "dossier", x: 120, y: 90, v: 0, rot: 0.3, vr: 0 }, { type: "fruit", e: "🍎", x: 330, y: 70, v: 0, rot: 0, vr: 0 }, { type: "sandwich", e: "🥪", x: 440, y: 150, v: 0, rot: 0, vr: 0 }, { type: "fruit", e: "🍌", x: 250, y: 30, v: 0, rot: 0, vr: 0 }];
      s.brancard = { x: 540, dir: -1, v: 0, alerte: 0, franchi: false, peau: PEAUX[2], cheveux: CHEVEUX[0] };
    },
    action(s) { if (s.h <= 0.5) { s.vh = SAUT_D; } },
    bas() { /* inutilisé */ },
    demarreAvec(k) { return GAUCHE_D.includes(k) || DROITE_D.includes(k) || SAUT_TOUCHES.includes(k); },
    touche(s, k) {
      if (GAUCHE_D.includes(k)) { s.gauche = true; s.cible = null; }
      else if (DROITE_D.includes(k)) { s.droite = true; s.cible = null; }
      else if (SAUT_TOUCHES.includes(k)) this.action(s);
    },
    relache(s, k) {
      if (GAUCHE_D.includes(k)) s.gauche = false;
      else if (DROITE_D.includes(k)) s.droite = false;
    },
    bouge(s, x) { s.cible = borne(x, 16, W - 16); },
    clic(s, x, y) { s.cible = borne(x, 16, W - 16); if (y < HD * 0.4) this.action(s); },   // toucher le haut de l'écran : sauter
    blesser(s, x, y, txt) {
      if (s.inv > 0) return;
      s.vies--; s.inv = 1.4; s.mal = 0.6;
      for (let i = 0; i < 9; i++) s.part.push({ x, y, vx: alea(-120, 120), vy: alea(-160, -30), vie: 0.9, r: alea(3, 6), rot: alea(0, 6) });
      s.textes.push({ x: s.x, y: SOLD - s.h - 84, txt, coul: "#d33a3a", vie: 1.1 });
      if (s.vies <= 0) s.mort = true;
    },
    step(s, dt) {
      s.t += dt;
      const d = Math.min(1.7, s.t / 50);   // la difficulté monte vite et continue de monter bien après la première minute
      // Déplacement : touches (vitesse fixe) ou suivi du pointeur (accéléré, amorti)
      const dir = (s.droite ? 1 : 0) - (s.gauche ? 1 : 0);
      let vise = 0;
      if (dir) vise = dir * 350;
      else if (s.cible !== null) { const dx = s.cible - s.x; vise = Math.abs(dx) < 4 ? 0 : Math.sign(dx) * Math.min(490, Math.abs(dx) * 9); }
      s.vx += (vise - s.vx) * Math.min(1, dt * 14);
      s.x = borne(s.x + s.vx * dt, 16, W - 16);
      if (Math.abs(s.vx) > 10) s.face = Math.sign(s.vx);
      // Saut : montée puis retombée
      if (s.h > 0 || s.vh > 0) { s.vh -= GD * dt; s.h += s.vh * dt; if (s.h <= 0) { s.h = 0; s.vh = 0; } }
      s.allure += (Math.min(1, Math.abs(s.vx) / 180) - s.allure) * Math.min(1, dt * 12);
      if (s.h <= 0) s.phase += (3 + Math.abs(s.vx) * 0.032) * dt * (s.allure > 0.05 ? 1 : 0.2);
      s.inv = Math.max(0, s.inv - dt); s.joie = Math.max(0, s.joie - dt); s.mal = Math.max(0, s.mal - dt);
      // Apparition des objets : de plus en plus nombreux, rapides et souvent des dossiers
      s.prochain -= dt;
      if (s.prochain <= 0) {
        s.prochain = alea(0.45, 0.85) * (1 - 0.5 * Math.min(1, d)) + 0.1;
        const r = Math.random(), pd = 0.28 + 0.2 * Math.min(1, d);
        let type = "fruit";
        if (r < pd) type = "dossier"; else if (r < pd + 0.1) type = "sandwich"; else if (r < pd + 0.1 + 0.025 && s.vies < VIES_D) type = "coeur";
        let x = alea(8, W - 8);
        if (type === "dossier" && Math.abs(x - s.dernierDossierX) < 60) x = borne(x + (x > s.dernierDossierX ? 80 : -80), 8, W - 8);
        if (type === "dossier") s.dernierDossierX = x;
        const v = 130 + 260 * d + alea(0, 60);
        s.items.push({ type, e: type === "sandwich" ? "🥪" : type === "coeur" ? "💖" : FRUITS_D[Math.floor(Math.random() * FRUITS_D.length)], x, y: -24, v, rot: alea(-0.4, 0.4), vr: alea(-1.2, 1.2) });
        // Dossiers « guidés » : on ne peut pas rester planté au même endroit, ni coincé contre un bord
        if (Math.random() < 0.08 + 0.22 * Math.min(1, d)) s.items.push({ type: "dossier", e: "", x: borne(s.x + alea(-28, 28), 8, W - 8), y: -24, v: v + 20, rot: alea(-0.4, 0.4), vr: alea(-1.2, 1.2) });
      }
      // Brancard : alerte au bord d'où il vient, puis traversée de tout l'écran à ras du sol
      s.prochainBrancard -= dt;
      if (!s.brancard && s.prochainBrancard <= 0) {
        const sens = Math.random() < 0.5 ? 1 : -1;
        s.brancard = { x: sens > 0 ? -60 : W + 60, dir: sens, v: 0, alerte: 1.0, franchi: false, peau: peauSuivante(), cheveux: auHasard(CHEVEUX) };
        s.prochainBrancard = alea(6, 10) - 3 * Math.min(1, d);
      }
      const b = s.brancard;
      if (b) {
        if (b.alerte > 0) { b.alerte -= dt; if (b.alerte <= 0) b.v = 290 + 110 * Math.min(1, d); }
        else {
          b.x += b.dir * b.v * dt;
          const corps = { x: b.x - 46, y: SOLD - 38, w: 92, h: 38 };
          const moi = { x: s.x - 10, y: SOLD - s.h - 62, w: 20, h: 62 };
          if (chevauche(moi, corps, 3)) this.blesser(s, s.x, SOLD - s.h - 30, "Brancard ! 🛏️");
          if (!b.franchi && (b.dir > 0 ? b.x > s.x : b.x < s.x)) {
            b.franchi = true;
            if (s.h > 14 && s.inv <= 0) { s.pts += 10; s.textes.push({ x: s.x, y: SOLD - s.h - 84, txt: "Bien sauté ! +10", coul: "#2f9e5b", vie: 1 }); }
          }
          if (b.x < -80 || b.x > W + 80) s.brancard = null;
        }
      }
      // Objets qui tombent
      const boite = { x: s.x - 12, y: SOLD - s.h - 66, w: 24, h: 66 };
      s.items.forEach(it => { it.y += it.v * dt; it.rot += it.vr * dt; });
      s.items = s.items.filter(it => {
        const tx = it.type === "dossier" ? { x: it.x - 15, y: it.y - 15, w: 30, h: 26 } : { x: it.x - 12, y: it.y - 12, w: 24, h: 24 };
        if (chevauche(boite, tx, 2)) {
          if (it.type === "dossier") {
            if (s.inv > 0) return true;   // invulnérable un instant : le dossier passe à travers
            this.blesser(s, it.x, it.y, "Aïe ! 📁");
          } else {
            const gain = it.type === "sandwich" ? 15 : it.type === "coeur" ? 0 : 5;
            if (it.type === "coeur") s.vies = Math.min(VIES_D, s.vies + 1);
            s.pts += gain; s.joie = 0.35;
            s.textes.push({ x: it.x, y: it.y - 14, txt: it.type === "coeur" ? "+1 vie" : "+" + gain, coul: it.type === "coeur" ? "#d6336c" : "#2f9e5b", vie: 0.9 });
          }
          return false;
        }
        if (it.y > SOLD - 6) {   // tombé par terre : feuilles qui s'éparpillent pour un dossier, rien de plus
          if (it.type === "dossier") for (let i = 0; i < 4; i++) s.part.push({ x: it.x, y: SOLD - 6, vx: alea(-70, 70), vy: alea(-90, -30), vie: 0.7, r: alea(3, 5), rot: alea(0, 6) });
          return false;
        }
        return true;
      });
      s.part.forEach(p => { p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 420 * dt; p.vie -= dt; p.rot += 6 * dt; });
      s.part = s.part.filter(p => p.vie > 0 && p.y < HD);
      s.textes.forEach(t => { t.y -= 34 * dt; t.vie -= dt; });
      s.textes = s.textes.filter(t => t.vie > 0);
      s.score = Math.floor(s.t) + s.pts;
    },
    draw(ctx, s, c) {
      decorD(ctx, s.t);
      const b = s.brancard;
      if (b && b.alerte > 0) {   // alerte : panneau clignotant sur le bord d'où le brancard va arriver
        const gauche = b.dir > 0, x = gauche ? 8 : W - 8;
        if (Math.floor(b.alerte * 8) % 2 === 0) {
          ctx.fillStyle = "#f2b01e"; ctx.strokeStyle = "#8a5d00"; ctx.lineWidth = 2;
          ctx.beginPath(); ctx.moveTo(x + (gauche ? 0 : -44), SOLD - 70); ctx.lineTo(x + (gauche ? 44 : 0), SOLD - 70); ctx.lineTo(x + (gauche ? 44 : 0), SOLD - 36); ctx.lineTo(x + (gauche ? 0 : -44), SOLD - 36); ctx.closePath(); ctx.fill(); ctx.stroke();
          ctx.fillStyle = "#3a2a00"; ctx.font = "bold 22px system-ui,sans-serif"; ctx.textAlign = "center"; ctx.fillText(gauche ? "🛏️▶" : "◀🛏️", x + (gauche ? 22 : -22), SOLD - 46); ctx.textAlign = "left";
        }
      }
      s.items.forEach(it => {
        if (it.type === "dossier") dessinDossier(ctx, it.x, it.y, it.rot);
        else emoji(ctx, it.e, it.x - (it.type === "sandwich" ? 15 : 12), it.y + (it.type === "sandwich" ? 12 : 10), it.type === "sandwich" ? 30 : 24);
      });
      if (b && b.alerte <= 0) brancard(ctx, b.x, SOLD, b.dir, b.peau, b.cheveux);
      s.part.forEach(p => { ctx.save(); ctx.globalAlpha = Math.max(0, Math.min(1, p.vie * 1.5)); ctx.translate(p.x, p.y); ctx.rotate(p.rot); ctx.fillStyle = "#fff"; ctx.strokeStyle = "#8a93a3"; ctx.lineWidth = 0.8; ctx.fillRect(-p.r, -p.r * 0.7, p.r * 2, p.r * 1.4); ctx.strokeRect(-p.r, -p.r * 0.7, p.r * 2, p.r * 1.4); ctx.restore(); });
      if (!(s.inv > 0 && Math.floor(s.inv * 12) % 2 === 0)) {
        const air = s.h > 2;
        ctx.fillStyle = "rgba(0,0,0,.2)"; ctx.beginPath(); ctx.ellipse(s.x, SOLD, 17 - Math.min(8, s.h / 12), 4, 0, 0, 7); ctx.fill();   // ombre restée au sol quand on saute
        soignant(ctx, s.x, SOLD - s.h, { h: 72, ph: s.phase, allure: air ? 0 : s.allure, air, face: s.face, bras: s.joie > 0 ? 1 : s.mal > 0 ? 0.85 : air ? 0.55 : 0, penche: borne(s.vx / 2400, -0.2, 0.2), mine: s.mal > 0, trait: c.texte });
      }
      ctx.font = "bold 14px system-ui,sans-serif"; ctx.textAlign = "center";
      s.textes.forEach(t => { ctx.globalAlpha = Math.min(1, t.vie * 2); ctx.fillStyle = t.coul; ctx.fillText(t.txt, t.x, t.y); ctx.globalAlpha = 1; });
      ctx.textAlign = "left";
      for (let i = 0; i < VIES_D; i++) emoji(ctx, i < s.vies ? "❤️" : "🖤", 10 + i * 24, 26, 20);
      ctx.fillStyle = c.texte; ctx.font = "bold 16px system-ui,sans-serif"; ctx.textAlign = "right"; ctx.fillText(s.score + " pts", W - 12, 24);
      ctx.font = "13px system-ui,sans-serif"; ctx.fillStyle = c.doux; ctx.fillText("Record : " + Math.max(s.rec, s.score), W - 12, 42); ctx.textAlign = "left";
    }
  };

  const JEUX = { course, seringue, urgences, dejeuner };


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
      if (actif.s.mort) {
        actif.etat = "fini"; record(actif.jeu.cle ? actif.jeu.cle(actif.s) : actif.jeu.nom, actif.s.score);
        // Le meilleur score est aussi gardé côté serveur (par jeu et par niveau) : l'application s'y abonne par LydiaJeux.surFin.
        if (typeof root.LydiaJeux.surFin === "function") { try { root.LydiaJeux.surFin(actif.jeu.nom, actif.jeu.niveaux ? String(actif.jeu.niveau()) : "", actif.s.score); } catch (e) { /* ignoré */ } } if (actif.rej) actif.rej.style.display = "block"; }
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
      if (jeu.demarreAvec && actif.etat === "pret" && jeu.demarreAvec(e.key)) { e.preventDefault(); appuyer(); }
      if (jeu.touche && actif.etat === "jeu" && e.key !== " ") { if (e.key.indexOf("Arrow") === 0) e.preventDefault(); jeu.touche(actif.s, e.key); return; }
      if (e.key === " " || e.key === "ArrowUp") { e.preventDefault(); if (!e.repeat) appuyer(); }
      else if (e.key === "ArrowDown") { e.preventDefault(); jeu.bas(actif.s, true); }
    };
    const relache = e => { if (jeu.relache && actif) jeu.relache(actif.s, e.key); if (e.key === " " && actif && actif.etat === "fini" && e.target && e.target.tagName === "BUTTON") e.preventDefault(); if (actif && e.key === "ArrowDown") jeu.bas(actif.s, false); };
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

  // Dessine l'écran de départ d'un jeu dans un petit canvas (choix du jeu) ; sans canvas disponible, la vignette garde son emoji.
  function miniature(id, cv) {
    const jeu = JEUX[id]; if (!jeu || !cv || !cv.getContext) return false;
    try {
      const ctx = cv.getContext("2d"); if (!ctx) return false;
      const h = jeu.h || H, s = jeu.init(); if (jeu.demo) jeu.demo(s);
      cv.width = W; cv.height = h;
      const c = couleurs(); ctx.fillStyle = c.fond; ctx.fillRect(0, 0, W, h); jeu.draw(ctx, s, c);
      return true;
    } catch (e) { return false; }
  }

  function fermer() {
    if (!actif) return;
    if (actif.raf && root.cancelAnimationFrame) root.cancelAnimationFrame(actif.raf);
    if (actif.nettoyer) actif.nettoyer();
    actif = null;
  }

  root.LydiaJeux = {
    liste: Object.keys(JEUX).map(k => ({ id: k, nom: JEUX[k].nom, titre: JEUX[k].titre, desc: JEUX[k].desc || "", admin: !!JEUX[k].admin })),
    miniature,
    ouvrir, fermer, enCours: () => !!actif, record, surFin: null,
    // Records enregistrés sur le serveur : on garde le meilleur entre eux et ceux de ce navigateur (la clé locale de « urgences » comprend le niveau).
    synchroniser: scores => { (scores || []).forEach(x => record(x.jeu === "urgences" ? x.jeu + x.niveau : x.jeu, x.score)); },
    _test: { JEUX, SOINS, chevauche, appuyer, etat: () => actif && actif.etat, finir: () => { actif.etat = "fini"; actif.rej.style.display = "block"; } }
  };
})(typeof window !== "undefined" ? window : globalThis);
