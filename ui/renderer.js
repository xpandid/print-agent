/**
 * Renderer for the Xpand Printer Agent window (ERP-styled).
 * Main view is the Job Log; the gear opens Printer Settings (printer + port).
 * Talks to the local HTTP server on 127.0.0.1:<port> using Node's http module.
 */
'use strict';

const http = require('http');

const port = new URLSearchParams(location.search).get('port') || '9101';
const base = `http://127.0.0.1:${port}`;

const banner = document.getElementById('banner');
const statusEl = document.getElementById('status');
const gearBtn = document.getElementById('gear');
const settingsModal = document.getElementById('settings-modal');
const printerSelect = document.getElementById('printer');
const languageSelect = document.getElementById('language');
const portInput = document.getElementById('port');
const saveBtn = document.getElementById('save');
const saveNote = document.getElementById('save-note');
const jobsBody = document.getElementById('jobs');
const jobsEmpty = document.getElementById('jobs-empty');
const jobCount = document.getElementById('job-count');
const agentSubEl = document.getElementById('agent-sub');
const appVersionEl = document.getElementById('app-version');
const updateStateEl = document.getElementById('update-state');
const checkUpdateBtn = document.getElementById('check-update');
const quitInstallBtn = document.getElementById('quit-install');

let ipcRenderer = null;
try {
  ({ ipcRenderer } = require('electron'));
} catch (e) { /* headless: no updater UI */ }

function renderUpdateState(state) {
  if (!updateStateEl) return;
  quitInstallBtn.style.display = 'none';
  const s = (state && state.status) || 'idle';
  if (s === 'idle' || s === 'latest') {
    updateStateEl.textContent = s === 'latest' ? '· up to date' : '';
  } else if (s === 'checking') {
    updateStateEl.textContent = '· checking…';
  } else if (s === 'available') {
    updateStateEl.textContent = `· v${(state.info && state.info.version) || '?'} available — downloading…`;
  } else if (s === 'downloading') {
    updateStateEl.textContent = `· downloading ${(state.info && state.info.percent) || 0}%…`;
  } else if (s === 'downloaded') {
    updateStateEl.textContent = `· v${(state.info && state.info.version) || '?'} ready`;
    quitInstallBtn.style.display = '';
  } else if (s === 'error') {
    updateStateEl.textContent = `· update check failed${state.info && state.info.message ? ': ' + state.info.message : ''}`;
  } else if (s === 'unavailable') {
    updateStateEl.textContent = '· auto-update unavailable in this build';
  }
}

if (ipcRenderer) {
  ipcRenderer.on('agent-update-state', (_e, state) => renderUpdateState(state));
  ipcRenderer.invoke('agent-update-state').then(renderUpdateState).catch(() => {});
  checkUpdateBtn.addEventListener('click', async () => {
    renderUpdateState({ status: 'checking' });
    try {
      renderUpdateState(await ipcRenderer.invoke('agent-check-update'));
    } catch (e) {
      renderUpdateState({ status: 'error', info: { message: String((e && e.message) || e) } });
    }
  });
  quitInstallBtn.addEventListener('click', () => ipcRenderer.invoke('agent-quit-install').catch(() => {}));
} else if (checkUpdateBtn) {
  checkUpdateBtn.style.display = 'none';
}

function request(method, path, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const req = http.request(base + path, {
      method,
      headers: data
        ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) }
        : {},
      timeout: 5000,
    }, (res) => {
      let text = '';
      res.on('data', (c) => (text += c));
      res.on('end', () => {
        try {
          resolve(JSON.parse(text));
        } catch (e) {
          resolve({ ok: false, error: text });
        }
      });
    });
    req.on('error', () => reject(new Error('agent unreachable')));
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('timeout'));
    });
    if (data) req.write(data);
    req.end();
  });
}

