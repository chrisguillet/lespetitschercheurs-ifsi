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
 */

const FEUILLE_LECTURES = 'Lectures';
const FEUILLE_UTILISATEURS = 'Utilisateurs';
const FEUILLE_HISTORIQUE = 'Historique';
const FEUILLE_COMMENTAIRES = 'Commentaires';
const FEUILLE_LUS = 'Lus';

const COLONNES = ['id', 'owner', 'statut', 'titre', 'parution', 'auteur', 'qualite', 'nation', 'type',
  'mots', 'kw', 'concepts', 'objet', 'opinion', 'controverse', 'libre', 'ajoute', 'modifie_le', 'modifie_par',
  'source', 'volume', 'numero', 'pages', 'doi'];
const COL_UTILISATEURS = ['email', 'prenom', 'role', 'couleur', 'statut', 'demande_le', 'derniere_connexion'];
const COL_COMMENTAIRES = ['id', 'lecture_id', 'auteur_email', 'auteur', 'date', 'texte', 'modifie_le'];
// Une ligne par personne (id = adresse) : identifiants des commentaires déjà lus, séparés par des virgules.
const COL_LUS = ['id', 'commentaires'];
const COL_HISTORIQUE = ['date', 'id', 'modifie_par', 'proprietaire', 'avant'];
const CHAMPS = ['statut', 'titre', 'parution', 'auteur', 'qualite', 'nation', 'type',
  'mots', 'kw', 'concepts', 'objet', 'opinion', 'controverse', 'libre',
  'source', 'volume', 'numero', 'pages', 'doi'];
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
  const u = preparer_(ss, FEUILLE_UTILISATEURS, COL_UTILISATEURS);
  if (u.getLastRow() < 2) {
    u.getRange(2, 1, 4, 5).setValues([
      ['wacim@gmail.com', 'Wacim', 'etudiant', '#2563eb', 'actif'],
      ['ange-marie@gmail.com', 'Ange-Marie', 'etudiant', '#ea580c', 'actif'],
      ['helene@gmail.com', 'Hélène', 'etudiant', '#16a34a', 'actif'],
      ['lydia@gmail.com', 'Lydia', 'etudiant', '#9333ea', 'actif']
    ]);
  }
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
        const id = muter_(function () { return commenter_(user, req.lecture_id, req.texte); });
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
      case 'translate':
        exigerEtudiant_(user);
        return json_({ ok: true, items: traduireMotsCles_(req.texte) });
      case 'admin_list':
        exigerGestion_(user);
        return json_({ ok: true, acces: listerAcces_() });
      case 'admin_set':
        muter_(function () { administrer_(user, req.data); });
        return json_(Object.assign({ ok: true, acces: listerAcces_() }, donnees_(user)));
      case 'admin_delete':
        muter_(function () { supprimerUtilisateur_(user, req.email); });
        return json_(Object.assign({ ok: true, acces: listerAcces_() }, donnees_(user)));
      default:
        throw err_('bad_request', 'Action inconnue');
    }
  } catch (e) {
    if (!e.code) console.error(e);
    return json_({ ok: false, error: e.code || 'server', message: e.code ? e.message : 'Erreur serveur' });
  }
}

// Étudiants actifs : listés à chaque réponse pour que les écrans déjà ouverts suivent les changements de l'administration.
function etudiantsActifs_() {
  return listerUtilisateurs_().filter(function (u) {
    return u.role === 'etudiant' && u.statut === 'actif';
  }).map(function (u) { return { prenom: u.prenom, role: u.role, couleur: u.couleur }; });
}

function donnees_(user) {
  return {
    utilisateurs: etudiantsActifs_(),
    lectures: lister_(user),
    commentaires: listerCommentaires_(user),
    lus: listerLus_(user),
    enAttente: peutGerer_(user)
      ? listerUtilisateurs_().filter(function (u) { return u.statut === 'en_attente'; }).length : 0
  };
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
    throw err_('pending', 'Votre demande d’accès a été envoyée : un étudiant du groupe doit la valider.');
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

function listerAcces_() {
  const nbL = {}, nbC = {};
  lireTable_(feuilleLectures_(), COLONNES).forEach(function (r) { nbL[r.owner] = (nbL[r.owner] || 0) + 1; });
  lireTable_(feuilleCommentaires_(), COL_COMMENTAIRES).forEach(function (r) { nbC[r.auteur_email] = (nbC[r.auteur_email] || 0) + 1; });
  return listerUtilisateurs_().map(function (u) {
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
  tables.forEach(function (t) {
      lireTable_(t[0], t[1]).filter(function (r) { return r[t[2]].toLowerCase() === ancien; })
        .forEach(function (r) { t[0].getRange(r._row, t[1].indexOf(t[2]) + 1, 1, 1).setValues([[nouveau]]); });
    });
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
  // Les lectures d'un utilisateur supprimé restent dans la feuille mais ne sont plus affichées.
  return lireTable_(feuilleLectures_(), COLONNES).filter(function (r) { return parEmail[r.owner]; }).map(function (r) {
    const proprio = parEmail[r.owner];
    const pub = { etudiant: proprio.prenom, couleur: proprio.couleur, mine: r.owner === user.email };
    COLONNES.forEach(function (c) { if (c !== 'owner') pub[c] = r[c]; });
    return pub;
  });
}

function ajouter_(user, data) {
  exigerEtudiant_(user);
  const d = nettoyer_(data);
  valider_(d);
  const meta = { id: Utilities.getUuid(), owner: user.email, ajoute: new Date().toISOString(),
    modifie_le: '', modifie_par: '' };
  const ligne = COLONNES.map(function (c) { return c in meta ? meta[c] : d[c]; });
  feuilleLectures_().appendRow(ligne);
  return meta.id;
}

function modifier_(user, id, data, override) {
  exigerEtudiant_(user);
  const sh = feuilleLectures_();
  const r = trouver_(sh, id);
  const proprio = r.owner === user.email;
  if (!proprio && !override) {
    throw err_('not_owner', 'Cette lecture appartient à quelqu’un d’autre');
  }
  const d = nettoyer_(data);
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
  // Seules les lectures encore affichées (propriétaire non supprimé) ont leurs commentaires listés.
  const visibles = {};
  lister_(user).forEach(function (l) { visibles[l.id] = true; });
  return lireTable_(feuilleCommentaires_(), COL_COMMENTAIRES).filter(function (r) { return visibles[r.lecture_id]; }).map(function (r) {
    // Un commentaire d'un utilisateur supprimé est conservé, sous un nom neutre.
    const connu = actifs[r.auteur_email] || r.auteur_email === emailAdmin_();
    return { id: r.id, lecture_id: r.lecture_id, auteur: connu ? r.auteur : 'Utilisateur supprimé', date: r.date, modifie_le: r.modifie_le,
      texte: r.texte, mine: r.auteur_email === user.email };
  });
}

function commenter_(user, lectureId, texte) {
  exigerCommentateur_(user);
  const t = nettoyerCommentaire_(texte);
  trouver_(feuilleLectures_(), lectureId);
  const id = Utilities.getUuid();
  feuilleCommentaires_().appendRow([id, lectureId, user.email, user.prenom, new Date().toISOString(), t, '']);
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
  if (!auteur && !peutGerer_(user)) throw err_('forbidden', 'Suppression non autorisée');
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
  if (d.parution && !/^\d{4}(-\d{2}(-\d{2})?)?$/.test(d.parution)) throw err_('invalid', 'Date de parution invalide');
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
