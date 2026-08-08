"use strict";
const fs = require("fs");
const path = require("path");
const assert = require("node:assert");
const { webcrypto } = require("node:crypto");
const vm = require("node:vm");
const { test } = require("./t");

const html = fs.readFileSync(path.join(__dirname, "..", "ap14-k7x2", "index.html"), "utf8");
const idempotencyScript = fs.readFileSync(
  path.join(__dirname, "..", "ap14-k7x2", "invoice-idempotency.js"),
  "utf8",
);

function memoryStorage({ rejectWrites = false } = {}) {
  const values = new Map();
  return {
    getItem(key) { return values.has(key) ? values.get(key) : null; },
    setItem(key, value) {
      if (rejectWrites) throw new Error("storage blocked");
      values.set(key, String(value));
    },
    removeItem(key) { values.delete(key); },
  };
}

function loadAp14Idempotency({ sessionStorage, localStorage, requestIds, clearOnSubmit = false }) {
  const fields = {
    invoiceRequestId: { value: "" },
    invoiceEmail: { value: "host@example.com" },
    invoiceEmailConfirm: { value: "host@example.com" },
    invoiceName: { value: "Test Guest" },
    invoiceStreet: { value: "Test 1" },
    invoicePostalCode: { value: "97401" },
    invoiceCity: { value: "Banská Bystrica" },
    invoiceCountry: { value: "Slovensko" },
    invoiceCompanyId: { value: "" },
    invoiceTaxId: { value: "" },
    invoiceVatId: { value: "" },
    invoiceBookingId: { value: "123456789" },
    invoiceNote: { value: "" },
    invoiceEmailConfirmedCheck: { checked: true },
    invoiceConsent: { checked: true },
    invoiceHoney: { value: "" },
    status: { textContent: "" },
  };
  const submittedIds = [];
  let requestIdCalls = 0;
  let originalClearCalls = 0;
  let sandbox;
  const form = {
    async onsubmit() {
      submittedIds.push(fields.invoiceRequestId.value);
      if (clearOnSubmit) sandbox.clearInvoiceRequestId();
    },
  };
  sandbox = {
    __AP14_INVOICE_IDEMPOTENCY_TEST__: true,
    crypto: webcrypto,
    TextEncoder,
    sessionStorage,
    localStorage,
    document: {
      getElementById(id) {
        if (id === "form") return form;
        assert.ok(fields[id], `unexpected field ${id}`);
        return fields[id];
      },
    },
    createInvoiceRequestId() {
      const value = requestIds[requestIdCalls];
      requestIdCalls += 1;
      if (!value) throw new Error("unexpected request id generation");
      return value;
    },
    clearInvoiceRequestId() {
      originalClearCalls += 1;
      fields.invoiceRequestId.value = "";
    },
  };
  vm.runInNewContext(idempotencyScript, sandbox, { filename: "invoice-idempotency.js" });
  return {
    api: sandbox.__AP14_INVOICE_IDEMPOTENCY_TEST_API__,
    fields,
    form,
    submittedIds,
    get requestIdCalls() { return requestIdCalls; },
    get originalClearCalls() { return originalClearCalls; },
  };
}

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

test("AP14 načíta reload-safe idempotency skript bez zmeny produkčného endpointu", () => {
  assert.ok(html.includes('<script src="./invoice-idempotency.js?v=20260809-1"></script>'));
  assert.ok(idempotencyScript.includes('var STORAGE_KEY = "booking-invoice-pending-v1:" + SOURCE_SITE'));
  assert.ok(idempotencyScript.includes('crypto.subtle.digest("SHA-256"'));
  assert.ok(idempotencyScript.includes('["localStorage", "sessionStorage"]'));
  assert.ok(idempotencyScript.includes('throw new Error("pending-storage-unavailable")'));
  assert.ok(idempotencyScript.includes("originalSubmit.call(this, event)"));
  assert.ok(idempotencyScript.includes("clearMatchingRequest(activeRequestId, activeFingerprint)"));
  assert.ok(!idempotencyScript.includes("script.google.com/macros"), "helper nesmie meniť endpoint");
  new vm.Script(idempotencyScript);
});

