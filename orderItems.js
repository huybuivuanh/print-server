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
 * Groups preprocessed items: appetizers, one main block (KITCHEN_SECTION_ORDER), then to-go.
 * Same grouping for dine-in and take-out (take-out is printed twice with different A/B labels only).
 */
function groupItemsByKitchen(items) {
  const appetizers = items.filter((i) => i.appetizer);
  const togoItems = items.filter((i) => i.togo && !i.appetizer);

  const sections = [];

  const byName = (a, b) => a.name.localeCompare(b.name);

  if (appetizers.length > 0) {
    sections.push({ label: "Appetizers", items: appetizers.sort(byName) });
  }

  const mainItems = [];
  for (const station of CONFIG.KITCHEN_SECTION_ORDER) {
    mainItems.push(...itemsMatchingStation(items, station).sort(byName));
  }
  if (mainItems.length > 0) {
    sections.push({ label: "Main", items: mainItems });
  }

  if (togoItems.length > 0) {
    sections.push({ label: "Togo Items", items: togoItems.sort(byName) });
  }

  return sections;
}

function preprocessOrderItem(item, applyNameOverrides) {
  const processed = { ...item };
  const qty = processed.quantity ?? processed.qty ?? 1;
  processed.quantity = qty;

  if (applyNameOverrides) {
    const overrideName = CONFIG.NAME_OVERRIDES[processed.name];
    if (overrideName) processed.name = overrideName;
  }

  if (!Array.isArray(processed.options) || processed.options.length === 0) {
    return processed;
  }

  // Rename options up front. Maps to new objects so the source order items are
  // never mutated.
  if (applyNameOverrides) {
    processed.options = processed.options.map((opt) => {
      const overrideOption = CONFIG.OPTION_OVERRIDES[opt.name];
      return overrideOption ? { ...opt, name: overrideOption } : opt;
    });
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

  return processed;
}

// applyNameOverrides: shorten long website names (online orders only).
function preprocessOrderItems(orderItems, { applyNameOverrides = false } = {}) {
  if (!Array.isArray(orderItems)) return [];
  return orderItems.map((item) =>
    preprocessOrderItem(item, applyNameOverrides),
  );
}

function getOrderTotals(order) {
  const tb = order.taxBreakDown;
  const disc = tb.discount;
  const discountAmount =
    disc && disc.discountType !== "None" ? disc.discountAmount : 0;
  return {
    subtotal: tb.subTotal,
    pst: tb.pst,
    gst: tb.gst,
    grandTotal: tb.total,
    discountAmount,
  };
}

/**
 * Points behind the discount when it's a rewards redemption, otherwise 0.
 * POS orders: loyalty.pointsRedeemed, and loyalty.redeemedAmount must still match the
 * discount (staff may have swapped it for a manual one). Online orders:
 * loyalty.pointsRedeemed once completed, loyalty.pointsToRedeem before that.
 */
function getRewardsPoints(order) {
  const loyalty = order.loyalty;
  const disc = order.taxBreakDown?.discount;
  if (!loyalty || !disc || disc.discountType !== "Amount") return 0;
  if (
    loyalty.redeemedAmount != null &&
    loyalty.redeemedAmount !== disc.discountValue
  ) {
    return 0;
  }
  return loyalty.pointsRedeemed || loyalty.pointsToRedeem || 0;
}

module.exports = {
  preprocessOrderItems,
  groupItemsByKitchen,
  getOrderTotals,
  getRewardsPoints,
};
