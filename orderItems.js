const { CONFIG } = require("./config");

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

  processed.displayName =
    processed.quantity > 1
      ? `${processed.quantity}x ${processed.name}`
      : processed.name;

  return processed;
}

/**
 * Preprocesses all order items
 */
function preprocessOrderItems(orderItems) {
  if (!Array.isArray(orderItems)) return [];
  return orderItems.map(preprocessOrderItem);
}

/**
 * Groups items by kitchen type and category
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

  if (!excludeTogo) {
    const togoItems = items.filter((item) => item.togo && !item.appetizer);
    sections.push({ label: "Togo Items", items: togoItems });
  }

  return sections.filter((section) => section.items.length > 0);
}

/**
 * Returns subtotal, pst, gst, grandTotal from order.taxBreakDown or fallback calculation
 */
function getOrderTotals(order, fallbackSubtotal) {
  const tb = order.taxBreakDown || order.taxbreakdown;
  if (tb && typeof tb.grandTotal === "number") {
    const subtotal = typeof tb.total === "number" ? tb.total : (fallbackSubtotal ?? 0);
    const pst = typeof tb.pst === "number" ? tb.pst : 0;
    const gst = typeof tb.gst === "number" ? tb.gst : 0;
    return { subtotal, pst, gst, grandTotal: tb.grandTotal };
  }
  const sub = fallbackSubtotal ?? order.total ?? 0;
  const pst = sub * CONFIG.TAX.PST_RATE;
  const gst = sub * CONFIG.TAX.GST_RATE;
  return { subtotal: sub, pst, gst, grandTotal: sub + pst + gst };
}

/**
 * Calculates the total price of to-go items
 */
function calculateTogoTotal(togoItems) {
  if (!Array.isArray(togoItems) || togoItems.length === 0) return 0;

  return togoItems.reduce((total, item) => {
    let itemTotal = (item.price || 0) * (item.quantity || 1);

    if (item.options?.length > 0) {
      itemTotal += item.options.reduce(
        (optTotal, opt) => optTotal + (opt.price || 0),
        0
      );
    }

    if (item.extras?.length > 0) {
      itemTotal += item.extras.reduce(
        (extraTotal, extra) => extraTotal + (extra.price || 0),
        0
      );
    }

    if (item.changes?.length > 0) {
      itemTotal += item.changes.reduce(
        (chgTotal, chg) => chgTotal + (chg.price || 0),
        0
      );
    }

    return total + itemTotal;
  }, 0);
}

module.exports = {
  preprocessOrderItem,
  preprocessOrderItems,
  groupItemsByKitchen,
  getOrderTotals,
  calculateTogoTotal,
};
