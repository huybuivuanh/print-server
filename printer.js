const {
  ThermalPrinter,
  PrinterTypes,
  CharacterSet,
  BreakLine,
} = require("node-thermal-printer");
const { CONFIG } = require("./config");
const { formatPhone, toDateMaybe, formatDate } = require("./utils");
const {
  groupItemsByKitchen,
  getOrderTotals,
  preprocessOrderItems,
} = require("./orderItems");
const { groupOrderItemsBySignature } = require("./orderItemGrouping");
const fs = require("fs");
const path = require("path");
const { PNG } = require("pngjs");

const REVIEW_QR_PATH = path.join(__dirname, "assets", "Google Review QR.png");
const REVIEW_QR_SCALE = 2; // 132px source -> 264px (~33mm at 203dpi)

// Loads the review QR once, scaled up with nearest-neighbour so modules stay sharp.
// Returns null (and the receipt prints without the QR) if the file is missing or bad.
function loadReviewQR() {
  try {
    const src = PNG.sync.read(fs.readFileSync(REVIEW_QR_PATH));
    const s = REVIEW_QR_SCALE;
    const out = new PNG({ width: src.width * s, height: src.height * s });
    for (let y = 0; y < out.height; y++) {
      for (let x = 0; x < out.width; x++) {
        const si = (Math.floor(y / s) * src.width + Math.floor(x / s)) << 2;
        const di = (y * out.width + x) << 2;
        src.data.copy(out.data, di, si, si + 4);
      }
    }
    return PNG.sync.write(out);
  } catch (error) {
    console.error(
      `Could not load review QR (${REVIEW_QR_PATH}):`,
      error.message,
    );
    return null;
  }
}

const REVIEW_QR_PNG = loadReviewQR();

const LOGO_PATH = path.join(__dirname, "assets", "Logo.png");
const LOGO_WIDTH = 400; // printer dots (~50mm at 203dpi; 80mm paper max is 576)
// Pixels darker than this print black. The printer's own cutoff (128) drops the
// light half of the gold lettering, so use a high one: anything not near-white is ink.
const LOGO_THRESHOLD = 225;

// Crops the white/transparent margin off the logo, shrinks it to LOGO_WIDTH by
// averaging, and converts it to pure black/white. Returns null if it can't be loaded.
function loadLogo() {
  try {
    const src = PNG.sync.read(fs.readFileSync(LOGO_PATH));
    const { width: W, height: H, data } = src;

    // Brightness as printed on white paper (transparent counts as white).
    const lum = (x, y) => {
      const i = (y * W + x) << 2;
      const a = data[i + 3] / 255;
      const c = (v) => v * a + 255 * (1 - a);
      return (
        0.2126 * c(data[i]) + 0.7152 * c(data[i + 1]) + 0.0722 * c(data[i + 2])
      );
    };

    let x0 = W,
      y0 = H,
      x1 = -1,
      y1 = -1;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        if (lum(x, y) < 245) {
          if (x < x0) x0 = x;
          if (x > x1) x1 = x;
          if (y < y0) y0 = y;
          if (y > y1) y1 = y;
        }
      }
    }
    if (x1 < 0) throw new Error("logo is blank");

    const cw = x1 - x0 + 1;
    const ch = y1 - y0 + 1;
    const ow = Math.min(LOGO_WIDTH, cw);
    const oh = Math.round((ch * ow) / cw);
    const out = new PNG({ width: ow, height: oh });

    for (let y = 0; y < oh; y++) {
      const sy0 = y0 + Math.floor((y * ch) / oh);
      const sy1 = Math.max(y0 + Math.floor(((y + 1) * ch) / oh), sy0 + 1);
      for (let x = 0; x < ow; x++) {
        const sx0 = x0 + Math.floor((x * cw) / ow);
        const sx1 = Math.max(x0 + Math.floor(((x + 1) * cw) / ow), sx0 + 1);
        let sum = 0;
        let n = 0;
        for (let sy = sy0; sy < sy1; sy++) {
          for (let sx = sx0; sx < sx1; sx++) {
            sum += lum(sx, sy);
            n++;
          }
        }
        const v = sum / n < LOGO_THRESHOLD ? 0 : 255;
        const d = (y * ow + x) << 2;
        out.data[d] = out.data[d + 1] = out.data[d + 2] = v;
        out.data[d + 3] = 255;
      }
    }
    return PNG.sync.write(out);
  } catch (error) {
    console.error(`Could not load logo (${LOGO_PATH}):`, error.message);
    return null;
  }
}

