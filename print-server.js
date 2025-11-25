const express = require("express");
const {
  ThermalPrinter,
  PrinterTypes,
  CharacterSet,
  BreakLine,
} = require("node-thermal-printer");

const admin = require("firebase-admin");
const serviceAccount = require("./asianlepos-firebase-adminsdk-fbsvc-f7068ecfc2.json");

// ========== CONFIGURATION ==========
const CONFIG = {
  AUTH_TOKEN: "Asianlerestaurant7799",
  PRINTER: {
    type: PrinterTypes.EPSON,
    interface: "/dev/usb/lp0",
    width: 48,
    characterSet: CharacterSet.PC852_LATIN2,
    removeSpecialCharacters: false,
    lineCharacter: "-",
    breakLine: BreakLine.WORD,
  },
  TAX: {
    PST_RATE: 0.06,
    GST_RATE: 0.05,
  },
  RESTAURANT: {
    name: "Asian Le Restaurant",
    address: "3-1400 6th Ave E",
    phone: "306-764-7799",
  },
  SERVER: {
    port: 3000,
    host: "127.0.0.1",
  },
  FIRESTORE: {
    RETRY_DELAY: 5000,
  },
  KITCHEN_TYPES: {
    A: "A",
    B: "B",
    C: "C",
    Z: "Z",
  },
  ORDER_TYPES: {
    DINE_IN: "Dine In",
    TAKE_OUT: "Take Out",
  },
  OPTION_NAMES: {
    EGG_ROLL: "Egg Roll",
    SPRING_ROLL: "Spring Roll",
    RICE: "Rice",
    NOODLES: "Noodles",
  },
  SPECIAL_ITEM: "#3",
};

// ========== INITIALIZATION ==========
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const db = admin.firestore();
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

// ========== UTILITY FUNCTIONS ==========
/**
 * Formats a phone number string
 * @param {string} phone - Phone number string
 * @returns {string} Formatted phone number
 */
function formatPhone(phone) {
  if (!phone) return "";
  const digits = phone.replace(/\D/g, "");

  if (digits.length > 7) {
    // Has area code: (306) 764-7799
    return `${digits.slice(0, -7)} ${digits.slice(-7, -4)}-${digits.slice(-4)}`;
  } else {
    // No area code: 764-7799
    return `${digits.slice(0, -4)}-${digits.slice(-4)}`;
  }
}

function toDateMaybe(ts) {
  if (!ts) return null;

  // Firestore Timestamp object
  if (typeof ts.toDate === "function") {
    return ts.toDate();
  }

  // Plain object version
  if (typeof ts.seconds === "number") {
    return new Date(ts.seconds * 1000 + Math.floor(ts.nanoseconds / 1e6));
  }

  return null;
}

/**
 * Formats a date to locale string
 * @param {Date} date - Date object
 * @param {object} options - Intl.DateTimeFormat options
 * @returns {string} Formatted date string
 */
function formatDate(date, options) {
  if (!date) return "";
  return date.toLocaleString("en-CA", options);
}

/**
 * Creates a new thermal printer instance
 * @returns {ThermalPrinter} Configured printer instance
 */
function createPrinter() {
  return new ThermalPrinter(CONFIG.PRINTER);
}

// ========== ITEM PREPROCESSING ==========
/**
 * Processes item options and creates display name
 * @param {object} item - Order item
 * @returns {object} Processed item with display name
 */
