/**
 * Lydia – API Apps Script (script lié au Google Sheet).
 *
 * Le Sheet reste privé : seul ce script y accède (exécution avec le compte du
 * déployeur). Chaque appel porte un jeton d'identité Google (ID token) que le
 * script vérifie auprès de Google, puis il applique les règles.
 *
 * Rôles (colonne « role » de l'onglet Utilisateurs) :
 *  - etudiant  : ses lectures, « contribuer » aux lectures des autres, validation des
 *                demandes d'accès (formateurs), modération des commentaires ;
 *  - formateur : lecture + commentaires ;
 * Rôle « admin » : adresse fixe de la propriété de script ADMIN_EMAIL (absente de la feuille).
 * Lecture, gestion de tous les accès (y compris les étudiants et leurs adresses), modération.
 *
 * Une adresse inconnue qui se connecte crée une demande (statut « en_attente »).
 * Un étudiant la valide depuis l'application (prénom + rôle) ou la refuse.
 *
 * Groupes : établissement > promo > groupe. Chaque fiche appartient à un groupe et reste visible de ses
 * seuls membres, sauf si elle est partagée avec la promo (portée « promo »). Les commentaires ont
 * la même portée que leur fil : ceux du groupe et ceux de la promo sont distincts.
 * Un étudiant appartient à un seul groupe par promo ; les formateurs sont rattachés à des groupes
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
const FEUILLE_ARTICLES = 'Articles';
const FEUILLE_PROPOSITIONS = 'Propositions';
const FEUILLE_REUNIONS = 'Reunions';
const FEUILLE_ETABLISSEMENTS = 'Etablissements';
const FEUILLE_PROMOS = 'Promos';
const FEUILLE_INSCRIPTIONS = 'Inscriptions';
const FEUILLE_FICHIERS = 'Fichiers';
const DOSSIER_FICHIERS = 'Fichiers – lectures IFSI';
const FEUILLE_JALONS = 'Jalons';

const COLONNES = ['id', 'owner', 'statut', 'titre', 'parution', 'auteur', 'qualite', 'nation', 'type',
  'mots', 'kw', 'concepts', 'objet', 'opinion', 'controverse', 'libre', 'ajoute', 'modifie_le', 'modifie_par',
  'source', 'volume', 'numero', 'pages', 'doi', 'lien', 'groupe_id', 'portee', 'article_id'];
// Un article (partie objective, mise en commun dans la promo) porte une ou plusieurs analyses (feuille Lectures,
// une par étudiant). Les colonnes objectives de Lectures ne servent plus qu'à la reprise de l'existant.
const COL_ARTICLES = ['id', 'cree_par', 'groupe_id', 'ajoute', 'modifie_le', 'modifie_par',
  'titre', 'parution', 'auteur', 'qualite', 'nation', 'type', 'source', 'volume', 'numero', 'pages', 'doi', 'lien'];
// Correction de la partie objective proposée par un étudiant : appliquée quand 3 étudiants de la promo l'ont approuvée
// (le proposant compte), refusée quand 3 l'ont rejetée, sinon expirée au bout de 14 jours.
const COL_PROPOSITIONS = ['id', 'article_id', 'propose_par', 'cree_le', 'valeurs', 'votes', 'statut', 'clos_le'];
const PROP_SEUIL = 3;
const PROP_DUREE_MS = 14 * 24 * 3600 * 1000;
// Suivi de projet d'un groupe : comptes rendus de réunion et jalons du rétroplanning (visibles du groupe, de ses formateurs
// rattachés et de l'administrateur ; modifiables par les étudiants du groupe).
const COL_REUNIONS = ['id', 'groupe_id', 'date', 'titre', 'participants', 'vu', 'attendu', 'suite',
  'cree_par', 'cree_le', 'modifie_le', 'modifie_par'];
// echeance = date fixe, ou date de fin d'une plage (debut renseigné) ; alerte_jours = nombre de jours avant la première date où
// l'interface signale le jalon (vide = pas d'alerte). Colonnes ajoutées en fin de feuille pour ne pas décaler les anciennes données.
const COL_JALONS = ['id', 'groupe_id', 'titre', 'echeance', 'statut', 'note', 'cree_par', 'cree_le', 'modifie_le', 'modifie_par', 'debut', 'alerte_jours'];
const STATUTS_JALON = ['a_faire', 'en_cours', 'fait'];
const OBJECTIFS = ['titre', 'parution', 'auteur', 'qualite', 'nation', 'type', 'source', 'volume', 'numero', 'pages', 'doi', 'lien'];
const ANALYSES = ['statut', 'mots', 'kw', 'concepts', 'objet', 'opinion', 'controverse', 'libre'];
// promo_demandee / role_demande : ce que la personne a indiqué à sa première connexion (informatif pour qui valide).
const COL_UTILISATEURS = ['email', 'prenom', 'role', 'couleur', 'statut', 'demande_le', 'derniere_connexion', 'promo_demandee', 'role_demande'];
// portee : « groupe » ou « promo » ; groupe_id : groupe de l'auteur au moment du commentaire.
const COL_COMMENTAIRES = ['id', 'lecture_id', 'auteur_email', 'auteur', 'date', 'texte', 'modifie_le', 'portee', 'groupe_id'];
// Structure : établissement > promo > groupe. Les groupes gardent les noms (clé de promo), ces feuilles listent aussi les promos vides.
const COL_ETABLISSEMENTS = ['id', 'nom', 'cree_le'];
// Code d'invitation : donne accès à la promo comme étudiant, sans validation (expire, nombre d'usages limité).
const COL_PROMOS = ['id', 'etablissement_id', 'nom', 'cree_le', 'code', 'code_expire', 'code_max', 'code_usages'];
// Étudiants inscrits à une promo (par code ou par validation) avant d'avoir un groupe.
// Documents (PDF, images) déposés sur un article ; le contenu est dans le Drive du propriétaire du script, jamais public.
// Retours sur l'outil (bugs, idées, autres) : ouverts à toute personne dont l'accès est validé. Deux par jour et par personne,
// modifiables le jour même ; le statut (nouveau / traité…) se change à la main dans le Sheet.
const FEUILLE_FEEDBACK = 'Feedback';
const COL_FEEDBACK = ['id', 'auteur_email', 'type', 'texte', 'contexte', 'jour', 'cree_le', 'modifie_le', 'statut'];
const TYPES_FEEDBACK = ['bug', 'idee', 'autre'];
const FEEDBACK_PAR_JOUR = 2;
const FEEDBACK_MAX = 2000;
const COL_FICHIERS = ['id', 'article_id', 'drive_id', 'nom', 'type', 'taille', 'cree_par', 'cree_le'];
const FICHIER_MAX = 5 * 1024 * 1024;     // 5 Mo par fichier
const FICHIERS_PAR_ARTICLE = 1;
const COL_INSCRIPTIONS = ['id', 'email', 'promo_id', 'ajoute_le', 'via'];
const COL_GROUPES = ['id', 'etablissement', 'promo', 'nom', 'cree_le', 'cree_par'];
const COL_MEMBRES = ['id', 'groupe_id', 'email', 'ajoute_le'];
// type : « retrait » (cible = adresse du membre) ou « nom » (valeur = nouveau nom) ; votes = JSON {adresse: 1|0}.
const COL_VOTES = ['id', 'groupe_id', 'type', 'cible', 'valeur', 'propose_par', 'cree_le', 'votes', 'statut', 'clos_le'];
// Une ligne par personne (id = adresse) : identifiants des commentaires déjà lus, séparés par des virgules.
const COL_LUS = ['id', 'commentaires'];
const COL_HISTORIQUE = ['date', 'id', 'modifie_par', 'proprietaire', 'avant'];
const CHAMPS = ['statut', 'titre', 'parution', 'auteur', 'qualite', 'nation', 'type',
  'mots', 'kw', 'concepts', 'objet', 'opinion', 'controverse', 'libre',
  'source', 'volume', 'numero', 'pages', 'doi', 'lien'];
// Une analyse terminée est partagée avec toute la promo ; en cours, elle reste dans le groupe de son auteur.
function porteeDe_(statut) { return statut === 'Terminée' ? 'promo' : 'groupe'; }
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
  try { return avecVerrou_(fn); } finally { memo_ = {}; memoOn_ = true; viderCacheTables_(); }
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
  preparer_(ss, FEUILLE_ARTICLES, COL_ARTICLES);
  preparer_(ss, FEUILLE_PROPOSITIONS, COL_PROPOSITIONS);
  preparer_(ss, FEUILLE_REUNIONS, COL_REUNIONS);
  preparer_(ss, FEUILLE_ETABLISSEMENTS, COL_ETABLISSEMENTS);
  preparer_(ss, FEUILLE_PROMOS, COL_PROMOS);
  preparer_(ss, FEUILLE_INSCRIPTIONS, COL_INSCRIPTIONS);
  preparer_(ss, FEUILLE_FICHIERS, COL_FICHIERS);
  preparer_(ss, FEUILLE_FEEDBACK, COL_FEEDBACK);
  preparer_(ss, FEUILLE_JALONS, COL_JALONS);
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
  migrerVersArticles_();
  migrerVersStructure_();
  migrerFormateursVersPromos_();
  viderCacheTables_();
}

// Reprise (idempotente, lancée par setup) : un formateur actif qui avait demandé une promo y est inscrit.
function migrerFormateursVersPromos_() {
  lireUtilisateurs_().forEach(function (u) {
    if (u.statut === 'actif' && u.role === 'formateur' && u.promo_demandee) inscrire_(u.email, u.promo_demandee, 'migration');
  });
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
          nom: 'Les petits chercheurs', cree_le: maintenant, cree_par: '' };
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

// Reprise de l'existant (idempotente) : chaque lecture sans article en reçoit un, en fusionnant dans une même promo
// les lectures du même article (même DOI ou même titre) quand elles viennent de personnes différentes.
function migrerVersArticles_() {
  avecVerrou_(function () {
    memoOn_ = false;
    try {
      const shL = feuilleLectures_(), shA = feuilleArticles_();
      const c = { groupesParId: {} };
      table_(FEUILLE_GROUPES, COL_GROUPES).forEach(function (g) { c.groupesParId[g.id] = g; });
      const articles = lireTable_(shA, COL_ARTICLES);
      const lectures = lireTable_(shL, COLONNES);
      const proprios = {};   // article_id -> propriétaires déjà présents
      lectures.forEach(function (r) { if (r.article_id) (proprios[r.article_id] = proprios[r.article_id] || {})[r.owner] = true; });
      const iArt = COLONNES.indexOf('article_id') + 1, iP = COLONNES.indexOf('portee') + 1;
      lectures.forEach(function (r) {
        const g = c.groupesParId[r.groupe_id];
        if (!r.article_id && g) {
          const promo = clePromo_(g);
          let a = articles.filter(function (x) {
            const gx = c.groupesParId[x.groupe_id];
            return gx && clePromo_(gx) === promo && memeArticle_(x, r) && !(proprios[x.id] && proprios[x.id][r.owner]);
          })[0];
          if (!a) {
            a = { id: Utilities.getUuid(), cree_par: r.owner, groupe_id: r.groupe_id, ajoute: r.ajoute, modifie_le: '', modifie_par: '' };
            OBJECTIFS.forEach(function (k) { a[k] = r[k]; });
            shA.appendRow(COL_ARTICLES.map(function (k) { return a[k]; }));
            articles.push(a);
          }
          (proprios[a.id] = proprios[a.id] || {})[r.owner] = true;
          r.article_id = a.id;
          shL.getRange(r._row, iArt, 1, 1).setValues([[a.id]]);
        }
        const p = porteeDe_(r.statut);
        if (r.portee !== p) shL.getRange(r._row, iP, 1, 1).setValues([[p]]);
      });
    } finally { memo_ = {}; memoOn_ = true; }
  });
}

// Reprise (idempotente) : les établissements et promos déjà portés par des groupes deviennent des entrées de la structure,
// et l'ancien rôle « lecteur » devient « formateur » (le partage se fait désormais au niveau de la promo).
function migrerVersStructure_() {
  avecVerrou_(function () {
    memoOn_ = false;
    try {
      table_(FEUILLE_GROUPES, COL_GROUPES).forEach(function (g) { assurerStructure_(g.etablissement, g.promo); });
      const sh = feuilleUtilisateurs_();
      sh.getDataRange().getDisplayValues().forEach(function (r, i) {
        if (i > 0 && String(r[2]).trim().toLowerCase() === 'lecteur') sh.getRange(i + 1, 3, 1, 1).setValues([['formateur']]);
      });
    } finally { memo_ = {}; memoOn_ = true; }
  });
}

function cleDoi_(d) {
  return String(d || '').trim().toLowerCase().replace(/^(https?:\/\/)?(dx\.)?doi\.org\//, '').replace(/^doi:\s*/, '');
}

