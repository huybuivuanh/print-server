const express = require("express");
const { CONFIG } = require("./config");
const { db } = require("./firestore");
const { printOrder } = require("./printer");

const app = express();

// ========== MIDDLEWARE ==========
app.use((req, res, next) => {
  const token = req.headers["x-auth-token"];
  if (token !== CONFIG.AUTH_TOKEN) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  next();
});

app.use(express.json());

// ========== PRINT QUEUE ==========
const printQueue = [];
let isPrinting = false;

// ========== QUEUE PROCESSING ==========
async function processQueue() {
  if (isPrinting || printQueue.length === 0) return;

  isPrinting = true;
  const order = printQueue.shift();
  let printSucceeded = false;

  try {
    console.log("Printing order:", order.id);

    if (order.orderType === CONFIG.ORDER_TYPES.TAKE_OUT) {
      const kitchens = [CONFIG.KITCHEN_TYPES.B, CONFIG.KITCHEN_TYPES.A];
      for (const kitchen of kitchens) {
        await printOrder(order, kitchen);
      }
    } else {
      await printOrder(order, "");
    }

    printSucceeded = true;
    console.log("✅ Print completed for order:", order.id);

    try {
      const collectionName =
        order.orderType === CONFIG.ORDER_TYPES.DINE_IN
          ? "dineInOrders"
          : "takeOutOrders";

      const orderRef = db.collection(collectionName).doc(order.id);
      const orderDoc = await orderRef.get();

      if (orderDoc.exists) {
        await orderRef.update({
          printed: true,
        });
        console.log(`✅ Marked order ${order.id} as printed in Firestore`);
      } else {
        console.log(
          `⚠️ Order ${order.id} not found in ${collectionName} (may be from order history)`
        );
      }
    } catch (updateError) {
      console.error(
        `Error updating Firestore for order ${order.id}:`,
        updateError.message || updateError
      );
    }
  } catch (error) {
    console.error("❌ Print failed for order:", order.id, error);
  } finally {
    try {
      if (order.printId) {
        await db.collection("printQueue").doc(order.printId).delete();
        console.log(
          printSucceeded
            ? `✅ Removed order ${order.id} from print queue (printed successfully)`
            : `⚠️ Removed order ${order.id} from print queue (print failed)`
        );
      }
    } catch (deleteError) {
      console.error(
        "Error deleting from print queue:",
        deleteError.message || deleteError
      );
    }

    isPrinting = false;
    processQueue();
  }
}

// ========== FIRESTORE LISTENER ==========
function startSnapshotListenerWithRetry(
  retryDelay = CONFIG.FIRESTORE.RETRY_DELAY
) {
  async function connect() {
    try {
      console.log("Attempting Firestore connection...");

      db.collection("printQueue").onSnapshot(
        (snapshot) => {
          if (snapshot.empty) {
            console.log("No unprinted orders in snapshot");
            return;
          }

          snapshot.docChanges().forEach((change) => {
            const order = change.doc.data();
            order.printId = change.doc.id;

            if (order) {
              console.log("New order detected:", order.id || order.printId);
              printQueue.push(order);
              processQueue();
            }
          });
        },
        (error) => {
          console.error("Firestore listener error:", error.message);
          console.log(`Retrying in ${retryDelay / 1000}s...`);
          setTimeout(connect, retryDelay);
        }
      );

      console.log("✅ Firestore listener connected!");
    } catch (err) {
      console.error("Failed to connect to Firestore:", err.message);
      console.log(`Retrying in ${retryDelay / 1000}s...`);
      setTimeout(connect, retryDelay);
    }
  }

  connect();
}

// ========== SERVER STARTUP ==========
app.listen(CONFIG.SERVER.port, CONFIG.SERVER.host, () => {
  console.log(
    `🖨️  Print server running on ${CONFIG.SERVER.host}:${CONFIG.SERVER.port}`
  );
  startSnapshotListenerWithRetry();
});