function preprocessOrderItem(item) {
  const processed = { ...item };

  if (!Array.isArray(processed.options) || processed.options.length === 0) {
    processed.displayName =
      processed.quantity > 1
        ? `${processed.quantity}x ${processed.name}`
        : processed.name;
    return processed;
  }

  // Special case for #3: find main option (non-egg-roll, non-spring-roll)
  if (processed.name === CONFIG.SPECIAL_ITEM) {
    const mainOption = processed.options.find(
      (opt) =>
        opt.name !== CONFIG.OPTION_NAMES.EGG_ROLL &&
        opt.name !== CONFIG.OPTION_NAMES.SPRING_ROLL
    );

    if (mainOption) {
      processed.name = `${processed.name}/${mainOption.name}`;
      processed.options = processed.options.filter((opt) => opt !== mainOption);
    }
  }

  // Handle Egg Roll / Spring Roll (skip if quantity > 1)
  const eggSpringOption = processed.options.find(
    (opt) =>
      (opt.name === CONFIG.OPTION_NAMES.EGG_ROLL ||
        opt.name === CONFIG.OPTION_NAMES.SPRING_ROLL) &&
      (!opt.quantity || opt.quantity <= 1)
  );

  if (eggSpringOption) {
    const abbreviation =
      eggSpringOption.name === CONFIG.OPTION_NAMES.EGG_ROLL ? "ER" : "SP";
    processed.name = `${processed.name}/${abbreviation}`;
    processed.options = processed.options.filter(
      (opt) => opt !== eggSpringOption
    );
  }

  // Handle Rice / Noodles
  const riceNoodleOption = processed.options.find(
    (opt) =>
      opt.name === CONFIG.OPTION_NAMES.RICE ||
      opt.name === CONFIG.OPTION_NAMES.NOODLES
  );

  if (riceNoodleOption) {
    const abbreviation =
      riceNoodleOption.name === CONFIG.OPTION_NAMES.RICE ? "Rice" : "ND";
    processed.name = `${processed.name}/${abbreviation}`;
    processed.options = processed.options.filter(
      (opt) => opt !== riceNoodleOption
    );
  }

  // Create display name
  processed.displayName =
    processed.quantity > 1
      ? `${processed.quantity}x ${processed.name}`
      : processed.name;

  return processed;
}

/**
 * Preprocesses all order items
 * @param {Array} orderItems - Array of order items
 * @returns {Array} Array of processed items
 */
function preprocessOrderItems(orderItems) {
  if (!Array.isArray(orderItems)) return [];
  return orderItems.map(preprocessOrderItem);
}

/**
 * Groups items by kitchen type and category
 * @param {Array} items - Processed order items
 * @param {boolean} excludeTogo - Whether to exclude to-go items from grouping
 * @returns {Array} Array of grouped sections
 */
function groupItemsByKitchen(items, excludeTogo = false) {
  const appetizers = items.filter((item) => item.appetizer);

  const filterByKitchen = (kitchenType) => (item) =>
    item.kitchenType === kitchenType && !item.appetizer && !item.togo;

  const kitchenA = items.filter(filterByKitchen(CONFIG.KITCHEN_TYPES.A));
  const kitchenB = items.filter(filterByKitchen(CONFIG.KITCHEN_TYPES.B));
  const kitchenZ = items.filter(filterByKitchen(CONFIG.KITCHEN_TYPES.Z));
  const kitchenC = items.filter(filterByKitchen(CONFIG.KITCHEN_TYPES.C));

  const sections = [
    { label: "Appetizers", items: appetizers },
    { label: "Kitchen A", items: kitchenA },
    { label: "Kitchen Z", items: kitchenZ },
    { label: "Kitchen B", items: kitchenB },
    { label: "Kitchen C", items: kitchenC },
  ];

  // Only include to-go items if not excluding them
  if (!excludeTogo) {
    const togoItems = items.filter((item) => item.togo && !item.appetizer);
    sections.push({ label: "Togo Items", items: togoItems });
  }

  return sections.filter((section) => section.items.length > 0);
}

/**
 * Gets to-go items from processed items
 * @param {Array} items - Processed order items
 * @returns {Array} Array of to-go items
 */
function getTogoItems(items) {
  return items.filter((item) => item.togo && !item.appetizer);
}

/**
 * Calculates the total price of to-go items
 * @param {Array} togoItems - Array of to-go items
 * @returns {number} Total price of to-go items
 */
function calculateTogoTotal(togoItems) {
  if (!Array.isArray(togoItems) || togoItems.length === 0) return 0;

  return togoItems.reduce((total, item) => {
    let itemTotal = (item.price || 0) * (item.quantity || 1);

    // Add options prices
    if (item.options?.length > 0) {
      itemTotal += item.options.reduce(
        (optTotal, opt) => optTotal + (opt.price || 0),
        0
      );
    }

    // Add extras prices
    if (item.extras?.length > 0) {
      itemTotal += item.extras.reduce(
        (extraTotal, extra) => extraTotal + (extra.price || 0),
        0
      );
    }

    // Add changes prices
    if (item.changes?.length > 0) {
      itemTotal += item.changes.reduce(
        (chgTotal, chg) => chgTotal + (chg.price || 0),
        0
      );
    }

    return total + itemTotal;
  }, 0);
}