// Deux fiches décrivent le même article : même DOI, ou (sans DOI différents) même titre d'au moins 8 caractères.
function memeArticle_(a, b) {
  const da = cleDoi_(a.doi), db = cleDoi_(b.doi);
  if (da && db) return da === db;
  const ta = normaliserTerme_(a.titre), tb = normaliserTerme_(b.titre);
  return ta.length >= 8 && ta === tb;
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
        muter_(function () { modifier_(user, req.id, req.data); });
        return json_(Object.assign({ ok: true }, donnees_(user)));
      case 'article_update':
        muter_(function () { modifierArticle_(user, req.article_id, req.data); });
        return json_(Object.assign({ ok: true }, donnees_(user)));
      case 'file_add':
        muter_(function () { ajouterFichier_(user, req.article_id, req.nom, req.data); });
        return json_(Object.assign({ ok: true }, donnees_(user)));
      case 'file_get':
        return json_(Object.assign({ ok: true }, lireFichier_(user, req.id)));
      case 'file_delete':
        muter_(function () { supprimerFichier_(user, req.id); });
        return json_(Object.assign({ ok: true }, donnees_(user)));
      case 'feedback_list':
        return json_(Object.assign({ ok: true }, feedbackPourClient_(user)));
      case 'feedback_save':
        muter_(function () { enregistrerFeedback_(user, req.id, req.data); });
        return json_(Object.assign({ ok: true }, feedbackPourClient_(user)));
      case 'reunion_save':
        muter_(function () { enregistrerSuivi_(user, 'reunion', req.groupe_id, req.id, req.data); });
        return json_(Object.assign({ ok: true }, donnees_(user)));
      case 'reunion_delete':
        muter_(function () { supprimerSuivi_(user, 'reunion', req.id); });
        return json_(Object.assign({ ok: true }, donnees_(user)));
      case 'jalon_save':
        muter_(function () { enregistrerSuivi_(user, 'jalon', req.groupe_id, req.id, req.data); });
        return json_(Object.assign({ ok: true }, donnees_(user)));
      case 'jalon_delete':
        muter_(function () { supprimerSuivi_(user, 'jalon', req.id); });
        return json_(Object.assign({ ok: true }, donnees_(user)));
      case 'article_vote':
        muter_(function () { voterArticle_(user, req.id, req.vote === true); });
        return json_(Object.assign({ ok: true }, donnees_(user)));
      case 'article_cancel':
        muter_(function () { annulerProposition_(user, req.id); });
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
      case 'formateur_candidates':
        return json_({ ok: true, candidats: formateursInvitables_(user, req.groupe_id) });
      case 'formateur_request':
        muter_(function () { demanderRattachement_(user, req.groupe_id); });
        return json_(Object.assign({ ok: true }, donnees_(user)));
      case 'vote_propose':
        muter_(function () { proposerVote_(user, req.groupe_id, req.type, req.pid, req.nom); });
        return json_(Object.assign({ ok: true }, donnees_(user)));
      case 'vote_answer':
        muter_(function () { repondreVote_(user, req.id, req.oui === true); });
        return json_(Object.assign({ ok: true }, donnees_(user)));
      case 'vote_cancel':
        muter_(function () { annulerVote_(user, req.id); });
        return json_(Object.assign({ ok: true }, donnees_(user)));
      case 'onboarding':
        return json_(Object.assign({ ok: true }, accueil_(user)));
      case 'onboarding_demande':
        muter_(function () { demanderPromo_(user, req.data); });
        return json_(Object.assign({ ok: true }, accueil_(user)));
      case 'join_code':
        muter_(function () { joindreAvecCode_(user, req.data); });
        return json_({ ok: true });
      case 'group_create_self':
        muter_(function () { creerGroupeSoi_(user, req.promo_id, req.nom); });
        return json_(Object.assign({ ok: true }, donnees_(user)));
      case 'join_request':
        muter_(function () { demanderAdhesion_(user, req.groupe_id); });
        return json_(Object.assign({ ok: true }, donnees_(user)));
      case 'promo_code':
        muter_(function () { genererCodePromo_(user, req.data); });
        return json_(Object.assign({ ok: true }, donnees_(user), accesSiAdmin_(user)));
      case 'promo_code_revoke':
        muter_(function () { revoquerCodePromo_(user, req.id); });
        return json_(Object.assign({ ok: true }, donnees_(user), accesSiAdmin_(user)));
      case 'etab_create': case 'etab_rename': case 'etab_delete': case 'promo_create': case 'promo_rename': case 'promo_delete':
        muter_(function () {
          ({ etab_create: creerEtablissement_, etab_rename: renommerEtablissement_, etab_delete: function (u) { supprimerEtablissement_(u, req.id); },
            promo_create: creerPromo_, promo_rename: renommerPromo_, promo_delete: function (u) { supprimerPromo_(u, req.id); } })[req.action](user, req.data);
        });
        return json_(Object.assign({ ok: true }, donnees_(user), accesSiAdmin_(user)));
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
        return json_(Object.assign({ ok: true, acces: listerAcces_(user), groupesAdmin: listerGroupesAdmin_(user), structure: listerStructureAdmin_(user) },
          user.role === 'admin' ? { stockage: stockageFichiers_(), feedbacks: feedbackPourAdmin_() } : {}));
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
    return json_({ ok: false, error: e.code || 'server', message: e.code ? e.message : 'Erreur serveur', extra: e.extra });
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
    propositions: propositionsPourClient_(user, c),
    promosMoi: promosMoiPourClient_(user, c),
    rattachements: rattachementsPourClient_(user, c),
    fichiers: fichiersPourClient_(user, c),
    reunions: suiviPourClient_(user, c, 'reunion'),
    jalons: suiviPourClient_(user, c, 'jalon'),
    lectures: lister_(user),
    commentaires: listerCommentaires_(user),
    lus: listerLus_(user),
    enAttente: peutGerer_(user)
      ? listerUtilisateurs_().filter(function (u) { return u.statut === 'en_attente'; }).length : 0
  };
}

function accesSiAdmin_(user) {
  if (user.role !== 'admin') return {};
  return { acces: listerAcces_(user), groupesAdmin: listerGroupesAdmin_(user), structure: listerStructureAdmin_(user), stockage: stockageFichiers_() };
}

// Espace occupé par les fichiers déposés (affiché à l'administrateur).
/* ---------- Retours sur l'outil ---------- */

function jourFeedback_() {
  return String(Utilities.formatDate(new Date(), 'Europe/Paris', 'yyyy-MM-dd')).slice(0, 10);
}

function feedbackPourClient_(user) {
  const jour = jourFeedback_();
  const miens = table_(FEUILLE_FEEDBACK, COL_FEEDBACK).filter(function (r) { return r.auteur_email === user.email && r.jour === jour; })
    .sort(function (a, b) { return String(a.cree_le).localeCompare(String(b.cree_le)); });
  return { feedbacks: miens.map(function (r) { return { id: r.id, type: r.type, texte: r.texte, cree_le: r.cree_le, modifie_le: r.modifie_le }; }),
    feedbackRestant: Math.max(0, FEEDBACK_PAR_JOUR - miens.length), feedbackParJour: FEEDBACK_PAR_JOUR };
}

function enregistrerFeedback_(user, id, data) {
  if (!data || typeof data !== 'object') throw err_('invalid', 'Données manquantes');
  const type = String(data.type || '');
  const texte = String(data.texte === undefined || data.texte === null ? '' : data.texte).trim();
  if (TYPES_FEEDBACK.indexOf(type) < 0) throw err_('invalid', 'Type de retour invalide');
  if (!texte) throw err_('invalid', 'Écrivez votre retour');
  if (texte.length > FEEDBACK_MAX) throw err_('invalid', 'Retour trop long (' + FEEDBACK_MAX + ' caractères maximum)');
  const sh = feuilleDe_(FEUILLE_FEEDBACK, COL_FEEDBACK);
  const toutes = lireTable_(sh, COL_FEEDBACK);
  const jour = jourFeedback_();
  const maintenant = new Date().toISOString();
  if (id) {
    const r = toutes.filter(function (x) { return x.id === id && x.auteur_email === user.email; })[0];
    if (!r) throw err_('not_found', 'Retour introuvable');
    if (r.jour !== jour) throw err_('forbidden', 'Un retour ne peut être modifié que le jour où il a été envoyé');
    sh.getRange(r._row, COL_FEEDBACK.indexOf('type') + 1, 1, 2).setValues([[type, texte]]);
    sh.getRange(r._row, COL_FEEDBACK.indexOf('modifie_le') + 1, 1, 1).setValues([[maintenant]]);
    return;
  }
  const deja = toutes.filter(function (x) { return x.auteur_email === user.email && x.jour === jour; }).length;
  if (deja >= FEEDBACK_PAR_JOUR) throw err_('limit', 'Vous avez déjà envoyé ' + FEEDBACK_PAR_JOUR + ' retours aujourd’hui : modifiez-en un ou revenez demain');
  const ctx = String(data.contexte === undefined || data.contexte === null ? '' : data.contexte).replace(/[\r\n]+/g, ' ').slice(0, 300);
  const f = { id: Utilities.getUuid(), auteur_email: user.email, type: type, texte: texte, contexte: ctx, jour: jour, cree_le: maintenant, modifie_le: '', statut: 'nouveau' };
  sh.appendRow(COL_FEEDBACK.map(function (k) { return f[k]; }));
}

// Administrateur seulement : tous les retours, les plus récents d'abord.
function feedbackPourAdmin_() {
  const parEmail = {};
  listerUtilisateurs_().forEach(function (u) { parEmail[u.email] = u; });
  return table_(FEUILLE_FEEDBACK, COL_FEEDBACK).sort(function (a, b) { return String(b.cree_le).localeCompare(String(a.cree_le)); })
    .slice(0, 300).map(function (r) {
      return { id: r.id, par: parEmail[r.auteur_email] ? parEmail[r.auteur_email].prenom : 'Utilisateur supprimé', email: r.auteur_email, type: r.type,
        texte: r.texte, contexte: r.contexte, cree_le: r.cree_le, modifie_le: r.modifie_le, statut: r.statut || 'nouveau' };
    });
}

