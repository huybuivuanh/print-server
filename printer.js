const { ThermalPrinter, PrinterTypes, CharacterSet, BreakLine } = require("node-thermal-printer");
const { CONFIG } = require("./config");
const { formatPhone, toDateMaybe, formatDate } = require("./utils");
const {
  preprocessOrderItems,
  groupItemsByKitchen,
  getOrderTotals,
  calculateTogoTotal,
} = require("./orderItems");

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

// Fallback VID and PID (if auto-detection fails) - Windows only
const FALLBACK_VID = 0x0483;  // Vendor ID
const FALLBACK_PID = 0x5743;  // Product ID

// Function to detect USB printer (Windows only)
function detectUSBPrinter() {
  if (!IS_WINDOWS) {
    throw new Error("USB printer detection is only available on Windows");
  }
  
  try {
    const printers = escpos.USB.findPrinter();
    
    if (!printers || printers.length === 0) {
      console.log('No USB printers found with auto-detection.');
      console.log('Using fallback VID/PID...\n');
      return { vid: FALLBACK_VID, pid: FALLBACK_PID };
    }
    
    console.log(`Found ${printers.length} USB printer(s):\n`);
    
    // Extract VID/PID from each printer
    const printerInfo = printers.map((printer, index) => {
      // VID/PID can be in deviceDescriptor
      const vid = printer.deviceDescriptor?.idVendor || printer.idVendor || printer.vendorId || printer.vid;
      const pid = printer.deviceDescriptor?.idProduct || printer.idProduct || printer.productId || printer.pid;
      
      if (vid && pid) {
        return {
          index: index + 1,
          vid: vid,
          pid: pid,
          vidHex: `0x${vid.toString(16).toUpperCase().padStart(4, '0')}`,
          pidHex: `0x${pid.toString(16).toUpperCase().padStart(4, '0')}`
        };
      }
      return null;
    }).filter(p => p !== null);
    
    if (printerInfo.length === 0) {
      console.log('Could not extract VID/PID from found printers.');
      console.log('Using fallback VID/PID...\n');
      return { vid: FALLBACK_VID, pid: FALLBACK_PID };
    }
    
    // Display all found printers
    printerInfo.forEach(p => {
      console.log(`  ${p.index}. VID: ${p.vidHex}, PID: ${p.pidHex}`);
    });
    console.log('');
    
    // Use the first found printer
    const selected = printerInfo[0];
    console.log(`Using printer ${selected.index}: VID: ${selected.vidHex}, PID: ${selected.pidHex}\n`);
    
    return { vid: selected.vid, pid: selected.pid };
    
  } catch (error) {
    console.log('Error during auto-detection:', error.message);
    console.log('Using fallback VID/PID...\n');
    return { vid: FALLBACK_VID, pid: FALLBACK_PID };
  }
}

function createPrinter() {
  // On Windows: use buffer interface for USB printing
  // On Linux: use direct interface path
  const printerConfig = {
    type: PrinterTypes.EPSON,
    interface: CONFIG.PRINTER.interface,
    characterSet: CharacterSet.PC852_LATIN2,
    removeSpecialCharacters: false,
    lineCharacter: '-',
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

function printOrderTypeHeader(printer, order, kitchen) {
  printer.setTextSize(2, 2);
  printer.bold(false);

  if (order.orderType === CONFIG.ORDER_TYPES.TAKE_OUT && !order.isPreorder) {
    printer.println(`*Take Out ${kitchen}*`);
    printer.newLine();
  } else if (order.tableNumber) {
    printer.println(`Table: ${order.tableNumber}`);
    printer.newLine();
  }
}

function printPreorderInfo(printer, order, kitchen) {
  if (!order.isPreorder) return;

  printer.setTextQuadArea();
  printer.println(`***Pre-Order ${kitchen}***`);

  const preorderDate = order.preorderTime
    ? toDateMaybe(order.preorderTime)
    : null;
  if (preorderDate) {
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
    printer.newLine();
  } else {
    printer.newLine();
    printer.newLine();
  }

  printer.setTextNormal();
}

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
      printer.println(`Name: ${order.name.toUpperCase()}`);
    }
    if (order.phoneNumber) {
      printer.println(`Phone #: ${formatPhone(order.phoneNumber)}`);
    }
  }

  printer.setTextNormal();
  printer.println("--------------------------------");
}

