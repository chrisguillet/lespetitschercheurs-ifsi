/**
 * Lydia – API Apps Script (script lié au Google Sheet).
 *
 * Le Sheet reste privé : seul ce script y accède (exécution avec le compte du
 * déployeur). Chaque appel porte un jeton d'identité Google (ID token) que le
 * script vérifie auprès de Google, puis il applique les règles.
 *
 * Rôles (colonne « role » de l'onglet Utilisateurs) :
 *  - etudiant  : ses lectures, « contribuer » aux lectures des autres, validation des
 *                demandes d'accès (lecteurs et formateurs), modération des commentaires ;
 *  - formateur : lecture + commentaires ;
 *  - lecteur   : lecture seule.
 * Rôle « admin » : adresse fixe de la propriété de script ADMIN_EMAIL (absente de la feuille).
 * Lecture, gestion de tous les accès (y compris les étudiants et leurs adresses), modération.
 *
 * Une adresse inconnue qui se connecte crée une demande (statut « en_attente »).
 * Un étudiant la valide depuis l'application (prénom + rôle) ou la refuse.
 *
 * Groupes : établissement > promo > groupe. Chaque fiche appartient à un groupe et reste visible de ses
 * seuls membres, sauf si elle est partagée avec la promo (portée « promo »). Les commentaires ont
 * la même portée que leur fil : ceux du groupe et ceux de la promo sont distincts.
 * Un étudiant appartient à un seul groupe par promo ; formateurs et lecteurs sont rattachés à des groupes
 * par l'administrateur. L'administrateur crée les groupes et gère les membres ; les étudiants peuvent
 * ajouter un membre à leur groupe, et retirer un membre ou renommer le groupe par vote à la majorité.
 */

const FEUILLE_LECTURES = 'Lectures';
const FEUILLE_UTILISATEURS = 'Utilisateurs';
const FEUILLE_HISTORIQUE = 'Historique';
const FEUILLE_COMMENTAIRES = 'Commentaires';
const FEUILLE_LUS = 'Lus';
const FEUILLE_GROUPES = 'Groupes';
const FEUILLE_MEMBRES = 'Membres';
const FEUILLE_VOTES = 'Votes';

const COLONNES = ['id', 'owner', 'statut', 'titre', 'parution', 'auteur', 'qualite', 'nation', 'type',
  'mots', 'kw', 'concepts', 'objet', 'opinion', 'controverse', 'libre', 'ajoute', 'modifie_le', 'modifie_par',
  'source', 'volume', 'numero', 'pages', 'doi', 'lien', 'groupe_id', 'portee'];
const COL_UTILISATEURS = ['email', 'prenom', 'role', 'couleur', 'statut', 'demande_le', 'derniere_connexion'];
// portee : « groupe » ou « promo » ; groupe_id : groupe de l'auteur au moment du commentaire.
const COL_COMMENTAIRES = ['id', 'lecture_id', 'auteur_email', 'auteur', 'date', 'texte', 'modifie_le', 'portee', 'groupe_id'];
const COL_GROUPES = ['id', 'etablissement', 'promo', 'nom', 'cree_le'];
const COL_MEMBRES = ['id', 'groupe_id', 'email', 'ajoute_le'];
// type : « retrait » (cible = adresse du membre) ou « nom » (valeur = nouveau nom) ; votes = JSON {adresse: 1|0}.
const COL_VOTES = ['id', 'groupe_id', 'type', 'cible', 'valeur', 'propose_par', 'cree_le', 'votes', 'statut', 'clos_le'];
// Une ligne par personne (id = adresse) : identifiants des commentaires déjà lus, séparés par des virgules.
const COL_LUS = ['id', 'commentaires'];
const COL_HISTORIQUE = ['date', 'id', 'modifie_par', 'proprietaire', 'avant'];
const CHAMPS = ['statut', 'titre', 'parution', 'auteur', 'qualite', 'nation', 'type',
  'mots', 'kw', 'concepts', 'objet', 'opinion', 'controverse', 'libre',
  'source', 'volume', 'numero', 'pages', 'doi', 'lien', 'portee'];
const PORTEES = ['groupe', 'promo'];
const NOM_MAX = 60;
const VOTE_DUREE_MS = 7 * 24 * 3600 * 1000;      // une proposition non tranchée expire au bout de 7 jours
const VOTE_BLOCAGE_MS = 14 * 24 * 3600 * 1000;   // et une proposition de retrait refusée ne peut pas être refaite avant 14 jours
const OBLIGATOIRES_TERMINEE = ['titre', 'parution', 'auteur', 'qualite', 'nation', 'type'];
const LIBELLES = { titre: 'titre', parution: 'date de parution', auteur: 'auteur', qualite: 'qualité',
  nation: 'nationalité', type: 'type d’article' };
const STATUTS = ['Terminée', 'En cours'];
const TYPES = ['Article scientifique', 'Article de recherche', 'Revue de littérature', 'Article professionnel',
  'Rapport / recommandation HAS', 'Thèse / mémoire', 'Autre'];
const LONGUEUR_MAX = 2500;
const COMMENTAIRE_MAX = 2000;
const PRENOM_MAX = 60;
const MAX_EN_ATTENTE = 50;
const COULEUR_DEFAUT = '#888888';
const DELAI_CONNEXION_MS = 10 * 60 * 1000;
const COULEUR_ADMIN = '#475569';
const CACHE_JETON_MAX_S = 3000;

// Lectures de feuilles mémorisées pour la durée d'une requête (désactivées pendant une écriture).
let memo_ = {};
let memoOn_ = true;
function lu_(cle, fn) {
  if (!memoOn_) return fn();
  if (!(cle in memo_)) memo_[cle] = fn();
  return memo_[cle];
}
function muter_(fn) {
  memoOn_ = false;
  try { return avecVerrou_(fn); } finally { memo_ = {}; memoOn_ = true; }
}
const EMAIL_VALIDE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/* ---------- Installation (à lancer depuis l'éditeur, sans risque de le relancer) ---------- */

function setup() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  preparer_(ss, FEUILLE_LECTURES, COLONNES);
  preparer_(ss, FEUILLE_HISTORIQUE, COL_HISTORIQUE);
  preparer_(ss, FEUILLE_COMMENTAIRES, COL_COMMENTAIRES);
  preparer_(ss, FEUILLE_LUS, COL_LUS);
  preparer_(ss, FEUILLE_GROUPES, COL_GROUPES);
  preparer_(ss, FEUILLE_MEMBRES, COL_MEMBRES);
  preparer_(ss, FEUILLE_VOTES, COL_VOTES);
  const u = preparer_(ss, FEUILLE_UTILISATEURS, COL_UTILISATEURS);
  if (u.getLastRow() < 2) {
    u.getRange(2, 1, 4, 5).setValues([
      ['wacim@gmail.com', 'Wacim', 'etudiant', '#2563eb', 'actif'],
      ['ange-marie@gmail.com', 'Ange-Marie', 'etudiant', '#ea580c', 'actif'],
      ['helene@gmail.com', 'Hélène', 'etudiant', '#16a34a', 'actif'],
      ['lydia@gmail.com', 'Lydia', 'etudiant', '#9333ea', 'actif']
    ]);
  }
  memo_ = {};
  migrerVersGroupes_();
}

// Reprise de l'existant (idempotente, lancée par setup) : un premier groupe reçoit tous les accès actifs,
// ainsi que les fiches et commentaires qui n'avaient pas encore de groupe.
function migrerVersGroupes_() {
  avecVerrou_(function () {
    memoOn_ = false;
    try {
      const ss = SpreadsheetApp.getActiveSpreadsheet();
      const shG = ss.getSheetByName(FEUILLE_GROUPES);
      let groupes = lireTable_(shG, COL_GROUPES);
      const maintenant = new Date().toISOString();
      if (!groupes.length) {
        const g = { id: Utilities.getUuid(), etablissement: 'IFSI Saint-Nazaire', promo: 'Promo 24-27',
          nom: 'Les petits chercheurs', cree_le: maintenant };
        shG.appendRow(COL_GROUPES.map(function (c) { return g[c]; }));
        const shM = ss.getSheetByName(FEUILLE_MEMBRES);
        lireUtilisateurs_().filter(function (u) { return u.statut === 'actif'; }).forEach(function (u) {
          shM.appendRow([Utilities.getUuid(), g.id, u.email, maintenant]);
        });
        memo_ = {};
        groupes = lireTable_(shG, COL_GROUPES);
      }
      const defaut = (groupes.filter(function (g) { return g.nom === 'Les petits chercheurs'; })[0] || groupes[0]).id;
      const shL = feuilleLectures_();
      const lectures = lireTable_(shL, COLONNES);
      const iG = COLONNES.indexOf('groupe_id') + 1, iP = COLONNES.indexOf('portee') + 1;
      lectures.forEach(function (r) {
        if (!r.groupe_id) shL.getRange(r._row, iG, 1, 1).setValues([[defaut]]);
        if (!r.portee) shL.getRange(r._row, iP, 1, 1).setValues([['groupe']]);
      });
      const parLecture = {};
      lectures.forEach(function (r) { parLecture[r.id] = r.groupe_id || defaut; });
      const shC = feuilleCommentaires_();
      const jP = COL_COMMENTAIRES.indexOf('portee') + 1;
      lireTable_(shC, COL_COMMENTAIRES).forEach(function (r) {
        if (!r.portee) shC.getRange(r._row, jP, 1, 2).setValues([['groupe', parLecture[r.lecture_id] || defaut]]);
      });
    } finally { memo_ = {}; memoOn_ = true; }
  });
}

