# Print Server

A Node.js service that listens to a Firestore `printQueue` collection and prints thermal receipts for dine-in and take-out orders for Asian Le POS.

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

### 5. Run as a Windows service (NSSM)

Use [NSSM](https://nssm.cc/) so the print server starts on boot and restarts if Node crashes. Run these in an **Administrator** terminal.

**Download and extract**

1. Download: [nssm-2.24 build](https://www.nssm.cc/ci/nssm-2.24-101-g897c7ad.zip)
2. Extract the zip (e.g. to `D:\nssm`). Use the `win64` folder on 64-bit Windows.

**Install the service** (once per machine)

Replace paths with your Node install and this project folder. Find Node with `where node` if needed.

```powershell
D:\nssm\win64\nssm.exe install PrintServer "C:\Program Files\nodejs\node.exe" "D:\Projects\print-server\server.js"
D:\nssm\win64\nssm.exe set PrintServer AppDirectory "D:\Projects\print-server"
```

Use `node server.js` directly — do not point NSSM at `npm start` / nodemon for a background service.

**Configure auto-start and restart**

```powershell
D:\nssm\win64\nssm.exe set PrintServer Start SERVICE_AUTO_START
D:\nssm\win64\nssm.exe set PrintServer AppExit Default Restart
D:\nssm\win64\nssm.exe set PrintServer AppRestartDelay 3000
```

**Start and check status**

```powershell
D:\nssm\win64\nssm.exe start PrintServer
D:\nssm\win64\nssm.exe status PrintServer
```

**Useful commands**

| Action | Command |
|--------|---------|
| Stop | `D:\nssm\win64\nssm.exe stop PrintServer` |
| Restart | `D:\nssm\win64\nssm.exe restart PrintServer` |
| Remove service | `D:\nssm\win64\nssm.exe remove PrintServer confirm` |

Logs and I/O redirection can be configured in the NSSM GUI (`nssm edit PrintServer`) or via `nssm set` if you need stdout/stderr files for debugging.

Ensure `admin-sdk.json` is in the project directory before starting the service — NSSM runs with the same working folder as `AppDirectory`.

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
