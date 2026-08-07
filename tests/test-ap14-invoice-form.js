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
    "schema_version:'3'", "property_code:'APT14'", "source_site:INVOICE_SOURCE_SITE",
    "email_confirmed:String(", "electronic_delivery_consent:String(",
    "'[FAKTURA-ZIADOST][APT14] Apartmán 14, Školská 9'",
    "getOrCreateInvoiceRequestId", "povraznikovav@gmail.com",
    "INVOICE_OWNER_NEXT_STEP",
    "Ďalší krok",
    "Bezpečný odkaz na doplnenie pobytu a ceny príde samostatným e-mailom do schránky majiteľa do jednej minúty.",
    "const response=await r.json().catch(()=>null)",
    "(response.success!==true&&response.success!=='true')",
  ]) {
    assert.ok(html.includes(value), `chýba odosielaný údaj ${value}`);
  }
  assert.ok(!html.includes("__APPS_SCRIPT_EXEC_URL__"), "produkčný endpoint nesmie zostať placeholder");
  assert.ok(!html.includes("script.google.com/macros/s/"), "žiadosť nesmie posielať súkromný Apps Script odkaz");
  assert.ok(!html.includes("accounts.google.com/AccountChooser"), "žiadosť nesmie posielať AccountChooser odkaz");
  assert.ok(!html.includes("buildInvoiceOwnerLink"), "starý builder odkazu nesmie zostať v stránke");
});

test("AP14 formulár už neposiela starú nejednoznačnú schému", () => {
  assert.ok(!html.includes("'Meno / firma':name.value"));
  assert.ok(!html.includes("'Fakturačná adresa':bill.value"));
});

test("AP14 potvrdí odoslanie iba po kladnej JSON odpovedi FormSubmit", () => {
  const guard = "if(!r.ok||!response||(response.success!==true&&response.success!=='true'))";
  const guardIndex = html.indexOf(guard);
  const resetIndex = html.indexOf("e.target.reset()", guardIndex);
  const clearIndex = html.indexOf("clearInvoiceRequestId()", guardIndex);
  assert.ok(guardIndex >= 0, "chýba prísna kontrola JSON odpovede");
  assert.ok(resetIndex > guardIndex, "formulár sa nesmie resetovať pred potvrdením odpovede");
  assert.ok(clearIndex > guardIndex, "request_id sa nesmie vymazať pred potvrdením odpovede");
  assert.strictEqual((html.match(/clearInvoiceRequestId\(\)/g) || []).length, 2,
    "request_id sa smie mazať iba definíciou funkcie a po úspechu");
});

test("inline JavaScript stránky AP14 je syntakticky platný", () => {
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(match => match[1]);
  assert.ok(scripts.length > 0, "nenašiel sa inline JavaScript");
  for (const script of scripts) new Function(script);
});
