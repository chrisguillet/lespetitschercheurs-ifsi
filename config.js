// Configuration publique du front (aucun secret ici).
window.LYDIA_CONFIG = {
  // Identifiant client OAuth (type « Application Web ») créé dans Google Cloud.
  GOOGLE_CLIENT_ID: "557849535071-guof3g587alo4q0ha6876039lq1hs2ed.apps.googleusercontent.com",
  // URL de déploiement de l'application web Apps Script (se termine par /exec).
  API_URL: "https://script.google.com/macros/s/AKfycbwgDDMZFvHH8SqGNb4iJfzJOgG3VsxwCbK8Bf-rSg__nDwNfo0jwZt9g13b56p6yidTXQ/exec",
  // Rafraîchissement automatique du tableau, en secondes (0 = désactivé).
  REFRESH_SECONDS: 45,
  // Affichés dans la politique de confidentialité (privacy.html).
  RESPONSABLE: "Lydia Ripoche (projet) et Christophe Guillet (technique)",
  CONTACT: "guillet.ripoche@gmail.com",
  // Mesure d'audience GoatCounter (sans cookie, asynchrone) ; retirer la ligne pour la désactiver.
  GOATCOUNTER: "https://chrisguillet.goatcounter.com/count"
};
