/**
 * Xpand Printer Agent — Electron tray app with a small management window
 * (BigSeller-plugin style): pick the printer, pause the queue, watch the job log.
 */
'use strict';

const { app, Tray, Menu, nativeImage, dialog, BrowserWindow, ipcMain } = require('electron');
const fs = require('fs');
const path = require('path');
const agent = require('./agent-core');

app.setName('Xpand Printer Agent');

// Single instance: second launch focuses the existing window instead of
// starting a second HTTP server on the same port.
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    createWindow();
  });
}

// Auto-update from GitHub Releases (CI publishes dist/*.exe there).
// State is pushed to the window; the settings modal offers a manual check.
let autoUpdater = null;
let updateState = { status: 'idle', info: null };
try {
  ({ autoUpdater } = require('electron-updater'));
} catch (e) { /* updater optional (headless / no publish config) */ }

function setUpdateState(status, info = null) {
  updateState = { status, info };
  if (win && !win.isDestroyed()) {
    win.webContents.send('agent-update-state', updateState);
  }
}

if (autoUpdater) {
  autoUpdater.autoDownload = true;
  autoUpdater.on('checking-for-update', () => setUpdateState('checking'));
  autoUpdater.on('update-available', (info) => setUpdateState('available', { version: info && info.version }));
  autoUpdater.on('update-not-available', () => setUpdateState('latest'));
  autoUpdater.on('download-progress', (p) => setUpdateState('downloading', { percent: Math.round(p.percent || 0) }));
  autoUpdater.on('update-downloaded', (info) => setUpdateState('downloaded', { version: info && info.version }));
  autoUpdater.on('error', (err) => setUpdateState('error', { message: String((err && err.message) || err) }));
  app.whenReady().then(() => {
    autoUpdater.checkForUpdatesAndNotify().catch(() => {});
  });
}

ipcMain.handle('agent-update-state', () => updateState);
ipcMain.handle('agent-check-update', async () => {
  if (!autoUpdater) return { status: 'unavailable', info: null };
  setUpdateState('checking');
  try {
    await autoUpdater.checkForUpdates();
  } catch (e) {
    setUpdateState('error', { message: String((e && e.message) || e) });
  }
  return updateState;
});
ipcMain.handle('agent-quit-install', () => {
  if (autoUpdater) autoUpdater.quitAndInstall();
});

let tray = null;
let win = null;

function trayIcon() {
  const file = path.join(__dirname, 'ui', 'icon.png');
  if (fs.existsSync(file)) {
    return nativeImage.createFromPath(file).resize({ width: 16, height: 16 });
  }
  const b64 =
    'iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAfUlEQVR4nGP8z8Dwn4ECwPD/H8PA' +
    'gAaMAKZwMM3AgIEZwJqFzMAMwGoeAw7A2CNNQxMRAZgxDYOqoQsuX9pQDFdeJaoBjAGYFAgTcy6' +
    '6DU9lHXkoA9gMk6HnIDqkmOwgbgICnSkmOQhHo5CBcAJqKk0DE+HDAAwAGLSEHjIfBSAAAAAASUVORK5CYII=';
  const image = nativeImage.createFromDataURL('data:image/png;base64,' + b64);
  return image.resize({ width: 16, height: 16 });
}

function createWindow() {
  try {
    if (win) {
      win.show();
      win.focus();
      return;
    }

    win = new BrowserWindow({
      width: 720,
      height: 560,
      title: 'Xpand Printer Agent',
      show: true,
      icon: path.join(__dirname, 'ui', 'icon.png'),
      webPreferences: {
        nodeIntegration: true,
        contextIsolation: false,
      },
    });

    win.webContents.on('did-fail-load', (_e, code, desc, url) => {
      console.error('[agent-ui] failed to load:', code, desc, url);
    });
    win.webContents.on('render-process-gone', (_e, details) => {
      console.error('[agent-ui] renderer gone:', JSON.stringify(details));
    });
    win.webContents.on('did-finish-load', () => {
      console.log('[agent-ui] window loaded');
    });
    win.on('closed', () => {
      win = null;
    });

    win.loadFile(path.join(__dirname, 'ui', 'index.html'), { query: { port: String(agent.getPort()) } });

    // Guarantee visibility even if the page is slow or the first paint is late.
    win.show();
    win.focus();
    setTimeout(() => {
      if (win) {
        if (!win.isVisible()) {
          win.show();
          win.focus();
          console.log('[agent-ui] forced visible again');
        }
        console.log('[agent-ui] visible =', win.isVisible());
      }
    }, 800);
  } catch (err) {
    console.error('[agent-ui] window creation failed:', err);
  }
}

function buildMenu() {
  return Menu.buildFromTemplate([
    { label: 'Xpand Printer Agent', enabled: false },
    { label: 'Open Agent', click: createWindow },
    { type: 'separator' },
    { label: 'Quit', role: 'quit' },
  ]);
}

app.whenReady().then(() => {
  agent.loadConfig();

  const server = agent.createServer();
  server.on('error', (err) => {
    dialog.showErrorBox('Xpand Printer Agent', `Unable to start on port ${agent.getPort()}: ${err.message}`);
  });
  server.listen(agent.getPort(), '127.0.0.1', () => {
    console.log(`Xpand Printer Agent listening on http://127.0.0.1:${agent.getPort()}`);
  });

  agent.attachRestart(() => {
    const port = agent.getPort();
    const listen = () => {
      server.listen(port, '127.0.0.1', () => {
        console.log(`Xpand Printer Agent listening on http://127.0.0.1:${port}`);
      });
    };
    if (server.listening) server.close(listen);
    else listen();
  });

  tray = new Tray(trayIcon());
  tray.setToolTip('Xpand Printer Agent');
  tray.setContextMenu(buildMenu());
  tray.on('click', createWindow);

  // Show the management window on launch so it's obvious the agent is running.
  createWindow();
});

// macOS: re-open / show the window when the Dock icon is clicked.
app.on('activate', () => {
  createWindow();
});

app.on('before-quit', () => {
  agent.stop();
});

app.on('window-all-closed', (e) => e.preventDefault());