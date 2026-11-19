/**
 * Copy the freshly rebuilt native binary into lib/ where
 * @thiagoelg/node-printer's loader (lib/printer.js) expects it.
 * node-gyp outputs build/Release/node_printer.node; the package requires
 * lib/node_printer.node first (then a platform-suffixed name).
 */
'use strict';

const fs = require('fs');
const path = require('path');

const pkg = path.join(__dirname, '..', 'node_modules', '@thiagoelg', 'node-printer');
const from = path.join(pkg, 'build', 'Release', 'node_printer.node');
const to = path.join(pkg, 'lib', 'node_printer.node');

if (!fs.existsSync(from)) {
  console.error('[build] rebuilt binary not found:', from);
  process.exit(1);
}

fs.copyFileSync(from, to);
console.log('[build] copied', path.basename(from), 'to lib/');