function preparer_(ss, nom, entetes) {
  const sh = ss.getSheetByName(nom) || ss.insertSheet(nom);
  // Format texte : évite que Sheets interprète une date ou une formule saisie.
  sh.getRange(1, 1, sh.getMaxRows(), entetes.length).setNumberFormat('@');
  sh.getRange(1, 1, 1, entetes.length).setValues([entetes]).setFontWeight('bold');
  sh.setFrozenRows(1);
  return sh;
}

/* ---------- Sauvegarde automatique (copie du Sheet dans Drive) ---------- */

const PRESENCE_S = 150;   // « en ligne » = a fait une requête (actualisation toutes les 45 s) depuis moins de 2 min 30

const DOSSIER_SAUVEGARDES = 'Sauvegardes – lectures IFSI';
const NB_QUOTIDIENNES = 7;      // une copie par jour, gardées 7 jours
const NB_HEBDOMADAIRES = 8;     // et celles du lundi, gardées 8 semaines

// Copie le Sheet dans un dossier dédié de votre Drive, puis supprime les copies devenues inutiles :
// on garde les 7 plus récentes (une par jour) et les 8 plus récentes faites un lundi (une par semaine).
// Les copies retirées vont à la corbeille Drive (récupérables 30 jours).
function sauvegarder() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const dossiers = DriveApp.getFoldersByName(DOSSIER_SAUVEGARDES);
  const dossier = dossiers.hasNext() ? dossiers.next() : DriveApp.createFolder(DOSSIER_SAUVEGARDES);
  const tz = Session.getScriptTimeZone();
  DriveApp.getFileById(ss.getId()).makeCopy(
    ss.getName() + ' – sauvegarde ' + Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd HH-mm'), dossier);
  const copies = [];
  const it = dossier.getFiles();
  while (it.hasNext()) {
    const f = it.next();
    if (f.getName().indexOf('sauvegarde') >= 0) copies.push({ f: f, t: f.getDateCreated().getTime() });
  }
  copiesASupprimer_(copies, tz).forEach(function (c) { c.f.setTrashed(true); });
}

// Pur (testable) : parmi des copies { t: date en ms }, celles qui ne sont plus à conserver.
function copiesASupprimer_(copies, tz) {
  const tri = copies.slice().sort(function (a, b) { return b.t - a.t; });
  const gardees = {};
  tri.slice(0, NB_QUOTIDIENNES).forEach(function (c) { gardees[c.t] = true; });
  tri.filter(function (c) { return Utilities.formatDate(new Date(c.t), tz, 'u') === '1'; })
    .slice(0, NB_HEBDOMADAIRES).forEach(function (c) { gardees[c.t] = true; });
  return tri.filter(function (c) { return !gardees[c.t]; });
}

// À lancer une seule fois depuis l'éditeur : sauvegarde chaque jour vers 3 h. Sans risque de le relancer.
function activerSauvegardes() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'sauvegarder') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('sauvegarder').timeBased().everyDays(1).atHour(3).create();
  sauvegarder();
}

/* ---------- Points d'entrée web ---------- */

function doGet() {
  return json_({ ok: true, service: 'lydia' });
}

function doPost(e) {
  try {
    memo_ = {}; memoOn_ = true;
    const req = JSON.parse(e.postData.contents);
    const user = authentifier_(req.token, req.action);
    signalerPresence_(user, req.action);
    switch (req.action) {
      case 'init':
        majConnexion_(user);
        return json_(Object.assign({
          ok: true,
          me: { prenom: user.prenom, role: user.role, couleur: user.couleur }
        }, donnees_(user)));
      case 'list':
        return json_(Object.assign({ ok: true }, donnees_(user)));
      case 'add': {
        const id = muter_(function () { return ajouter_(user, req.data); });
        return json_(Object.assign({ ok: true, id: id }, donnees_(user)));
      }
      case 'update':
        muter_(function () { modifier_(user, req.id, req.data, req.override === true); });
        return json_(Object.assign({ ok: true }, donnees_(user)));
      case 'delete':
        muter_(function () { supprimer_(user, req.id); });
        return json_(Object.assign({ ok: true }, donnees_(user)));
      case 'comment_add': {
        const id = muter_(function () { return commenter_(user, req.lecture_id, req.texte, req.portee); });
        return json_(Object.assign({ ok: true, id: id }, donnees_(user)));
      }
      case 'comment_update':
        muter_(function () { modifierCommentaire_(user, req.id, req.texte); });
        return json_(Object.assign({ ok: true }, donnees_(user)));
      case 'comment_delete':
        muter_(function () { supprimerCommentaire_(user, req.id); });
        return json_(Object.assign({ ok: true }, donnees_(user)));
      case 'comments_read':
        muter_(function () { marquerLus_(user, req.ids, req.tous === true); });
        return json_(Object.assign({ ok: true }, donnees_(user)));
      case 'comments_unread':
        muter_(function () { marquerNonLus_(user, req.ids); });
        return json_(Object.assign({ ok: true }, donnees_(user)));
      case 'bye':
        return json_({ ok: true });
      case 'member_add':
        muter_(function () { ajouterMembreDemande_(user, req.groupe_id, req.pid, req.email); });
        return json_(Object.assign({ ok: true }, donnees_(user), accesSiAdmin_(user)));
      case 'member_candidates':
        return json_({ ok: true, candidats: candidats_(user, req.groupe_id) });
      case 'vote_propose':
        muter_(function () { proposerVote_(user, req.groupe_id, req.type, req.pid, req.nom); });
        return json_(Object.assign({ ok: true }, donnees_(user)));
      case 'vote_answer':
        muter_(function () { repondreVote_(user, req.id, req.oui === true); });
        return json_(Object.assign({ ok: true }, donnees_(user)));
      case 'vote_cancel':
        muter_(function () { annulerVote_(user, req.id); });
        return json_(Object.assign({ ok: true }, donnees_(user)));
      case 'group_create':
        muter_(function () { creerGroupe_(user, req.data); });
        return json_(Object.assign({ ok: true }, donnees_(user), accesSiAdmin_(user)));
      case 'group_update':
        muter_(function () { modifierGroupe_(user, req.data); });
        return json_(Object.assign({ ok: true }, donnees_(user), accesSiAdmin_(user)));
      case 'group_delete':
        muter_(function () { supprimerGroupe_(user, req.id); });
        return json_(Object.assign({ ok: true }, donnees_(user), accesSiAdmin_(user)));
      case 'member_remove':
        muter_(function () { retirerMembreAdmin_(user, req.groupe_id, req.email); });
        return json_(Object.assign({ ok: true }, donnees_(user), accesSiAdmin_(user)));
      case 'translate':
        exigerEtudiant_(user);
        return json_({ ok: true, items: traduireMotsCles_(req.texte) });
      case 'admin_list':
        exigerGestion_(user);
        return json_({ ok: true, acces: listerAcces_(user), groupesAdmin: listerGroupesAdmin_(user) });
      case 'admin_set':
        muter_(function () { administrer_(user, req.data); });
        return json_(Object.assign({ ok: true, acces: listerAcces_(user), groupesAdmin: listerGroupesAdmin_(user) }, donnees_(user)));
      case 'admin_delete':
        muter_(function () { supprimerUtilisateur_(user, req.email); });
        return json_(Object.assign({ ok: true, acces: listerAcces_(user), groupesAdmin: listerGroupesAdmin_(user) }, donnees_(user)));
      default:
        throw err_('bad_request', 'Action inconnue');
    }
  } catch (e) {
    if (!e.code) console.error(e);
    return json_({ ok: false, error: e.code || 'server', message: e.code ? e.message : 'Erreur serveur' });
  }
}

// Camarades (étudiants actifs des groupes de la personne) : listés à chaque réponse pour que les écrans
// déjà ouverts suivent les changements de l'administration. L'administrateur voit tous les étudiants.
function etudiantsActifs_(user) {
  const c = contexte_(user);
  return listerUtilisateurs_().filter(function (u) {
    return u.role === 'etudiant' && u.statut === 'actif' && (c.admin || c.coequipiers[u.email]);
  }).map(function (u) { return { prenom: u.prenom, role: u.role, couleur: u.couleur }; });
}

function donnees_(user) {
  const c = contexte_(user);
  return {
    utilisateurs: etudiantsActifs_(user),
    enLigne: listerEnLigne_(user),
    groupes: groupesPourClient_(user, c),
    votes: votesPourClient_(user, c),
    lectures: lister_(user),
    commentaires: listerCommentaires_(user),
    lus: listerLus_(user),
    enAttente: peutGerer_(user)
      ? listerUtilisateurs_().filter(function (u) { return u.statut === 'en_attente'; }).length : 0
  };
}

