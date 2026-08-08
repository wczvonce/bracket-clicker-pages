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
    "action:'guest_request'", "schema_version:'4'", "property_code:'APT14'", "source_site:INVOICE_SOURCE_SITE",
    "guest_name:", "street:", "postal_code:", "city:", "country:",
    "company_id:", "tax_id:", "vat_id:", "guest_email:", "booking_id:", "note:", "_honey:",
    "email_confirmed:String(", "electronic_delivery_consent:String(",
    "getOrCreateInvoiceRequestId",
    "postInvoiceRequest(data)",
    "Majiteľ dostane do jednej minúty jeden e-mail s údajmi a odkazom",
  ]) {
    assert.ok(html.includes(value), `chýba odosielaný údaj ${value}`);
  }
  assert.ok(html.includes('pattern="[0-9]{6,20}"'), "Booking ID pattern musí byť platný aj v novom Chrome");
  assert.ok(!html.includes('pattern="[0-9 -]{6,24}"'), "neplatný UnicodeSets pattern nesmie zostať v stránke");
  assert.ok(html.includes("https://script.google.com/macros/s/AKfycbwD7RRz5nJdp6FsU3vL1CTgsPNwXPuCrx1ad9JMBa8LQNDYZCTltMAtN48IRzb8NsYo/exec"), "chýba produkčný verejný intake endpoint");
  assert.ok(!html.includes("REPLACE_WITH_PUBLIC_INTAKE_DEPLOYMENT_ID"), "produkčná stránka nesmie obsahovať placeholder endpointu");
  assert.ok(!html.includes("accounts.google.com/AccountChooser"), "žiadosť nesmie posielať AccountChooser odkaz");
  assert.ok(!html.includes("buildInvoiceOwnerLink"), "starý builder odkazu nesmie zostať v stránke");
  assert.ok(!html.includes("formsubmit.co"), "žiadosť sa už nesmie posielať cez FormSubmit");
  assert.ok(!html.includes("povraznikovav@gmail.com"), "web hosťa nesmie poznať cieľový e-mail majiteľa");
});

test("AP14 formulár už neposiela starú nejednoznačnú schému", () => {
  assert.ok(!html.includes("'Meno / firma':name.value"));
  assert.ok(!html.includes("'Fakturačná adresa':bill.value"));
});

test("AP14 vymaže request_id iba po platnom pozitívnom ACK", () => {
  const ackGuard = "data.channel!==INTAKE_ACK_CHANNEL||data.ack_nonce!==nonce";
  const ackIndex = html.indexOf(ackGuard);
  const awaitIndex = html.indexOf("await postInvoiceRequest(data)", ackIndex);
  const resetIndex = html.indexOf("e.target.reset()", awaitIndex);
  const clearIndex = html.indexOf("clearInvoiceRequestId()", awaitIndex);
  assert.ok(ackIndex >= 0, "chýba kontrola kanála a nonce ACK");
  assert.ok(html.includes("data.ok===true?finish(true,data)"), "iba pozitívny ACK smie potvrdiť prijatie");
  assert.ok(awaitIndex > ackIndex, "odoslanie musí čakať na ACK");
  assert.ok(resetIndex > awaitIndex, "formulár sa nesmie resetovať pred ACK");
  assert.ok(clearIndex > awaitIndex, "request_id sa nesmie vymazať pred ACK");
  assert.strictEqual((html.match(/clearInvoiceRequestId\(\)/g) || []).length, 2,
    "request_id sa smie mazať iba definíciou funkcie a po úspechu");
});

test("AP14 používa URL-encoded sandbox iframe a overuje pôvod aj zdroj ACK", () => {
  for (const value of [
    "form.enctype='application/x-www-form-urlencoded'",
    "frame.setAttribute('sandbox','allow-scripts allow-same-origin')",
    "frame.referrerPolicy='no-referrer'",
    "Object.entries({...payload,ack_nonce:nonce})",
    "isIntakeAckSource(event.source,frame.contentWindow)",
    "isAllowedIntakeAckOrigin(event.origin)",
    "script.googleusercontent.com",
    "window.removeEventListener('message',onMessage)",
    "form.remove();frame.remove()",
    "setTimeout(()=>finish(false,new Error('timeout')),INTAKE_TIMEOUT_MS)",
  ]) {
    assert.ok(html.includes(value), `chýba bezpečnostná vlastnosť transportu: ${value}`);
  }
});

test("AP14 generuje oddelené 128-bitové request a ACK nonce", () => {
  const getRandomValuesCalls = html.match(/crypto\.getRandomValues\(bytes\)/g) || [];
  assert.strictEqual(getRandomValuesCalls.length, 2, "request_id aj ACK nonce musia mať vlastný bezpečný random");
  assert.ok(html.includes("const bytes=new Uint8Array(16)"), "nonce musí používať 16 bajtov (128 bitov)");
  assert.ok(html.includes("const nonce=createInvoiceAckNonce()"));
});

test("inline JavaScript stránky AP14 je syntakticky platný", () => {
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(match => match[1]);
  assert.ok(scripts.length > 0, "nenašiel sa inline JavaScript");
  for (const script of scripts) new Function(script);
});