const LOGO_PNG = loadLogo();

function isScheduledTakeOut(order) {
  if (order.fulfillment?.kind === "scheduled") return true;
  return Boolean(order.isPreorder);
}

// Website orders from the Orders app (onlinePrintQueue).
function isOnlineOrder(order) {
  return order.source === "online";
}

// Online orders print like take-out: lanes, name/phone, ready time.
function isTakeOutLike(order) {
  return (
    isOnlineOrder(order) || order.orderType === CONFIG.ORDER_TYPES.TAKE_OUT
  );
}

function takeOutLabel(order) {
  return isOnlineOrder(order) ? "Online" : "Take Out";
}

function staffDisplay(order) {
  if (typeof order.staff === "string" && order.staff.trim()) {
    return order.staff.trim();
  }
  if (order.staff?.name) return order.staff.name;
  return "";
}

function takeOutCustomerName(order) {
  return order.customerName ?? order.name ?? "";
}

function scheduledPickupDate(order) {
  if (
    order.fulfillment?.kind === "scheduled" &&
    order.fulfillment.scheduledAt
  ) {
    return toDateMaybe(order.fulfillment.scheduledAt);
  }
  if (order.preorderTime) return toDateMaybe(order.preorderTime);
  return null;
}

function immediateReadyMinutes(order) {
  if (
    order.fulfillment?.kind === "immediate" &&
    order.fulfillment.readyTimeMinutes != null
  ) {
    return order.fulfillment.readyTimeMinutes;
  }
  if (order.readyTime != null) return order.readyTime;
  return null;
}

// Platform detection
const IS_WINDOWS = process.platform === "win32";
const IS_LINUX = process.platform === "linux";

// Only load USB-related modules on Windows
let escpos, escposUSB;
if (IS_WINDOWS) {
  escpos = require("escpos");
  escposUSB = require("escpos-usb");
  escpos.USB = escposUSB;
}

// Function to detect USB printer (Windows only)
function detectUSBPrinter() {
  if (!IS_WINDOWS) {
    throw new Error("USB printer detection is only available on Windows");
  }

  const printers = escpos.USB.findPrinter();

  if (!printers || printers.length === 0) {
    throw new Error(
      "No USB printers found. Make sure the printer is connected and the WinUSB driver is installed (use Zadig).",
    );
  }

  console.log(`Found ${printers.length} USB printer(s):\n`);

  const printerInfo = printers
    .map((printer, index) => {
      const vid =
        printer.deviceDescriptor?.idVendor ||
        printer.idVendor ||
        printer.vendorId ||
        printer.vid;
      const pid =
        printer.deviceDescriptor?.idProduct ||
        printer.idProduct ||
        printer.productId ||
        printer.pid;

      if (vid && pid) {
        return {
          index: index + 1,
          vid: vid,
          pid: pid,
          vidHex: `0x${vid.toString(16).toUpperCase().padStart(4, "0")}`,
          pidHex: `0x${pid.toString(16).toUpperCase().padStart(4, "0")}`,
        };
      }
      return null;
    })
    .filter((p) => p !== null);

  if (printerInfo.length === 0) {
    throw new Error("Could not extract VID/PID from detected printers.");
  }

  printerInfo.forEach((p) => {
    console.log(`  ${p.index}. VID: ${p.vidHex}, PID: ${p.pidHex}`);
  });

  const selected = printerInfo[0];
  console.log(
    `Using printer ${selected.index}: VID: ${selected.vidHex}, PID: ${selected.pidHex}\n`,
  );

  return { vid: selected.vid, pid: selected.pid };
}

