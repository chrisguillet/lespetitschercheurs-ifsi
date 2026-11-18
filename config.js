// Configuration publique du front (aucun secret ici).
window.LYDIA_CONFIG = {
  // Identifiant client OAuth (type « Application Web ») créé dans Google Cloud.
  GOOGLE_CLIENT_ID: "REMPLACER.apps.googleusercontent.com",
  // URL de déploiement de l'application web Apps Script (se termine par /exec).
  API_URL: "https://script.google.com/macros/s/REMPLACER/exec",
  // Rafraîchissement automatique du tableau, en secondes (0 = désactivé).
  REFRESH_SECONDS: 20
};
