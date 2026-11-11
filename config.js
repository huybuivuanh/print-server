const {
  PrinterTypes,
  CharacterSet,
  BreakLine,
} = require("node-thermal-printer");

const CONFIG = {
  /**
   * This restaurant's business id: the businesses/{id} doc in the shared asianlepos
   * Firebase project. Every queue and order is read from there. Required.
   */
  BUSINESS_ID: "ASQxXxfSedn4x1mdNCa2", // Asian Le
  AUTH_TOKEN: "Asianlerestaurant7799",
  PRINTER: {
    type: PrinterTypes.EPSON,
    interface: process.platform === "win32" ? "buffer" : "/dev/usb/lp0",
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
  CASH_DRAWER: {
    // Firestore doc the POS writes { openDrawer: true, requestedAt } to.
    COLLECTION: "cashDrawer",
    DOC_ID: "main",
    // Requests older than this (e.g. sent while offline) are cleared without opening.
    MAX_AGE_MS: 30000,
  },
  /**
   * Firestore queues this server prints from (under businesses/{BUSINESS_ID}).
   * "pos": dine-in / take-out from the POS, order in dineInOrders / takeOutOrders.
   * "online": website orders from the Orders app, order in orders.
   * All of them feed one local queue so jobs never hit the printer at the same time.
   */
  PRINT_QUEUES: [
    { collection: "printQueue", source: "pos" },
    { collection: "onlinePrintQueue", source: "online" },
  ],
  ORDER_TYPES: {
    DINE_IN: "Dine In",
    TAKE_OUT: "Take Out",
  },
  /**
   * Take-out: print the same ticket twice, in this order (B then A).
   * Only changes the slip label (*Take Out B* / *Take Out A*); line items are identical.
   */
  TAKEOUT_PRINT_LANES: ["B", "A"],
  /**
   * Section order after appetizers, before to-go.
   * Matches Firestore MenuItem.kitchenType strings.
   */
  KITCHEN_SECTION_ORDER: ["Deep Fry", "Both", "Stir Fry", "Other", "Drink"],
  OPTION_NAMES: {
    EGG_ROLL: "Egg Roll",
    SPRING_ROLL: "Spring Roll",
    RICE: "Rice",
    NOODLES: "Noodles",
  },
  SPECIAL_ITEM: "#3",
  /**
   * Shorten long website menu item names on online order tickets (POS tickets
   * print names unchanged).
   * Key = exact incoming item.name, value = name to print instead.
   */
  NAME_OVERRIDES: {
    "Vietnamese Spring Rolls": "Spring Rolls",
    "Chinese Egg Rolls": "Egg Rolls",
    "Vegetarian Salad Rolls": "Veg Salad Rolls",
    "Thai Tom Yum Chicken Soup": "Thai Chicken Soup",
    "Thai Tom Yum Shrimp Soup": "Thai Shrimp Soup",
    "Curry Vermicelli With One Spring Roll": "Curry Vermicelli",
    "Sate Vermicelli With One Spring Roll": "Sate Vermicelli",
    "Stir Fry Vermicelli With One Spring Roll": "Stir Fry Vermicelli",
    "Spring Roll Vermicelli": "Spring Roll Vermiceli",
    "Thai Tom Yum Noodle Soup": "Thai Noodle Soup",
    "Almond on Rice/Noodles": "Almond on",
    "Black Bean on Rice/Noodles": "Black Bean on",
    "Coconut on Rice/Noodles": "Coconut on",
    "Ginger on Rice/Noodles": "Ginger on",
    "Lemon Chicken on Rice/Noodles": "Lemon Chicken on",
    "Sate on Rice/Noodles": "Sate on",
    "Sweet & Sour on Rice/Noodles": "Sweet & Sour on",
    "Szechuan on Rice/Noodles": "Szechuan on",
    "Almond Chicken & Diced Vegetagbles": "Almond Chicken",
    "Almond Shrimp & Diced Vegetables": "Almond Shrimp",
    "Chicken in Black Bean Sauce": "Chicken in BBS",
    "Sate Chicken & Vegetables": "Sate Chicken & Veg",
    "Butter Garlic Dry Chicken": "Butter Chicken",
    "Thai Chicken & Vegetables": "Thai Chicken & Veg",
    "Butter Garlic Pork": "Butter Pork",
    "Pork in Black Bean Sauce": "Pork in BBS",
    "Sate Pork & Vegetables": "Sate Pork & Veg",
    "Sweet & Sour Lean Pork": "Sweet & Sour Pork",
    "Thai Pork & Vegetables": "Thai Pork & Veg",
    "Beef in Black Bean Sauce": "Beef in BBS",
    "Sate Beef & Vegetables": "Sate Beef & Veg",
    "Thai Beef & Vegetables": "Thai Beef & Veg",
    "Sate Shrimp & Vegetables": "Sate Shrimp & Veg",
    "Thai Shrimp & Vegetables": "Thai Shrimp & Veg",
    "Butter Garlic Fried Shrimp": "ButterShrimp",
    "Shrimp in Black Bean Sauce": "Shrimp in BBS",
    "Regular Bird Nest": "Bird Nest",
    "Vegetables Bird Nest": "Veg Bird Nest",
    "Hot Plate 1: Sate Sauce": "Hot Plate 1",
    "Hot Plate 2: Black Bean Sauce": "Hot Plate 2",
    "Hot Plate 3: Ginger Sauce": "Hot Plate 3",
    "Hot Plate 4: Coconut Sauce": "Hot Plate 4",
    "Hot Plate 5: Szechuan Sauce": "Hot Plate 5",
    "Hot Plate 6: Thai Tom Yum Sauce": "Hot Plate 6",
    "Vietnamese Iced Coffee": "Viet Iced Coffee",
  },

  OPTION_OVERRIDES: {
    "Coconut Pork (Sauce on side)": "Coconut Pork",
    "Ginger Beef (Sauce on side)": "Ginger Beef",
    "Ginger Chicken (Sauce on side)": "Ginger Chicken",
    "Ginger Pork (Sauce on side)": "Ginger Pork",
    "Lemon Chicken (Sauce on side)": "Lemon Chicken",
  },
};

module.exports = { CONFIG };
