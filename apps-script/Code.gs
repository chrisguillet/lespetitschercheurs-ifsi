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

const COLONNES = ['id', 'owner', 'statut', 'titre', 'parution', 'auteur', 'qualite', 'nation', 'type',
  'mots', 'kw', 'concepts', 'objet', 'opinion', 'controverse', 'libre', 'ajoute', 'modifie_le', 'modifie_par'];
const COL_UTILISATEURS = ['email', 'prenom', 'role', 'couleur', 'statut', 'demande_le', 'derniere_connexion'];
const COL_COMMENTAIRES = ['id', 'lecture_id', 'auteur_email', 'auteur', 'date', 'texte', 'modifie_le'];
const COL_HISTORIQUE = ['date', 'id', 'modifie_par', 'proprietaire', 'avant'];
const CHAMPS = ['statut', 'titre', 'parution', 'auteur', 'qualite', 'nation', 'type',
  'mots', 'kw', 'concepts', 'objet', 'opinion', 'controverse', 'libre'];
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
          me: { prenom: user.prenom, role: user.role, couleur: user.couleur },
          utilisateurs: listerUtilisateurs_().filter(function (u) {
            return u.role === 'etudiant' && u.statut === 'actif';
          }).map(function (u) { return { prenom: u.prenom, role: u.role, couleur: u.couleur }; })
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
      case 'admin_list':
        exigerGestion_(user);
        return json_({ ok: true, acces: listerAcces_() });
      case 'admin_set':
        muter_(function () { administrer_(user, req.data); });
        return json_(Object.assign({ ok: true, acces: listerAcces_() }, donnees_(user)));
      default:
        throw err_('bad_request', 'Action inconnue');
    }
  } catch (e) {
    if (!e.code) console.error(e);
    return json_({ ok: false, error: e.code || 'server', message: e.code ? e.message : 'Erreur serveur' });
  }
}

function donnees_(user) {
  return {
    lectures: lister_(user),
    commentaires: listerCommentaires_(user),
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
  return listerUtilisateurs_().map(function (u) {
    return { email: u.email, prenom: u.prenom, role: u.role, statut: u.statut, couleur: u.couleur,
      demande_le: u.demande_le, derniere_connexion: u.derniere_connexion, protege: u.role === 'etudiant' };
  });
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
  [[feuilleLectures_(), COLONNES, 'owner'], [feuilleCommentaires_(), COL_COMMENTAIRES, 'auteur_email']]
    .forEach(function (t) {
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
  return lireTable_(feuilleLectures_(), COLONNES).map(function (r) {
    const proprio = parEmail[r.owner];
    const pub = { etudiant: proprio ? proprio.prenom : 'Inconnu(e)', couleur: proprio ? proprio.couleur : COULEUR_DEFAUT,
      mine: r.owner === user.email };
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

/* ---------- Commentaires (formateurs) ---------- */

function feuilleCommentaires_() {
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(FEUILLE_COMMENTAIRES);
  if (!sh) throw err_('server', 'Feuille Commentaires absente : lancez setup()');
  return sh;
}

function listerCommentaires_(user) {
  return lireTable_(feuilleCommentaires_(), COL_COMMENTAIRES).map(function (r) {
    return { id: r.id, lecture_id: r.lecture_id, auteur: r.auteur, date: r.date, modifie_le: r.modifie_le,
      texte: r.texte, mine: r.auteur_email === user.email };
  });
}

function commenter_(user, lectureId, texte) {
  exigerFormateur_(user);
  const t = nettoyerCommentaire_(texte);
  trouver_(feuilleLectures_(), lectureId);
  const id = Utilities.getUuid();
  feuilleCommentaires_().appendRow([id, lectureId, user.email, user.prenom, new Date().toISOString(), t, '']);
  return id;
}

function modifierCommentaire_(user, id, texte) {
  exigerFormateur_(user);
  const sh = feuilleCommentaires_();
  const c = trouverCommentaire_(sh, id);
  if (c.auteur_email !== user.email) throw err_('not_owner', 'Vous ne pouvez modifier que vos commentaires');
  const t = nettoyerCommentaire_(texte);
  sh.getRange(c._row, 6, 1, 2).setValues([[t, new Date().toISOString()]]);
}

function supprimerCommentaire_(user, id) {
  const sh = feuilleCommentaires_();
  const c = trouverCommentaire_(sh, id);
  const auteur = c.auteur_email === user.email && user.role === 'formateur';
  if (!auteur && !peutGerer_(user)) throw err_('forbidden', 'Suppression non autorisée');
  sh.deleteRow(c._row);
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

function exigerFormateur_(user) {
  if (user.role !== 'formateur') throw err_('forbidden', 'Réservé aux formateurs');
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
  if (d.parution && !/^\d{4}-\d{2}-\d{2}$/.test(d.parution)) throw err_('invalid', 'Date de parution invalide');
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
