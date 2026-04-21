const admin = require("firebase-admin");
const { getFirestore } = require("firebase-admin/firestore");
const serviceAccount = require("./admin-sdk.json");

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const databaseId = "asian-le-pos-database";
const db = databaseId ? getFirestore(admin.app(), databaseId) : getFirestore(admin.app());

module.exports = { db };