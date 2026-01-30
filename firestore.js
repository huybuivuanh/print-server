const admin = require("firebase-admin");
const serviceAccount = require("./asianlepos-firebase-adminsdk-fbsvc-97798208bf.json");

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const db = admin.firestore();

module.exports = { db };