async function refresh() {
  try {
    const health = await request('GET', '/health');
    statusEl.textContent = health.printerModule ? 'Online' : 'Offline';
    statusEl.className = 'pill ' + (health.printerModule ? 'on' : 'off');
    banner.style.display = health.printerModule ? 'none' : 'block';
    if (appVersionEl && health.version) appVersionEl.textContent = 'v' + health.version;
    if (agentSubEl) {
      const lang = (health.detectedLanguage || 'zpl').toUpperCase();
      const manual = health.languageSource === 'manual' ? ' (manual)' : '';
      agentSubEl.textContent = health.printer
        ? `${health.printer} · ${lang}${manual}`
        : 'Local label printing · 127.0.0.1';
    }

    renderJobs(await request('GET', '/jobs').catch(() => ({ jobs: [] })));
  } catch (e) {
    statusEl.textContent = 'Offline';
    statusEl.className = 'pill off';
  }
}

function renderJobs(resp) {
  const jobs = resp.jobs || [];
  jobCount.textContent = String(jobs.length);
  jobsBody.innerHTML = jobs
    .map((j) => {
      const time = (j.at || '').replace('T', ' ').slice(0, 19);
      const pill = j.ok ? 'pill-ok' : 'pill-fail';
      return `<tr>
        <td class="time">${escapeHtml(time)}</td>
        <td>${escapeHtml(j.printer || '—')}</td>
        <td>${escapeHtml((j.language || '').toUpperCase())}</td>
        <td>${j.bytes ?? 0}</td>
        <td><span class="${pill}">${j.ok ? 'OK' : 'FAIL'}</span></td>
        <td class="err" title="${escapeHtml(j.error || '')}">${escapeHtml(j.error || '')}</td>
      </tr>`;
    })
    .join('');
  jobsEmpty.style.display = jobs.length ? 'none' : 'block';
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[ch]));
}

function renderPrinterOptions(current, names, langMap) {
  const options = ['', ...(names || [])];
  if (current && !options.includes(current)) options.push(current);
  printerSelect.innerHTML = options
    .map((p) => {
      const lang = p && langMap && langMap[p] ? ` (${langMap[p].toUpperCase()})` : '';
      return `<option value="${escapeHtml(p)}" ${p === current ? 'selected' : ''}>${escapeHtml((p || '(default)') + lang)}</option>`;
    })
    .join('');
}

async function openSettings() {
  saveNote.textContent = '';
  saveNote.className = '';
  settingsModal.classList.add('open');

  // Never wipe the dropdown before a successful fetch: on failure the last
  // known list (and the saved choice) stays selectable.
  let config = {};
  try {
    config = await request('GET', '/config');
    portInput.value = config.port || portInput.value || port;
  } catch (e) {
    saveNote.textContent = 'Agent unreachable — showing last known settings.';
    saveNote.className = 'err';
    return;
  }

  const current = config.printer || '';
  languageSelect.value = config.language || '';
  try {
    const printers = await request('GET', '/printers');
    const langMap = {};
    for (const entry of printers.languages || []) {
      if (entry && entry.printer) langMap[entry.printer] = entry.language;
    }
    renderPrinterOptions(current, printers.printers, langMap);
    if (!printers.printerModule && !(printers.printers || []).length) {
      saveNote.textContent = 'Printer list unavailable — binding not loaded or agent offline. Saved choice kept.';
      saveNote.className = 'err';
    }
  } catch (e) {
    renderPrinterOptions(current, [...printerSelect.options].map((o) => o.value).filter(Boolean));
    saveNote.textContent = 'Could not load printers — saved choice kept.';
    saveNote.className = 'err';
  }
}

function closeSettings() {
  settingsModal.classList.remove('open');
}

async function saveSettings() {
  saveNote.textContent = '';
  saveNote.className = '';
  try {
    await request('POST', '/config', {
      printer: printerSelect.value || null,
      language: languageSelect.value || null,
      port: parseInt(portInput.value, 10) || 9101,
    });
    saveNote.textContent = 'Saved.';
    refresh();
    setTimeout(closeSettings, 600);
  } catch (e) {
    saveNote.textContent = 'Save failed.';
    saveNote.className = 'err';
  }
}

gearBtn.addEventListener('click', openSettings);
document.getElementById('close-settings').addEventListener('click', closeSettings);
document.getElementById('cancel-settings').addEventListener('click', closeSettings);
saveBtn.addEventListener('click', saveSettings);

refresh();
setInterval(refresh, 3000);
