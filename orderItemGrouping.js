function roundMoney2(n) {
  return Math.round(n * 100) / 100;
}

function safeUnitCount(n) {
  const v = Number(n);
  return Number.isFinite(v) && Math.floor(v) >= 1 ? Math.floor(v) : 1;
}

function normalizeInstructionsKey(instructions) {
  return (instructions?.trim() ?? "");
}

function normalizeOptionsKey(options) {
  if (!options?.length) return "";
  const sorted = [...options].sort((a, b) => {
    const byName = a.name.localeCompare(b.name);
    if (byName !== 0) return byName;
    if (a.price !== b.price) return a.price - b.price;
    return a.quantity - b.quantity;
  });
  return JSON.stringify(sorted.map((o) => ({ name: o.name, price: o.price, quantity: o.quantity })));
}

function normalizeChangesKey(changes) {
  if (!changes?.length) return "";
  const sorted = [...changes].sort((a, b) => {
    const byFrom = a.from.localeCompare(b.from);
    if (byFrom !== 0) return byFrom;
    const byTo = a.to.localeCompare(b.to);
    if (byTo !== 0) return byTo;
    return a.price - b.price;
  });
  return JSON.stringify(sorted.map((c) => ({ from: c.from, to: c.to, price: roundMoney2(c.price) })));
}

function normalizeExtrasKey(extras) {
  if (!extras?.length) return "";
  const sorted = [...extras].sort((a, b) => {
    const byDesc = a.description.localeCompare(b.description);
    if (byDesc !== 0) return byDesc;
    return a.price - b.price;
  });
  return JSON.stringify(sorted.map((e) => ({ description: e.description, price: roundMoney2(e.price) })));
}

function fullSignatureKey(item) {
  return [
    item.name,
    String(roundMoney2(item.price)),
    item.kitchenType,
    item.togo ? "1" : "0",
    item.appetizer ? "1" : "0",
    normalizeOptionsKey(item.options),
    normalizeInstructionsKey(item.instructions),
    normalizeChangesKey(item.changes),
    normalizeExtrasKey(item.extras),
  ].join("\0");
}

function buildMergedLine(template, totalQuantity) {
  const options = template.options?.length ? template.options.map((o) => ({ ...o })) : undefined;
  const changes = template.changes?.length ? template.changes.map((c) => ({ ...c })) : undefined;
  const extras = template.extras?.length ? template.extras.map((e) => ({ ...e })) : undefined;
  const instructions = template.instructions?.trim();
  return {
    id: template.id,
    name: template.name,
    price: roundMoney2(template.price),
    quantity: totalQuantity,
    kitchenType: template.kitchenType,
    togo: template.togo,
    appetizer: template.appetizer,
    paid: template.paid,
    completed: template.completed,
    ...(options ? { options } : {}),
    ...(changes ? { changes } : {}),
    ...(extras ? { extras } : {}),
    ...(instructions ? { instructions } : {}),
  };
}

function drinkFlavorBucketKey(item) {
  if (item.kitchenType !== "Drink") return null;
  if (!item.options?.length) return null;
  return [
    item.name,
    String(roundMoney2(item.price)),
    item.kitchenType,
    item.togo ? "1" : "0",
    item.appetizer ? "1" : "0",
    normalizeInstructionsKey(item.instructions),
    normalizeChangesKey(item.changes),
    normalizeExtrasKey(item.extras),
  ].join("\0");
}

// item.price is already the total for one occurrence of this item's whole
// flavor/options combo (computed upstream in the POS), so it must be summed
// once per bucket member - never split or re-multiplied per flavor.
function buildMergedDrinkFlavorLine(bucket) {
  const template = bucket[0];
  const flavorOrder = [];
  const seenFlavor = new Set();
  const optionQtyByName = new Map();
  const optionPriceByName = new Map();
  let lineTotalSum = 0;

  for (const item of bucket) {
    const memberQty = safeUnitCount(item.quantity);
    lineTotalSum += roundMoney2(item.price) * memberQty;

    for (const opt of item.options) {
      const optUnit = safeUnitCount(opt.quantity);
      const add = memberQty * optUnit;
      const name = opt.name;
      optionQtyByName.set(name, (optionQtyByName.get(name) ?? 0) + add);
      if (!seenFlavor.has(name)) { seenFlavor.add(name); flavorOrder.push(name); }
      if (!optionPriceByName.has(name)) optionPriceByName.set(name, roundMoney2(opt.price || 0));
    }
  }

  const options = flavorOrder.map((name) => ({
    name,
    price: optionPriceByName.get(name) ?? 0,
    quantity: optionQtyByName.get(name) ?? 0,
  }));

  const changes = template.changes?.length ? template.changes.map((c) => ({ ...c })) : undefined;
  const extras = template.extras?.length ? template.extras.map((e) => ({ ...e })) : undefined;
  const instructions = template.instructions?.trim();

  return {
    id: template.id,
    name: template.name,
    price: roundMoney2(lineTotalSum),
    quantity: 1,
    kitchenType: template.kitchenType,
    togo: template.togo,
    appetizer: template.appetizer,
    paid: template.paid,
    completed: template.completed,
    options,
    ...(changes ? { changes } : {}),
    ...(extras ? { extras } : {}),
    ...(instructions ? { instructions } : {}),
  };
}

function applyDrinkFlavorGrouping(items) {
  const n = items.length;
  const indicesByKey = new Map();
  for (let i = 0; i < n; i++) {
    const key = drinkFlavorBucketKey(items[i]);
    if (!key) continue;
    let list = indicesByKey.get(key);
    if (!list) { list = []; indicesByKey.set(key, list); }
    list.push(i);
  }
  const skip = new Set();
  const replaceFirst = new Map();
  for (const indices of indicesByKey.values()) {
    replaceFirst.set(indices[0], buildMergedDrinkFlavorLine(indices.map((i) => items[i])));
    for (let j = 1; j < indices.length; j++) skip.add(indices[j]);
  }
  const out = [];
  for (let i = 0; i < n; i++) {
    if (skip.has(i)) continue;
    out.push(replaceFirst.get(i) ?? items[i]);
  }
  return out;
}

function mergeByExactSignature(items) {
  const totalsByKey = new Map();
  const templateByKey = new Map();
  for (const item of items) {
    const key = fullSignatureKey(item);
    totalsByKey.set(key, (totalsByKey.get(key) ?? 0) + item.quantity);
    if (!templateByKey.has(key)) templateByKey.set(key, item);
  }
  const emittedKeys = new Set();
  const out = [];
  for (const item of items) {
    const key = fullSignatureKey(item);
    if (emittedKeys.has(key)) continue;
    emittedKeys.add(key);
    out.push(buildMergedLine(templateByKey.get(key), totalsByKey.get(key)));
  }
  return out;
}

function groupOrderItemsBySignature(items) {
  if (items.length === 0) return [];
  return mergeByExactSignature(applyDrinkFlavorGrouping(items));
}

module.exports = { groupOrderItemsBySignature };