function accesSiAdmin_(user) {
  return user.role === 'admin' ? { acces: listerAcces_(user), groupesAdmin: listerGroupesAdmin_(user) } : {};
}

/* ---------- Présence (qui est en ligne) ---------- */

// Stockée dans le cache du script, pas dans le Sheet : aucune écriture, et ça s'efface tout seul.
// L'administrateur reste discret : il n'apparaît pas dans la liste.
function signalerPresence_(user, action) {
  if (user.role === 'admin') return;
  const cache = CacheService.getScriptCache();
  const cle = 'p_' + user.email;
  if (action === 'bye') cache.remove(cle);
  else cache.put(cle, String(Date.now()), 600);
}

function listerEnLigne_(user) {
  const c = contexte_(user);
  const actifs = listerUtilisateurs_().filter(function (u) {
    return u.statut === 'actif' && (c.admin || c.coequipiers[u.email]);
  });
  const vus = CacheService.getScriptCache().getAll(actifs.map(function (u) { return 'p_' + u.email; }));
  const maintenant = Date.now();
  return actifs.filter(function (u) {
    const t = Number(vus['p_' + u.email]);
    return t && maintenant - t < PRESENCE_S * 1000;
  }).map(function (u) {
    return { prenom: u.prenom, couleur: u.couleur, role: u.role, moi: u.email === user.email };
  });
}

/* ---------- Authentification et accès ---------- */

function authentifier_(token, action) {
  if (!token || typeof token !== 'string') throw err_('unauthorized', 'Connexion requise');
  const cache = CacheService.getScriptCache();
  const cle = 't_' + Utilities.base64EncodeWebSafe(
    Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, token));
  let email = cache.get(cle);
  if (!email) {
    const res = UrlFetchApp.fetch(
      'https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(token),
      { muteHttpExceptions: true });
    if (res.getResponseCode() !== 200) throw err_('unauthorized', 'Session expirée, reconnectez-vous');
    const info = JSON.parse(res.getContentText());
    const clientId = PropertiesService.getScriptProperties().getProperty('GOOGLE_CLIENT_ID');
    if (!clientId || info.aud !== clientId) throw err_('unauthorized', 'Jeton invalide');
    if (String(info.email_verified) !== 'true') throw err_('unauthorized', 'Adresse non vérifiée');
    email = String(info.email).toLowerCase();
    const restant = Number(info.exp) - Math.floor(Date.now() / 1000);
    cache.put(cle, email, Math.max(1, Math.min(CACHE_JETON_MAX_S, restant)));
  }
  if (email === emailAdmin_()) {
    return { _row: 0, email: email, prenom: 'Administrateur', role: 'admin', couleur: COULEUR_ADMIN,
      statut: 'actif', demande_le: '', derniere_connexion: '' };
  }
  const user = listerUtilisateurs_().filter(function (u) { return u.email === email; })[0];
  if (!user) {
    // Adresse inconnue : une demande est enregistrée à l'ouverture de l'application seulement.
    if (action === 'init') avecVerrou_(function () { enregistrerDemande_(email); });
    throw err_('pending', 'Votre demande d’accès a été envoyée : elle doit être validée.');
  }
  if (user.statut === 'en_attente') throw err_('pending', 'Votre demande d’accès est en attente de validation.');
  if (user.statut === 'refuse') throw err_('forbidden', 'Accès refusé');
  return user;
}

function feuilleUtilisateurs_() {
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(FEUILLE_UTILISATEURS);
  if (!sh) throw err_('server', 'Feuille Utilisateurs absente : lancez setup()');
  return sh;
}

function listerUtilisateurs_() {
  return lu_('u', lireUtilisateurs_);
}

function lireUtilisateurs_() {
  return feuilleUtilisateurs_().getDataRange().getDisplayValues().slice(1).map(function (r, i) {
    const role = String(r[2]).trim().toLowerCase();
    const statut = String(r[4] || '').trim().toLowerCase();
    return {
      _row: i + 2,
      email: String(r[0]).trim().toLowerCase(),
      prenom: String(r[1]).trim(),
      // Rôle inconnu ou vide : le moins privilégié.
      role: role === 'etudiant' || role === 'formateur' ? role : 'lecteur',
      couleur: /^#[0-9a-fA-F]{6}$/.test(String(r[3]).trim()) ? String(r[3]).trim() : COULEUR_DEFAUT,
      // Ligne ancienne sans statut : considérée comme active.
      statut: statut === 'en_attente' || statut === 'refuse' ? statut : 'actif',
      demande_le: String(r[5] || ''),
      derniere_connexion: String(r[6] || '')
    };
  }).filter(function (u) { return u.email; });
}

function enregistrerDemande_(email) {
  const existants = listerUtilisateurs_();
  if (existants.some(function (u) { return u.email === email; })) return;
  const enAttente = existants.filter(function (u) { return u.statut === 'en_attente'; }).length;
  if (enAttente >= MAX_EN_ATTENTE) throw err_('forbidden', 'Trop de demandes en attente, réessayez plus tard');
  feuilleUtilisateurs_().appendRow([email, '', 'lecteur', COULEUR_DEFAUT, 'en_attente', new Date().toISOString(), '']);
}

function emailAdmin_() {
  return String(PropertiesService.getScriptProperties().getProperty('ADMIN_EMAIL') || '').trim().toLowerCase();
}

function majConnexion_(user) {
  if (!user._row) return;
  const derniere = Date.parse(user.derniere_connexion);
  if (derniere && Date.now() - derniere < DELAI_CONNEXION_MS) return;
  feuilleUtilisateurs_().getRange(user._row, 7, 1, 1).setValues([[new Date().toISOString()]]);
}

/* ---------- Administration des accès (étudiants) ---------- */

// L'administrateur voit tout le monde. Un étudiant ne voit pas les adresses des autres étudiants (la promo en compte beaucoup) :
// il garde les demandes en attente et les formateurs / lecteurs qu'il peut gérer.
function listerAcces_(user) {
  const admin = user.role === 'admin';
  const nbL = {}, nbC = {};
  lireTable_(feuilleLectures_(), COLONNES).forEach(function (r) { nbL[r.owner] = (nbL[r.owner] || 0) + 1; });
  lireTable_(feuilleCommentaires_(), COL_COMMENTAIRES).forEach(function (r) { nbC[r.auteur_email] = (nbC[r.auteur_email] || 0) + 1; });
  return listerUtilisateurs_().filter(function (u) { return admin || u.role !== 'etudiant'; }).map(function (u) {
    return { email: u.email, prenom: u.prenom, role: u.role, statut: u.statut, couleur: u.couleur,
      demande_le: u.demande_le, derniere_connexion: u.derniere_connexion, protege: u.role === 'etudiant',
      nb_lectures: nbL[u.email] || 0, nb_commentaires: nbC[u.email] || 0 };
  });
}

// Suppression d'un accès (administrateur seulement). La ligne de l'utilisateur disparaît, donc plus aucun accès ;
// ses lectures et commentaires restent dans le Sheet (récupérables), mais ne sont plus affichés : ses commentaires
// sont masqués avec ses lectures ou, sur les lectures d'autrui, signés « Utilisateur supprimé ».
// Si la même adresse est un jour revalidée, ses lectures réapparaissent.
function supprimerUtilisateur_(user, email) {
  if (user.role !== 'admin') throw err_('forbidden', 'Réservé à l’administrateur');
  email = String(email || '').trim().toLowerCase();
  const cible = listerUtilisateurs_().filter(function (u) { return u.email === email; })[0];
  if (!cible) throw err_('not_found', 'Adresse introuvable');
  feuilleUtilisateurs_().deleteRow(cible._row);
}