function createPrinter() {
  // On Windows: use buffer interface for USB printing
  // On Linux: use direct interface path
  const printerConfig = {
    type: PrinterTypes.EPSON,
    interface: CONFIG.PRINTER.interface,
    characterSet: CharacterSet.PC852_LATIN2,
    removeSpecialCharacters: false,
    lineCharacter: "-",
    breakLine: BreakLine.WORD,
  };

  // On Linux, add width if using direct interface
  if (IS_LINUX && CONFIG.PRINTER.interface !== "buffer") {
    printerConfig.width = CONFIG.PRINTER.width;
  }

  return new ThermalPrinter(printerConfig);
}

function printSectionHeader(printer, title) {
  printer.alignCenter();
  printer.setTextQuadArea();
  printer.bold(true);
  printer.println(`---- ${title} ----`);
  printer.alignLeft();
  printer.setTextNormal();
  printer.newLine();
}

function isPaid(order) {
  return order.orderItems.every((item) => item.paid);
}

async function printRestaurantHeader(printer, order) {
  if (isPaid(order)) {
    printer.alignCenter();
    printer.setTextSize(2, 2);
    printer.println("Paid");
    printer.newLine();
  }
  printer.alignCenter();
  if (LOGO_PNG) {
    await printer.printImageBuffer(LOGO_PNG);
    printer.newLine();
  }
  // printer.setTextQuadArea();
  // printer.bold(true);
  // printer.println(CONFIG.RESTAURANT.name);
}

function printOrderTypeHeader(printer, order, kitchen) {
  printer.newLine();
  printer.setTextSize(2, 2);
  printer.bold(false);

  if (isTakeOutLike(order) && !isScheduledTakeOut(order)) {
    printer.println(`*${takeOutLabel(order)} ${kitchen}*`);
  } else if (order.tableNumber) {
    printer.println(`Table: ${order.tableNumber}`);
  }
}

function printPreorderInfo(printer, order, kitchen) {
  if (!isScheduledTakeOut(order)) return;

  printer.setTextQuadArea();
  const label = isOnlineOrder(order) ? "Online" : "Pre-Order";
  printer.println(`***${label} ${kitchen}***`);

  const preorderDate = scheduledPickupDate(order);
  if (preorderDate) {
    printer.println(
      formatDate(preorderDate, {
        year: "numeric",
        month: "short",
        day: "numeric",
      }),
    );
    printer.println(
      formatDate(preorderDate, {
        weekday: "short",
        hour: "2-digit",
        minute: "2-digit",
        hour12: true,
      }),
    );
  }

  printer.setTextNormal();
}

function printOrderDetails(printer, order) {
  printer.newLine();
  printer.setTextNormal();
  printer.alignLeft();

  const staff = staffDisplay(order);
  if (staff) {
    printer.println(`Staff: ${staff}`);
  }

  if (order.orderType === CONFIG.ORDER_TYPES.DINE_IN && order.guests) {
    printer.println(`Guests: ${order.guests.toString()}`);
  }

  const orderedAt = order.orderedAt ?? order.createdAt;
  if (orderedAt) {
    const orderDate = toDateMaybe(orderedAt);
    const timeString = formatDate(orderDate, {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: true,
    });
    if (timeString) {
      printer.println(`Ordered At: ${timeString}`);
    }
  }

  const readyMins = immediateReadyMinutes(order);
  if (isTakeOutLike(order) && !isScheduledTakeOut(order) && readyMins != null) {
    printer.println(`Ready in: ${readyMins} mins`);
  }
  if (isOnlineOrder(order)) {
    printer.println(`Order number: ${order.orderNumber}`);
  }

  printer.setTextQuadArea();
  printer.bold(false);

  if (isTakeOutLike(order)) {
    const custName = takeOutCustomerName(order);
    if (custName) {
      printer.println(`Name: ${custName.toUpperCase()}`);
    }
    if (order.phoneNumber) {
      printer.println(`Phone #: ${formatPhone(order.phoneNumber)}`);
    }
  }

  printer.setTextNormal();
  printer.println("--------------------------------");
}

