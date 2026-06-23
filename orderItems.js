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

function preprocessOrderItem(item) {
  const processed = { ...item };
  const qty = processed.quantity ?? processed.qty ?? 1;
  processed.quantity = qty;

  if (!Array.isArray(processed.options) || processed.options.length === 0) {
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

  return processed;
}
function preprocessOrderItems(orderItems) {
  if (!Array.isArray(orderItems)) return [];
  return orderItems.map(preprocessOrderItem);
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

module.exports = {
  preprocessOrderItems,
  groupItemsByKitchen,
  getOrderTotals,
};
