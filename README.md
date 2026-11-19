# Xpand Printer Agent

Local tray app that prints Xpand label streams (ZPL/TSPL/ESC/P) directly to the
operator's **USB** printer, bypassing the browser print dialog.

Runs on each workstation that has a label printer.

## Delivery model

Hosted / central Xpand (usual case): ERP is remote, operator's **browser**
fetches the label stream and posts it to the agent on their own PC:

```
ERP server ──(fetch stream)──> browser ──POST http://127.0.0.1:9101/print──> agent ──> USB printer
```

Local / same-machine install: ERP server posts directly to the agent:

```
ERP web app ──> server ── POST http://127.0.0.1:9101/print ──> agent ──> USB label printer
```

Either way the agent only listens on 127.0.0.1.

## Install

Download from GitHub Releases (Windows `.exe` installer, macOS `.dmg` for testing):

1. Run the installer, tray icon appears.
2. Click tray icon → Agent window → gear → pick label printer → Save.
3. Verify: `curl http://127.0.0.1:9101/health`

Windows is the production target. macOS build is dev/testing only.

Auto-update: the app checks GitHub Releases on launch and notifies when a
newer version is available.

## Agent window

- **Printer** — label printer, Save persists to `.agent-config.json`.
- **Port** — default `9101`. Changing it restarts the server on the new port.
- **Job Log** — last 100 jobs: time, printer, language, bytes, OK/FAIL, error.

## Running from source

```bash
npm install
npm start            # Electron window (needs rebuild once: npm run rebuild)
node agent-core.js   # headless, no window (prebuilt binding is enough)
```

`npm run rebuild` compiles the native binding for Electron's ABI (needs VS
Build Tools + Python on Windows). Headless under plain Node uses the prebuilt
binary, no compile.

## Building installers (GitHub Actions)

You never build locally — push code, CI builds the installers. No C++
toolchain needed on your machine.

Workflow: `.github/workflows/build-win.yml`, two jobs:

- `build-win` on `windows-latest` → `dist/*.exe` (NSIS installer + portable)
- `build-mac` on `macos-latest` → `dist/*.dmg` (dev/testing only)

Prerequisites (one time):

1. Push this repo to GitHub (already done: `xpandid/print-agent`).
2. `package.json` `repository.url` must point at the GitHub repo — it does,
   auto-update and `electron-builder --publish` rely on it.
3. No secrets to add — the workflow uses the built-in `GITHUB_TOKEN`.

Build step by step:

```bash
# 1. make your changes, bump version in package.json if releasing
# 2. commit + push to main
git add -A && git commit -m "describe change" && git push origin main

# 3a. test build without releasing (manual dispatch)
#     browser: Actions tab → printer-agent-win → Run workflow → Run
#     when green: download win-installer / mac-installer artifacts

# 3b. release build (attaches .exe + .dmg to a GitHub Release,
#     installed apps auto-update to it on next launch)
git tag v1.1.0 && git push origin v1.1.0
```

What CI runs per job (Windows shown, mac identical except the target):

```
npm install                    # includes electron-updater + native binding prebuilt
npm run dist:win               # electron-builder --win nsis portable
                               # rebuilds @thiagoelg/node-printer for Electron's ABI
                               # (needs VS Build Tools + Python — preinstalled on the runner)
```

Output → `dist/` on the runner → uploaded as workflow artifacts, and on a
`v*` tag also attached to the GitHub Release via `softprops/action-gh-release`.

Local builds (only if you must):

```bash
npm install
npm run dist:win   # Windows machine with VS Build Tools + Python 3
npx electron-builder --mac dmg   # Mac, dev/testing only
```

Never commit `dist/` — it is gitignored. Operators always download from
GitHub Releases, never from a dev machine.

## Behavior

- **Serial queue:** concurrent prints are serialized, never interleaved.
- **Auto-retry:** transient failures retried 2x at 1s; deterministic errors
  (paused, no binding, no printer) fail fast.
- **Language check:** ERP sends `{language, data}`; if `language` disagrees
  with the printer-name guess (e.g. TSPL job to a Zebra), the job still
  prints but a mismatch warning is logged and returned.
- **Single instance:** second launch focuses the existing window.
- **Pause:** `POST /pause?pause=1` pauses (jobs get 409), `?pause=0` resumes,
  no query toggles.
- In-memory job log, resets on restart.

## HTTP API (127.0.0.1 only)

| Method | Path    | Body                           | Response                                             |
| ------ | ------- | ------------------------------ | ---------------------------------------------------- |
| GET    | /health | —                              | `{ ok, version, printer, paused, printerModule, ... }` |
| GET    | /printers | —                            | `{ printers, languages }`                            |
| GET    | /config | —                              | `{ port, printer, paused }`                          |
| POST   | /config | `{ port?, printer?, paused? }` | saved config                                         |
| GET    | /jobs   | —                              | `{ jobs: [...] }` (newest first)                     |
| POST   | /pause  | `?pause=1/0`                   | `{ ok, paused }`                                     |
| POST   | /print  | `{ language, data, printer? }` | `{ ok, printer, bytes, warning? }`                   |

## Notes

- Binds `127.0.0.1` only, CORS `*` is safe by design (any site can only reach
  the operator's own loopback).
- Config: `.agent-config.json` next to the app.
- ERP-side agent port must match the user's Printer Settings port.
