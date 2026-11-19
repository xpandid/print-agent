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
const portInput = document.getElementById('port');
const saveBtn = document.getElementById('save');
const saveNote = document.getElementById('save-note');
const jobsBody = document.getElementById('jobs');
const jobsEmpty = document.getElementById('jobs-empty');
const jobCount = document.getElementById('job-count');

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

function openSettings() {
  saveNote.textContent = '';
  saveNote.className = '';
  Promise.all([
    request('GET', '/config').catch(() => ({})),
    request('GET', '/printers').catch(() => ({ printers: [] })),
  ]).then(([config, printers]) => {
    portInput.value = config.port || port;
    const current = config.printer || '';
    const options = ['', ...(printers.printers || [])];
    printerSelect.innerHTML = options
      .map((p) => `<option value="${escapeHtml(p)}" ${p === current ? 'selected' : ''}>${escapeHtml(p || '(default)')}</option>`)
      .join('');
  }).catch(() => {});
  settingsModal.classList.add('open');
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
      port: parseInt(portInput.value, 10) || 9101,
    });
    saveNote.textContent = 'Saved.';
    refresh();
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
