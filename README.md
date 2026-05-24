# Print Server

A Node.js service that listens to a Firestore `printQueue` collection and prints thermal receipts for dine-in and take-out orders.

## How it works

1. The server connects to Firestore and watches the `printQueue` collection for new documents.
2. When an unprinted order appears, it is pushed into a local queue.
3. Orders are printed one at a time to avoid collisions.
4. After a successful print, the order document and its `printQueue` entry are marked `printed: true` in Firestore.

Take-out orders are printed twice (lanes **B** then **A**) with different slip labels but identical line items.

## Platform support

| Platform | Print method |
|----------|-------------|
| Windows  | USB via `escpos-usb` (auto-detects VID/PID) |
| Linux    | Direct device interface (`/dev/usb/lp0`) |

## Requirements

- Node.js 18+
- A Firebase project with Firestore enabled
- An EPSON-compatible thermal printer (48-column)
- **Windows only:** WinUSB driver installed via [Zadig](https://zadig.akeo.ie/), run as Administrator

## Setup

### 1. Install dependencies

```bash
npm install
```

### 2. Add Firebase credentials

Place your Firebase Admin SDK service account file at the project root:

```
admin-sdk.json
```

Download it from: Firebase Console → Project Settings → Service Accounts → Generate new private key.

### 3. Configure

Edit `config.js` to match your environment:

| Field | Description |
|-------|-------------|
| `AUTH_TOKEN` | Bearer token required on all HTTP requests (`x-auth-token` header) |
| `PRINTER.interface` | Auto-set by platform: `"buffer"` on Windows, `/dev/usb/lp0` on Linux |
| `RESTAURANT` | Name, address, and phone printed on receipts |
| `SERVER.port / host` | Defaults to `127.0.0.1:3000` |
| `TAKEOUT_PRINT_LANES` | Labels printed on take-out slips (default `["B", "A"]`) |
| `KITCHEN_SECTION_ORDER` | Order of kitchen sections on the ticket |

### 4. Run

```bash
npm start
```

The server starts on `http://127.0.0.1:3000` and immediately begins listening to Firestore.

## Project structure

```
server.js       — Express server, print queue, Firestore listener
printer.js      — Thermal printer layout and platform-specific print logic
orderItems.js   — Order item preprocessing and grouping
config.js       — All configuration constants
firestore.js    — Firebase Admin SDK initialisation
utils.js        — Phone/date formatting helpers
admin-sdk.json  — Firebase service account credentials (not committed)
```

## Authentication

All requests to the server require the header:

```
x-auth-token: <AUTH_TOKEN>
```

The token is defined in `config.js`.

## Firestore schema

The server reads from the `printQueue` collection. Each document is expected to have:

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Order document ID |
| `orderType` | string | `"Dine In"` or `"Take Out"` |
| `orderItems` | array | Line items |
| `printed` | boolean | Set to `true` after printing |
| `printId` | string | Auto-set from the `printQueue` doc ID |

After printing, the server also updates the corresponding `dineInOrders` or `takeOutOrders` document.
