# Xpand Printer Agent

Local tray app that prints Xpand label streams (ZPL for Zebra, TSPL for TSC / Datamax,
ESC/P for dot matrix) directly to the operator's **USB** printer, bypassing the browser
print dialog and its paper-size matching problems.

It runs on each workstation that has a label printer.

## Delivery models

**Hosted / central Xpand (the usual case):** the ERP is on a remote server, so the
operator's **browser** fetches the label stream from the ERP and posts it straight to
this agent on their own PC (CORS is enabled for this reason):

```
ERP server ──(fetch stream)──> browser ──POST http://127.0.0.1:9101/print──> agent ──> USB printer
```

**Local / same-machine install:** the ERP server can also post directly to the agent.

```
ERP web app ──> server ── POST http://127.0.0.1:9101/print
                                                              │
                                              (this agent running on the PC)
                                                              ▼
                                                          USB label printer
```

Either way the agent never dials the tenant — it only listens on 127.0.0.1.

## Install on a workstation (Windows recommended)

```bash
cd printer-agent
npm install
npm run rebuild     # only needed for the Electron window (`npm start`);
                    # builds the binding for Electron's ABI (needs VS Build Tools + Python)
npm start           # tray icon appears; click it to open the agent window
```

- `npm install` downloads a **prebuilt** binary, which is enough if you run the agent
  **headless under Node** (`node agent-core.js`) — no compile.
- The Electron window runs a different ABI, so running the window requires `npm run rebuild`
  once (this is also done automatically by `electron-builder` when you build the installer).
- If you used **Bun** to install, run `bun pm trust @thiagoelg/node-printer` so the
  prebuilt binary gets downloaded; then `npm run rebuild` if you use the Electron window.

Verify it is running:
```bash
curl http://127.0.0.1:9101/health
# {"ok":true,"printer":"ZDesigner ZD220","printerModule":true}
```

### Using the agent window (BigSeller-style)

- **Printer** — pick the label printer (ZD220 / TSC / dot-matrix) and **Save**
  (settings persist in `.agent-config.json`).
- **Port** — default `9101`.
- **Pause / Resume** — while paused, incoming jobs are rejected (`409`, "Agent is paused").
- **Job Log** — last 100 jobs (time, printer, bytes, OK/FAIL, error), auto-refresh.

## Running headless (no tray window)

```bash
npm install @thiagoelg/node-printer      # native binding
node agent-core.js                       # HTTP server only
```

The server is identical; only the tray window is missing. Bun: `bun install` +
`bun run agent-core.js` works for the HTTP server, but the native binding loads
best under Node — use Node on Windows.

## Build an installer (Windows — the deployment target)

On a **Windows** machine (or a GitHub Actions `windows-latest` runner) with
Visual Studio Build Tools + Python 3 installed:

```bash
cd printer-agent
npm install
npm run dist:win
```

Output: `dist/Xpand Printer Agent Setup 1.0.0.exe` (NSIS one-click installer).
Electron-builder rebuilds `@thiagoelg/node-printer` against Electron's ABI during
the build — this step is what makes USB printing work inside the packaged app, so it
needs the C++/Python toolchain on the build machine. The installer then runs on
workstations without Node or build tools.

> macOS `npm run dist:mac` is dev/testing only; the native rebuild on macOS has
> clang/C++ version friction. Production packaging is always done on Windows.

If you want an agent with **no native compile at all**, run it headless with plain
Node (the prebuilt binding works there directly):
```bash
node agent-core.js
```
and optionally start it as a background service / `shell:startup` shortcut.

## Start on login

- Windows: put a shortcut to `node_modules/electron/dist/electron.exe <path-to-printer-agent>`
  in `shell:startup`, or package an installer with `electron-builder`.
- Headless: create a Windows service or a startup script that runs `node agent-core.js`.

## Behavior

- **Auto-retry:** transient failures (printer busy, spooler hiccup) are retried up to
  **2 extra attempts** (1s apart) before the job is logged as FAIL. Deterministic
  errors (paused, no printer, binding missing) are never retried.
- **Job Log:** every attempted print is recorded (last 100): time, printer, bytes,
  OK/FAIL, error. Kept per-PC and in-memory; it resets when the agent restarts.
- There is no buffering queue in the agent — each job is dispatched as it arrives.

## HTTP API (only bound to 127.0.0.1)

| Method | Path            | Body                     | Response                         |
| ------ | --------------- | ------------------------ | -------------------------------- |
| GET    | /health         | —                        | `{ ok, printer, paused, printerModule, ... }` |
| GET    | /printers       | —                        | `{ printers: ["ZDesigner ZD220"] }` |
| GET    | /config         | —                        | `{ port, printer, paused }`      |
| POST   | /config         | `{ port?, printer?, paused? }` | saved config               |
| GET    | /jobs           | —                        | `{ jobs: [...] }`                |
| POST   | /pause?pause=1  | —                        | `{ ok, paused }`                 |
| POST   | /print          | `{ language, data }`     | `{ ok, printer, bytes }`         |

`data` is the raw TCP print stream the ERP built for the selected preset size, so the
printer always cuts at the configured label size (e.g. `SIZE 30 mm, 20 mm`).

## Notes

- The agent binds to `127.0.0.1` only and cannot be reached from other machines.
- Config is stored in `.agent-config.json` next to the app.
- If you change the port, restart the agent window (or the ERP user's agent port setting
  must match the ERP-side "My Printer" agent port).