function administrer_(user, data) {
  exigerGestion_(user);
  const admin = user.role === 'admin';
  if (!data || typeof data !== 'object') throw err_('invalid', 'Données manquantes');
  const email = String(data.email || '').trim().toLowerCase();
  const tous = listerUtilisateurs_();
  const cible = tous.filter(function (u) { return u.email === email; })[0];
  if (!cible) throw err_('not_found', 'Adresse introuvable');
  if (cible.role === 'etudiant' && !admin) {
    throw err_('forbidden', 'Les étudiants sont gérés par l’administrateur');
  }
  const role = String(data.role || '');
  const statut = String(data.statut || '');
  const prenom = String(data.prenom === undefined || data.prenom === null ? '' : data.prenom).trim();
  if ((admin ? ['etudiant', 'formateur', 'lecteur'] : ['formateur', 'lecteur']).indexOf(role) < 0) {
    throw err_('invalid', 'Rôle invalide');
  }
  if (['actif', 'refuse'].indexOf(statut) < 0) throw err_('invalid', 'Statut invalide');
  if (prenom.length > PRENOM_MAX) throw err_('invalid', 'Prénom trop long');
  if (statut === 'actif' && !prenom) throw err_('invalid', 'Prénom requis pour valider un accès');

  let couleur = cible.couleur;
  if (admin && data.couleur) {
    if (!/^#[0-9a-fA-F]{6}$/.test(String(data.couleur))) throw err_('invalid', 'Couleur invalide');
    couleur = String(data.couleur);
  }
  let nouvelEmail = email;
  if (admin && data.nouvel_email && String(data.nouvel_email).trim().toLowerCase() !== email) {
    nouvelEmail = String(data.nouvel_email).trim().toLowerCase();
    if (!EMAIL_VALIDE.test(nouvelEmail)) throw err_('invalid', 'Adresse e-mail invalide');
    if (nouvelEmail === emailAdmin_() || tous.some(function (u) { return u.email === nouvelEmail; })) {
      throw err_('invalid', 'Cette adresse est déjà utilisée');
    }
  }
  feuilleUtilisateurs_().getRange(cible._row, 1, 1, 5).setValues([[nouvelEmail, prenom, role, couleur, statut]]);
  // Les lectures et commentaires sont rattachés à l'adresse : on les suit.
  if (nouvelEmail !== email) migrerEmail_(email, nouvelEmail);
}

function migrerEmail_(ancien, nouveau) {
  const tables = [[feuilleLectures_(), COLONNES, 'owner'], [feuilleCommentaires_(), COL_COMMENTAIRES, 'auteur_email']];
  if (feuilleLus_(false)) tables.push([feuilleLus_(false), COL_LUS, 'id']);
  [[FEUILLE_MEMBRES, COL_MEMBRES, 'email'], [FEUILLE_VOTES, COL_VOTES, 'cible'], [FEUILLE_VOTES, COL_VOTES, 'propose_par']]
    .forEach(function (t) {
      const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(t[0]);
      if (sh) tables.push([sh, t[1], t[2]]);
    });
  tables.forEach(function (t) {
      lireTable_(t[0], t[1]).filter(function (r) { return r[t[2]].toLowerCase() === ancien; })
        .forEach(function (r) { t[0].getRange(r._row, t[1].indexOf(t[2]) + 1, 1, 1).setValues([[nouveau]]); });
    });
  // Les votes déposés sont indexés par adresse.
  const shV = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(FEUILLE_VOTES);
  if (shV) {
    lireTable_(shV, COL_VOTES).filter(function (v) { return v.votes.indexOf(ancien) >= 0; }).forEach(function (v) {
      shV.getRange(v._row, COL_VOTES.indexOf('votes') + 1, 1, 1).setValues([[v.votes.split('"' + ancien + '"').join('"' + nouveau + '"')]]);
    });
  }
}

/* ---------- Lectures ---------- */

function feuilleLectures_() {
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(FEUILLE_LECTURES);
  if (!sh) throw err_('server', 'Feuille Lectures absente : lancez setup()');
  return sh;
}

function lireTable_(sh, colonnes) {
  return lu_('t:' + sh.getName(), function () {
    return sh.getDataRange().getDisplayValues().slice(1).map(function (v, i) {
      const o = { _row: i + 2 };
      colonnes.forEach(function (c, j) { o[c] = v[j] === undefined ? '' : String(v[j]); });
      return o;
    }).filter(function (o) { return o.id; });
  });
}

function lister_(user) {
  const parEmail = {};
  listerUtilisateurs_().forEach(function (u) { parEmail[u.email] = u; });
  const c = contexte_(user);
  // Les lectures d'un utilisateur supprimé, ou d'un groupe supprimé, restent dans la feuille mais ne sont plus affichées.
  return lireTable_(feuilleLectures_(), COLONNES).filter(function (r) {
    return parEmail[r.owner] && lectureVisible_(c, r);
  }).map(function (r) {
    const proprio = parEmail[r.owner];
    const g = c.groupesParId[r.groupe_id];
    const pub = { etudiant: proprio.prenom, couleur: proprio.couleur, mine: r.owner === user.email };
    COLONNES.forEach(function (col) { if (col !== 'owner') pub[col] = r[col]; });
    pub.portee = r.portee === 'promo' ? 'promo' : 'groupe';
    pub.groupe = g.nom;
    pub.etablissement = g.etablissement;
    pub.promo = g.promo;
    // Modifiable par tout étudiant du groupe de la fiche (pas par les autres groupes de la promo).
    pub.modifiable = user.role === 'etudiant' && !!c.miens[g.id];
    return pub;
  });
}

function lectureVisible_(c, r) {
  const g = c.groupesParId[r.groupe_id];
  if (!g) return false;
  if (c.admin || c.miens[g.id]) return true;
  return r.portee === 'promo' && !!c.promos[clePromo_(g)];
}

function ajouter_(user, data) {
  exigerEtudiant_(user);
  const gid = groupeParDefaut_(user, data && data.groupe_id);
  const d = nettoyer_(data);
  d.portee = d.portee || 'groupe';
  valider_(d);
  const meta = { id: Utilities.getUuid(), owner: user.email, ajoute: new Date().toISOString(),
    modifie_le: '', modifie_par: '', groupe_id: gid };
  const ligne = COLONNES.map(function (c) { return c in meta ? meta[c] : d[c]; });
  feuilleLectures_().appendRow(ligne);
  return meta.id;
}

// Groupe de la nouvelle fiche : celui demandé (dont l'étudiant doit être membre) ou, à défaut, son seul groupe.
function groupeParDefaut_(user, demande) {
  const c = contexte_(user);
  const gid = String(demande || '');
  if (gid) { exigerMembre_(user, gid); return gid; }
  if (c.mesGroupes.length === 1) return c.mesGroupes[0].id;
  throw err_('invalid', c.mesGroupes.length ? 'Choisissez un groupe' : 'Vous ne faites encore partie d’aucun groupe');
}

function modifier_(user, id, data, override) {
  exigerEtudiant_(user);
  const sh = feuilleLectures_();
  const r = trouver_(sh, id);
  exigerMembre_(user, r.groupe_id);
  const proprio = r.owner === user.email;
  if (!proprio && !override) {
    throw err_('not_owner', 'Cette lecture appartient à quelqu’un d’autre');
  }
  const d = nettoyer_(data);
  d.portee = d.portee || r.portee || 'groupe';
  valider_(d);
  const maintenant = new Date().toISOString();
  if (!proprio) historiser_(r, user, maintenant);
  const ligne = COLONNES.map(function (c) {
    if (CHAMPS.indexOf(c) >= 0) return d[c];
    if (c === 'modifie_le') return maintenant;
    if (c === 'modifie_par') return user.prenom;
    return r[c];
  });
  sh.getRange(r._row, 1, 1, COLONNES.length).setValues([ligne]);
}

function supprimer_(user, id) {
  exigerEtudiant_(user);
  const sh = feuilleLectures_();
  const r = trouver_(sh, id);
  if (r.owner !== user.email) throw err_('not_owner', 'Seul le propriétaire peut supprimer une lecture');
  exigerMembre_(user, r.groupe_id);
  sh.deleteRow(r._row);
  // Les commentaires d'une lecture supprimée sont supprimés avec elle (de bas en haut).
  const c = feuilleCommentaires_();
  lireTable_(c, COL_COMMENTAIRES).filter(function (x) { return x.lecture_id === id; })
    .sort(function (a, b) { return b._row - a._row; })
    .forEach(function (x) { c.deleteRow(x._row); });
}

function historiser_(ancienne, user, date) {
  const proprio = listerUtilisateurs_().filter(function (u) { return u.email === ancienne.owner; })[0];
  const avant = {};
  CHAMPS.forEach(function (c) { avant[c] = ancienne[c]; });
  const h = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(FEUILLE_HISTORIQUE);
  h.appendRow([date, ancienne.id, user.prenom, proprio ? proprio.prenom : '', JSON.stringify(avant).slice(0, 49000)]);
}

/* ---------- Commentaires (étudiants et formateurs) ---------- */

function feuilleCommentaires_() {
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(FEUILLE_COMMENTAIRES);
  if (!sh) throw err_('server', 'Feuille Commentaires absente : lancez setup()');
  return sh;
}

function listerCommentaires_(user) {
  const actifs = {};
  listerUtilisateurs_().forEach(function (u) { actifs[u.email] = true; });
  const c = contexte_(user);
  // Seules les lectures encore affichées ont leurs commentaires listés, et chaque fil (groupe ou promo) a sa visibilité.
  const visibles = {};
  lister_(user).forEach(function (l) { visibles[l.id] = l; });
  return lireTable_(feuilleCommentaires_(), COL_COMMENTAIRES).filter(function (r) {
    const l = visibles[r.lecture_id];
    if (!l) return false;
    return r.portee === 'promo' ? l.portee === 'promo' : (c.admin || !!c.miens[l.groupe_id]);
  }).map(function (r) {
    // Un commentaire d'un utilisateur supprimé est conservé, sous un nom neutre.
    const connu = actifs[r.auteur_email] || r.auteur_email === emailAdmin_();
    const g = c.groupesParId[r.groupe_id];
    return { id: r.id, lecture_id: r.lecture_id, auteur: connu ? r.auteur : 'Utilisateur supprimé', date: r.date, modifie_le: r.modifie_le,
      texte: r.texte, mine: r.auteur_email === user.email, portee: r.portee === 'promo' ? 'promo' : 'groupe',
      groupe: g ? g.nom : '' };
  });
}

// portee « groupe » : fil réservé aux membres du groupe de la fiche ; « promo » : fil ouvert à toute la promo,
// seulement si la fiche est partagée avec elle. Les deux fils sont indépendants.
function commenter_(user, lectureId, texte, portee) {
  exigerCommentateur_(user);
  const t = nettoyerCommentaire_(texte);
  const l = trouver_(feuilleLectures_(), lectureId);
  const c = contexte_(user);
  const g = c.groupesParId[l.groupe_id];
  if (!g) throw err_('not_found', 'Lecture introuvable');
  let porteeFinale = portee === 'promo' ? 'promo' : 'groupe';
  let gid = g.id;
  if (porteeFinale === 'groupe') {
    if (!c.miens[g.id]) throw err_('forbidden', 'Ce fil est réservé aux membres du groupe');
  } else {
    if (l.portee !== 'promo') throw err_('forbidden', 'Cette fiche n’est pas partagée avec la promo');
    const mien = c.mesGroupes.filter(function (x) { return clePromo_(x) === clePromo_(g); })[0];
    if (!mien) throw err_('forbidden', 'Réservé aux membres de la promo');
    gid = mien.id;
  }
  const id = Utilities.getUuid();
  feuilleCommentaires_().appendRow([id, lectureId, user.email, user.prenom, new Date().toISOString(), t, '', porteeFinale, gid]);
  return id;
}

function modifierCommentaire_(user, id, texte) {
  exigerCommentateur_(user);
  const sh = feuilleCommentaires_();
  const c = trouverCommentaire_(sh, id);
  if (c.auteur_email !== user.email) throw err_('not_owner', 'Vous ne pouvez modifier que vos commentaires');
  const t = nettoyerCommentaire_(texte);
  sh.getRange(c._row, 6, 1, 2).setValues([[t, new Date().toISOString()]]);
}

function supprimerCommentaire_(user, id) {
  const sh = feuilleCommentaires_();
  const c = trouverCommentaire_(sh, id);
  const auteur = c.auteur_email === user.email && peutCommenter_(user);
  // Modération : les étudiants du groupe sur le fil du groupe ; le fil de la promo n'est modéré que par l'administrateur.
  const l = lireTable_(feuilleLectures_(), COLONNES).filter(function (x) { return x.id === c.lecture_id; })[0];
  const modere = c.portee !== 'promo' && user.role === 'etudiant' && !!l && !!contexte_(user).miens[l.groupe_id];
  if (!auteur && !modere && user.role !== 'admin') throw err_('forbidden', 'Suppression non autorisée');
  sh.deleteRow(c._row);
}

/* ---------- Commentaires lus / non lus (par personne, suivis d'un appareil à l'autre) ---------- */

function feuilleLus_(creer) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName(FEUILLE_LUS);
  // La feuille est créée au besoin : une installation antérieure fonctionne sans relancer setup().
  return sh || (creer ? preparer_(ss, FEUILLE_LUS, COL_LUS) : null);
}