function printOrderItem(printer, item) {
  const itemTotal = (item.price * item.quantity).toFixed(2);

  printer.alignLeft();
  printer.bold(true);
  printer.setTextQuadArea();
  printer.println(item.displayName);
  printer.setTextNormal();
  printer.bold(true);

  if (item.options?.length > 0) {
    item.options.forEach((opt) => {
      const optName = opt.quantity > 1 ? `${opt.quantity}x ${opt.name}` : opt.name;
      const optPrice = opt.price > 0 ? `${opt.quantity}x ${opt.price.toFixed(2)}` : "";
      printer.leftRight(`   • ${optName}`, optPrice);
    });
  }

  if (item.extras?.length > 0) {
    item.extras.forEach((extra) => {
      printer.leftRight(
        `   + Add Extra: ${extra.description.toUpperCase()}`,
        extra.price > 0 ? `$${extra.price.toFixed(2)}` : ""
      );
      printer.newLine();
    });
  }

  if (item.changes?.length > 0) {
    item.changes.forEach((chg) => {
      printer.leftRight(
        `   + Change: ${chg.from.toUpperCase()} -->> ${chg.to.toUpperCase()}`,
        chg.price > 0 ? `$${chg.price.toFixed(2)}` : ""
      );
      printer.newLine();
    });
  }

  if (item.instructions) {
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

    section.items.forEach((item) => printOrderItem(printer, item));

    if (section.label === "Appetizers") {
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

  const { subtotal, pst, gst, grandTotal } = getOrderTotals(order);

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

async function printOrder(order, kitchen) {
  const printer = createPrinter();

  try {
    const processedItems = preprocessOrderItems(order.orderItems);
    const groupedSections = groupItemsByKitchen(processedItems);

    printRestaurantHeader(printer, order);
    printOrderTypeHeader(printer, order, kitchen);
    printPreorderInfo(printer, order, kitchen);
    printOrderDetails(printer, order);
    printOrderItems(printer, groupedSections);
    printTotals(printer, order);
    printFooter(printer, order, kitchen);

    printer.cut();
    
    // Platform-specific printing
    if (IS_WINDOWS) {
      // Windows: Use USB printing via escpos-usb
      return await printViaUSB(printer);
    } else {
      // Linux: Use direct interface
      return await printViaDirectInterface(printer);
    }
  } catch (error) {
    console.error("Print error:", error);
    throw error;
  }
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
    
    usbDevice.open(function(error) {
      if (error) {
        console.error('Failed to open USB printer:', error);
        console.error('\nTroubleshooting:');
        console.error('1. Make sure printer is connected via USB');
        console.error('2. Run as Administrator');
        console.error('3. Verify WinUSB driver is installed (use Zadig)');
        reject(error);
        return;
      }
      
      console.log('✓ USB printer connected!');
      console.log('Sending print data...\n');
      
      // Write buffer to USB device
      usbDevice.write(buffer, function(err) {
        if (err) {
          console.error('Error writing to printer:', err);
          usbDevice.close();
          reject(err);
          return;
        }
        
        console.log('✓ Print sent successfully!');
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
    console.log('Sending print data...\n');
    
    await printer.execute();
    
    console.log('✓ Print sent successfully!');
  } catch (error) {
    console.error('Failed to print via direct interface:', error);
    console.error('\nTroubleshooting:');
    console.error(`1. Check if printer is connected at ${CONFIG.PRINTER.interface}`);
    console.error('2. Verify printer permissions (may need to run with sudo or add user to lp group)');
    console.error('3. Check if printer device path is correct in config.js');
    throw error;
  }
}

module.exports = { printOrder };
