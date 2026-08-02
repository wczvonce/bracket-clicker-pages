"use strict";
const fs = require("fs");
const path = require("path");
const assert = require("node:assert");
const { test } = require("./t");

const html = fs.readFileSync(path.join(__dirname, "..", "owner-invoice", "index.html"), "utf8");

test("mobilný formulár vlastníka obsahuje iba potrebné údaje a podpísaný token", () => {
  for (const id of ["checkIn", "checkOut", "totalGross", "emailVerified"]) {
    assert.ok(html.includes(`id="${id}"`), `chýba pole ${id}`);
  }
  for (const field of ["owner_form_version", "owner_form_token", '"Príchod"', '"Odchod"', '"Celková cena"']) {
    assert.ok(html.includes(field), `chýba ${field}`);
  }
  assert.ok(html.includes("location.hash.slice(1)"));
  assert.ok(html.includes('content="strict-origin-when-cross-origin"'));
  assert.ok(!html.includes('content="no-referrer"'));
  assert.ok(!html.includes("localStorage"));
});

test("úspech sa ukáže iba po kladnej JSON odpovedi FormSubmit", () => {
  assert.ok(html.includes("await response.json()"));
  assert.ok(html.includes("!responseData.success"));
  assert.ok(html.includes("request_id: claims.rid"));
  assert.ok(html.includes("faktúru odošle až v deň odchodu"));
});

test("inline JavaScript mobilného formulára je syntakticky platný", () => {
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(match => match[1]);
  assert.equal(scripts.length, 1);
  new Function(scripts[0]);
});