function listerLus_(user) {
  const sh = feuilleLus_(false);
  if (!sh) return [];
  const ligne = lireTable_(sh, COL_LUS).filter(function (r) { return r.id === user.email; })[0];
  if (!ligne || !ligne.commentaires) return [];
  const existants = {};
  lireTable_(feuilleCommentaires_(), COL_COMMENTAIRES).forEach(function (c) { existants[c.id] = true; });
  return ligne.commentaires.split(',').filter(function (id) { return existants[id]; });
}

// ids : commentaires à marquer lus ; tous : marque tout ce qui existe. Les identifiants de commentaires
// supprimés sont retirés au passage, pour que la liste reste courte.
function marquerLus_(user, ids, tous) {
  const existants = {};
  lireTable_(feuilleCommentaires_(), COL_COMMENTAIRES).forEach(function (c) { existants[c.id] = true; });
  const demandes = tous ? Object.keys(existants) : (Array.isArray(ids) ? ids : []);
  const sh = feuilleLus_(true);
  const ligne = lireTable_(sh, COL_LUS).filter(function (r) { return r.id === user.email; })[0];
  const deja = ligne && ligne.commentaires ? ligne.commentaires.split(',') : [];
  const fusion = {};
  deja.concat(demandes.map(String)).forEach(function (id) { if (existants[id]) fusion[id] = true; });
  const texte = Object.keys(fusion).join(',');
  if (ligne) sh.getRange(ligne._row, 2, 1, 1).setValues([[texte]]);
  else sh.appendRow([user.email, texte]);
}

// Remet des commentaires en « non lu » (les retire de la liste des lus).
function marquerNonLus_(user, ids) {
  const sh = feuilleLus_(false);
  if (!sh || !Array.isArray(ids)) return;
  const ligne = lireTable_(sh, COL_LUS).filter(function (r) { return r.id === user.email; })[0];
  if (!ligne || !ligne.commentaires) return;
  const retirer = {};
  ids.forEach(function (id) { retirer[String(id)] = true; });
  const reste = ligne.commentaires.split(',').filter(function (id) { return !retirer[id]; });
  sh.getRange(ligne._row, 2, 1, 1).setValues([[reste.join(',')]]);
}

function trouverCommentaire_(sh, id) {
  const c = lireTable_(sh, COL_COMMENTAIRES).filter(function (x) { return x.id === id; })[0];
  if (!c) throw err_('not_found', 'Commentaire introuvable');
  return c;
}

function nettoyerCommentaire_(texte) {
  const t = texte === undefined || texte === null ? '' : String(texte).trim();
  if (!t) throw err_('invalid', 'Commentaire vide');
  if (t.length > COMMENTAIRE_MAX) throw err_('invalid', 'Commentaire trop long (' + COMMENTAIRE_MAX + ' caractères maximum)');
  return t;
}

/* ---------- Groupes, membres et votes ---------- */

function table_(nom, colonnes) {
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(nom);
  return sh ? lireTable_(sh, colonnes) : [];
}

function feuilleDe_(nom, colonnes) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  return ss.getSheetByName(nom) || preparer_(ss, nom, colonnes);
}

// Une promo = un établissement + un nom de promo (comparés sans accents ni casse).
function clePromo_(g) {
  return normaliserTerme_(g.etablissement) + '|' + normaliserTerme_(g.promo);
}

// Identifiant public d'une personne (jamais son adresse) : sert à désigner un membre depuis l'application.
function pid_(email) {
  return Utilities.base64EncodeWebSafe(
    Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, 'pid:' + email)).slice(0, 12);
}

// Groupes visibles par la personne (l'administrateur les voit tous) et ce qui en découle.
function contexte_(user) {
  return lu_('ctx:' + user.email, function () {
    const groupes = table_(FEUILLE_GROUPES, COL_GROUPES);
    const parId = {};
    groupes.forEach(function (g) { parId[g.id] = g; });
    const actifs = {};
    listerUtilisateurs_().forEach(function (u) { if (u.statut === 'actif') actifs[u.email] = true; });
    const membres = table_(FEUILLE_MEMBRES, COL_MEMBRES).filter(function (m) { return actifs[m.email] && parId[m.groupe_id]; });
    const admin = user.role === 'admin';
    const miens = {};
    membres.forEach(function (m) { if (m.email === user.email) miens[m.groupe_id] = true; });
    const mesGroupes = groupes.filter(function (g) { return admin || miens[g.id]; });
    const promos = {};
    mesGroupes.forEach(function (g) { promos[clePromo_(g)] = true; });
    const coequipiers = {};
    membres.forEach(function (m) { if (miens[m.groupe_id]) coequipiers[m.email] = true; });
    return { admin: admin, groupesParId: parId, membres: membres, miens: miens, mesGroupes: mesGroupes,
      promos: promos, coequipiers: coequipiers };
  });
}

function exigerMembre_(user, gid) {
  const c = contexte_(user);
  if (!c.groupesParId[gid] || !c.miens[gid]) throw err_('forbidden', 'Vous ne faites pas partie de ce groupe');
}

function groupesPourClient_(user, c) {
  const parEmail = {};
  listerUtilisateurs_().forEach(function (u) { parEmail[u.email] = u; });
  return c.mesGroupes.map(function (g) {
    const membres = c.membres.filter(function (m) { return m.groupe_id === g.id; }).map(function (m) {
      const u = parEmail[m.email];
      return { pid: pid_(m.email), prenom: u.prenom, couleur: u.couleur, role: u.role, moi: m.email === user.email };
    }).sort(function (a, b) {
      return (a.role === 'etudiant' ? 0 : 1) - (b.role === 'etudiant' ? 0 : 1) || a.prenom.localeCompare(b.prenom);
    });
    return { id: g.id, nom: g.nom, etablissement: g.etablissement, promo: g.promo, membres: membres };
  }).sort(function (a, b) {
    return (a.etablissement + a.promo + a.nom).localeCompare(b.etablissement + b.promo + b.nom);
  });
}

