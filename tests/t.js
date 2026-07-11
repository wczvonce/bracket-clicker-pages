// Mini test runner bez závislostí.
"use strict";
let pass = 0, fail = 0;
const failures = [];
function test(name, fn) {
  try { fn(); pass++; console.log("  ✓ " + name); }
  catch (e) { fail++; failures.push({ name, e }); console.log("  ✗ " + name + "\n    " + (e && e.message)); }
}
function suite(name) { console.log("\n" + name); }
function report() {
  console.log(`\n${pass} testov prešlo, ${fail} zlyhalo`);
  if (fail) process.exitCode = 1;
  return { pass, fail, failures };
}
module.exports = { test, suite, report };
