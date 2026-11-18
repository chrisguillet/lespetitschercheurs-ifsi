/**
 * Lydia – API Apps Script (script lié au Google Sheet).
 *
 * Le Sheet reste privé : seul ce script y accède (exécution avec le compte du
 * déployeur). Chaque appel porte un jeton d'identité Google (ID token) que le
 * script vérifie auprès de Google, puis il applique les règles :
 *  - étudiant : lit tout, modifie/supprime ses lectures ;
 *  - étudiant sur la lecture d'un autre : modification possible uniquement
 *    avec override explicite (l'ancienne version est gardée dans « Historique ») ;
 *  - formateur : lecture seule stricte.
 */

const FEUILLE_LECTURES = 'Lectures';
const FEUILLE_UTILISATEURS = 'Utilisateurs';
const FEUILLE_HISTORIQUE = 'Historique';

const COLONNES = ['id', 'owner', 'statut', 'titre', 'parution', 'auteur', 'qualite', 'nation', 'type',
  'mots', 'kw', 'concepts', 'objet', 'opinion', 'controverse', 'libre', 'ajoute', 'modifie_le', 'modifie_par'];
const CHAMPS = ['statut', 'titre', 'parution', 'auteur', 'qualite', 'nation', 'type',
  'mots', 'kw', 'concepts', 'objet', 'opinion', 'controverse', 'libre'];
const OBLIGATOIRES_TERMINEE = ['titre', 'parution', 'auteur', 'qualite', 'nation', 'type'];
const LIBELLES = { titre: 'titre', parution: 'date de parution', auteur: 'auteur', qualite: 'qualité',
  nation: 'nationalité', type: 'type d’article' };
const STATUTS = ['Terminée', 'En cours'];
const TYPES = ['Article scientifique', 'Article de recherche', 'Revue de littérature', 'Article professionnel',
  'Rapport / recommandation HAS', 'Thèse / mémoire', 'Autre'];
const LONGUEUR_MAX = 2500;
const COULEUR_DEFAUT = '#888888';

/* ---------- Installation (à lancer une fois depuis l'éditeur) ---------- */

function setup() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  preparer_(ss, FEUILLE_LECTURES, COLONNES);
  preparer_(ss, FEUILLE_HISTORIQUE, ['date', 'id', 'modifie_par', 'proprietaire', 'avant']);
  const u = preparer_(ss, FEUILLE_UTILISATEURS, ['email', 'prenom', 'role', 'couleur']);
  if (u.getLastRow() < 2) {
    u.getRange(2, 1, 5, 4).setValues([
      ['wacim@gmail.com', 'Wacim', 'etudiant', '#2563eb'],
      ['ange-marie@gmail.com', 'Ange-Marie', 'etudiant', '#ea580c'],
      ['helene@gmail.com', 'Hélène', 'etudiant', '#16a34a'],
      ['lydia@gmail.com', 'Lydia', 'etudiant', '#9333ea'],
      ['formateur@gmail.com', 'Formateur', 'formateur', '#475569']
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
    const req = JSON.parse(e.postData.contents);
    const user = authentifier_(req.token);
    switch (req.action) {
      case 'init':
        return json_({
          ok: true,
          me: { prenom: user.prenom, role: user.role, couleur: user.couleur },
          utilisateurs: listerUtilisateurs_().map(function (u) {
            return { prenom: u.prenom, role: u.role, couleur: u.couleur };
          }),
          lectures: lister_(user)
        });
      case 'list':
        return json_({ ok: true, lectures: lister_(user) });
      case 'add':
        return json_({ ok: true, id: avecVerrou_(function () { return ajouter_(user, req.data); }) });
      case 'update':
        avecVerrou_(function () { modifier_(user, req.id, req.data, req.override === true); });
        return json_({ ok: true });
      case 'delete':
        avecVerrou_(function () { supprimer_(user, req.id); });
        return json_({ ok: true });
      default:
        throw err_('bad_request', 'Action inconnue');
    }
  } catch (e) {
    if (!e.code) console.error(e);
    return json_({ ok: false, error: e.code || 'server', message: e.code ? e.message : 'Erreur serveur' });
  }
}

/* ---------- Authentification ---------- */

function authentifier_(token) {
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
    cache.put(cle, email, Math.max(1, Math.min(300, restant)));
  }
  const user = listerUtilisateurs_().filter(function (u) { return u.email === email; })[0];
  if (!user) throw err_('forbidden', 'Cette adresse n’est pas autorisée');
  return user;
}

function listerUtilisateurs_() {
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(FEUILLE_UTILISATEURS);
  if (!sh) throw err_('server', 'Feuille Utilisateurs absente : lancez setup()');
  return sh.getDataRange().getDisplayValues().slice(1)
    .filter(function (r) { return r[0] && r[1]; })
    .map(function (r) {
      return {
        email: String(r[0]).trim().toLowerCase(),
        prenom: String(r[1]).trim(),
        role: String(r[2]).trim().toLowerCase() === 'formateur' ? 'formateur' : 'etudiant',
        couleur: /^#[0-9a-fA-F]{6}$/.test(String(r[3]).trim()) ? String(r[3]).trim() : COULEUR_DEFAUT
      };
    });
}

/* ---------- Lectures ---------- */

function feuilleLectures_() {
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(FEUILLE_LECTURES);
  if (!sh) throw err_('server', 'Feuille Lectures absente : lancez setup()');
  return sh;
}

function lireLignes_(sh) {
  return sh.getDataRange().getDisplayValues().slice(1).map(function (v, i) {
    const o = { _row: i + 2 };
    COLONNES.forEach(function (c, j) { o[c] = v[j] === undefined ? '' : String(v[j]); });
    return o;
  }).filter(function (o) { return o.id; });
}

function lister_(user) {
  const parEmail = {};
  listerUtilisateurs_().forEach(function (u) { parEmail[u.email] = u; });
  return lireLignes_(feuilleLectures_()).map(function (r) {
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
}

function historiser_(ancienne, user, date) {
  const proprio = listerUtilisateurs_().filter(function (u) { return u.email === ancienne.owner; })[0];
  const avant = {};
  CHAMPS.forEach(function (c) { avant[c] = ancienne[c]; });
  const h = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(FEUILLE_HISTORIQUE);
  h.appendRow([date, ancienne.id, user.prenom, proprio ? proprio.prenom : '', JSON.stringify(avant).slice(0, 49000)]);
}

/* ---------- Validation ---------- */

function exigerEtudiant_(user) {
  if (user.role !== 'etudiant') throw err_('forbidden', 'Accès en lecture seule');
}

function trouver_(sh, id) {
  const r = lireLignes_(sh).filter(function (x) { return x.id === id; })[0];
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