// Étudiants actifs d'un groupe qui votent (hors la personne visée, pour un retrait).
function electeursGroupe_(gid, sauf) {
  const etudiants = {};
  listerUtilisateurs_().forEach(function (u) { if (u.statut === 'actif' && u.role === 'etudiant') etudiants[u.email] = true; });
  return table_(FEUILLE_MEMBRES, COL_MEMBRES).filter(function (m) {
    return m.groupe_id === gid && etudiants[m.email] && m.email !== sauf;
  }).map(function (m) { return m.email; });
}

function lireVotesDe_(v) {
  try { return JSON.parse(v.votes || '{}') || {}; } catch (e) { return {}; }
}

// Majorité simple des électeurs : adopté dès que « oui » dépasse la moitié, refusé dès que la majorité n'est plus atteignable.
function etatVote_(v, electeurs) {
  const votes = lireVotesDe_(v);
  const oui = electeurs.filter(function (e) { return votes[e] === 1; }).length;
  const non = electeurs.filter(function (e) { return votes[e] === 0; }).length;
  const n = electeurs.length;
  const besoin = Math.floor(n / 2) + 1;
  return { oui: oui, non: non, n: n, besoin: besoin, adopte: n > 0 && oui >= besoin, refuse: n > 0 && non > n - besoin };
}

function voteOuvert_(v, maintenant) {
  return v.statut === 'ouvert' && Date.parse(v.cree_le) + VOTE_DUREE_MS > maintenant;
}

function votesPourClient_(user, c) {
  const maintenant = Date.now();
  const parEmail = {};
  listerUtilisateurs_().forEach(function (u) { parEmail[u.email] = u; });
  return table_(FEUILLE_VOTES, COL_VOTES).filter(function (v) {
    return voteOuvert_(v, maintenant) && c.groupesParId[v.groupe_id] && (c.admin || c.miens[v.groupe_id]);
  }).map(function (v) {
    const retrait = v.type === 'retrait';
    const tous = electeursGroupe_(v.groupe_id);
    if (retrait && tous.indexOf(v.cible) < 0) return null;
    const electeurs = retrait ? tous.filter(function (e) { return e !== v.cible; }) : tous;
    const etat = etatVote_(v, electeurs);
    const votes = lireVotesDe_(v);
    const proposant = parEmail[v.propose_par];
    return { id: v.id, groupe_id: v.groupe_id, type: v.type,
      cible_pid: retrait ? pid_(v.cible) : '', cible: retrait ? parEmail[v.cible].prenom : '', valeur: v.valeur,
      propose_par: proposant ? proposant.prenom : 'Utilisateur supprimé',
      expire_le: new Date(Date.parse(v.cree_le) + VOTE_DUREE_MS).toISOString(),
      oui: etat.oui, non: etat.non, n: etat.n, besoin: etat.besoin,
      mon_vote: votes[user.email] === undefined ? null : votes[user.email],
      peut_voter: electeurs.indexOf(user.email) >= 0, proposant: v.propose_par === user.email };
  }).filter(Boolean);
}

function nomValide_(v, libelle) {
  const t = String(v === undefined || v === null ? '' : v).trim().replace(/\s+/g, ' ');
  if (!t) throw err_('invalid', libelle + ' vide');
  if (t.length > NOM_MAX) throw err_('invalid', libelle + ' trop long (' + NOM_MAX + ' caractères maximum)');
  return t;
}

function verifierNomLibre_(cle, nom, sauf) {
  const k = normaliserTerme_(nom);
  if (table_(FEUILLE_GROUPES, COL_GROUPES).some(function (g) {
    return g.id !== sauf && clePromo_(g) === cle && normaliserTerme_(g.nom) === k;
  })) throw err_('invalid', 'Ce nom est déjà pris dans cette promo');
}

// Un étudiant n'est que dans un groupe par promo.
function dejaDansPromo_(email, cle, sauf) {
  const parId = {};
  table_(FEUILLE_GROUPES, COL_GROUPES).forEach(function (g) { parId[g.id] = g; });
  return table_(FEUILLE_MEMBRES, COL_MEMBRES).some(function (m) {
    return m.email === email && m.groupe_id !== sauf && parId[m.groupe_id] && clePromo_(parId[m.groupe_id]) === cle;
  });
}

function ajouterMembre_(g, u) {
  if (table_(FEUILLE_MEMBRES, COL_MEMBRES).some(function (m) { return m.groupe_id === g.id && m.email === u.email; })) {
    throw err_('invalid', u.prenom + ' fait déjà partie du groupe');
  }
  if (u.role === 'etudiant' && dejaDansPromo_(u.email, clePromo_(g), g.id)) {
    throw err_('invalid', u.prenom + ' est déjà dans un groupe de cette promo');
  }
  feuilleDe_(FEUILLE_MEMBRES, COL_MEMBRES).appendRow([Utilities.getUuid(), g.id, u.email, new Date().toISOString()]);
}

function retirerMembre_(gid, email) {
  const sh = feuilleDe_(FEUILLE_MEMBRES, COL_MEMBRES);
  const lignes = lireTable_(sh, COL_MEMBRES).filter(function (m) { return m.groupe_id === gid && m.email === email; });
  if (!lignes.length) throw err_('not_found', 'Ce membre ne fait pas partie du groupe');
  lignes.sort(function (a, b) { return b._row - a._row; }).forEach(function (m) { sh.deleteRow(m._row); });
}

function groupeParId_(gid) {
  const g = table_(FEUILLE_GROUPES, COL_GROUPES).filter(function (x) { return x.id === gid; })[0];
  if (!g) throw err_('not_found', 'Groupe introuvable');
  return g;
}

function utilisateurActif_(predicat) {
  return listerUtilisateurs_().filter(function (u) { return u.statut === 'actif' && predicat(u); })[0];
}

// Étudiants sans groupe dans la promo du groupe : ceux qu'un membre peut rattacher à son groupe.
function candidats_(user, gid) {
  exigerEtudiant_(user);
  exigerMembre_(user, gid);
  const g = groupeParId_(gid);
  const cle = clePromo_(g);
  return listerUtilisateurs_().filter(function (u) {
    return u.statut === 'actif' && u.role === 'etudiant' && !dejaDansPromo_(u.email, cle, '');
  }).map(function (u) { return { pid: pid_(u.email), prenom: u.prenom }; })
    .sort(function (a, b) { return a.prenom.localeCompare(b.prenom); });
}

// Un membre ajoute un étudiant sans groupe (désigné par son identifiant public) ; l'administrateur peut tout rattacher, par adresse.
function ajouterMembreDemande_(user, gid, pid, email) {
  const admin = user.role === 'admin';
  if (!admin) { exigerEtudiant_(user); exigerMembre_(user, gid); }
  const g = groupeParId_(gid);
  const cible = admin && email
    ? utilisateurActif_(function (u) { return u.email === String(email).trim().toLowerCase(); })
    : utilisateurActif_(function (u) { return pid_(u.email) === pid; });
  if (!cible) throw err_('not_found', 'Personne introuvable');
  if (!admin && cible.role !== 'etudiant') throw err_('forbidden', 'Seul l’administrateur rattache un formateur ou un lecteur');
  ajouterMembre_(g, cible);
}

function retirerMembreAdmin_(user, gid, email) {
  if (user.role !== 'admin') throw err_('forbidden', 'Réservé à l’administrateur');
  groupeParId_(gid);
  retirerMembre_(gid, String(email || '').trim().toLowerCase());
}

/* ----- Votes à la majorité (retrait d'un membre, changement de nom) ----- */

function cloreExpires_() {
  const sh = feuilleDe_(FEUILLE_VOTES, COL_VOTES);
  const maintenant = Date.now();
  lireTable_(sh, COL_VOTES).forEach(function (v) {
    if (v.statut === 'ouvert' && !voteOuvert_(v, maintenant)) {
      sh.getRange(v._row, COL_VOTES.indexOf('statut') + 1, 1, 2).setValues([['expire', new Date().toISOString()]]);
    }
  });
}

