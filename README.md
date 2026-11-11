# Print Server

A Node.js service that prints thermal receipts for Asian Le: dine-in and take-out orders from the POS, and online (website) orders from the Orders app.

> **Shared Firebase project:** this server uses the shared `asianlepos` project, where each
> business's data is under `businesses/{id}/…`. In the same business it prints:
> - POS orders from `printQueue` (order read from `dineInOrders` / `takeOutOrders`)
> - online orders from `onlinePrintQueue` (order read from `orders`)
>
> and listens to `cashDrawer/main`. Set `BUSINESS_ID` in `config.js` to this restaurant's business doc id — the server
> won't start without it. `admin-sdk.json` must be a service account key for `asianlepos`.


## How it works

1. The server connects to Firestore and watches every queue in `PRINT_QUEUES` (`printQueue` and `onlinePrintQueue`) for new documents.
2. When an unprinted order appears, it is pushed into one shared local queue (tagged `pos` or `online`).
3. Orders and cash drawer kicks are sent to the printer one at a time, so they never collide.
4. After a successful print, the order document and its queue entry are marked `printed: true` in Firestore.

Take-out and online orders are printed twice (lanes **B** then **A**) with different slip labels but identical line items. Online slips say `*Online B*` / `*Online A*`, show the order number, and use the shortened names from `NAME_OVERRIDES` / `OPTION_OVERRIDES`.

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
| `PRINT_QUEUES` | Firestore queues to print from, each tagged `pos` or `online` |
| `NAME_OVERRIDES` / `OPTION_OVERRIDES` | Shorter names for long website item/option names (online tickets only) |

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

## Cash drawer

The POS opens the cash drawer (wired to the receipt printer) when a cash payment starts by writing `cashDrawer/main`:

```
{ openDrawer: true, requestedAt: <Timestamp, device clock> }
```

The server resets `openDrawer` to `false`, then sends the drawer kick only if `requestedAt` is within `CASH_DRAWER.MAX_AGE_MS` (30s). Older requests (sent while the tablet or server was offline) are cleared without opening. Drawer kicks go through the same queue as receipts, ahead of waiting receipts.

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

The server reads from the `printQueue` and `onlinePrintQueue` collections. Each document is expected to have:

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Order document ID |
| `orderType` | string | `"Dine In"` or `"Take Out"` |
| `orderItems` | array | Line items |
| `printed` | boolean | Set to `true` after printing |
| `printId` | string | Auto-set from the queue doc ID |

After printing, the server also updates the corresponding `dineInOrders` / `takeOutOrders` document (POS) or `orders` document (online).