function printOrderItem(printer, item, index) {
  const itemTotal = (item.price * item.quantity).toFixed(2);

  if (index > 0) {
    printer.newLine();
  }

  printer.alignLeft();
  printer.bold(true);
  printer.setTextQuadArea();
  printer.println(
    `${item.quantity > 1 ? `${item.quantity}x ` : ""}${item.name}`,
  );
  printer.setTextNormal();
  printer.bold(true);

  if (item.options?.length > 0) {
    item.options.forEach((opt) => {
      printer.newLine();
      const optName =
        opt.quantity > 1 ? `${opt.quantity}x ${opt.name}` : opt.name;

      let optPrice = "";
      if (item.kitchenType === "Drink") {
        optPrice = `${opt.quantity} x ${opt.price.toFixed(2)}`;
      } else {
        if (opt.quantity > 1 && opt.price > 0) {
          optPrice = `${opt.quantity}x ${opt.price.toFixed(2)}`;
        }
      }

      printer.leftRight(`   • ${optName}`, optPrice);
    });
  }

  if (item.extras?.length > 0) {
    item.extras.forEach((extra) => {
      printer.newLine();
      printer.leftRight(
        `   + Add Extra: ${extra.description.toUpperCase()}`,
        extra.price > 0 ? `$${extra.price.toFixed(2)}` : "",
      );
    });
  }

  if (item.changes?.length > 0) {
    item.changes.forEach((chg) => {
      printer.newLine();
      printer.leftRight(
        `   + Change: ${chg.from.toUpperCase()} -->> ${chg.to.toUpperCase()}`,
        chg.price > 0 ? `$${chg.price.toFixed(2)}` : "",
      );
    });
  }

  if (item.instructions) {
    printer.newLine();
    printer.println(`   * Note: "${item.instructions}"`.toUpperCase());
  }

  printer.alignRight();
  printer.setTextNormal();
  printer.bold(true);
  printer.println(itemTotal > 0 ? `$${itemTotal}` : "");
  printer.setTextNormal();
}

function printOrderItems(printer, groupedSections) {
  groupedSections.forEach((section) => {
    if (section.label === "Togo Items") {
      printSectionHeader(printer, "TO GO");
    } else if (section.label === "Appetizers") {
      printSectionHeader(printer, "Appetizers");
    }

    section.items.forEach((item, index) =>
      printOrderItem(printer, item, index),
    );

    if (section.label === "Appetizers" && groupedSections.length > 1) {
      printer.setTextNormal();
      printer.alignLeft();
      printer.bold(true);
      printer.println("--------------------------------");
    }
  });
}

function printTotals(printer, order) {
  printer.println("--------------------------------");
  printer.alignRight();

  const { subtotal, discount, rewards, taxableSubtotal, pst, gst, grandTotal } =
    getOrderTotals(order);

  printer.bold(false);
  printer.println(`Subtotal: $${subtotal.toFixed(2)}`);
  if (discount) {
    const discountLabel =
      discount.discountType === "Amount"
        ? `Discount ($${discount.discountValue.toFixed(2)})`
        : `Discount (${discount.discountValue.toFixed(0)}%)`;
    printer.println(`${discountLabel}: -$${discount.discountAmount.toFixed(2)}`);
  }
  if (rewards) {
    printer.println(`Rewards (${rewards.points} pts): -$${rewards.amount.toFixed(2)}`);
  }
  if (discount || rewards) {
    printer.println(`Taxable Subtotal: $${taxableSubtotal.toFixed(2)}`);
  }
  printer.println(`PST (6%): $${pst.toFixed(2)}`);
  printer.println(`GST (5%): $${gst.toFixed(2)}`);
  printer.println(`----------------------------`);
  printer.setTextQuadArea();
  printer.println(`TOTAL: $${grandTotal.toFixed(2)}`);
  printer.setTextNormal();
  printer.newLine();
}