function proposerVote_(user, gid, type, pid, nom) {
  exigerEtudiant_(user);
  exigerMembre_(user, gid);
  cloreExpires_();
  const g = groupeParId_(gid);
  const maintenant = Date.now();
  const votes = table_(FEUILLE_VOTES, COL_VOTES).filter(function (v) { return v.groupe_id === gid && v.type === type; });
  let cible = '', valeur = '';
  if (type === 'retrait') {
    const tous = electeursGroupe_(gid);
    cible = tous.filter(function (e) { return pid_(e) === pid; })[0];
    if (!cible) throw err_('not_found', 'Membre introuvable');
    if (cible === user.email) throw err_('invalid', 'Vous ne pouvez pas proposer votre propre retrait');
    if (tous.length < 3) throw err_('invalid', 'À deux, le retrait ne peut pas être voté : contactez l’administrateur');
    if (votes.some(function (v) { return v.cible === cible && v.statut === 'ouvert'; })) {
      throw err_('invalid', 'Une proposition est déjà en cours pour ce membre');
    }
    if (votes.some(function (v) { return v.cible === cible && v.statut === 'refuse' && maintenant - Date.parse(v.clos_le) < VOTE_BLOCAGE_MS; })) {
      throw err_('invalid', 'Une proposition contre cette personne a été refusée récemment : réessayez dans quelques jours');
    }
  } else if (type === 'nom') {
    valeur = nomValide_(nom, 'Nom');
    if (normaliserTerme_(valeur) === normaliserTerme_(g.nom)) throw err_('invalid', 'C’est déjà le nom du groupe');
    verifierNomLibre_(clePromo_(g), valeur, g.id);
    if (votes.some(function (v) { return v.statut === 'ouvert'; })) throw err_('invalid', 'Un changement de nom est déjà en cours de vote');
    if (votes.some(function (v) { return v.statut === 'refuse' && v.valeur === valeur && maintenant - Date.parse(v.clos_le) < VOTE_BLOCAGE_MS; })) {
      throw err_('invalid', 'Ce nom a été refusé récemment');
    }
  } else {
    throw err_('invalid', 'Type de vote inconnu');
  }
  const sh = feuilleDe_(FEUILLE_VOTES, COL_VOTES);
  const id = Utilities.getUuid();
  const v = { id: id, groupe_id: gid, type: type, cible: cible, valeur: valeur, propose_par: user.email,
    cree_le: new Date().toISOString(), votes: JSON.stringify(objetUnique_(user.email, 1)), statut: 'ouvert', clos_le: '' };
  sh.appendRow(COL_VOTES.map(function (c) { return v[c]; }));
  evaluerVote_(lireTable_(sh, COL_VOTES).filter(function (x) { return x.id === id; })[0]);
}

function objetUnique_(cle, valeur) { const o = {}; o[cle] = valeur; return o; }

function trouverVote_(id) {
  const v = table_(FEUILLE_VOTES, COL_VOTES).filter(function (x) { return x.id === id; })[0];
  if (!v) throw err_('not_found', 'Proposition introuvable');
  return v;
}

function repondreVote_(user, id, oui) {
  exigerEtudiant_(user);
  cloreExpires_();
  const v = trouverVote_(id);
  if (v.statut !== 'ouvert') throw err_('invalid', 'Cette proposition est close');
  exigerMembre_(user, v.groupe_id);
  const electeurs = electeursGroupe_(v.groupe_id, v.type === 'retrait' ? v.cible : '');
  if (electeurs.indexOf(user.email) < 0) throw err_('forbidden', 'Vous ne participez pas à ce vote');
  const votes = lireVotesDe_(v);
  votes[user.email] = oui ? 1 : 0;
  v.votes = JSON.stringify(votes);
  feuilleDe_(FEUILLE_VOTES, COL_VOTES).getRange(v._row, COL_VOTES.indexOf('votes') + 1, 1, 1).setValues([[v.votes]]);
  evaluerVote_(v);
}

function annulerVote_(user, id) {
  const v = trouverVote_(id);
  if (v.statut !== 'ouvert') throw err_('invalid', 'Cette proposition est close');
  if (v.propose_par !== user.email && user.role !== 'admin') throw err_('forbidden', 'Seul l’auteur de la proposition peut l’annuler');
  feuilleDe_(FEUILLE_VOTES, COL_VOTES).getRange(v._row, COL_VOTES.indexOf('statut') + 1, 1, 2)
    .setValues([['annule', new Date().toISOString()]]);
}

// Tranche si la majorité est acquise (ou ne peut plus l'être) et applique le résultat.
function evaluerVote_(v) {
  const retrait = v.type === 'retrait';
  const etat = etatVote_(v, electeursGroupe_(v.groupe_id, retrait ? v.cible : ''));
  if (!etat.adopte && !etat.refuse) return;
  let statut = etat.adopte ? 'adopte' : 'refuse';
  if (etat.adopte) {
    try {
      if (retrait) {
        // Garde-fou : on ne vide jamais un groupe de ses étudiants.
        if (electeursGroupe_(v.groupe_id).length < 2) throw err_('invalid', 'dernier étudiant');
        retirerMembre_(v.groupe_id, v.cible);
      } else {
        const g = groupeParId_(v.groupe_id);
        verifierNomLibre_(clePromo_(g), v.valeur, g.id);
        feuilleDe_(FEUILLE_GROUPES, COL_GROUPES).getRange(g._row, COL_GROUPES.indexOf('nom') + 1, 1, 1).setValues([[v.valeur]]);
      }
    } catch (e) {
      if (!e.code) throw e;
      statut = 'annule';
    }
  }
  feuilleDe_(FEUILLE_VOTES, COL_VOTES).getRange(v._row, COL_VOTES.indexOf('statut') + 1, 1, 2)
    .setValues([[statut, new Date().toISOString()]]);
}

/* ----- Administration des groupes (administrateur) ----- */

function exigerAdmin_(user) {
  if (user.role !== 'admin') throw err_('forbidden', 'Réservé à l’administrateur');
}

function listerGroupesAdmin_(user) {
  if (user.role !== 'admin') return [];
  const parEmail = {};
  listerUtilisateurs_().forEach(function (u) { parEmail[u.email] = u; });
  const membres = table_(FEUILLE_MEMBRES, COL_MEMBRES);
  return table_(FEUILLE_GROUPES, COL_GROUPES).map(function (g) {
    return { id: g.id, etablissement: g.etablissement, promo: g.promo, nom: g.nom, cree_le: g.cree_le,
      membres: membres.filter(function (m) { return m.groupe_id === g.id && parEmail[m.email]; }).map(function (m) {
        return { email: m.email, prenom: parEmail[m.email].prenom, role: parEmail[m.email].role };
      }) };
  });
}

function creerGroupe_(user, data) {
  exigerAdmin_(user);
  if (!data || typeof data !== 'object') throw err_('invalid', 'Données manquantes');
  const g = { id: Utilities.getUuid(), etablissement: nomValide_(data.etablissement, 'Établissement'),
    promo: nomValide_(data.promo, 'Promo'), nom: nomValide_(data.nom, 'Nom'), cree_le: new Date().toISOString() };
  const cle = clePromo_(g);
  verifierNomLibre_(cle, g.nom, '');
  const vus = {};
  const membres = (Array.isArray(data.membres) ? data.membres : []).map(function (e) {
    const email = String(e || '').trim().toLowerCase();
    const u = utilisateurActif_(function (x) { return x.email === email; });
    if (!u) throw err_('not_found', 'Personne introuvable : ' + email);
    if (vus[email]) throw err_('invalid', u.prenom + ' est indiqué deux fois');
    vus[email] = true;
    if (u.role === 'etudiant' && dejaDansPromo_(email, cle, '')) throw err_('invalid', u.prenom + ' est déjà dans un groupe de cette promo');
    return u;
  });
  feuilleDe_(FEUILLE_GROUPES, COL_GROUPES).appendRow(COL_GROUPES.map(function (c) { return g[c]; }));
  membres.forEach(function (u) { ajouterMembre_(g, u); });
}

function modifierGroupe_(user, data) {
  exigerAdmin_(user);
  if (!data || typeof data !== 'object') throw err_('invalid', 'Données manquantes');
  const g = groupeParId_(String(data.id || ''));
  const n = { etablissement: nomValide_(data.etablissement === undefined ? g.etablissement : data.etablissement, 'Établissement'),
    promo: nomValide_(data.promo === undefined ? g.promo : data.promo, 'Promo'),
    nom: nomValide_(data.nom === undefined ? g.nom : data.nom, 'Nom') };
  const cle = clePromo_(n);
  verifierNomLibre_(cle, n.nom, g.id);
  if (cle !== clePromo_(g)) {
    const etudiants = electeursGroupe_(g.id);
    etudiants.forEach(function (email) {
      if (dejaDansPromo_(email, cle, g.id)) throw err_('invalid', 'Un membre est déjà dans un groupe de cette promo');
    });
  }
  feuilleDe_(FEUILLE_GROUPES, COL_GROUPES).getRange(g._row, 2, 1, 3).setValues([[n.etablissement, n.promo, n.nom]]);
}

// Le groupe, ses membres et ses votes disparaissent ; ses fiches et commentaires restent dans le Sheet mais ne sont plus affichés.
function supprimerGroupe_(user, id) {
  exigerAdmin_(user);
  const g = groupeParId_(String(id || ''));
  [[FEUILLE_VOTES, COL_VOTES], [FEUILLE_MEMBRES, COL_MEMBRES]].forEach(function (t) {
    const sh = feuilleDe_(t[0], t[1]);
    lireTable_(sh, t[1]).filter(function (r) { return r.groupe_id === g.id; })
      .sort(function (a, b) { return b._row - a._row; }).forEach(function (r) { sh.deleteRow(r._row); });
  });
  feuilleDe_(FEUILLE_GROUPES, COL_GROUPES).deleteRow(g._row);
}

/* ---------- Validation ---------- */

