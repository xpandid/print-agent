/**
 * Patch @thiagoelg/node-printer's binding.gyp so it compiles with C++17.
 * Its hardcoded "-std=c++14" breaks against the modern V8 headers used by
 * Electron/Node (no is_*_v type_traits). Idempotent.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, '..', 'node_modules', '@thiagoelg', 'node-printer', 'binding.gyp');

if (!fs.existsSync(file)) {
  console.error('[build] binding.gyp not found:', file);
  process.exit(1);
}

let source = fs.readFileSync(file, 'utf8');

// The fork compiles with C++14, which modern V8 headers reject; force C++17.
source = source.replace(/-std=c\+\+14/g, '-std=c++17');
if (!source.includes('-std=c++17')) {
  console.error('[build] could not patch C++ standard in binding.gyp');
  process.exit(1);
}

// The gyp action calls `python`, which does not exist on macOS (only python3).
source = source.replace(/\["python",/g, '["python3",');
if (!source.includes('["python3",')) {
  console.error('[build] could not patch python action in binding.gyp');
  process.exit(1);
}

fs.writeFileSync(file, source);
console.log('[build] binding.gyp patched: C++17 + python3');