test("AP14 po reloade použije rovnaké ID, zmena payloadu vytvorí nové a ACK pending vymaže", async () => {
  const sessionStorage = memoryStorage();
  const localStorage = memoryStorage();
  const ids = [
    "web-11111111111111111111111111111111",
    "web-22222222222222222222222222222222",
    "web-33333333333333333333333333333333",
  ];
  const now = 1900000000000;
  const first = loadAp14Idempotency({ sessionStorage, localStorage, requestIds: ids });
  const payload = first.api.payloadFromForm();
  const fingerprint = await first.api.createFingerprint(payload);
  const firstId = first.api.getOrCreateRequestId(fingerprint, now);
  assert.equal(firstId, ids[0]);

  const reload = loadAp14Idempotency({ sessionStorage: memoryStorage(), localStorage, requestIds: ids.slice(1) });
  const reloadFingerprint = await reload.api.createFingerprint(reload.api.payloadFromForm());
  assert.equal(reloadFingerprint, fingerprint);
  assert.equal(reload.api.getOrCreateRequestId(reloadFingerprint, now + 1), firstId);
  assert.equal(reload.requestIdCalls, 0);

  reload.fields.invoiceName.value = "Changed Guest";
  const changedFingerprint = await reload.api.createFingerprint(reload.api.payloadFromForm());
  const changedId = reload.api.getOrCreateRequestId(changedFingerprint, now + 2);
  assert.equal(changedId, ids[1]);
  reload.api.clearMatchingRequest(firstId, fingerprint, now + 3);
  assert.equal(reload.fields.invoiceRequestId.value, changedId, "stale ACK nesmie vymazať novšiu žiadosť");
  reload.api.clearMatchingRequest(changedId, changedFingerprint, now + 4);
  assert.equal(localStorage.getItem(reload.api.storageKey), null);

  const afterAck = loadAp14Idempotency({ sessionStorage: memoryStorage(), localStorage, requestIds: ids.slice(2) });
  afterAck.fields.invoiceName.value = "Changed Guest";
  const afterAckFingerprint = await afterAck.api.createFingerprint(afterAck.api.payloadFromForm());
  assert.equal(afterAck.api.getOrCreateRequestId(afterAckFingerprint, now + 5), ids[2]);
});

test("AP14 wrapper ponechá pending pri chybe a po simulovanom pozitívnom ACK ho vymaže", async () => {
  const sessionStorage = memoryStorage();
  const localStorage = memoryStorage();
  const ids = ["web-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "web-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"];
  const failed = loadAp14Idempotency({ sessionStorage, localStorage, requestIds: ids, clearOnSubmit: false });
  await failed.form.onsubmit({ preventDefault() {} });
  assert.deepEqual(failed.submittedIds, [ids[0]]);
  assert.ok(localStorage.getItem(failed.api.storageKey), "nepotvrdené odoslanie musí prežiť aj zatvorenie karty");

  const acknowledged = loadAp14Idempotency({
    sessionStorage: memoryStorage(),
    localStorage,
    requestIds: ids.slice(1),
    clearOnSubmit: true,
  });
  await acknowledged.form.onsubmit({ preventDefault() {} });
  assert.deepEqual(acknowledged.submittedIds, [ids[0]], "reload musí poslať rovnaký request_id");
  assert.equal(acknowledged.requestIdCalls, 0);
  assert.equal(acknowledged.originalClearCalls, 1);
  assert.equal(localStorage.getItem(acknowledged.api.storageKey), null);
});

test("AP14 používa sessionStorage fallback a ukladá iba ID, hash a expiráciu", async () => {
  const blockedLocal = memoryStorage({ rejectWrites: true });
  const sessionStorage = memoryStorage();
  const ids = ["web-cccccccccccccccccccccccccccccccc", "web-dddddddddddddddddddddddddddddddd"];
  const first = loadAp14Idempotency({ sessionStorage, localStorage: blockedLocal, requestIds: ids });
  const fingerprint = await first.api.createFingerprint(first.api.payloadFromForm());
  const requestId = first.api.getOrCreateRequestId(fingerprint, 1900000000000);
  const stored = sessionStorage.getItem(first.api.storageKey);
  assert.ok(stored);
  assert.doesNotMatch(stored, /Test Guest|host@example\.com|Test 1/);

  const reload = loadAp14Idempotency({ sessionStorage, localStorage: blockedLocal, requestIds: ids.slice(1) });
  const reloadFingerprint = await reload.api.createFingerprint(reload.api.payloadFromForm());
  assert.equal(reload.api.getOrCreateRequestId(reloadFingerprint, 1900000000001), requestId);
  assert.equal(reload.requestIdCalls, 0);
});

test("AP14 bez dostupného persistentného storage zlyhá pred prípravou POST", async () => {
  const direct = loadAp14Idempotency({
    sessionStorage: memoryStorage({ rejectWrites: true }),
    localStorage: memoryStorage({ rejectWrites: true }),
    requestIds: ["web-eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee"],
  });
  const fingerprint = await direct.api.createFingerprint(direct.api.payloadFromForm());
  assert.throws(
    () => direct.api.getOrCreateRequestId(fingerprint, 1900000000000),
    /pending-storage-unavailable/,
  );
  assert.equal(direct.fields.invoiceRequestId.value, "");

  const wrapped = loadAp14Idempotency({
    sessionStorage: memoryStorage({ rejectWrites: true }),
    localStorage: memoryStorage({ rejectWrites: true }),
    requestIds: ["web-ffffffffffffffffffffffffffffffff"],
  });
  await wrapped.form.onsubmit({ preventDefault() {} });
  assert.deepEqual(wrapped.submittedIds, [], "pôvodný submit/POST sa nesmie spustiť");
  assert.equal(wrapped.fields.invoiceRequestId.value, "");
  assert.match(wrapped.fields.status.textContent, /Bezpečné opakované odoslanie/);
});

test("inline JavaScript stránky AP14 je syntakticky platný", () => {
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(match => match[1]);
  assert.ok(scripts.length > 0, "nenašiel sa inline JavaScript");
  for (const script of scripts) new Function(script);
});
