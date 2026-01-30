const { ThermalPrinter } = require("node-thermal-printer");
const { CONFIG } = require("./config");
const { formatPhone, toDateMaybe, formatDate } = require("./utils");
const {
  preprocessOrderItems,
  groupItemsByKitchen,
  getOrderTotals,
  calculateTogoTotal,
} = require("./orderItems");

function createPrinter() {
  return new ThermalPrinter(CONFIG.PRINTER);
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
      printer.println(`Customer: ${order.name}`);
    }
    if (order.phoneNumber) {
      printer.println(`Phone: ${formatPhone(order.phoneNumber)}`);
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
  printer.newLine();
  printer.setTextNormal();
  printer.bold(true);

  if (item.options?.length > 0) {
    item.options.forEach((opt) => {
      const optName = opt.quantity > 1 ? `${opt.quantity}x ${opt.name}` : opt.name;
      const optPrice = opt.price > 0 ? `${opt.quantity}x ${opt.price.toFixed(2)}` : "";
      printer.leftRight(`   • ${optName}`, optPrice);
      printer.newLine();
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

function printTogoTicket(printer, order, togoItems) {
  printer.alignCenter();
  printer.setTextQuadArea();
  printer.bold(true);
  printer.println(CONFIG.RESTAURANT.name);
  printer.newLine();

  if (order.tableNumber) {
    printer.setTextSize(2, 2);
    printer.bold(false);
    printer.println(`TO GO: ${order.tableNumber}`);
    printer.newLine();
  }

  printer.setTextNormal();
  printer.println("--------------------------------");

  printer.alignLeft();
  togoItems.forEach((item) => printOrderItem(printer, item));

  printer.println("--------------------------------");
  printer.alignRight();

  const togoSubtotal = calculateTogoTotal(togoItems);
  const { subtotal, pst, gst, grandTotal } = getOrderTotals(order, togoSubtotal);

  printer.bold(false);
  printer.println(`Subtotal: $${subtotal.toFixed(2)}`);
  printer.println(`PST (6%): $${pst.toFixed(2)}`);
  printer.println(`GST (5%): $${gst.toFixed(2)}`);
  printer.println(`----------------------------`);
  printer.setTextQuadArea();
  printer.println(`TOTAL: $${grandTotal.toFixed(2)}`);
  printer.setTextNormal();
  printer.newLine();
  printer.newLine();
}

async function printOrder(order, kitchen) {
  const printer = createPrinter();

  try {
    const isConnected = await printer.isPrinterConnected();
    if (!isConnected) {
      throw new Error("Printer not connected");
    }

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
    await printer.execute();
  } catch (error) {
    console.error("Print error:", error);
    throw error;
  }
}

module.exports = { printOrder };
