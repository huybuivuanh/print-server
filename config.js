const {
  PrinterTypes,
  CharacterSet,
  BreakLine,
} = require("node-thermal-printer");

const CONFIG = {
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
};

module.exports = { CONFIG };
