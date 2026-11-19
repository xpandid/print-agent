/**
 * Publish built installers (dist/*.exe|dmg|zip) for the ERP's
 * public/printer-agent/ folder (monorepo layout) or for a standalone
 * checkout just list them. Skips gracefully when there is no ERP public
 * folder (standalone repo + GitHub Releases flow).
 */
'use strict';

const fs = require('fs');
const path = require('path');

const sourceDir = path.join(__dirname, '..', 'dist');
// Standalone repo (CI): no ERP public/ folder — just report what was built.
const monoTarget = path.join(__dirname, '..', '..', 'public', 'printer-agent');
const targetDir = fs.existsSync(path.join(__dirname, '..', '..', 'public'))
  ? monoTarget
  : null;

if (!fs.existsSync(sourceDir)) {
  console.error('[publish] no dist/ folder found — build first (npm run dist:win)');
  process.exit(1);
}

if (!targetDir) {
  const built = fs.readdirSync(sourceDir).filter((f) => /\.(exe|dmg|zip)$/i.test(f));
  console.log('[publish] standalone repo — built files:');
  built.forEach((f) => console.log('  dist/' + f));
  console.log('[publish] done (upload dist/*.exe to a GitHub Release)');
  process.exit(0);
}

fs.mkdirSync(targetDir, { recursive: true });

const wanted = /\.(exe|dmg|zip)$/i;
let copied = 0;

for (const file of fs.readdirSync(sourceDir)) {
  if (!wanted.test(file)) continue;

  // A Windows .exe is only valid when it's a real PE binary (starts with "MZ").
  // A macOS-built exe contains a mach-o binding instead and would not print on
  // Windows, so skip those regardless of which machine ran the build.
  if (/\.exe$/i.test(file)) {
    const fd = fs.openSync(path.join(sourceDir, file), 'r');
    const header = Buffer.alloc(2);
    fs.readSync(fd, header, 0, 2, 0);
    fs.closeSync(fd);
    if (header.toString('latin1') !== 'MZ') {
      console.warn('[publish] skipping ' + file + ' (not a real Windows PE executable)');
      continue;
    }
  }

  fs.copyFileSync(path.join(sourceDir, file), path.join(targetDir, file));
  console.log('[publish] -> public/printer-agent/' + file);
  copied++;
}

// Keep only the newest build per family (dmg / installer exe / portable exe / zip)
// so the download list never shows stale versions or deletes a portable build.
const families = {};

for (const file of fs.readdirSync(targetDir)) {
  let family;
  if (/\.dmg$/i.test(file)) family = 'mac';
  else if (/\.zip$/i.test(file)) family = 'zip';
  else if (/\.exe$/i.test(file)) family = /setup/i.test(file) ? 'exec-installer' : 'exe-portable';
  else continue;

  const mtime = fs.statSync(path.join(targetDir, file)).mtimeMs;
  (families[family] = families[family] || []).push({ file, mtime });
}

for (const family of Object.keys(families)) {
  const entries = families[family].sort((a, b) => b.mtime - a.mtime);
  for (const old of entries.slice(1)) {
    fs.unlinkSync(path.join(targetDir, old.file));
    console.log('[publish] removed stale ' + old.file);
  }
}

if (!copied) {
  console.warn('[publish] no .exe/.dmg/.zip found in dist/');
}

console.log('[publish] done');
