"use strict";
const fs = require("fs");
const path = require("path");
const assert = require("node:assert");
const { test } = require("./t");

const html = fs.readFileSync(path.join(__dirname, "..", "ap14-k7x2", "index.html"), "utf8");

test("AP14 fakturačný formulár obsahuje údaje potrebné pre automatizáciu", () => {
  for (const id of [
    "invoiceName", "invoiceStreet", "invoicePostalCode", "invoiceCity",
    "invoiceCountry", "invoiceEmail", "invoiceEmailConfirm", "invoiceBookingId",
    "invoiceConsent", "invoiceNote",
  ]) {
    assert.ok(html.includes(`id="${id}"`), `chýba pole ${id}`);
  }
  for (const value of [
    "schema_version:'2'", "property_code:'APT7'", "source_site:location.hostname",
    "email_confirmed:'true'", "electronic_delivery_consent:String(",
    "'[FAKTURA-ZIADOST][APT7] Apartmán 7, Školská 9'",
  ]) {
    assert.ok(html.includes(value), `chýba odosielaný údaj ${value}`);
  }
});

test("AP14 formulár už neposiela starú nejednoznačnú schému", () => {
  assert.ok(!html.includes("'Meno / firma':name.value"));
  assert.ok(!html.includes("'Fakturačná adresa':bill.value"));
});

test("inline JavaScript stránky AP14 je syntakticky platný", () => {
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(match => match[1]);
  assert.ok(scripts.length > 0, "nenašiel sa inline JavaScript");
  for (const script of scripts) new Function(script);
});
