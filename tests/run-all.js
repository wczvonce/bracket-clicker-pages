// Spustí všetky testy: node tests/run-all.js
"use strict";
const files = ["test-bracket.js", "test-prune-undo.js", "test-branch-text.js", "test-parsers.js", "test-state.js", "test-presov-2026.js"];
for (const f of files) {
  try { require("./" + f); }
  catch (e) {
    console.error(`✗ ${f} sa nepodarilo spustiť:`, e);
    process.exitCode = 1;
  }
}
require("./t").report();