// ========== PRINTER FORMATTING HELPERS ==========
/**
 * Prints section header
 * @param {ThermalPrinter} printer - Printer instance
 * @param {string} title - Section title
 */
function printSectionHeader(printer, title) {
  printer.alignCenter();
  printer.setTextQuadArea();
  printer.bold(true);
  printer.println(`---- ${title} ----`);
  printer.alignLeft();
  printer.setTextNormal();
  printer.newLine();
}

/**
 * Prints restaurant header
 * @param {ThermalPrinter} printer - Printer instance
 */
function printRestaurantHeader(printer, order) {
  if (order.paid) {
    printer.alignCenter();
    printer.setTextSize(2, 2);
    printer.println("Paid");
    printer.newLine();
  }
  printer.alignCenter();
  printer.setTextQuadArea();
  printer.bold(true);
  printer.println(CONFIG.RESTAURANT.name);
  printer.newLine();
}

/**
 * Prints order type header
 * @param {ThermalPrinter} printer - Printer instance
 * @param {object} order - Order object
 * @param {string} kitchen - Kitchen identifier
 */
function printOrderTypeHeader(printer, order, kitchen) {
  printer.setTextSize(2, 2);
  printer.bold(false);

  if (order.orderType === CONFIG.ORDER_TYPES.TAKE_OUT && !order.isPreorder) {
    printer.println(`*Take Out ${kitchen}*`);
    printer.newLine();
  } else if (order.tableNumber) {
    printer.println(`Table: ${order.tableNumber}`);
  }
}

/**
 * Prints preorder information
 * @param {ThermalPrinter} printer - Printer instance
 * @param {object} order - Order object
 * @param {string} kitchen - Kitchen identifier
 */
function printPreorderInfo(printer, order, kitchen) {
  if (!order.isPreorder) return;

  printer.setTextQuadArea();
  printer.println(`***Pre-Order ${kitchen}***`);

  if (order.preorderTime) {
    const preorderDate = order.preorderTime.toDate();
    printer.println(
      formatDate(preorderDate, {
        year: "numeric",
        month: "short",
        day: "numeric",
      })
    );
    printer.println(
      formatDate(preorderDate, {
        weekday: "short",
        hour: "2-digit",
        minute: "2-digit",
        hour12: true,
      })
    );
  } else {
    printer.newLine();
    printer.newLine();
  }

  printer.setTextNormal();
}

/**
 * Prints order details (staff, guests, time, etc.)
 * @param {ThermalPrinter} printer - Printer instance
 * @param {object} order - Order object
 */
function printOrderDetails(printer, order) {
  printer.setTextNormal();
  printer.alignLeft();

  if (order.staff?.name) {
    printer.println(`Staff: ${order.staff.name}`);
  }

  if (order.orderType === CONFIG.ORDER_TYPES.DINE_IN && order.guests) {
    printer.println(`Guests: ${order.guests.toString()}`);
  }

  if (order.createdAt) {
    const orderDate = toDateMaybe(order.createdAt);
    const timeString = formatDate(orderDate, {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: true,
    });
    printer.println(`Ordered At: ${timeString}`);
  }

  if (
    !order.isPreorder &&
    order.readyTime &&
    order.orderType !== CONFIG.ORDER_TYPES.DINE_IN
  ) {
    printer.println(`Ready in: ${order.readyTime} mins`);
  }

  printer.setTextQuadArea();
  printer.bold(false);

  if (order.orderType === CONFIG.ORDER_TYPES.TAKE_OUT) {
    if (order.name) {
      printer.println(`Customer: ${order.name}`);
    }
    if (order.phoneNumber) {
      printer.println(`Phone: ${formatPhone(order.phoneNumber)}`);
    }
  }

  printer.setTextNormal();
  printer.println("--------------------------------");
}

/**
 * Prints an order item with options, extras, and changes
 * @param {ThermalPrinter} printer - Printer instance
 * @param {object} item - Order item
 */