async function printFooter(printer, order, kitchen) {
  printer.alignCenter();
  printer.underline(true);
  printer.println(CONFIG.RESTAURANT.address);
  printer.println(CONFIG.RESTAURANT.phone);
  printer.println(CONFIG.RESTAURANT.website);
  printer.println("Thank you! Please come again!");
  printer.println();
  printer.underline(false);
  // This clone printer ignores native QR (GS ( k), so print the QR as a raster image.
  if (REVIEW_QR_PNG) {
    await printer.printImageBuffer(REVIEW_QR_PNG);
    printer.println();
    printer.println("Scan to leave us a review!");
    printer.println(`Join our rewards program: ${CONFIG.RESTAURANT.rewards}`);
  }

  printer.underline(false);

  printer.setTextSize(2, 2);
  printer.bold(false);

  if (isTakeOutLike(order)) {
    if (!isScheduledTakeOut(order)) {
      printer.newLine();
      printer.println(`*${takeOutLabel(order)} ${kitchen}*`);
    } else {
      printer.newLine();
      printPreorderInfo(printer, order, kitchen);
    }
  } else if (order.tableNumber) {
    printer.newLine();
    printer.println(`Table: ${order.tableNumber}`);
  }

  printer.newLine();
}

async function printOrder(order, kitchen) {
  const printer = createPrinter();

  try {
    const processedItems = preprocessOrderItems(
      groupOrderItemsBySignature(order.orderItems),
      { applyNameOverrides: isOnlineOrder(order) },
    );
    const groupedSections = groupItemsByKitchen(processedItems);

    await printRestaurantHeader(printer, order);
    printOrderTypeHeader(printer, order, kitchen);
    printPreorderInfo(printer, order, kitchen);
    printOrderDetails(printer, order);
    printOrderItems(printer, groupedSections);
    printTotals(printer, order);
    await printFooter(printer, order, kitchen);

    printer.cut();

    return await sendToPrinter(printer);
  } catch (error) {
    console.error("Print error:", error);
    throw error;
  }
}

// Sends the drawer kick pulse through the receipt printer (drawer is wired to it).
async function openCashDrawer() {
  const printer = createPrinter();
  printer.openCashDrawer();
  return await sendToPrinter(printer);
}

// Platform-specific send
async function sendToPrinter(printer) {
  if (IS_WINDOWS) {
    // Windows: Use USB printing via escpos-usb
    return await printViaUSB(printer);
  }
  // Linux: Use direct interface
  return await printViaDirectInterface(printer);
}

// Windows: Print via USB using escpos-usb
async function printViaUSB(printer) {
  // Get the buffer instead of executing directly
  const buffer = await printer.getBuffer();

  // Auto-detect printer VID/PID
  const { vid: VID, pid: PID } = detectUSBPrinter();

  // Send buffer to USB printer using escpos-usb
  return new Promise((resolve, reject) => {
    const usbDevice = new escpos.USB(VID, PID);

    usbDevice.open(function (error) {
      if (error) {
        console.error("Failed to open USB printer:", error);
        console.error("\nTroubleshooting:");
        console.error("1. Make sure printer is connected via USB");
        console.error("2. Run as Administrator");
        console.error("3. Verify WinUSB driver is installed (use Zadig)");
        reject(error);
        return;
      }

      console.log("✓ USB printer connected!");
      console.log("Sending print data...\n");

      // Write buffer to USB device
      usbDevice.write(buffer, function (err) {
        if (err) {
          console.error("Error writing to printer:", err);
          usbDevice.close();
          reject(err);
          return;
        }

        console.log("✓ Print sent successfully!");
        usbDevice.close();
        resolve();
      });
    });
  });
}

// Linux: Print via direct interface
async function printViaDirectInterface(printer) {
  try {
    const isConnected = await printer.isPrinterConnected();
    if (!isConnected) {
      throw new Error(`Printer not connected at ${CONFIG.PRINTER.interface}`);
    }

    console.log(`✓ Printer connected at ${CONFIG.PRINTER.interface}`);
    console.log("Sending print data...\n");

    await printer.execute();

    console.log("✓ Print sent successfully!");
  } catch (error) {
    console.error("Failed to print via direct interface:", error);
    console.error("\nTroubleshooting:");
    console.error(
      `1. Check if printer is connected at ${CONFIG.PRINTER.interface}`,
    );
    console.error(
      "2. Verify printer permissions (may need to run with sudo or add user to lp group)",
    );
    console.error("3. Check if printer device path is correct in config.js");
    throw error;
  }
}

module.exports = { printOrder, openCashDrawer, isTakeOutLike };