function stockageFichiers_() {
  const f = table_(FEUILLE_FICHIERS, COL_FICHIERS);
  return { nb: f.length, octets: f.reduce(function (n, x) { return n + (Number(x.taille) || 0); }, 0) };
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

const ACTIONS_ACCUEIL = ['onboarding', 'onboarding_demande', 'join_code'];

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
  // Première connexion : une personne inconnue ou en attente peut choisir sa promo ou entrer un code d'invitation.
  if (ACTIONS_ACCUEIL.indexOf(action) >= 0 && (!user || user.statut === 'en_attente')) {
    return user ? Object.assign({ accueil: true }, user)
      : { _row: 0, email: email, prenom: '', role: 'formateur', couleur: COULEUR_DEFAUT, statut: 'en_attente', accueil: true,
        demande_le: '', derniere_connexion: '', promo_demandee: '', role_demande: '' };
  }
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
      // Rôle inconnu, vide ou ancien « lecteur » : formateur (sans groupe rattaché, il ne voit rien d'autre que ce que la promo partage).
      role: role === 'etudiant' ? role : 'formateur',
      couleur: /^#[0-9a-fA-F]{6}$/.test(String(r[3]).trim()) ? String(r[3]).trim() : COULEUR_DEFAUT,
      // Ligne ancienne sans statut : considérée comme active.
      statut: statut === 'en_attente' || statut === 'refuse' ? statut : 'actif',
      demande_le: String(r[5] || ''),
      derniere_connexion: String(r[6] || ''),
      promo_demandee: String(r[7] || ''),
      role_demande: String(r[8] || '')
    };
  }).filter(function (u) { return u.email; });
}