function printOrderItem(printer, item) {
  const itemTotal = (item.price * item.quantity).toFixed(2);

  // Item name
  printer.alignLeft();
  printer.bold(true);
  printer.setTextQuadArea();
  printer.println(item.displayName);
  printer.newLine();
  printer.setTextNormal();
  printer.bold(true);

  // Options
  if (item.options?.length > 0) {
    item.options.forEach((opt) => {
      const optName =
        opt.quantity > 1 ? `${opt.quantity}x ${opt.name}` : opt.name;

      const optPrice = opt.price
        ? opt.quantity
          ? `+$${(opt.price * opt.quantity).toFixed(2)}`
          : `+$${opt.price.toFixed(2)}`
        : "";
      printer.leftRight(`   • ${optName}`, optPrice);
      printer.newLine();
    });
  }

  // Extras
  if (item.extras?.length > 0) {
    item.extras.forEach((extra) => {
      printer.leftRight(
        `   + Add Extra: ${extra.description.toUpperCase()}`,
        extra.price > 0 ? `+$${extra.price.toFixed(2)}` : ""
      );
      printer.newLine();
    });
  }

  // Changes
  if (item.changes?.length > 0) {
    item.changes.forEach((chg) => {
      printer.leftRight(
        `   + Change: ${chg.from.toUpperCase()} -->> ${chg.to.toUpperCase()}`,
        chg.price > 0 ? `+$${chg.price.toFixed(2)}` : ""
      );
      printer.newLine();
    });
  }

  // Special instructions
  if (item.instructions) {
    printer.println(`   * Note: "${item.instructions}"`.toUpperCase());
  }

  // Item total
  printer.alignRight();
  printer.setTextNormal();
  printer.bold(true);
  printer.println(itemTotal > 0 ? `$${itemTotal}` : "");
  printer.setTextNormal();
}

/**
 * Prints order items grouped by sections
 * @param {ThermalPrinter} printer - Printer instance
 * @param {Array} groupedSections - Array of grouped sections
 */
function printOrderItems(printer, groupedSections) {
  groupedSections.forEach((section) => {
    // Print section header for special sections
    if (section.label === "Togo Items") {
      printSectionHeader(printer, "TO GO");
    } else if (section.label === "Appetizers") {
      printSectionHeader(printer, "Appetizers");
    }

    // Print items in section
    section.items.forEach((item) => printOrderItem(printer, item));

    // Print separator after appetizers
    if (section.label === "Appetizers") {
      printer.setTextNormal();
      printer.alignLeft();
      printer.bold(true);
      printer.println("--------------------------------");
    }
  });
}

/**
 * Prints order totals
 * @param {ThermalPrinter} printer - Printer instance
 * @param {object} order - Order object
 */
function printTotals(printer, order) {
  printer.println("--------------------------------");
  printer.alignRight();

  const subtotal = order.total || 0;
  const pst = subtotal * CONFIG.TAX.PST_RATE;
  const gst = subtotal * CONFIG.TAX.GST_RATE;
  const grandTotal = subtotal + pst + gst;

  printer.bold(false);
  printer.println(`Subtotal: $${subtotal.toFixed(2)}`);
  printer.println(`PST (6%): $${pst.toFixed(2)}`);
  printer.println(`GST (5%): $${gst.toFixed(2)}`);
  printer.println(`----------------------------`);
  printer.setTextQuadArea();
  printer.println(`TOTAL: $${grandTotal.toFixed(2)}`);
  printer.setTextNormal();
  printer.newLine();
}

/**
 * Prints restaurant footer
 * @param {ThermalPrinter} printer - Printer instance
 * @param {object} order - Order object
 * @param {string} kitchen - Kitchen identifier
 */
function printFooter(printer, order, kitchen) {
  printer.alignCenter();
  printer.underline(true);
  printer.println("Thank you! Please come again!");
  printer.println(CONFIG.RESTAURANT.address);
  printer.println(CONFIG.RESTAURANT.phone);
  printer.underline(false);
  printer.newLine();

  printer.setTextSize(2, 2);
  printer.bold(false);

  if (order.orderType === CONFIG.ORDER_TYPES.TAKE_OUT) {
    const label = order.isPreorder ? "Pre-Order" : "Take Out";
    printer.println(`*${label} ${kitchen}*`);
  } else if (order.tableNumber) {
    printer.println(`Table: ${order.tableNumber}`);
  }

  printer.newLine();
}

