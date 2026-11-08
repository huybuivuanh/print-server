const express = require("express");
const { CONFIG } = require("./config");
const { db, biz } = require("./firestore");
const { printOrder, openCashDrawer } = require("./printer");

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
const DRAWER_JOB = "cashDrawer";

// ========== QUEUE PROCESSING ==========
async function processQueue() {
  if (isPrinting || printQueue.length === 0) return;

  isPrinting = true;
  const order = printQueue.shift();

  // Cash drawer kicks share this queue so they never hit the USB printer mid-receipt.
  if (order.kind === DRAWER_JOB) {
    try {
      await openCashDrawer();
      console.log("💵 Cash drawer opened");
    } catch (error) {
      console.error("❌ Failed to open cash drawer:", error?.message || error);
    } finally {
      isPrinting = false;
      processQueue();
    }
    return;
  }

  try {
    // Prefer timestamps (and any missing fields) from the canonical order doc.
    // printQueue docs are often created "now", so their createdAt may not reflect
    // the original order time.
    try {
      if (order?.id && order?.orderType) {
        const collectionName =
          order.orderType === CONFIG.ORDER_TYPES.DINE_IN
            ? "dineInOrders"
            : "takeOutOrders";
        const orderRef = biz(collectionName).doc(order.id);
        const orderDoc = await orderRef.get();

        if (orderDoc.exists) {
          const orderData = orderDoc.data();
          // Only override if the canonical doc has these fields.
          if (orderData?.createdAt) order.createdAt = orderData.createdAt;
          if (orderData?.orderedAt) order.orderedAt = orderData.orderedAt;
        }
      }
    } catch (enrichErr) {
      console.warn(
        "⚠️ Failed to enrich order timestamp from Firestore:",
        enrichErr?.message || enrichErr,
      );
    }

    console.log("Printing order:", order.id);

    if (order.orderType === CONFIG.ORDER_TYPES.TAKE_OUT) {
      for (const lane of CONFIG.TAKEOUT_PRINT_LANES) {
        await printOrder(order, lane);
      }
    } else {
      await printOrder(order, "");
    }

    console.log("✅ Print completed for order:", order.id);

    if (!order.printId) {
      console.warn(
        `No printId for order ${order.id}; skipping Firestore printed flags (Partial Order)`,
      );
    } else {
      const collectionName =
        order.orderType === CONFIG.ORDER_TYPES.DINE_IN
          ? "dineInOrders"
          : "takeOutOrders";

      const orderRef = biz(collectionName).doc(order.id);
      const queueRef = biz("printQueue").doc(order.printId);
      const orderDoc = await orderRef.get();

      const batch = db.batch();
      if (orderDoc.exists) {
        batch.update(orderRef, { printed: true });
      } else {
        console.log(
          `⚠️ Order ${order.id} not found in ${collectionName} (Partial Order)`,
        );
      }
      batch.update(queueRef, { printed: true });
      await batch.commit();
      console.log(
        `✅ Marked print queue and order ${order.id} as printed in Firestore`,
      );
    }
  } catch (error) {
    console.error(
      "❌ Print or Firestore update failed for order:",
      order.id,
      error,
    );
  } finally {
    isPrinting = false;
    processQueue();
  }
}

// ========== FIRESTORE LISTENER ==========
function startSnapshotListenerWithRetry(
  retryDelay = CONFIG.FIRESTORE.RETRY_DELAY,
) {
  async function connect() {
    try {
      console.log("Attempting Firestore connection...");

      biz("printQueue").onSnapshot(
        (snapshot) => {
          if (snapshot.empty) return;

          snapshot.docChanges().forEach((change) => {
            if (change.type === "removed") return;

            const order = change.doc.data();
            if (!order || order.printed === true) return;

            order.printId = change.doc.id;

            const alreadyQueued = printQueue.some(
              (o) => o.printId === order.printId,
            );
            if (alreadyQueued) return;

            console.log("New order detected:", order.id || order.printId);
            printQueue.push(order);
            processQueue();
          });
        },
        (error) => {
          console.error("Firestore listener error:", error.message);
          console.log(`Retrying in ${retryDelay / 1000}s...`);
          setTimeout(connect, retryDelay);
        },
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

// ========== CASH DRAWER LISTENER ==========
// The POS sets { openDrawer: true, requestedAt } on cashDrawer/main.
// We reset openDrawer to false, then kick the drawer only if the request is fresh,
// so a request queued while the tablet or this server was offline never pops it late.
function startCashDrawerListenerWithRetry(
  retryDelay = CONFIG.FIRESTORE.RETRY_DELAY,
) {
  const { COLLECTION, DOC_ID, MAX_AGE_MS } = CONFIG.CASH_DRAWER;
  const drawerRef = biz(COLLECTION).doc(DOC_ID);

  async function handleSnapshot(snap) {
    const data = snap.exists ? snap.data() : null;
    if (!data || data.openDrawer !== true) return;

    // Only reset if the doc hasn't changed since this snapshot; if the POS sent
    // a newer request in between, this fails and the next snapshot handles it.
    try {
      await drawerRef.update(
        { openDrawer: false },
        { lastUpdateTime: snap.updateTime },
      );
    } catch {
      return;
    }

    const requestedMs = data.requestedAt?.toMillis?.();
    const ageMs = requestedMs ? Date.now() - requestedMs : Infinity;
    // abs() allows for a tablet clock that runs a little ahead of this machine.
    if (Math.abs(ageMs) > MAX_AGE_MS) {
      console.log(
        `⏭️  Skipped stale cash drawer request (${Math.round(ageMs / 1000)}s old)`,
      );
      return;
    }

    // Jump ahead of receipts: someone is standing at the till waiting.
    printQueue.unshift({ kind: DRAWER_JOB });
    processQueue();
  }

  function connect() {
    drawerRef.onSnapshot(
      (snap) => {
        handleSnapshot(snap).catch((err) =>
          console.error("Cash drawer handler error:", err?.message || err),
        );
      },
      (error) => {
        console.error("Cash drawer listener error:", error.message);
        console.log(`Retrying in ${retryDelay / 1000}s...`);
        setTimeout(connect, retryDelay);
      },
    );
    console.log("✅ Cash drawer listener connected!");
  }

  connect();
}

// ========== SERVER STARTUP ==========
app.listen(CONFIG.SERVER.port, CONFIG.SERVER.host, () => {
  console.log(
    `🖨️  Print server running on ${CONFIG.SERVER.host}:${CONFIG.SERVER.port}`,
  );
  startSnapshotListenerWithRetry();
  startCashDrawerListenerWithRetry();
});