function exigerEtudiant_(user) {
  if (user.role !== 'etudiant') throw err_('forbidden', 'Accès en lecture seule');
}

function peutGerer_(user) {
  return user.role === 'etudiant' || user.role === 'admin';
}

function exigerGestion_(user) {
  if (!peutGerer_(user)) throw err_('forbidden', 'Réservé aux étudiants et à l’administrateur');
}

function peutCommenter_(user) {
  return user.role === 'etudiant' || user.role === 'formateur';
}

function exigerCommentateur_(user) {
  if (!peutCommenter_(user)) throw err_('forbidden', 'Réservé aux étudiants et aux formateurs');
}

function trouver_(sh, id) {
  const r = lireTable_(sh, COLONNES).filter(function (x) { return x.id === id; })[0];
  if (!r) throw err_('not_found', 'Lecture introuvable');
  return r;
}

function nettoyer_(data) {
  if (!data || typeof data !== 'object') throw err_('invalid', 'Données manquantes');
  const d = {};
  CHAMPS.forEach(function (c) {
    const v = data[c] === undefined || data[c] === null ? '' : String(data[c]).trim();
    if (v.length > LONGUEUR_MAX) throw err_('invalid', 'Champ trop long (' + LONGUEUR_MAX + ' caractères maximum)');
    d[c] = v;
  });
  return d;
}

function valider_(d) {
  if (STATUTS.indexOf(d.statut) < 0) throw err_('invalid', 'Statut invalide');
  const requis = d.statut === 'En cours' ? ['titre'] : OBLIGATOIRES_TERMINEE;
  const manquants = requis.filter(function (k) { return !d[k]; });
  if (manquants.length) {
    throw err_('invalid', 'À compléter : ' + manquants.map(function (k) { return LIBELLES[k]; }).join(', '));
  }
  if (d.type && TYPES.indexOf(d.type) < 0) throw err_('invalid', 'Type d’article invalide');
  if (PORTEES.indexOf(d.portee) < 0) throw err_('invalid', 'Partage invalide');
  if (d.parution && !/^\d{4}(-\d{2}(-\d{2})?)?$/.test(d.parution)) throw err_('invalid', 'Date de parution invalide');
  // Le lien est cliquable dans l'application : seuls http(s) sont acceptés (jamais javascript:, data:, etc.).
  if (d.lien && !/^https?:\/\/[^\s<>"']+$/i.test(d.lien)) throw err_('invalid', 'Lien invalide : il doit commencer par http:// ou https://');
}

/* ---------- Traduction des mots-clés (fr -> en) avec indice de fiabilité ---------- */

const TRAD_MAX_CARACTERES = 600;
const TRAD_MAX_TERMES = 30;
// Termes courants en sciences infirmières : la traduction du glossaire prime sur la traduction automatique.
const GLOSSAIRE = {
  'soins infirmiers': 'nursing care', 'sciences infirmieres': 'nursing science', 'science infirmiere': 'nursing science',
  'relation soignant soigne': 'nurse-patient relationship', 'relation de soin': 'care relationship',
  'relation d aide': 'helping relationship', 'vecu': 'lived experience', 'patient': 'patient',
  'etudiant en soins infirmiers': 'nursing student', 'etudiants en soins infirmiers': 'nursing students',
  'stage': 'clinical placement', 'formation initiale': 'initial training', 'pratique reflexive': 'reflective practice',
  'raisonnement clinique': 'clinical reasoning', 'ethique': 'ethics', 'dignite': 'dignity', 'empathie': 'empathy',
  'douleur': 'pain', 'fin de vie': 'end of life', 'soins palliatifs': 'palliative care', 'qualite de vie': 'quality of life',
  'education therapeutique': 'therapeutic patient education', 'bientraitance': 'good care practices',
  'maltraitance': 'mistreatment', 'burn out': 'burnout', 'burnout': 'burnout', 'stress': 'stress',
  'sante mentale': 'mental health', 'psychiatrie': 'psychiatry', 'personne agee': 'older adult',
  'personnes agees': 'older adults', 'geriatrie': 'geriatrics', 'pediatrie': 'paediatrics', 'autonomie': 'autonomy',
  'consentement': 'consent', 'communication': 'communication', 'humanisation des soins': 'humanization of care',
  'posture professionnelle': 'professional stance', 'identite professionnelle': 'professional identity',
  'competences': 'competencies', 'tutorat': 'mentoring', 'hopital': 'hospital', 'infirmier': 'nurse',
  'infirmiere': 'nurse', 'aide soignant': 'nursing assistant', 'cadre de sante': 'nurse manager',
  'prevention': 'prevention', 'promotion de la sante': 'health promotion', 'sante publique': 'public health',
  'hygiene': 'hygiene', 'securite des patients': 'patient safety', 'erreur medicamenteuse': 'medication error',
  'charge de travail': 'workload', 'qualite des soins': 'quality of care', 'prise en charge': 'care management',
  'accompagnement': 'support', 'collaboration interprofessionnelle': 'interprofessional collaboration',
  'travail en equipe': 'teamwork', 'sentiment d efficacite personnelle': 'self-efficacy'
};
const MOTS_VIDES_FR = ['le', 'la', 'les', 'l', 'un', 'une', 'des', 'de', 'du', 'd', 'et', 'en', 'au', 'aux'];

function normaliserTerme_(t) {
  return String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ').trim();
}

function jetons_(t) {
  return normaliserTerme_(t).split(' ').filter(function (m) { return m && MOTS_VIDES_FR.indexOf(m) < 0; })
    .map(function (m) { return m.length > 3 ? m.replace(/(s|x)$/, '') : m; });
}

// Proximité de deux termes (1 = mêmes mots, à l'accord et aux mots vides près).
function similitude_(a, b) {
  const x = jetons_(a), y = jetons_(b);
  if (!x.length || !y.length) return 0;
  const communs = x.filter(function (m) { return y.indexOf(m) >= 0; }).length;
  return communs / (x.length + y.length - communs);
}

// Traduit une liste en un seul appel (lignes), ou terme par terme si le service ne conserve pas les lignes.
function traduireListe_(liste, de, vers) {
  const sortie = LanguageApp.translate(liste.join('\n'), de, vers).split('\n');
  if (sortie.length === liste.length) return sortie.map(function (x) { return x.trim(); });
  return liste.map(function (t) { return String(LanguageApp.translate(t, de, vers)).trim(); });
}

function traduireMotsCles_(texte) {
  const brut = String(texte === undefined || texte === null ? '' : texte);
  if (brut.length > TRAD_MAX_CARACTERES) throw err_('invalid', 'Texte trop long pour la traduction');
  const vus = {};
  const termes = brut.split(/[,;\n]+/).map(function (t) { return t.trim(); }).filter(function (t) {
    const k = normaliserTerme_(t);
    if (!t || !k || vus[k]) return false;
    vus[k] = true;
    return true;
  });
  if (!termes.length) throw err_('invalid', 'Aucun mot-clé à traduire');
  if (termes.length > TRAD_MAX_TERMES) throw err_('invalid', 'Trop de mots-clés (' + TRAD_MAX_TERMES + ' maximum)');

  const aTraduire = termes.filter(function (t) { return !GLOSSAIRE[normaliserTerme_(t)]; });
  const aller = aTraduire.length ? traduireListe_(aTraduire, 'fr', 'en') : [];
  const retour = aTraduire.length ? traduireListe_(aller, 'en', 'fr') : [];
  const parTerme = {};
  aTraduire.forEach(function (t, i) { parTerme[normaliserTerme_(t)] = { en: aller[i], fr2: retour[i] }; });

  return termes.map(function (t) {
    const k = normaliserTerme_(t);
    if (GLOSSAIRE[k]) return { fr: t, en: GLOSSAIRE[k], niveau: 'haute', raison: 'terme du glossaire de sciences infirmières' };
    const r = parTerme[k];
    if (!r.en) return { fr: t, en: '', niveau: 'faible', raison: 'aucune traduction obtenue' };
    if (r.en.toLowerCase() === t.toLowerCase()) {
      return { fr: t, en: r.en, niveau: 'moyenne', raison: 'identique au français (sigle, nom propre ou emprunt ?)' };
    }
    const sim = similitude_(t, r.fr2);
    if (sim >= 0.99) return { fr: t, en: r.en, niveau: 'haute', raison: 'la retraduction en français redonne le même terme' };
    if (sim >= 0.5) return { fr: t, en: r.en, niveau: 'moyenne', raison: 'retraduction proche (« ' + r.fr2 + ' ») : vérifier le sens' };
    return { fr: t, en: r.en, niveau: 'faible', raison: 'la retraduction (« ' + r.fr2 + ' ») s’écarte du terme : à vérifier' };
  });
}

/* ---------- Utilitaires ---------- */

function avecVerrou_(fn) {
  const verrou = LockService.getScriptLock();
  verrou.waitLock(10000);
  try { return fn(); } finally { verrou.releaseLock(); }
}

function err_(code, message) {
  const e = new Error(message);
  e.code = code;
  return e;
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
