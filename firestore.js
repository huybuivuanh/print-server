const admin = require("firebase-admin");
const serviceAccount = require("./admin-sdk.json");
const { CONFIG } = require("./config");

// Shared asianlepos project: every business's data is under businesses/{id}/…
// This server only works with its own business (CONFIG.BUSINESS_ID).
if (!CONFIG.BUSINESS_ID) {
  console.error(
    "CONFIG.BUSINESS_ID is empty. Set it in config.js to this restaurant's businesses/{id} doc id.",
  );
  process.exit(1);
}

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const db = admin.firestore();

/** A collection inside this server's business, e.g. biz("printQueue"). */
const biz = (name) => db.collection(`businesses/${CONFIG.BUSINESS_ID}/${name}`);

module.exports = { db, biz };