/**
 * Prints a simplified to-go ticket
 * @param {ThermalPrinter} printer - Printer instance
 * @param {object} order - Order object
 * @param {Array} togoItems - Array of to-go items
 */
function printTogoTicket(printer, order, togoItems) {
  // Restaurant name
  printer.alignCenter();
  printer.setTextQuadArea();
  printer.bold(true);
  printer.println(CONFIG.RESTAURANT.name);
  printer.newLine();

  // Table number
  if (order.tableNumber) {
    printer.setTextSize(2, 2);
    printer.bold(false);
    printer.println(`TO GO: ${order.tableNumber}`);
    printer.newLine();
  }

  printer.setTextNormal();
  printer.println("--------------------------------");

  // Print to-go items
  printer.alignLeft();
  togoItems.forEach((item) => printOrderItem(printer, item));

  // Print totals (only for to-go items)
  printer.println("--------------------------------");
  printer.alignRight();

  const togoSubtotal = calculateTogoTotal(togoItems);
  const pst = togoSubtotal * CONFIG.TAX.PST_RATE;
  const gst = togoSubtotal * CONFIG.TAX.GST_RATE;
  const grandTotal = togoSubtotal + pst + gst;

  printer.bold(false);
  printer.println(`Subtotal: $${togoSubtotal.toFixed(2)}`);
  printer.println(`PST (6%): $${pst.toFixed(2)}`);
  printer.println(`GST (5%): $${gst.toFixed(2)}`);
  printer.println(`----------------------------`);
  printer.setTextQuadArea();
  printer.println(`TOTAL: $${grandTotal.toFixed(2)}`);
  printer.setTextNormal();
  printer.newLine();
  printer.newLine();
}

// ========== PRINT ORDER ==========
/**
 * Prints an order to the thermal printer
 * @param {object} order - Order object
 * @param {string} kitchen - Kitchen identifier (A, B, or empty string)
 * @throws {Error} If printer is not connected or print fails
 */
async function printOrder(order, kitchen) {
  const printer = createPrinter();

  try {
    const isConnected = await printer.isPrinterConnected();
    if (!isConnected) {
      throw new Error("Printer not connected");
    }

    // Process and group items
    const processedItems = preprocessOrderItems(order.orderItems);
    const groupedSections = groupItemsByKitchen(processedItems);

    // Print receipt sections
    printRestaurantHeader(printer, order);
    printOrderTypeHeader(printer, order, kitchen);
    printPreorderInfo(printer, order, kitchen);
    printOrderDetails(printer, order);
    printOrderItems(printer, groupedSections);
    printTotals(printer, order);
    printFooter(printer, order, kitchen);

    // Execute print
    printer.cut();
    await printer.execute();
  } catch (error) {
    console.error("Print error:", error);
    throw error;
  }
}

// ========== QUEUE PROCESSING ==========
/**
 * Processes the print queue
 */
async function processQueue() {
  if (isPrinting || printQueue.length === 0) return;

  isPrinting = true;
  const order = printQueue.shift();
  let printSucceeded = false;

  try {
    console.log("Printing order:", order.id);

    if (order.orderType === CONFIG.ORDER_TYPES.TAKE_OUT) {
      // Print to both Kitchen A and B for take-out orders
      const kitchens = [CONFIG.KITCHEN_TYPES.B, CONFIG.KITCHEN_TYPES.A];
      for (const kitchen of kitchens) {
        await printOrder(order, kitchen);
      }
    } else {
      await printOrder(order, "");
    }

    printSucceeded = true;
    console.log("✅ Print completed for order:", order.id);

    // Update Firestore - mark as printed only if successful
    // Handle case where order might not exist (e.g., printed from order history)
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
      // Don't throw - printing succeeded, just couldn't update Firestore
    }
  } catch (error) {
    console.error("❌ Print failed for order:", order.id, error);
  } finally {
    // Always delete from print queue to avoid reprinting, even if print failed
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
/**
 * Starts Firestore snapshot listener with retry logic
 * @param {number} retryDelay - Delay in milliseconds before retrying connection
 */
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