function enregistrerDemande_(email) {
  const existants = listerUtilisateurs_();
  if (existants.some(function (u) { return u.email === email; })) return;
  const enAttente = existants.filter(function (u) { return u.statut === 'en_attente'; }).length;
  if (enAttente >= MAX_EN_ATTENTE) throw err_('forbidden', 'Trop de demandes en attente, réessayez plus tard');
  feuilleUtilisateurs_().appendRow([email, '', 'formateur', COULEUR_DEFAUT, 'en_attente', new Date().toISOString(), '']);
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
// il garde les demandes en attente et les formateurs qu'il peut gérer.
// Ce qu'un étudiant peut voir et gérer dans l'administration : les demandes en attente et les formateurs actifs
// rattachés à l'un de ses groupes. Jamais les accès refusés, ni les formateurs sans lien avec ses groupes ; l'administrateur voit tout.
function accesVisibles_(user) {
  if (user.role === 'admin') return function () { return true; };
  const miens = {}, voisins = {};
  const membres = table_(FEUILLE_MEMBRES, COL_MEMBRES);
  membres.forEach(function (m) { if (m.email === user.email) miens[m.groupe_id] = true; });
  membres.forEach(function (m) { if (miens[m.groupe_id]) voisins[m.email] = true; });
  return function (u) {
    return u.role !== 'etudiant' && (u.statut === 'en_attente' || (u.statut === 'actif' && !!voisins[u.email]));
  };
}

function listerAcces_(user) {
  const admin = user.role === 'admin', visible = accesVisibles_(user);
  const nbL = {}, nbC = {};
  lireTable_(feuilleLectures_(), COLONNES).forEach(function (r) { nbL[r.owner] = (nbL[r.owner] || 0) + 1; });
  lireTable_(feuilleCommentaires_(), COL_COMMENTAIRES).forEach(function (r) { nbC[r.auteur_email] = (nbC[r.auteur_email] || 0) + 1; });
  return listerUtilisateurs_().filter(visible).map(function (u) {
    return { email: u.email, prenom: u.prenom, role: u.role, statut: u.statut, couleur: u.couleur,
      demande_le: u.demande_le, derniere_connexion: u.derniere_connexion, demande: demandeLibelle_(u), protege: u.role === 'etudiant',
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
  if (!accesVisibles_(user)(cible)) throw err_('forbidden', 'Cet accès ne concerne pas vos groupes');
  const role = String(data.role || '');
  const statut = String(data.statut || '');
  const prenom = String(data.prenom === undefined || data.prenom === null ? '' : data.prenom).trim();
  if ((admin ? ['etudiant', 'formateur'] : ['formateur']).indexOf(role) < 0) {
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
  // Un étudiant validé qui avait demandé une promo y est inscrit.
  if (admin && statut === 'actif' && role === 'etudiant' && cible.promo_demandee) inscrire_(nouvelEmail, cible.promo_demandee, 'admin');
  // Un formateur validé (par un étudiant ou l'administrateur) est inscrit à la promo demandée : il peut alors demander à rejoindre ses groupes.
  if (statut === 'actif' && role === 'formateur' && cible.promo_demandee) inscrire_(nouvelEmail, cible.promo_demandee, admin ? 'admin' : 'etudiant');
}

function migrerEmail_(ancien, nouveau) {
  const tables = [[feuilleLectures_(), COLONNES, 'owner'], [feuilleArticles_(), COL_ARTICLES, 'cree_par'], [feuillePropositions_(), COL_PROPOSITIONS, 'propose_par'], [feuilleSuivi_('reunion'), COL_REUNIONS, 'cree_par'], [feuilleSuivi_('jalon'), COL_JALONS, 'cree_par'], [feuilleCommentaires_(), COL_COMMENTAIRES, 'auteur_email']];
  if (feuilleLus_(false)) tables.push([feuilleLus_(false), COL_LUS, 'id']);
  [[FEUILLE_MEMBRES, COL_MEMBRES, 'email'], [FEUILLE_INSCRIPTIONS, COL_INSCRIPTIONS, 'email'], [FEUILLE_FICHIERS, COL_FICHIERS, 'cree_par'], [FEUILLE_FEEDBACK, COL_FEEDBACK, 'auteur_email'], [FEUILLE_VOTES, COL_VOTES, 'cible'], [FEUILLE_VOTES, COL_VOTES, 'propose_par']]
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

function feuilleArticles_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  // Créée au besoin : une installation antérieure fonctionne jusqu'au prochain setup().
  return ss.getSheetByName(FEUILLE_ARTICLES) || preparer_(ss, FEUILLE_ARTICLES, COL_ARTICLES);
}

function articlesParId_() {
  const m = {};
  lireTable_(feuilleArticles_(), COL_ARTICLES).forEach(function (a) { m[a.id] = a; });
  return m;
}

function lister_(user) {
  const parEmail = {};
  listerUtilisateurs_().forEach(function (u) { parEmail[u.email] = u; });
  const c = contexte_(user);
  const arts = articlesParId_();
  // Les lectures d'un utilisateur supprimé, ou d'un groupe supprimé, restent dans la feuille mais ne sont plus affichées.
  return lireTable_(feuilleLectures_(), COLONNES).filter(function (r) {
    return parEmail[r.owner] && arts[r.article_id] && lectureVisible_(c, r);
  }).map(function (r) {
    const proprio = parEmail[r.owner];
    const g = c.groupesParId[r.groupe_id];
    const a = arts[r.article_id];
    const pub = { etudiant: proprio.prenom, couleur: proprio.couleur, mine: r.owner === user.email };
    COLONNES.forEach(function (col) { if (col !== 'owner') pub[col] = r[col]; });
    OBJECTIFS.forEach(function (k) { pub[k] = a[k]; });
    pub.portee = porteeDe_(r.statut);
    pub.groupe = g.nom;
    pub.etablissement = g.etablissement;
    pub.promo = g.promo;
    // L'analyse n'est modifiable que par son auteur ; l'article (partie objective) par tout étudiant de la promo.
    pub.modifiable = user.role === 'etudiant' && r.owner === user.email;
    pub.article_modifiable = articleModifiable_(user, c, a);
    if ((a.modifie_le || '') > (pub.modifie_le || '')) { pub.modifie_le = a.modifie_le; pub.modifie_par = a.modifie_par; }
    return pub;
  });
}

function promoDeArticle_(c, a) {
  const g = c.groupesParId[a.groupe_id];
  return g ? clePromo_(g) : '';
}

function articleModifiable_(user, c, a) {
  return user.role === 'etudiant' && !!c.promos[promoDeArticle_(c, a)];
}

function lectureVisible_(c, r) {
  const g = c.groupesParId[r.groupe_id];
  if (!g) return false;
  if (c.admin || c.miens[g.id]) return true;
  return porteeDe_(r.statut) === 'promo' && !!c.promos[clePromo_(g)];
}

// Analyses visibles par la personne qui portent l'article.
function analysesVisibles_(c, articleId) {
  return lireTable_(feuilleLectures_(), COLONNES).filter(function (r) {
    return r.article_id === articleId && lectureVisible_(c, r);
  });
}

function articleVisible_(user, articleId) {
  const c = contexte_(user);
  const a = articlesParId_()[articleId];
  if (!a || !c.groupesParId[a.groupe_id]) throw err_('not_found', 'Article introuvable');
  if (!c.admin && !analysesVisibles_(c, articleId).length) throw err_('not_found', 'Article introuvable');
  return a;
}

// Groupe de l'étudiant dans la promo concernée.
function groupeDansPromo_(c, promo) {
  const g = c.mesGroupes.filter(function (x) { return clePromo_(x) === promo; })[0];
  if (!g) throw err_('forbidden', 'Vous ne faites pas partie de cette promo');
  return g;
}

// data.article_id : ajoute SON analyse à un article existant (les champs objectifs ne comblent que les vides) ;
// sinon crée l'article (avec détection des doublons dans la promo, sauf data.nouveau === true) et la première analyse.
function ajouter_(user, data) {
  exigerEtudiant_(user);
  const c = contexte_(user);
  const d = nettoyer_(data);
  const maintenant = new Date().toISOString();
  let art, g;
  if (data && data.article_id) {
    art = articleVisible_(user, String(data.article_id));
    g = groupeDansPromo_(c, promoDeArticle_(c, art));
    if (lireTable_(feuilleLectures_(), COLONNES).some(function (r) { return r.article_id === art.id && r.owner === user.email; })) {
      throw err_('invalid', 'Vous avez déjà une fiche de lecture pour cet article');
    }
    const fusion = {};
    OBJECTIFS.forEach(function (k) { fusion[k] = art[k] || d[k]; });
    valider_(Object.assign({}, d, fusion));
    if (OBJECTIFS.some(function (k) { return fusion[k] !== art[k]; })) {
      ecrireArticle_(art, fusion, user, maintenant);
    }
  } else {
    const gid = groupeParDefaut_(user, data && data.groupe_id);
    g = c.mesGroupes.filter(function (x) { return x.id === gid; })[0];
    valider_(d);
    if (!(data && data.nouveau === true)) {
      const promo = clePromo_(g);
      const doublon = lireTable_(feuilleArticles_(), COL_ARTICLES).filter(function (x) {
        return promoDeArticle_(c, x) === promo && memeArticle_(x, d) && analysesVisibles_(c, x.id).length;
      })[0];
      if (doublon) {
        const e = err_('duplicate', 'Cet article existe déjà dans la promo : ajoutez-y plutôt votre fiche de lecture.');
        e.extra = { article_id: doublon.id, titre: doublon.titre };
        throw e;
      }
    }
    art = { id: Utilities.getUuid(), cree_par: user.email, groupe_id: g.id, ajoute: maintenant, modifie_le: '', modifie_par: '' };
    OBJECTIFS.forEach(function (k) { art[k] = d[k]; });
    feuilleArticles_().appendRow(COL_ARTICLES.map(function (k) { return art[k]; }));
  }
  const meta = { id: Utilities.getUuid(), owner: user.email, ajoute: maintenant, modifie_le: '', modifie_par: '',
    groupe_id: g.id, portee: porteeDe_(d.statut), article_id: art.id };
  const ligne = COLONNES.map(function (k) {
    if (k in meta) return meta[k];
    return ANALYSES.indexOf(k) >= 0 ? d[k] : '';
  });
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

function ecrireArticle_(art, valeurs, user, date) {
  historiserArticle_(art, user, date);
  const ligne = COL_ARTICLES.map(function (k) {
    if (OBJECTIFS.indexOf(k) >= 0) return valeurs[k];
    if (k === 'modifie_le') return date;
    if (k === 'modifie_par') return user.prenom;
    return art[k];
  });
  feuilleArticles_().getRange(art._row, 1, 1, COL_ARTICLES.length).setValues([ligne]);
}

function historiserArticle_(art, user, date) {
  const avant = {};
  OBJECTIFS.forEach(function (k) { avant[k] = art[k]; });
  const proprio = listerUtilisateurs_().filter(function (u) { return u.email === art.cree_par; })[0];
  SpreadsheetApp.getActiveSpreadsheet().getSheetByName(FEUILLE_HISTORIQUE)
    .appendRow([date, art.id, user.prenom, proprio ? proprio.prenom : '', JSON.stringify(avant).slice(0, 49000)]);
}

// Modifie son analyse (et, si les champs objectifs sont fournis, la partie objective de l'article).
function modifier_(user, id, data) {
  exigerEtudiant_(user);
  const sh = feuilleLectures_();
  const r = trouver_(sh, id);
  exigerMembre_(user, r.groupe_id);
  if (r.owner !== user.email) throw err_('not_owner', 'Cette lecture appartient à quelqu’un d’autre');
  const art = articlesParId_()[r.article_id];
  if (!art) throw err_('not_found', 'Article introuvable');
  const d = nettoyer_(data);
  const voulu = {};
  OBJECTIFS.forEach(function (k) { voulu[k] = data[k] === undefined ? art[k] : d[k]; });
  const change = OBJECTIFS.some(function (k) { return voulu[k] !== art[k]; });
  const direct = !change || modifDirecte_(user, art);
  const obj = direct ? voulu : art;
  valider_(Object.assign({}, d, obj));
  const maintenant = new Date().toISOString();
  if (change && direct) {
    validerArticleTerminees_(r.article_id, obj, r.id);
    ecrireArticle_(art, obj, user, maintenant);
  } else if (change) {
    validerArticleTerminees_(r.article_id, voulu, r.id);
    proposerArticle_(user, art, voulu, maintenant);
  }
  const ligne = COLONNES.map(function (k) {
    if (ANALYSES.indexOf(k) >= 0) return d[k];
    if (k === 'portee') return porteeDe_(d.statut);
    if (k === 'modifie_le') return maintenant;
    if (k === 'modifie_par') return user.prenom;
    return r[k];
  });
  sh.getRange(r._row, 1, 1, COLONNES.length).setValues([ligne]);
}

// Si une analyse de l'article est terminée, les six champs obligatoires de l'article doivent rester renseignés.
function validerArticleTerminees_(articleId, obj, sauf) {
  const terminee = lireTable_(feuilleLectures_(), COLONNES).some(function (x) {
    return x.article_id === articleId && x.id !== sauf && x.statut === 'Terminée';
  });
  if (terminee) valider_(Object.assign({ statut: 'Terminée' }, obj));
  else valider_(Object.assign({ statut: 'En cours' }, obj));
}

// Correction directe : l'administrateur, ou le créateur de l'article tant qu'il est seul à l'avoir analysé.
function modifDirecte_(user, art) {
  if (user.role === 'admin') return true;
  if (art.cree_par !== user.email) return false;
  return !lireTable_(feuilleLectures_(), COLONNES).some(function (r) { return r.article_id === art.id && r.owner !== user.email; });
}

// Correction de la partie objective : directe pour l'administrateur / le créateur isolé, sinon proposition à valider.
function modifierArticle_(user, articleId, data) {
  const c = contexte_(user);
  if (user.role !== 'etudiant' && user.role !== 'admin') throw err_('forbidden', 'Accès en lecture seule');
  const art = articleVisible_(user, String(articleId));
  if (user.role === 'etudiant' && !articleModifiable_(user, c, art)) throw err_('forbidden', 'Réservé aux étudiants de la promo');
  const d = nettoyer_(data);
  const obj = {};
  OBJECTIFS.forEach(function (k) { obj[k] = data[k] === undefined ? art[k] : d[k]; });
  if (!OBJECTIFS.some(function (k) { return obj[k] !== art[k]; })) throw err_('invalid', 'Aucune modification');
  validerArticleTerminees_(art.id, obj, '');
  const maintenant = new Date().toISOString();
  if (modifDirecte_(user, art)) ecrireArticle_(art, obj, user, maintenant);
  else proposerArticle_(user, art, obj, maintenant);
}

function feuillePropositions_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  return ss.getSheetByName(FEUILLE_PROPOSITIONS) || preparer_(ss, FEUILLE_PROPOSITIONS, COL_PROPOSITIONS);
}

function votesProp_(p) {
  try { return JSON.parse(p.votes || '{}') || {}; } catch (e) { return {}; }
}

// Les propositions ouvertes depuis trop longtemps expirent (au fil des lectures).
function cloreExpireesProp_() {
  const sh = feuillePropositions_();
  const maintenant = Date.now();
  lireTable_(sh, COL_PROPOSITIONS).forEach(function (p) {
    if (p.statut === 'ouvert' && maintenant - Date.parse(p.cree_le) > PROP_DUREE_MS) {
      sh.getRange(p._row, 7, 1, 2).setValues([['expire', new Date().toISOString()]]);
    }
  });
}

function proposerArticle_(user, art, valeurs, date) {
  const sh = feuillePropositions_();
  // Une seule proposition ouverte par personne et par article : la nouvelle remplace l'ancienne.
  lireTable_(sh, COL_PROPOSITIONS).filter(function (p) {
    return p.article_id === art.id && p.propose_par === user.email && p.statut === 'ouvert';
  }).forEach(function (p) { sh.getRange(p._row, 7, 1, 2).setValues([['annule', date]]); });
  const v = {}; v[user.email] = 1;
  const val = {};
  OBJECTIFS.forEach(function (k) { val[k] = valeurs[k]; });
  sh.appendRow([Utilities.getUuid(), art.id, user.email, date, JSON.stringify(val), JSON.stringify(v), 'ouvert', '']);
}

function voterArticle_(user, id, oui) {
  exigerEtudiant_(user);
  const sh = feuillePropositions_();
  cloreExpireesProp_();
  const p = lireTable_(sh, COL_PROPOSITIONS).filter(function (x) { return x.id === id; })[0];
  if (!p) throw err_('not_found', 'Proposition introuvable');
  if (p.statut !== 'ouvert') throw err_('invalid', 'Cette proposition est close');
  const c = contexte_(user);
  const art = articleVisible_(user, p.article_id);
  if (!articleModifiable_(user, c, art)) throw err_('forbidden', 'Réservé aux étudiants de la promo');
  if (p.propose_par === user.email && oui === false) throw err_('invalid', 'Annulez votre proposition plutôt que la refuser');
  const votes = votesProp_(p);
  votes[user.email] = oui ? 1 : 0;
  const actifs = {};
  listerUtilisateurs_().forEach(function (u) { if (u.role === 'etudiant' && u.statut === 'actif') actifs[u.email] = true; });
  let pour = 0, contre = 0;
  Object.keys(votes).forEach(function (e) { if (!actifs[e]) return; if (votes[e]) pour++; else contre++; });
  let statut = 'ouvert';
  const maintenant = new Date().toISOString();
  if (pour >= PROP_SEUIL) statut = 'adopte';
  else if (contre >= PROP_SEUIL) statut = 'refuse';
  if (statut === 'adopte') {
    const valeurs = JSON.parse(p.valeurs);
    const cible = articlesParId_()[p.article_id];
    // Si l'article est devenu incomplet entre-temps, la proposition ne peut pas être appliquée.
    validerArticleTerminees_(cible.id, valeurs, '');
    ecrireArticle_(cible, valeurs, user, maintenant);
  }
  sh.getRange(p._row, 6, 1, 3).setValues([[JSON.stringify(votes), statut, statut === 'ouvert' ? '' : maintenant]]);
}

function annulerProposition_(user, id) {
  const sh = feuillePropositions_();
  const p = lireTable_(sh, COL_PROPOSITIONS).filter(function (x) { return x.id === id; })[0];
  if (!p) throw err_('not_found', 'Proposition introuvable');
  if (p.propose_par !== user.email && user.role !== 'admin') throw err_('forbidden', 'Seul l’auteur peut annuler');
  if (p.statut !== 'ouvert') throw err_('invalid', 'Cette proposition est close');
  sh.getRange(p._row, 7, 1, 2).setValues([['annule', new Date().toISOString()]]);
}

// Propositions ouvertes sur les articles que la personne voit (adresses jamais exposées : identifiants publics).
function propositionsPourClient_(user, c) {
  cloreExpireesProp_();
  const arts = articlesParId_();
  const visibles = {};
  lireTable_(feuilleLectures_(), COLONNES).forEach(function (r) {
    if (arts[r.article_id] && lectureVisible_(c, r)) visibles[r.article_id] = true;
  });
  const parEmail = {};
  listerUtilisateurs_().forEach(function (u) { parEmail[u.email] = u; });
  return lireTable_(feuillePropositions_(), COL_PROPOSITIONS).filter(function (p) {
    return p.statut === 'ouvert' && visibles[p.article_id] && parEmail[p.propose_par];
  }).map(function (p) {
    const v = votesProp_(p);
    let pour = 0, contre = 0;
    // Seuls les étudiants actifs comptent (comme au moment du vote) : jamais un formateur.
    Object.keys(v).forEach(function (e) { if (!parEmail[e] || parEmail[e].role !== 'etudiant' || parEmail[e].statut !== 'actif') return; if (v[e]) pour++; else contre++; });
    return { id: p.id, article_id: p.article_id, par: parEmail[p.propose_par].prenom, cree_le: p.cree_le,
      valeurs: JSON.parse(p.valeurs), pour: pour, contre: contre, seuil: PROP_SEUIL,
      mine: p.propose_par === user.email, monVote: user.email in v ? (v[user.email] ? 1 : 0) : -1 };
  });
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
  // Un article sans plus aucune analyse disparaît.
  if (r.article_id && !lireTable_(sh, COLONNES).some(function (x) { return x.article_id === r.article_id; })) {
    const a = articlesParId_()[r.article_id];
    if (a) feuilleArticles_().deleteRow(a._row);
    retirerFichiersArticle_(r.article_id);
  }
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
    if (porteeDe_(l.statut) !== 'promo') throw err_('forbidden', 'Cette fiche de lecture n’est pas partagée avec la promo');
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
  if (!sh) return [];
  // Les feuilles de structure changent rarement : lues depuis le cache du script (10 min) sauf pendant une écriture,
  // où l'on relit toujours le Sheet. Le cache est vidé à la fin de chaque écriture.
  if (!TABLES_EN_CACHE[nom] || !memoOn_) return lireTable_(sh, colonnes);
  return lu_('t:' + nom, function () {
    const cache = CacheService.getScriptCache();
    let valeurs = null;
    try { valeurs = JSON.parse(cache.get('tc_' + nom) || 'null'); } catch (e) { valeurs = null; }
    if (!valeurs) {
      valeurs = sh.getDataRange().getDisplayValues().slice(1);
      const brut = JSON.stringify(valeurs);
      if (brut.length < 90000) cache.put('tc_' + nom, brut, CACHE_TABLES_S);
    }
    return valeurs.map(function (v, i) {
      const o = { _row: i + 2 };
      colonnes.forEach(function (c, j) { o[c] = v[j] === undefined ? '' : String(v[j]); });
      return o;
    }).filter(function (o) { return o.id; });
  });
}

const CACHE_TABLES_S = 600;
const TABLES_EN_CACHE = { 'Etablissements': true, 'Promos': true, 'Inscriptions': true, 'Fichiers': true };
function viderCacheTables_() {
  const cache = CacheService.getScriptCache();
  Object.keys(TABLES_EN_CACHE).forEach(function (n) { cache.remove('tc_' + n); });
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
    // Les promos où l'on est inscrit (code d'invitation, validation) comptent aussi, même sans groupe.
    const insc = table_(FEUILLE_INSCRIPTIONS, COL_INSCRIPTIONS).filter(function (i) { return i.email === user.email; });
    if (insc.length) {
      const pp = promosParId_();
      insc.forEach(function (i) { if (pp[i.promo_id]) promos[pp[i.promo_id].cle] = true; });
    }
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
      cible_pid: retrait ? pid_(v.cible) : '', cible: (retrait || v.type === 'adhesion' || TYPES_FORMATEUR.indexOf(v.type) >= 0) && parEmail[v.cible] ? parEmail[v.cible].prenom : '', valeur: v.valeur,
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
  if (!admin && cible.role !== 'etudiant') throw err_('forbidden', 'Seul l’administrateur rattache un formateur');
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
  } else if (type === 'formateur_invite') {
    const f = formateursDePromo_(clePromo_(g)).filter(function (u) { return pid_(u.email) === pid; })[0];
    if (!f) throw err_('not_found', 'Formateur introuvable dans cette promo');
    cible = f.email;
    verifierRattachementPossible_(g, cible, 'Ce formateur fait déjà partie du groupe', 'Une proposition est déjà en cours pour ce formateur');
    if (votes.some(function (v) { return v.cible === cible && v.statut === 'refuse' && maintenant - Date.parse(v.clos_le) < VOTE_BLOCAGE_MS; })) {
      throw err_('invalid', 'Une invitation de ce formateur a été refusée récemment : réessayez dans quelques jours');
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
      if (v.type === 'adhesion') {
        const cand = utilisateurActif_(function (x) { return x.email === v.cible; });
        if (!cand) throw err_('invalid', 'candidat introuvable');
        ajouterMembre_(groupeParId_(v.groupe_id), cand);
      } else if (TYPES_FORMATEUR.indexOf(v.type) >= 0) {
        const f = utilisateurActif_(function (x) { return x.email === v.cible && x.role === 'formateur'; });
        if (!f) throw err_('invalid', 'formateur introuvable');
        ajouterMembre_(groupeParId_(v.groupe_id), f);
      } else if (retrait) {
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

// Nom de l'établissement et de la promo : ceux de la structure (promo_id) ou, à défaut, ceux saisis (créés au besoin, casse existante conservée).
function structureDe_(data, courant) {
  if (data.promo_id) {
    const p = table_(FEUILLE_PROMOS, COL_PROMOS).filter(function (x) { return x.id === String(data.promo_id); })[0];
    const e = p && table_(FEUILLE_ETABLISSEMENTS, COL_ETABLISSEMENTS).filter(function (x) { return x.id === p.etablissement_id; })[0];
    if (!p || !e) throw err_('not_found', 'Promo introuvable');
    return { etablissement: e.nom, promo: p.nom };
  }
  const base = courant || {};
  const etab = nomValide_(data.etablissement === undefined ? base.etablissement : data.etablissement, 'Établissement');
  const promo = nomValide_(data.promo === undefined ? base.promo : data.promo, 'Promo');
  return assurerStructure_(etab, promo);
}

// Crée l'établissement et la promo s'ils n'existent pas ; renvoie leurs noms canoniques.
function assurerStructure_(etab, promo) {
  const maintenant = new Date().toISOString();
  const shE = feuilleDe_(FEUILLE_ETABLISSEMENTS, COL_ETABLISSEMENTS), shP = feuilleDe_(FEUILLE_PROMOS, COL_PROMOS);
  let e = lireTable_(shE, COL_ETABLISSEMENTS).filter(function (x) { return normaliserTerme_(x.nom) === normaliserTerme_(etab); })[0];
  if (!e) {
    e = { id: Utilities.getUuid(), nom: etab, cree_le: maintenant };
    shE.appendRow(COL_ETABLISSEMENTS.map(function (c) { return e[c]; }));
  }
  let p = lireTable_(shP, COL_PROMOS).filter(function (x) { return x.etablissement_id === e.id && normaliserTerme_(x.nom) === normaliserTerme_(promo); })[0];
  if (!p) {
    p = { id: Utilities.getUuid(), etablissement_id: e.id, nom: promo, cree_le: maintenant };
    shP.appendRow(COL_PROMOS.map(function (c) { return p[c] === undefined ? '' : p[c]; }));
  }
  return { etablissement: e.nom, promo: p.nom };
}

function listerStructureAdmin_(user) {
  if (user.role !== 'admin') return [];
  const promos = table_(FEUILLE_PROMOS, COL_PROMOS);
  return table_(FEUILLE_ETABLISSEMENTS, COL_ETABLISSEMENTS).map(function (e) {
    return { id: e.id, nom: e.nom, promos: promos.filter(function (p) { return p.etablissement_id === e.id; })
      .map(function (p) {
        const actif = !!p.code && Date.parse(p.code_expire) > Date.now();
        return { id: p.id, nom: p.nom, code: p.code || '', code_expire: p.code_expire || '', code_max: Number(p.code_max) || 0,
          code_usages: Number(p.code_usages) || 0, code_actif: actif };
      }) };
  });
}

function etabParId_(id) {
  const e = table_(FEUILLE_ETABLISSEMENTS, COL_ETABLISSEMENTS).filter(function (x) { return x.id === String(id || ''); })[0];
  if (!e) throw err_('not_found', 'Établissement introuvable');
  return e;
}
function promoParId_(id) {
  const p = table_(FEUILLE_PROMOS, COL_PROMOS).filter(function (x) { return x.id === String(id || ''); })[0];
  if (!p) throw err_('not_found', 'Promo introuvable');
  return p;
}

function creerEtablissement_(user, data) {
  exigerAdmin_(user);
  const nom = nomValide_(data && data.nom, 'Établissement');
  if (table_(FEUILLE_ETABLISSEMENTS, COL_ETABLISSEMENTS).some(function (x) { return normaliserTerme_(x.nom) === normaliserTerme_(nom); })) {
    throw err_('invalid', 'Cet établissement existe déjà');
  }
  feuilleDe_(FEUILLE_ETABLISSEMENTS, COL_ETABLISSEMENTS).appendRow([Utilities.getUuid(), nom, new Date().toISOString()]);
}

function renommerEtablissement_(user, data) {
  exigerAdmin_(user);
  const e = etabParId_(data && data.id);
  const nom = nomValide_(data.nom, 'Établissement');
  if (table_(FEUILLE_ETABLISSEMENTS, COL_ETABLISSEMENTS).some(function (x) { return x.id !== e.id && normaliserTerme_(x.nom) === normaliserTerme_(nom); })) {
    throw err_('invalid', 'Cet établissement existe déjà');
  }
  feuilleDe_(FEUILLE_ETABLISSEMENTS, COL_ETABLISSEMENTS).getRange(e._row, 2, 1, 1).setValues([[nom]]);
  const shG = feuilleDe_(FEUILLE_GROUPES, COL_GROUPES);
  table_(FEUILLE_GROUPES, COL_GROUPES).filter(function (g) { return g.etablissement === e.nom; })
    .forEach(function (g) { shG.getRange(g._row, 2, 1, 1).setValues([[nom]]); });
}

function supprimerEtablissement_(user, id) {
  exigerAdmin_(user);
  const e = etabParId_(id);
  if (table_(FEUILLE_PROMOS, COL_PROMOS).some(function (p) { return p.etablissement_id === e.id; })) {
    throw err_('invalid', 'Supprimez d’abord les promos de cet établissement');
  }
  feuilleDe_(FEUILLE_ETABLISSEMENTS, COL_ETABLISSEMENTS).deleteRow(e._row);
}

function creerPromo_(user, data) {
  exigerAdmin_(user);
  const e = etabParId_(data && data.etablissement_id);
  const nom = nomValide_(data.nom, 'Promo');
  if (table_(FEUILLE_PROMOS, COL_PROMOS).some(function (p) { return p.etablissement_id === e.id && normaliserTerme_(p.nom) === normaliserTerme_(nom); })) {
    throw err_('invalid', 'Cette promo existe déjà dans cet établissement');
  }
  feuilleDe_(FEUILLE_PROMOS, COL_PROMOS).appendRow([Utilities.getUuid(), e.id, nom, new Date().toISOString(), '', '', '', '']);
}

function renommerPromo_(user, data) {
  exigerAdmin_(user);
  const p = promoParId_(data && data.id);
  const e = etabParId_(p.etablissement_id);
  const nom = nomValide_(data.nom, 'Promo');
  if (table_(FEUILLE_PROMOS, COL_PROMOS).some(function (x) { return x.id !== p.id && x.etablissement_id === e.id && normaliserTerme_(x.nom) === normaliserTerme_(nom); })) {
    throw err_('invalid', 'Cette promo existe déjà dans cet établissement');
  }
  feuilleDe_(FEUILLE_PROMOS, COL_PROMOS).getRange(p._row, 3, 1, 1).setValues([[nom]]);
  const shG = feuilleDe_(FEUILLE_GROUPES, COL_GROUPES);
  table_(FEUILLE_GROUPES, COL_GROUPES).filter(function (g) { return g.etablissement === e.nom && g.promo === p.nom; })
    .forEach(function (g) { shG.getRange(g._row, 3, 1, 1).setValues([[nom]]); });
}

function supprimerPromo_(user, id) {
  exigerAdmin_(user);
  const p = promoParId_(id);
  const e = etabParId_(p.etablissement_id);
  if (table_(FEUILLE_GROUPES, COL_GROUPES).some(function (g) { return g.etablissement === e.nom && g.promo === p.nom; })) {
    throw err_('invalid', 'Supprimez d’abord les groupes de cette promo');
  }
  feuilleDe_(FEUILLE_PROMOS, COL_PROMOS).deleteRow(p._row);
  const shI = feuilleDe_(FEUILLE_INSCRIPTIONS, COL_INSCRIPTIONS);
  lireTable_(shI, COL_INSCRIPTIONS).filter(function (i) { return i.promo_id === p.id; })
    .sort(function (a, b) { return b._row - a._row; }).forEach(function (i) { shI.deleteRow(i._row); });
}

function creerGroupe_(user, data) {
  exigerAdmin_(user);
  if (!data || typeof data !== 'object') throw err_('invalid', 'Données manquantes');
  const st = structureDe_(data, null);
  const g = { id: Utilities.getUuid(), etablissement: st.etablissement,
    promo: st.promo, nom: nomValide_(data.nom, 'Nom'), cree_le: new Date().toISOString(), cree_par: '' };
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
  const st = structureDe_(data, g);
  const n = { etablissement: st.etablissement, promo: st.promo,
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

/* ---------- Suivi de projet : réunions et rétroplanning ---------- */

const SUIVI = {
  reunion: { feuille: FEUILLE_REUNIONS, colonnes: COL_REUNIONS, champs: ['date', 'titre', 'participants', 'vu', 'attendu', 'suite'] },
  jalon: { feuille: FEUILLE_JALONS, colonnes: COL_JALONS, champs: ['titre', 'echeance', 'statut', 'note', 'debut', 'alerte_jours'] }
};

function feuilleSuivi_(type) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const d = SUIVI[type];
  // Créée au besoin : une installation antérieure fonctionne jusqu'au prochain setup().
  return ss.getSheetByName(d.feuille) || preparer_(ss, d.feuille, d.colonnes);
}

function dateValide_(v) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const d = new Date(v + 'T00:00:00Z');
  return !isNaN(d) && d.toISOString().slice(0, 10) === v;
}

function validerSuivi_(type, d) {
  if (type === 'reunion') {
    if (!dateValide_(d.date)) throw err_('invalid', 'Date de réunion invalide');
    if (!d.titre && !d.vu && !d.attendu && !d.suite) throw err_('invalid', 'Renseignez au moins un titre ou un compte rendu');
  } else {
    if (!d.titre) throw err_('invalid', 'Le jalon doit avoir un titre');
    if (!dateValide_(d.echeance)) throw err_('invalid', 'Échéance invalide');
    if (STATUTS_JALON.indexOf(d.statut) < 0) throw err_('invalid', 'Statut invalide');
    if (d.debut) {
      if (!dateValide_(d.debut)) throw err_('invalid', 'Date de début invalide');
      if (d.debut > d.echeance) throw err_('invalid', 'La date de début doit précéder la date de fin');
      if (d.debut === d.echeance) d.debut = '';   // une plage d'un jour est une date fixe
    }
    if (d.alerte_jours !== '' && (!/^\d{1,3}$/.test(d.alerte_jours) || +d.alerte_jours > 365)) throw err_('invalid', 'Alerte : nombre de jours entre 0 et 365');
  }
}

function enregistrerSuivi_(user, type, groupeId, id, data) {
  exigerEtudiant_(user);
  if (!data || typeof data !== 'object') throw err_('invalid', 'Données manquantes');
  const def = SUIVI[type];
  const sh = feuilleSuivi_(type);
  let existante = null;
  let gid = String(groupeId || '');
  if (id) {
    existante = lireTable_(sh, def.colonnes).filter(function (x) { return x.id === id; })[0];
    if (!existante) throw err_('not_found', 'Élément introuvable');
    gid = existante.groupe_id;
  }
  exigerMembre_(user, gid);
  const d = {};
  def.champs.forEach(function (k) {
    const v = data[k] === undefined || data[k] === null ? '' : String(data[k]).trim();
    if (v.length > LONGUEUR_MAX) throw err_('invalid', 'Champ trop long (' + LONGUEUR_MAX + ' caractères maximum)');
    d[k] = v;
  });
  if (type === 'jalon' && !d.statut) d.statut = 'a_faire';
  validerSuivi_(type, d);
  const maintenant = new Date().toISOString();
  if (!existante) {
    const m = { id: Utilities.getUuid(), groupe_id: gid, cree_par: user.email, cree_le: maintenant, modifie_le: '', modifie_par: '' };
    sh.appendRow(def.colonnes.map(function (k) { return k in m ? m[k] : d[k]; }));
    return;
  }
  const ligne = def.colonnes.map(function (k) {
    if (def.champs.indexOf(k) >= 0) return d[k];
    if (k === 'modifie_le') return maintenant;
    if (k === 'modifie_par') return user.prenom;
    return existante[k];
  });
  sh.getRange(existante._row, 1, 1, def.colonnes.length).setValues([ligne]);
}

// Les étudiants du groupe modifient et suppriment ; l'administrateur peut aussi supprimer (modération).
function supprimerSuivi_(user, type, id) {
  const def = SUIVI[type];
  const sh = feuilleSuivi_(type);
  const x = lireTable_(sh, def.colonnes).filter(function (r) { return r.id === id; })[0];
  if (!x) throw err_('not_found', 'Élément introuvable');
  if (user.role !== 'admin') { exigerEtudiant_(user); exigerMembre_(user, x.groupe_id); }
  sh.deleteRow(x._row);
}

function suiviPourClient_(user, c, type) {
  const def = SUIVI[type];
  const parEmail = {};
  listerUtilisateurs_().forEach(function (u) { parEmail[u.email] = u; });
  return lireTable_(feuilleSuivi_(type), def.colonnes).filter(function (r) {
    return c.groupesParId[r.groupe_id] && (c.admin || c.miens[r.groupe_id]);
  }).map(function (r) {
    const o = { id: r.id, groupe_id: r.groupe_id, cree_le: r.cree_le, modifie_le: r.modifie_le, modifie_par: r.modifie_par,
      par: parEmail[r.cree_par] ? parEmail[r.cree_par].prenom : 'Utilisateur supprimé',
      modifiable: user.role === 'etudiant' && !!c.miens[r.groupe_id] };
    def.champs.forEach(function (k) { o[k] = r[k]; });
    return o;
  });
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

/* ---------- Accueil : promo, code d'invitation, groupes en autonomie ---------- */

const PALETTE_ETUDIANTS = ['#e6194b', '#3cb44b', '#4363d8', '#f58231', '#911eb4', '#42a5a5', '#d4a017', '#f032e6', '#9a6324', '#008080'];
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CODE_ESSAIS_MAX = 5;
const CODE_ESSAIS_S = 900;

// Promos indexées par identifiant, avec la clé (établissement|promo) qui relie aux groupes.
function promosParId_() {
  const etabs = {};
  table_(FEUILLE_ETABLISSEMENTS, COL_ETABLISSEMENTS).forEach(function (e) { etabs[e.id] = e; });
  const out = {};
  table_(FEUILLE_PROMOS, COL_PROMOS).forEach(function (p) {
    const e = etabs[p.etablissement_id];
    if (e) out[p.id] = { id: p.id, nom: p.nom, etablissement: e.nom, cle: clePromo_({ etablissement: e.nom, promo: p.nom }) };
  });
  return out;
}

function inscritPromo_(email, cle) {
  const pp = promosParId_();
  return table_(FEUILLE_INSCRIPTIONS, COL_INSCRIPTIONS).some(function (i) { return i.email === email && pp[i.promo_id] && pp[i.promo_id].cle === cle; });
}

// Inscrit une personne à une promo ; renvoie false si elle l'était déjà (ou si la promo n'existe plus).
function inscrire_(email, promoId, via) {
  if (!promosParId_()[promoId]) return false;
  if (table_(FEUILLE_INSCRIPTIONS, COL_INSCRIPTIONS).some(function (i) { return i.email === email && i.promo_id === promoId; })) return false;
  feuilleDe_(FEUILLE_INSCRIPTIONS, COL_INSCRIPTIONS).appendRow([Utilities.getUuid(), email, promoId, new Date().toISOString(), via]);
  return true;
}

function demandeLibelle_(u) {
  const p = u.promo_demandee ? promosParId_()[u.promo_demandee] : null;
  return { promo_id: p ? p.id : '', promo: p ? p.etablissement + ' · ' + p.nom : '', role: u.role_demande || '' };
}

// Ce que voit une personne à sa première connexion : la liste des promos (noms seulement) et sa demande en cours.
function accueil_(user) {
  const u = listerUtilisateurs_().filter(function (x) { return x.email === user.email; })[0] || user;
  const promos = table_(FEUILLE_PROMOS, COL_PROMOS);
  return {
    structure: table_(FEUILLE_ETABLISSEMENTS, COL_ETABLISSEMENTS).map(function (e) {
      return { id: e.id, nom: e.nom, promos: promos.filter(function (p) { return p.etablissement_id === e.id; })
        .map(function (p) { return { id: p.id, nom: p.nom }; }) };
    }),
    demande: Object.assign({ prenom: u.prenom || '' }, demandeLibelle_(u)),
    statut: u.statut
  };
}

function exigerAccueil_(user) {
  if (user.role === 'admin') throw err_('invalid', 'L’administrateur n’a pas besoin de demande');
  if (user.statut === 'actif' && user.role !== 'etudiant') throw err_('forbidden', 'Réservé aux étudiants');
}

function prenomValide_(v) {
  const p = String(v === undefined || v === null ? '' : v).trim().replace(/\s+/g, ' ');
  if (!p) throw err_('invalid', 'Prénom requis');
  if (p.length > PRENOM_MAX) throw err_('invalid', 'Prénom trop long');
  return p;
}

// Première connexion sans code : la demande reste en attente, validée comme avant, avec la promo et le rôle souhaités.
function demanderPromo_(user, data) {
  if (user.role === 'admin' || user.statut === 'actif') throw err_('invalid', 'Votre accès est déjà actif');
  if (!data || typeof data !== 'object') throw err_('invalid', 'Données manquantes');
  const role = String(data.role || '');
  if (['etudiant', 'formateur'].indexOf(role) < 0) throw err_('invalid', 'Rôle invalide');
  const prenom = prenomValide_(data.prenom);
  // Une seule promo ouverte : elle est choisie d'office (pas de choix à faire).
  const toutes = Object.keys(promosParId_());
  const promoId = String(data.promo_id || (toutes.length === 1 ? toutes[0] : ''));
  if (role === 'etudiant' && !promosParId_()[promoId]) throw err_('invalid', 'Choisissez votre promo');
  if (promoId && !promosParId_()[promoId]) throw err_('invalid', 'Promo introuvable');
  let cible = listerUtilisateurs_().filter(function (u) { return u.email === user.email; })[0];
  if (!cible) {
    enregistrerDemande_(user.email);
    cible = listerUtilisateurs_().filter(function (u) { return u.email === user.email; })[0];
  }
  const sh = feuilleUtilisateurs_();
  sh.getRange(cible._row, 2, 1, 1).setValues([[prenom]]);
  sh.getRange(cible._row, 8, 1, 2).setValues([[promoId, role]]);
}

function couleurPeuUtilisee_() {
  const n = {};
  PALETTE_ETUDIANTS.forEach(function (c) { n[c] = 0; });
  listerUtilisateurs_().forEach(function (u) { if (u.role === 'etudiant' && n[u.couleur] !== undefined) n[u.couleur]++; });
  return PALETTE_ETUDIANTS.slice().sort(function (a, b) { return n[a] - n[b]; })[0];
}

function normaliserCode_(v) {
  return String(v === undefined || v === null ? '' : v).toUpperCase().replace(/[^A-Z0-9]/g, '');
}

// Un code valide ouvre l'accès comme étudiant de la promo, sans validation. Les essais ratés sont limités.
function joindreAvecCode_(user, data) {
  exigerAccueil_(user);
  if (!data || typeof data !== 'object') throw err_('invalid', 'Données manquantes');
  const cache = CacheService.getScriptCache();
  const cleEssais = 'codefail_' + user.email;
  const essais = Number(cache.get(cleEssais) || 0);
  if (essais >= CODE_ESSAIS_MAX) throw err_('forbidden', 'Trop d’essais : réessayez dans quelques minutes');
  const code = normaliserCode_(data.code);
  const echec = function (msg) {
    cache.put(cleEssais, String(essais + 1), CODE_ESSAIS_S);
    throw err_('invalid', msg || 'Code invalide ou expiré');
  };
  if (code.length < 6) echec();
  const p = table_(FEUILLE_PROMOS, COL_PROMOS).filter(function (x) { return x.code && normaliserCode_(x.code) === code; })[0];
  if (!p || !(Date.parse(p.code_expire) > Date.now())) echec();
  const dejaInscrit = table_(FEUILLE_INSCRIPTIONS, COL_INSCRIPTIONS).some(function (i) { return i.email === user.email && i.promo_id === p.id; });
  if (!dejaInscrit && Number(p.code_usages || 0) >= Number(p.code_max || 0)) echec('Ce code a atteint son nombre maximal d’utilisations');
  const existant = listerUtilisateurs_().filter(function (u) { return u.email === user.email; })[0];
  if (!existant || existant.statut === 'en_attente') {
    const prenom = prenomValide_(data.prenom || (existant && existant.prenom));
    const maintenant = new Date().toISOString();
    if (!existant) {
      feuilleUtilisateurs_().appendRow([user.email, prenom, 'etudiant', couleurPeuUtilisee_(), 'actif', maintenant, maintenant, p.id, 'etudiant']);
    } else {
      const sh = feuilleUtilisateurs_();
      sh.getRange(existant._row, 2, 1, 4).setValues([[prenom, 'etudiant', couleurPeuUtilisee_(), 'actif']]);
      sh.getRange(existant._row, 8, 1, 2).setValues([[p.id, 'etudiant']]);
    }
  }
  if (inscrire_(user.email, p.id, 'code')) {
    feuilleDe_(FEUILLE_PROMOS, COL_PROMOS).getRange(p._row, COL_PROMOS.indexOf('code_usages') + 1, 1, 1)
      .setValues([[Number(p.code_usages || 0) + 1]]);
  }
  cache.remove(cleEssais);
}

function genererCodePromo_(user, data) {
  exigerAdmin_(user);
  const p = promoParId_(data && data.id);
  const borne = function (v, defaut, min, max) {
    const n = Math.floor(Number(v));
    return isFinite(n) && n >= min ? Math.min(n, max) : defaut;
  };
  const jours = borne(data.jours, 30, 1, 365), max = borne(data.max, 150, 1, 1000);
  const pris = {};
  table_(FEUILLE_PROMOS, COL_PROMOS).forEach(function (x) { if (x.code) pris[normaliserCode_(x.code)] = true; });
  let code = '';
  do {
    const hex = Utilities.getUuid().replace(/-/g, '');
    code = '';
    for (let i = 0; i < 8; i++) code += CODE_ALPHABET.charAt(parseInt(hex.substr(i * 2, 2), 16) % CODE_ALPHABET.length);
  } while (pris[code]);
  const expire = new Date(Date.now() + jours * 86400000).toISOString();
  feuilleDe_(FEUILLE_PROMOS, COL_PROMOS).getRange(p._row, COL_PROMOS.indexOf('code') + 1, 1, 4).setValues([[code, expire, max, 0]]);
}

function revoquerCodePromo_(user, id) {
  exigerAdmin_(user);
  const p = promoParId_(id);
  feuilleDe_(FEUILLE_PROMOS, COL_PROMOS).getRange(p._row, COL_PROMOS.indexOf('code') + 1, 1, 4).setValues([['', '', '', '']]);
}

// Un étudiant inscrit à une promo mais sans groupe peut créer le sien (un seul membre suffit).
function creerGroupeSoi_(user, promoId, nom) {
  exigerEtudiant_(user);
  cloreExpires_();
  const p = promosParId_()[String(promoId || '')];
  if (!p) throw err_('not_found', 'Promo introuvable');
  if (!inscritPromo_(user.email, p.cle)) throw err_('forbidden', 'Vous n’êtes pas inscrit à cette promo');
  if (dejaDansPromo_(user.email, p.cle, '')) throw err_('invalid', 'Vous êtes déjà dans un groupe de cette promo');
  const g = { id: Utilities.getUuid(), etablissement: p.etablissement, promo: p.nom, nom: nomValide_(nom, 'Nom'),
    cree_le: new Date().toISOString(), cree_par: user.email };
  verifierNomLibre_(p.cle, g.nom, '');
  feuilleDe_(FEUILLE_GROUPES, COL_GROUPES).appendRow(COL_GROUPES.map(function (c) { return g[c]; }));
  ajouterMembre_(g, user);
  annulerAdhesionsOuvertes_(user.email, p.cle);
}

function annulerAdhesionsOuvertes_(email, cle) {
  const sh = feuilleDe_(FEUILLE_VOTES, COL_VOTES);
  const parId = {};
  table_(FEUILLE_GROUPES, COL_GROUPES).forEach(function (g) { parId[g.id] = g; });
  lireTable_(sh, COL_VOTES).filter(function (v) {
    return v.type === 'adhesion' && v.statut === 'ouvert' && v.cible === email && parId[v.groupe_id] && clePromo_(parId[v.groupe_id]) === cle;
  }).forEach(function (v) {
    sh.getRange(v._row, COL_VOTES.indexOf('statut') + 1, 1, 2).setValues([['annule', new Date().toISOString()]]);
  });
}

/* ----- Formateurs : demande de rattachement à un groupe, ou invitation par un groupe (vote des étudiants du groupe) ----- */

const TYPES_FORMATEUR = ['formateur_demande', 'formateur_invite'];

// Promos d'un formateur : celles où il est inscrit, plus celles de ses groupes (un formateur peut être rattaché à plusieurs groupes).
function promosDeFormateur_(email) {
  const out = {}, pp = promosParId_();
  table_(FEUILLE_INSCRIPTIONS, COL_INSCRIPTIONS).forEach(function (i) { if (i.email === email && pp[i.promo_id]) out[pp[i.promo_id].cle] = true; });
  const parId = {};
  table_(FEUILLE_GROUPES, COL_GROUPES).forEach(function (g) { parId[g.id] = g; });
  table_(FEUILLE_MEMBRES, COL_MEMBRES).forEach(function (m) { if (m.email === email && parId[m.groupe_id]) out[clePromo_(parId[m.groupe_id])] = true; });
  return out;
}

function formateursDePromo_(cle) {
  return listerUtilisateurs_().filter(function (u) { return u.statut === 'actif' && u.role === 'formateur' && promosDeFormateur_(u.email)[cle]; });
}

// Refuse si le formateur est déjà dans le groupe ou si une proposition (demande ou invitation) est déjà ouverte pour lui dans ce groupe.
function verifierRattachementPossible_(g, email, msgMembre, msgOuvert) {
  if (table_(FEUILLE_MEMBRES, COL_MEMBRES).some(function (m) { return m.groupe_id === g.id && m.email === email; })) throw err_('invalid', msgMembre);
  const maintenant = Date.now();
  if (table_(FEUILLE_VOTES, COL_VOTES).some(function (v) {
    return v.groupe_id === g.id && v.cible === email && TYPES_FORMATEUR.indexOf(v.type) >= 0 && voteOuvert_(v, maintenant);
  })) throw err_('invalid', msgOuvert);
}

// Formateurs de la promo du groupe que ses étudiants peuvent inviter (pas déjà membres, pas de proposition ouverte).
function formateursInvitables_(user, gid) {
  exigerEtudiant_(user);
  exigerMembre_(user, gid);
  cloreExpires_();
  const g = groupeParId_(gid);
  const maintenant = Date.now();
  const membres = {}, ouverts = {};
  table_(FEUILLE_MEMBRES, COL_MEMBRES).forEach(function (m) { if (m.groupe_id === g.id) membres[m.email] = true; });
  table_(FEUILLE_VOTES, COL_VOTES).forEach(function (v) {
    if (v.groupe_id === g.id && TYPES_FORMATEUR.indexOf(v.type) >= 0 && voteOuvert_(v, maintenant)) ouverts[v.cible] = true;
  });
  return formateursDePromo_(clePromo_(g)).filter(function (u) { return !membres[u.email] && !ouverts[u.email]; })
    .map(function (u) { return { pid: pid_(u.email), prenom: u.prenom }; })
    .sort(function (a, b) { return a.prenom.localeCompare(b.prenom); });
}

// Un formateur demande à rejoindre un groupe de sa promo : les étudiants du groupe votent à la majorité simple.
function demanderRattachement_(user, gid) {
  if (user.role !== 'formateur') throw err_('forbidden', 'Réservé aux formateurs');
  cloreExpires_();
  const g = groupeParId_(String(gid || ''));
  if (!promosDeFormateur_(user.email)[clePromo_(g)]) throw err_('forbidden', 'Ce groupe n’est pas dans votre promo');
  if (!electeursGroupe_(g.id).length) throw err_('invalid', 'Ce groupe n’a aucun membre étudiant');
  verifierRattachementPossible_(g, user.email, 'Vous faites déjà partie de ce groupe', 'Une demande ou une invitation est déjà en cours pour ce groupe');
  const maintenant = Date.now();
  if (table_(FEUILLE_VOTES, COL_VOTES).some(function (v) {
    return v.groupe_id === g.id && v.cible === user.email && v.type === 'formateur_demande' && v.statut === 'refuse' && maintenant - Date.parse(v.clos_le) < VOTE_BLOCAGE_MS;
  })) throw err_('invalid', 'Ce groupe a refusé votre demande récemment : réessayez dans quelques jours');
  const sh = feuilleDe_(FEUILLE_VOTES, COL_VOTES);
  const v = { id: Utilities.getUuid(), groupe_id: g.id, type: 'formateur_demande', cible: user.email, valeur: '', propose_par: user.email,
    cree_le: new Date().toISOString(), votes: '{}', statut: 'ouvert', clos_le: '' };
  sh.appendRow(COL_VOTES.map(function (c) { return v[c]; }));
}

// Pour un formateur : les groupes de ses promos, avec son appartenance, sa demande ouverte et les invitations reçues.
function rattachementsPourClient_(user, c) {
  if (user.role !== 'formateur') return [];
  const cles = promosDeFormateur_(user.email);
  const parEmail = {};
  listerUtilisateurs_().forEach(function (u) { parEmail[u.email] = u; });
  const maintenant = Date.now();
  const mesVotes = table_(FEUILLE_VOTES, COL_VOTES).filter(function (v) { return v.cible === user.email && TYPES_FORMATEUR.indexOf(v.type) >= 0; });
  const parPromo = {};
  table_(FEUILLE_GROUPES, COL_GROUPES).filter(function (g) { return cles[clePromo_(g)]; }).forEach(function (g) {
    const etudiants = electeursGroupe_(g.id);
    const vg = mesVotes.filter(function (v) { return v.groupe_id === g.id; });
    const resume = function (v) {
      const etat = etatVote_(v, etudiants);
      return { id: v.id, oui: etat.oui, non: etat.non, n: etat.n, besoin: etat.besoin, expire_le: new Date(Date.parse(v.cree_le) + VOTE_DUREE_MS).toISOString() };
    };
    const demande = vg.filter(function (v) { return v.type === 'formateur_demande' && voteOuvert_(v, maintenant); })[0];
    const invitation = vg.filter(function (v) { return v.type === 'formateur_invite' && voteOuvert_(v, maintenant); })[0];
    const k = clePromo_(g);
    (parPromo[k] = parPromo[k] || { titre: g.etablissement + ' · ' + g.promo, groupes: [] }).groupes.push({
      id: g.id, nom: g.nom, membre: !!c.miens[g.id],
      demande: demande ? resume(demande) : null, invitation: invitation ? resume(invitation) : null,
      bloque: vg.some(function (v) { return v.type === 'formateur_demande' && v.statut === 'refuse' && maintenant - Date.parse(v.clos_le) < VOTE_BLOCAGE_MS; }),
      membres: etudiants.filter(function (e) { return parEmail[e]; }).map(function (e) { return { prenom: parEmail[e].prenom, couleur: parEmail[e].couleur }; })
    });
  });
  return Object.keys(parPromo).sort().map(function (k) {
    parPromo[k].groupes.sort(function (a, b) { return a.nom.localeCompare(b.nom); });
    return parPromo[k];
  });
}

// Demande à rejoindre un groupe de sa promo : les étudiants du groupe votent à la majorité simple.
function demanderAdhesion_(user, gid) {
  exigerEtudiant_(user);
  cloreExpires_();
  const g = groupeParId_(String(gid || ''));
  const cle = clePromo_(g);
  if (!inscritPromo_(user.email, cle)) throw err_('forbidden', 'Vous n’êtes pas inscrit à cette promo');
  if (dejaDansPromo_(user.email, cle, '')) throw err_('invalid', 'Vous êtes déjà dans un groupe de cette promo');
  if (!electeursGroupe_(g.id).length) throw err_('invalid', 'Ce groupe n’a aucun membre étudiant');
  const maintenant = Date.now();
  const parId = {};
  table_(FEUILLE_GROUPES, COL_GROUPES).forEach(function (x) { parId[x.id] = x; });
  const miens = table_(FEUILLE_VOTES, COL_VOTES).filter(function (v) {
    return v.type === 'adhesion' && v.cible === user.email && parId[v.groupe_id] && clePromo_(parId[v.groupe_id]) === cle;
  });
  if (miens.some(function (v) { return v.statut === 'ouvert'; })) throw err_('invalid', 'Vous avez déjà une demande en cours dans cette promo : annulez-la d’abord');
  if (miens.some(function (v) { return v.groupe_id === g.id && v.statut === 'refuse' && maintenant - Date.parse(v.clos_le) < VOTE_BLOCAGE_MS; })) {
    throw err_('invalid', 'Ce groupe a refusé votre demande récemment : réessayez dans quelques jours');
  }
  const sh = feuilleDe_(FEUILLE_VOTES, COL_VOTES);
  const id = Utilities.getUuid();
  const v = { id: id, groupe_id: g.id, type: 'adhesion', cible: user.email, valeur: '', propose_par: user.email,
    cree_le: new Date().toISOString(), votes: '{}', statut: 'ouvert', clos_le: '' };
  sh.appendRow(COL_VOTES.map(function (c) { return v[c]; }));
}

// Pour chaque promo où l'étudiant est inscrit : ses groupes possibles (tant qu'il n'en a pas) et l'état de sa demande.
function promosMoiPourClient_(user, c) {
  if (user.role !== 'etudiant') return [];
  const pp = promosParId_();
  const parCle = {};
  Object.keys(pp).forEach(function (id) { parCle[pp[id].cle] = pp[id]; });
  const cles = {};
  table_(FEUILLE_INSCRIPTIONS, COL_INSCRIPTIONS).forEach(function (i) {
    if (i.email === user.email && pp[i.promo_id]) cles[pp[i.promo_id].cle] = true;
  });
  c.mesGroupes.forEach(function (g) { cles[clePromo_(g)] = true; });
  const parEmail = {};
  listerUtilisateurs_().forEach(function (u) { parEmail[u.email] = u; });
  const maintenant = Date.now();
  const votes = table_(FEUILLE_VOTES, COL_VOTES).filter(function (v) { return v.type === 'adhesion' && v.cible === user.email; });
  const groupes = table_(FEUILLE_GROUPES, COL_GROUPES);
  return Object.keys(cles).filter(function (k) { return parCle[k]; }).map(function (k) {
    const p = parCle[k];
    const mien = groupes.filter(function (g) { return clePromo_(g) === k && c.miens[g.id]; })[0];
    const liste = mien ? [] : groupes.filter(function (g) { return clePromo_(g) === k; }).map(function (g) {
      const etudiants = electeursGroupe_(g.id);
      const mesVotes = votes.filter(function (v) { return v.groupe_id === g.id; });
      const ouvert = mesVotes.filter(function (v) { return voteOuvert_(v, maintenant); })[0];
      let demande = null;
      if (ouvert) {
        const etat = etatVote_(ouvert, etudiants);
        demande = { id: ouvert.id, oui: etat.oui, non: etat.non, n: etat.n, besoin: etat.besoin,
          expire_le: new Date(Date.parse(ouvert.cree_le) + VOTE_DUREE_MS).toISOString() };
      }
      return { id: g.id, nom: g.nom, demande: demande,
        bloque: mesVotes.some(function (v) { return v.statut === 'refuse' && maintenant - Date.parse(v.clos_le) < VOTE_BLOCAGE_MS; }),
        membres: etudiants.filter(function (e) { return parEmail[e]; }).map(function (e) { return { prenom: parEmail[e].prenom, couleur: parEmail[e].couleur }; }) };
    }).sort(function (a, b) { return a.nom.localeCompare(b.nom); });
    return { id: p.id, nom: p.nom, etablissement: p.etablissement, mon_groupe_id: mien ? mien.id : '', groupes: liste };
  });
}

/* ---------- Fichiers déposés sur un article (PDF, images) ---------- */

// Fichiers des articles que la personne peut voir (mêmes règles que les fiches de lecture).
function fichiersPourClient_(user, c) {
  const fichiers = table_(FEUILLE_FICHIERS, COL_FICHIERS);
  if (!fichiers.length) return [];
  const visibles = {}, miens = {};
  lireTable_(feuilleLectures_(), COLONNES).forEach(function (r) {
    if (!r.article_id) return;
    if (lectureVisible_(c, r)) visibles[r.article_id] = true;
    if (r.owner === user.email) miens[r.article_id] = true;
  });
  const parEmail = {};
  listerUtilisateurs_().forEach(function (u) { parEmail[u.email] = u; });
  return fichiers.filter(function (f) { return visibles[f.article_id]; }).map(function (f) {
    const u = parEmail[f.cree_par];
    return { id: f.id, article_id: f.article_id, nom: f.nom, type: f.type, taille: Number(f.taille) || 0,
      par: u ? u.prenom : 'Utilisateur supprimé', cree_le: f.cree_le,
      supprimable: f.cree_par === user.email || user.role === 'admin' || !!miens[f.article_id] };
  });
}

function dossierFichiers_() {
  const d = DriveApp.getFoldersByName(DOSSIER_FICHIERS);
  return d.hasNext() ? d.next() : DriveApp.createFolder(DOSSIER_FICHIERS);
}

// Le type est déduit du contenu (début du fichier), jamais de ce que déclare le navigateur.
function typeDeFichier_(o) {
  const b = function (i) { return (o[i] || 0) & 255; };
  if (b(0) === 0x25 && b(1) === 0x50 && b(2) === 0x44 && b(3) === 0x46) return { type: 'application/pdf', ext: '.pdf' };
  if (b(0) === 0x89 && b(1) === 0x50 && b(2) === 0x4e && b(3) === 0x47) return { type: 'image/png', ext: '.png' };
  if (b(0) === 0xff && b(1) === 0xd8 && b(2) === 0xff) return { type: 'image/jpeg', ext: '.jpg' };
  return null;
}

function nomDeFichier_(nom, ext) {
  let n = String(nom || '').split(/[\\/]/).pop().replace(/[\u0000-\u001f<>:"|?*]/g, ' ').replace(/\s+/g, ' ').replace(/^[.\s]+/, '').trim();
  n = n.replace(/\.(pdf|png|jpe?g)$/i, '').slice(0, 100).trim() || 'document';
  return n + ext;
}

function ajouterFichier_(user, articleId, nom, base64) {
  if (user.role !== 'etudiant' && user.role !== 'admin') throw err_('forbidden', 'Accès en lecture seule');
  const c = contexte_(user);
  const art = articleVisible_(user, String(articleId || ''));
  if (user.role === 'etudiant') {
    if (!articleModifiable_(user, c, art)) throw err_('forbidden', 'Réservé aux étudiants de la promo');
    // Le fichier se joint depuis sa propre fiche de lecture : il faut en avoir une sur cet article.
    if (!aFicheSurArticle_(user, art.id)) throw err_('forbidden', 'Joignez le fichier depuis votre fiche de lecture de cet article');
  }
  const b64 = String(base64 || '');
  if (!b64) throw err_('invalid', 'Fichier vide');
  if (b64.length > Math.ceil(FICHIER_MAX * 4 / 3) + 8) throw err_('invalid', 'Fichier trop volumineux (5 Mo maximum)');
  const octets = Utilities.base64Decode(b64);
  if (!octets.length) throw err_('invalid', 'Fichier vide');
  if (octets.length > FICHIER_MAX) throw err_('invalid', 'Fichier trop volumineux (5 Mo maximum)');
  const t = typeDeFichier_(octets);
  if (!t) throw err_('invalid', 'Format non accepté : PDF, PNG ou JPEG uniquement');
  if (table_(FEUILLE_FICHIERS, COL_FICHIERS).filter(function (f) { return f.article_id === art.id; }).length >= FICHIERS_PAR_ARTICLE) {
    throw err_('invalid', 'Un seul fichier par article : supprimez le fichier actuel avant d\'en ajouter un autre');
  }
  const id = Utilities.getUuid();
  const nomFinal = nomDeFichier_(nom, t.ext);
  const fichier = dossierFichiers_().createFile(Utilities.newBlob(octets, t.type, id + ' - ' + nomFinal));
  const f = { id: id, article_id: art.id, drive_id: fichier.getId(), nom: nomFinal, type: t.type, taille: octets.length,
    cree_par: user.email, cree_le: new Date().toISOString() };
  feuilleDe_(FEUILLE_FICHIERS, COL_FICHIERS).appendRow(COL_FICHIERS.map(function (k) { return f[k]; }));
}

function fichierVisible_(user, id) {
  const f = table_(FEUILLE_FICHIERS, COL_FICHIERS).filter(function (x) { return x.id === String(id || ''); })[0];
  if (!f) throw err_('not_found', 'Fichier introuvable');
  articleVisible_(user, f.article_id);          // mêmes droits que l'article
  return f;
}

// Le contenu passe par le script : un fichier n'a jamais de lien public.
function lireFichier_(user, id) {
  const f = fichierVisible_(user, id);
  let octets;
  try { octets = DriveApp.getFileById(f.drive_id).getBlob().getBytes(); }
  catch (e) { throw err_('not_found', 'Fichier introuvable dans le Drive'); }
  return { nom: f.nom, type: f.type, data: Utilities.base64Encode(octets) };
}

// Vrai si la personne est propriétaire d'une fiche de lecture sur cet article.
function aFicheSurArticle_(user, articleId, lectures) {
  return (lectures || lireTable_(feuilleLectures_(), COLONNES)).some(function (r) { return r.article_id === articleId && r.owner === user.email; });
}

function supprimerFichier_(user, id) {
  const f = fichierVisible_(user, id);
  // Le fichier appartient à l'article : tout propriétaire d'une fiche sur cet article peut le gérer (supprimer, donc remplacer),
  // quel que soit celui qui l'a déposé ; l'administrateur aussi.
  if (user.role !== 'admin' && f.cree_par !== user.email && !aFicheSurArticle_(user, f.article_id)) throw err_('forbidden', 'Réservé aux auteurs d’une fiche de lecture sur ce document (ou à l’administrateur)');
  try { DriveApp.getFileById(f.drive_id).setTrashed(true); } catch (e) { /* déjà absent du Drive */ }
  feuilleDe_(FEUILLE_FICHIERS, COL_FICHIERS).deleteRow(f._row);
}

// Un article qui disparaît emporte ses fichiers (corbeille Drive).
function retirerFichiersArticle_(articleId) {
  const sh = feuilleDe_(FEUILLE_FICHIERS, COL_FICHIERS);
  lireTable_(sh, COL_FICHIERS).filter(function (f) { return f.article_id === articleId; })
    .sort(function (a, b) { return b._row - a._row; })
    .forEach(function (f) {
      try { DriveApp.getFileById(f.drive_id).setTrashed(true); } catch (e) { /* déjà absent */ }
      sh.deleteRow(f._row);
    });
}


function err_(code, message) {
  const e = new Error(message);
  e.code = code;
  return e;
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
