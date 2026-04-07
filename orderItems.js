const { CONFIG } = require("./config");

const DINE_IN_LANE_ORDER = [
  CONFIG.KITCHEN_TYPES.A,
  CONFIG.KITCHEN_TYPES.Z,
  CONFIG.KITCHEN_TYPES.B,
  CONFIG.KITCHEN_TYPES.C,
];

/**
 * Lane letter(s) for Firestore kitchenType (or legacy A/B/C/Z).
 * @param {object} item
 * @returns {string[]}
 */
function kitchenLanesForItem(item) {
  const kt = item.kitchenType;
  if (kt == null || kt === "") return [];

  const mapped = CONFIG.KITCHEN_TYPE_MAP[kt];
  if (mapped === "BOTH") {
    return [CONFIG.KITCHEN_TYPES.A, CONFIG.KITCHEN_TYPES.B];
  }
  if (mapped) return [mapped];

  if (
    kt === CONFIG.KITCHEN_TYPES.A ||
    kt === CONFIG.KITCHEN_TYPES.B ||
    kt === CONFIG.KITCHEN_TYPES.C ||
    kt === CONFIG.KITCHEN_TYPES.Z
  ) {
    return [kt];
  }

  return [];
}

/**
 * @param {object[]} items
 * @param {{ kitchenPass?: string | null }} [options] — take-out: "A"|"B" filters lines; null = dine-in
 */
function groupItemsByKitchen(items, options = {}) {
  const kitchenPass =
    options.kitchenPass === "" ? null : options.kitchenPass ?? null;

  const appetizers = items.filter((i) => i.appetizer);
  const togoItems = items.filter((i) => i.togo && !i.appetizer);

  const filterByLane = (lane) => (item) =>
    kitchenLanesForItem(item).includes(lane) &&
    !item.appetizer &&
    !item.togo;

  if (kitchenPass == null) {
    const sections = [
      { label: "Appetizers", items: appetizers },
      ...DINE_IN_LANE_ORDER.map((lane) => ({
        label: `Kitchen ${lane}`,
        items: items.filter(filterByLane(lane)),
      })),
      { label: "Togo Items", items: togoItems },
    ];
    return sections.filter((s) => s.items.length > 0);
  }

  const laneItems = items.filter(
    (item) =>
      !item.appetizer &&
      !item.togo &&
      kitchenLanesForItem(item).includes(kitchenPass),
  );

  const sections = [];
  if (appetizers.length > 0) {
    sections.push({ label: "Appetizers", items: appetizers });
  }
  if (laneItems.length > 0) {
    sections.push({ label: `Kitchen ${kitchenPass}`, items: laneItems });
  }
  if (togoItems.length > 0) {
    sections.push({ label: "Togo Items", items: togoItems });
  }

  return sections.filter((s) => s.items.length > 0);
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

  const eggSpringOption = processed.options.find(
    (opt) =>
      (opt.name === CONFIG.OPTION_NAMES.EGG_ROLL ||
        opt.name === CONFIG.OPTION_NAMES.SPRING_ROLL) &&
      (!opt.quantity || opt.quantity <= 1),
  );

  if (eggSpringOption) {
    const abbreviation =
      eggSpringOption.name === CONFIG.OPTION_NAMES.EGG_ROLL ? "ER" : "SP";
    processed.name = `${processed.name}/${abbreviation}`;
    processed.options = processed.options.filter(
      (opt) => opt !== eggSpringOption,
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

/**
 * Firestore taxBreakDown: { subTotal, total, pst, gst, discount? }
 */
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
        (optTotal, opt) =>
          optTotal + (opt.price || 0) * (opt.quantity || 1),
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
  kitchenLanesForItem,
  groupItemsByKitchen,
  getOrderTotals,
  calculateTogoTotal,
};
