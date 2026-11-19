/**
 * Patch @thiagoelg/node-printer so it compiles with modern toolchains:
 *  1. binding.gyp: force C++17 (hardcoded C++14 breaks modern V8 headers),
 *     and call `python3` instead of `python`.
 *  2. node_printer_{win,posix}.cc: qualify dependent-base member `_value`
 *     as `this->_value` (strict two-phase lookup in VS2022+/clang rejects
 *     the unqualified name with C3861/C2065).
 * Idempotent.
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

// Dependent base-class member: MemValue<Type> derives from MemValueBase<Type>,
// so `_value` must be written `this->_value` under strict two-phase lookup.
// Negative lookbehind keeps the patch idempotent (never touches this->_value).
for (const name of ['node_printer_win.cc', 'node_printer_posix.cc']) {
  const src = path.join(__dirname, '..', 'node_modules', '@thiagoelg', 'node-printer', 'src', name);
  if (!fs.existsSync(src)) continue;
  const before = fs.readFileSync(src, 'utf8');
  const after = before.replace(/(?<![\w>.])_value/g, 'this->_value');
  if (after !== before) {
    fs.writeFileSync(src, after);
    console.log(`[build] ${name} patched: this->_value`);
  }
}
