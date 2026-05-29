const admin = require("firebase-admin");
const serviceAccount = require("./admin-sdk.json");

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const db = admin.firestore();

module.exports = { db };

// const admin = require("firebase-admin");
// const { getFirestore } = require("firebase-admin/firestore");
// const serviceAccount = require("./admin-sdk.json");

// const app = admin.initializeApp({
//   credential: admin.credential.cert(serviceAccount),
// });

// const db = getFirestore(app, "demo");

// module.exports = { db };
