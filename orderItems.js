const { CONFIG } = require("./config");

/** Firestore MenuItem.kitchenType (Deep Fry, Stir Fry, Both, Other, Drink). */
function normalizedKitchenType(item) {
  const kt = item.kitchenType;
  if (kt == null || kt === "") return null;
  return kt;
}

function isMainLineItem(item) {
  return !item.appetizer && !item.togo;
}

function itemsMatchingStation(items, station) {
  return items.filter(
    (item) => isMainLineItem(item) && normalizedKitchenType(item) === station,
  );
}

/**
 * Groups preprocessed items: appetizers, then kitchen types in KITCHEN_SECTION_ORDER, then to-go.
 * Same grouping for dine-in and take-out (take-out is printed twice with different A/B labels only).
 */
function groupItemsByKitchen(items) {
  const appetizers = items.filter((i) => i.appetizer);
  const togoItems = items.filter((i) => i.togo && !i.appetizer);

  const sections = [];

  if (appetizers.length > 0) {
    sections.push({ label: "Appetizers", items: appetizers });
  }

  for (const station of CONFIG.KITCHEN_SECTION_ORDER) {
    const stationItems = itemsMatchingStation(items, station);
    if (stationItems.length > 0) {
      sections.push({ label: station, items: stationItems });
    }
  }

  if (togoItems.length > 0) {
    sections.push({ label: "Togo Items", items: togoItems });
  }

  return sections;
}

function preprocessOrderItem(item) {
  const processed = { ...item };
  const qty = processed.quantity ?? processed.qty ?? 1;
  processed.quantity = qty;

  if (!Array.isArray(processed.options) || processed.options.length === 0) {
    processed.displayName =
      qty > 1 ? `${qty}x ${processed.name}` : processed.name;
    return processed;
  }

  if (processed.name === CONFIG.SPECIAL_ITEM) {
    const mainOption = processed.options.find(
      (opt) =>
        opt.name !== CONFIG.OPTION_NAMES.EGG_ROLL &&
        opt.name !== CONFIG.OPTION_NAMES.SPRING_ROLL,
    );

    if (mainOption) {
      processed.name = `${processed.name}/${mainOption.name}`;
      processed.options = processed.options.filter((opt) => opt !== mainOption);
    }
  }

  const eggOption = processed.options.find(
    (opt) => opt.name === CONFIG.OPTION_NAMES.EGG_ROLL,
  );

  const springOption = processed.options.find(
    (opt) => opt.name === CONFIG.OPTION_NAMES.SPRING_ROLL,
  );

  if ((eggOption || springOption) && !(eggOption && springOption)) {
    processed.name = `${processed.name}/${eggOption ? "ER" : "SP"}`;
    processed.options = processed.options.filter(
      (opt) => opt !== eggOption && opt !== springOption,
    );
  }

  const riceNoodleOption = processed.options.find(
    (opt) =>
      opt.name === CONFIG.OPTION_NAMES.RICE ||
      opt.name === CONFIG.OPTION_NAMES.NOODLES,
  );

  if (riceNoodleOption) {
    const abbreviation =
      riceNoodleOption.name === CONFIG.OPTION_NAMES.RICE ? "Rice" : "ND";
    processed.name = `${processed.name}/${abbreviation}`;
    processed.options = processed.options.filter(
      (opt) => opt !== riceNoodleOption,
    );
  }

  processed.displayName =
    qty > 1 ? `${qty}x ${processed.name}` : processed.name;

  return processed;
}

function preprocessOrderItems(orderItems) {
  if (!Array.isArray(orderItems)) return [];
  return orderItems.map(preprocessOrderItem);
}

function getOrderTotals(order, fallbackSubtotal) {
  const tb = order.taxBreakDown || order.taxbreakdown;
  if (tb && typeof tb === "object") {
    const grandTotal =
      typeof tb.total === "number"
        ? tb.total
        : typeof tb.grandTotal === "number"
          ? tb.grandTotal
          : null;
    if (grandTotal != null) {
      const subtotal =
        typeof tb.subTotal === "number"
          ? tb.subTotal
          : typeof tb.subtotal === "number"
            ? tb.subtotal
            : (fallbackSubtotal ?? 0);
      const pst = typeof tb.pst === "number" ? tb.pst : 0;
      const gst = typeof tb.gst === "number" ? tb.gst : 0;
      const disc = tb.discount;
      let discountAmount = 0;
      if (
        disc &&
        disc.discountType &&
        disc.discountType !== "None" &&
        typeof disc.discountAmount === "number"
      ) {
        discountAmount = disc.discountAmount;
      }
      return { subtotal, pst, gst, grandTotal, discountAmount };
    }
  }
  const sub = fallbackSubtotal ?? order.total ?? 0;
  const pst = sub * CONFIG.TAX.PST_RATE;
  const gst = sub * CONFIG.TAX.GST_RATE;
  return {
    subtotal: sub,
    pst,
    gst,
    grandTotal: sub + pst + gst,
    discountAmount: 0,
  };
}

function calculateTogoTotal(togoItems) {
  if (!Array.isArray(togoItems) || togoItems.length === 0) return 0;

  return togoItems.reduce((total, item) => {
    const qty = item.quantity ?? item.qty ?? 1;
    let itemTotal = (item.price || 0) * qty;

    if (item.options?.length > 0) {
      itemTotal += item.options.reduce(
        (optTotal, opt) => optTotal + (opt.price || 0) * (opt.quantity || 1),
        0,
      );
    }

    if (item.extras?.length > 0) {
      itemTotal += item.extras.reduce(
        (extraTotal, extra) => extraTotal + (extra.price || 0),
        0,
      );
    }

    if (item.changes?.length > 0) {
      itemTotal += item.changes.reduce(
        (chgTotal, chg) => chgTotal + (chg.price || 0),
        0,
      );
    }

    return total + itemTotal;
  }, 0);
}

module.exports = {
  preprocessOrderItem,
  preprocessOrderItems,
  normalizedKitchenType,
  groupItemsByKitchen,
  getOrderTotals,
  calculateTogoTotal,
};
