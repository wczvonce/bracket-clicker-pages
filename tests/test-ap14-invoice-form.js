"use strict";
const fs = require("fs");
const path = require("path");
const assert = require("node:assert");
const { webcrypto } = require("node:crypto");
const vm = require("node:vm");
const { test } = require("./t");

const html = fs.readFileSync(path.join(__dirname, "..", "ap14-k7x2", "index.html"), "utf8");
const publicWrapper = fs.readFileSync(path.join(__dirname, "..", "apartman-14", "index.html"), "utf8");
const idempotencyScript = fs.readFileSync(
  path.join(__dirname, "..", "ap14-k7x2", "invoice-idempotency.js"),
  "utf8",
);

function memoryStorage({
  rejectWrites = false,
  rejectRemoves = false,
  failWritesAfter = Number.POSITIVE_INFINITY,
} = {}) {
  const values = new Map();
  let writeCalls = 0;
  return {
    getItem(key) { return values.has(key) ? values.get(key) : null; },
    setItem(key, value) {
      if (rejectWrites || writeCalls >= failWritesAfter) throw new Error("storage blocked");
      writeCalls += 1;
      values.set(key, String(value));
    },
    removeItem(key) {
      if (rejectRemoves) throw new Error("storage remove blocked");
      values.delete(key);
    },
  };
}

function serializedLocks() {
  const tails = new Map();
  let requestCalls = 0;
  return {
    get requestCalls() { return requestCalls; },
    request(name, options, callback) {
      assert.strictEqual(options.mode, "exclusive");
      requestCalls += 1;
      const previous = tails.get(name) || Promise.resolve();
      let release;
      const gate = new Promise(resolve => { release = resolve; });
      const tail = previous.then(() => gate);
      tails.set(name, tail);
      return previous
        .then(() => callback({ name, mode: "exclusive" }))
        .finally(() => {
          release();
          if (tails.get(name) === tail) tails.delete(name);
        });
    },
  };
}

function loadAp14Idempotency({
  sessionStorage,
  localStorage,
  requestIds,
  clearOnSubmit = false,
  locks = serializedLocks(),
  includeLocks = true,
  baseHandlerReady = true,
  onRequestIdGenerated = null,
}) {
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
    __AP14_INVOICE_BASE_HANDLER_READY__: baseHandlerReady,
    crypto: webcrypto,
    TextEncoder,
    sessionStorage,
    localStorage,
    navigator: includeLocks ? { locks } : {},
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
      if (onRequestIdGenerated) onRequestIdGenerated(fields);
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
    get ready() { return sandbox.__AP14_INVOICE_IDEMPOTENCY_READY__; },
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
  assert.ok(html.includes("bookingIdInput.removeAttribute('required')"), "Booking ID musí byť voliteľné");
  assert.ok(html.includes("bookingIdLabel.textContent+=' (voliteľné)'"), "hosť musí vidieť, že Booking ID je voliteľné");
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

test("AP14 načíta strict idempotency helper bez zmeny produkčného endpointu", () => {
  assert.ok(html.includes('<script src="./invoice-idempotency.js?v=20260809-2"></script>'));
  assert.ok(idempotencyScript.includes('var LEGACY_STORAGE_KEY = "booking-invoice-pending-v1:" + SOURCE_SITE'));
  assert.ok(idempotencyScript.includes('var STORAGE_KEY_PREFIX = LEGACY_STORAGE_KEY + ":"'));
  assert.ok(idempotencyScript.includes('crypto.subtle.digest("SHA-256"'));
  assert.ok(idempotencyScript.includes("globalThis.localStorage"));
  assert.ok(!idempotencyScript.includes("sessionStorage"));
  assert.ok(!idempotencyScript.includes("pendingMemory"));
  assert.ok(idempotencyScript.includes("globalThis.navigator && globalThis.navigator.locks"));
  assert.ok(idempotencyScript.includes('{ mode: "exclusive" }'));
  assert.ok(idempotencyScript.includes('throw new Error("pending-storage-unavailable")'));
  assert.ok(idempotencyScript.includes("activeRequestId = await getOrCreateRequestId(activeFingerprint)"));
  assert.ok(idempotencyScript.includes("canonicalPayload(payloadFromForm()) !== payloadSnapshot"));
  assert.ok(idempotencyScript.includes("__AP14_INVOICE_BASE_HANDLER_READY__ !== true"));
  assert.ok(idempotencyScript.includes('state: "acknowledged"'));
  assert.ok(!idempotencyScript.includes("removeKeyConfirmed(LEGACY_STORAGE_KEY)"));
  assert.ok(idempotencyScript.includes("globalThis[READY_FLAG] = true"));
  assert.ok(!idempotencyScript.includes("script.google.com/macros"), "helper nesmie meniť endpoint");
  new vm.Script(idempotencyScript);
});

test("AP14 verejný wrapper načíta novú verziu voliteľného Booking ID", () => {
  assert.ok(publicWrapper.includes("../ap14-k7x2/?v=20260809-3"));
});

test("AP14 bez načítaného helpera zastaví pôvodný submit pred ID aj POST", async () => {
  const guardScript = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)]
    .map(match => match[1])
    .find(source => source.includes("unguardedSubmit") && source.includes("__AP14_INVOICE_IDEMPOTENCY_READY__"));
  assert.ok(guardScript, "chýba inline READY guard");
  assert.ok(
    guardScript.indexOf("__AP14_INVOICE_IDEMPOTENCY_READY__!==true") <
      guardScript.indexOf("unguardedSubmit.call"),
    "READY kontrola musí byť pred pôvodným handlerom",
  );

  let prevented = 0;
  let requestIdCalls = 0;
  let postCalls = 0;
  const status = { textContent: "" };
  const bookingLabel = { textContent: "Číslo rezervácie Booking.com" };
  const bookingInput = {
    required: true,
    previousElementSibling: bookingLabel,
    removeAttribute(name) { if (name === "required") this.required = false; },
  };
  const form = {
    async onsubmit() {
      requestIdCalls += 1;
      postCalls += 1;
    },
  };
  const sandbox = {
    document: {
      getElementById(id) {
        if (id === "form") return form;
        if (id === "status") return status;
        if (id === "invoiceBookingId") return bookingInput;
        throw new Error(`unexpected field ${id}`);
      },
    },
  };
  vm.runInNewContext(guardScript, sandbox, { filename: "ap14-ready-guard.js" });
  assert.strictEqual(sandbox.__AP14_INVOICE_IDEMPOTENCY_READY__, false);
  assert.strictEqual(sandbox.__AP14_INVOICE_BASE_HANDLER_READY__, true);
  assert.strictEqual(bookingInput.required, false);
  assert.match(bookingLabel.textContent, /\(voliteľné\)$/);
  await form.onsubmit({ preventDefault() { prevented += 1; } });
  assert.strictEqual(prevented, 1);
  assert.strictEqual(requestIdCalls, 0);
  assert.strictEqual(postCalls, 0);
  assert.match(status.textContent, /Bezpečné opakované odoslanie/);

  const missingStatus = { textContent: "" };
  const missingForm = { onsubmit: null };
  const missingBookingInput = {
    required: true,
    previousElementSibling: { textContent: "Číslo rezervácie Booking.com" },
    removeAttribute(name) { if (name === "required") this.required = false; },
  };
  const missingSandbox = {
    document: {
      getElementById(id) {
        if (id === "form") return missingForm;
        if (id === "status") return missingStatus;
        if (id === "invoiceBookingId") return missingBookingInput;
        throw new Error(`unexpected field ${id}`);
      },
    },
  };
  vm.runInNewContext(guardScript, missingSandbox, { filename: "ap14-ready-guard-missing-base.js" });
  assert.strictEqual(missingSandbox.__AP14_INVOICE_BASE_HANDLER_READY__, false);
  assert.strictEqual(typeof missingForm.onsubmit, "function", "guard musí blokovať aj chýbajúci base handler");
  let missingPrevented = 0;
  await missingForm.onsubmit({ preventDefault() { missingPrevented += 1; } });
  assert.strictEqual(missingPrevented, 1);
  assert.match(missingStatus.textContent, /Bezpečné opakované odoslanie/);

  const helperWithoutBase = loadAp14Idempotency({
    sessionStorage: memoryStorage(),
    localStorage: memoryStorage(),
    requestIds: ["web-90909090909090909090909090909090"],
    baseHandlerReady: false,
  });
  assert.strictEqual(helperWithoutBase.ready, false, "helper nesmie vyhlásiť READY bez base handlera");
});

test("AP14 po zatvorení a znovuotvorení použije rovnaké ID a ACK uloží tombstone", async () => {
  const localStorage = memoryStorage();
  const ids = [
    "web-11111111111111111111111111111111",
    "web-22222222222222222222222222222222",
  ];
  const now = 1900000000000;
  const first = loadAp14Idempotency({
    sessionStorage: memoryStorage(),
    localStorage,
    requestIds: ids,
  });
  assert.strictEqual(first.ready, true);
  const fingerprint = await first.api.createFingerprint(first.api.payloadFromForm());
  const firstId = await first.api.getOrCreateRequestId(fingerprint, now);
  assert.strictEqual(firstId, ids[0]);
  const exactKey = first.api.storageKeyForFingerprint(fingerprint);
  const stored = localStorage.getItem(exactKey);
  assert.ok(stored);
  assert.doesNotMatch(stored, /Test Guest|host@example\.com|Test 1/);
  const originalExpiry = JSON.parse(stored).expiresAt;

  const reopened = loadAp14Idempotency({
    sessionStorage: memoryStorage(),
    localStorage,
    requestIds: ids.slice(1),
  });
  const reopenedFingerprint = await reopened.api.createFingerprint(reopened.api.payloadFromForm());
  assert.strictEqual(reopenedFingerprint, fingerprint);
  assert.strictEqual(
    await reopened.api.getOrCreateRequestId(reopenedFingerprint, now + 1),
    firstId,
  );
  assert.strictEqual(reopened.requestIdCalls, 0);

  assert.strictEqual(
    await reopened.api.clearMatchingRequest(firstId, fingerprint, now + 2),
    true,
  );
  const tombstone = JSON.parse(localStorage.getItem(exactKey));
  assert.strictEqual(tombstone.requestId, firstId);
  assert.strictEqual(tombstone.state, "acknowledged");
  assert.strictEqual(tombstone.expiresAt, originalExpiry, "ACK nesmie predĺžiť pôvodné 24h okno");
  assert.strictEqual(
    await reopened.api.getOrCreateRequestId(fingerprint, now + 3),
    firstId,
  );
  assert.strictEqual(reopened.requestIdCalls, 0);
  assert.strictEqual(
    await reopened.api.getOrCreateRequestId(fingerprint, now + 24 * 60 * 60 * 1000 + 1),
    ids[1],
    "až po pôvodnom 24h okne sa smie vytvoriť nové ID",
  );
});

test("AP14 wrapper ponechá pending pri chybe a po pozitívnom ACK zapíše tombstone", async () => {
  const localStorage = memoryStorage();
  const ids = ["web-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "web-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"];
  const failed = loadAp14Idempotency({
    sessionStorage: memoryStorage(),
    localStorage,
    requestIds: ids,
    clearOnSubmit: false,
  });
  const fingerprint = await failed.api.createFingerprint(failed.api.payloadFromForm());
  await failed.form.onsubmit({ preventDefault() {} });
  assert.deepEqual(failed.submittedIds, [ids[0]]);
  const exactKey = failed.api.storageKeyForFingerprint(fingerprint);
  assert.ok(localStorage.getItem(exactKey), "nepotvrdené odoslanie musí prežiť zatvorenie karty");

  const acknowledged = loadAp14Idempotency({
    sessionStorage: memoryStorage(),
    localStorage,
    requestIds: ids.slice(1),
    clearOnSubmit: true,
  });
  await acknowledged.form.onsubmit({ preventDefault() {} });
  assert.deepEqual(acknowledged.submittedIds, [ids[0]], "reopen musí poslať rovnaký request_id");
  assert.strictEqual(acknowledged.requestIdCalls, 0);
  assert.strictEqual(acknowledged.originalClearCalls, 1);
  const tombstone = JSON.parse(localStorage.getItem(exactKey));
  assert.strictEqual(tombstone.requestId, ids[0]);
  assert.strictEqual(tombstone.state, "acknowledged");
});

test("AP14 neodošle payload zmenený počas čakania na fingerprint alebo lock", async () => {
  const localStorage = memoryStorage();
  const instance = loadAp14Idempotency({
    sessionStorage: memoryStorage(),
    localStorage,
    requestIds: ["web-abababababababababababababababab"],
    onRequestIdGenerated(fields) {
      fields.invoiceName.value = "Changed During Lock";
    },
  });
  const originalFingerprint = await instance.api.createFingerprint(instance.api.payloadFromForm());
  await instance.form.onsubmit({ preventDefault() {} });

  assert.deepEqual(instance.submittedIds, [], "pôvodný handler/POST sa po DOM zmene nesmie spustiť");
  assert.strictEqual(instance.fields.invoiceRequestId.value, "");
  assert.match(instance.fields.status.textContent, /počas prípravy odoslania zmenili/);
  assert.ok(
    localStorage.getItem(instance.api.storageKeyForFingerprint(originalFingerprint)),
    "už pridelený marker A sa nesmie zahodiť, lebo ho môže používať iná karta",
  );
  const changedFingerprint = await instance.api.createFingerprint(instance.api.payloadFromForm());
  assert.notStrictEqual(changedFingerprint, originalFingerprint);
});

test("AP14 pri zlyhaní confirmed tombstone write ponechá pending marker aj ID", async () => {
  const localStorage = memoryStorage({ failWritesAfter: 1 });
  const requestId = "web-cdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcd";
  const instance = loadAp14Idempotency({
    sessionStorage: memoryStorage(),
    localStorage,
    requestIds: [requestId],
    clearOnSubmit: true,
  });
  const fingerprint = await instance.api.createFingerprint(instance.api.payloadFromForm());
  await instance.form.onsubmit({ preventDefault() {} });

  assert.deepEqual(instance.submittedIds, [requestId], "serverový ACK už bol prijatý");
  assert.ok(localStorage.getItem(instance.api.storageKeyForFingerprint(fingerprint)));
  assert.strictEqual(instance.fields.invoiceRequestId.value, requestId);
  assert.strictEqual(instance.originalClearCalls, 0);
  assert.match(instance.fields.status.textContent, /bezpečný kód sa nepodarilo vyčistiť/);
});

test("AP14 zlyhá pred POST pri blokovanom localStorage aj pri chýbajúcom Web Locks", async () => {
  const blocked = loadAp14Idempotency({
    sessionStorage: memoryStorage(),
    localStorage: memoryStorage({ rejectWrites: true }),
    requestIds: ["web-cccccccccccccccccccccccccccccccc"],
  });
  const blockedFingerprint = await blocked.api.createFingerprint(blocked.api.payloadFromForm());
  await assert.rejects(
    blocked.api.getOrCreateRequestId(blockedFingerprint, 1900000000000),
    /pending-storage-unavailable/,
  );
  await blocked.form.onsubmit({ preventDefault() {} });
  assert.deepEqual(blocked.submittedIds, [], "sessionStorage nesmie autorizovať POST");
  assert.strictEqual(blocked.fields.invoiceRequestId.value, "");

  const noLocks = loadAp14Idempotency({
    sessionStorage: memoryStorage(),
    localStorage: memoryStorage(),
    requestIds: ["web-dddddddddddddddddddddddddddddddd"],
    includeLocks: false,
  });
  const noLocksFingerprint = await noLocks.api.createFingerprint(noLocks.api.payloadFromForm());
  await assert.rejects(
    noLocks.api.getOrCreateRequestId(noLocksFingerprint, 1900000000000),
    /web-locks-unavailable/,
  );
  await noLocks.form.onsubmit({ preventDefault() {} });
  assert.deepEqual(noLocks.submittedIds, [], "bez Web Locks sa pôvodný POST nesmie spustiť");
});

test("AP14 dve súbežné karty s rovnakým payloadom dostanú rovnaké ID", async () => {
  const localStorage = memoryStorage();
  const locks = serializedLocks();
  const first = loadAp14Idempotency({
    sessionStorage: memoryStorage(),
    localStorage,
    locks,
    requestIds: ["web-eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee"],
  });
  const second = loadAp14Idempotency({
    sessionStorage: memoryStorage(),
    localStorage,
    locks,
    requestIds: ["web-ffffffffffffffffffffffffffffffff"],
  });
  const firstFingerprint = await first.api.createFingerprint(first.api.payloadFromForm());
  const secondFingerprint = await second.api.createFingerprint(second.api.payloadFromForm());
  assert.strictEqual(firstFingerprint, secondFingerprint);

  const [firstId, secondId] = await Promise.all([
    first.api.getOrCreateRequestId(firstFingerprint, 1900000000000),
    second.api.getOrCreateRequestId(secondFingerprint, 1900000000000),
  ]);
  assert.strictEqual(firstId, secondId);
  assert.strictEqual(first.requestIdCalls + second.requestIdCalls, 1);
  assert.strictEqual(locks.requestCalls, 2);
});

test("AP14 stale ACK jednej karty nevymaže marker iného fingerprintu", async () => {
  const localStorage = memoryStorage();
  const locks = serializedLocks();
  const first = loadAp14Idempotency({
    sessionStorage: memoryStorage(),
    localStorage,
    locks,
    requestIds: ["web-12121212121212121212121212121212"],
  });
  const second = loadAp14Idempotency({
    sessionStorage: memoryStorage(),
    localStorage,
    locks,
    requestIds: ["web-34343434343434343434343434343434"],
  });
  second.fields.invoiceName.value = "Changed Guest";
  const fingerprintA = await first.api.createFingerprint(first.api.payloadFromForm());
  const fingerprintB = await second.api.createFingerprint(second.api.payloadFromForm());
  const requestA = await first.api.getOrCreateRequestId(fingerprintA, 1900000000000);
  const requestB = await second.api.getOrCreateRequestId(fingerprintB, 1900000000001);

  await first.api.clearMatchingRequest(requestA, fingerprintA, 1900000000002);
  const markerB = localStorage.getItem(second.api.storageKeyForFingerprint(fingerprintB));
  assert.ok(markerB);
  assert.strictEqual(JSON.parse(markerB).requestId, requestB);

  first.fields.invoiceName.value = "Changed Guest";
  const fingerprintBFromFirst = await first.api.createFingerprint(first.api.payloadFromForm());
  assert.strictEqual(fingerprintBFromFirst, fingerprintB);
  assert.strictEqual(
    await first.api.getOrCreateRequestId(fingerprintBFromFirst, 1900000000003),
    requestB,
  );
  assert.strictEqual(first.requestIdCalls, 1, "karta A musí čítať aktuálny shared localStorage");
});

test("AP14 A dostane ACK, B ho stratí a retry B stále použije pôvodné ID", async () => {
  const localStorage = memoryStorage();
  const locks = serializedLocks();
  const tabA = loadAp14Idempotency({
    sessionStorage: memoryStorage(),
    localStorage,
    locks,
    requestIds: ["web-45454545454545454545454545454545"],
  });
  const tabB = loadAp14Idempotency({
    sessionStorage: memoryStorage(),
    localStorage,
    locks,
    requestIds: ["web-67676767676767676767676767676767"],
  });
  const fingerprint = await tabA.api.createFingerprint(tabA.api.payloadFromForm());
  const [requestA, requestB] = await Promise.all([
    tabA.api.getOrCreateRequestId(fingerprint, 1900000000000),
    tabB.api.getOrCreateRequestId(fingerprint, 1900000000000),
  ]);
  assert.strictEqual(requestA, requestB);

  await tabA.api.clearMatchingRequest(requestA, fingerprint, 1900000000001);
  const tombstone = JSON.parse(localStorage.getItem(tabA.api.storageKeyForFingerprint(fingerprint)));
  assert.strictEqual(tombstone.requestId, requestA);
  assert.strictEqual(tombstone.state, "acknowledged");

  const retryB = loadAp14Idempotency({
    sessionStorage: memoryStorage(),
    localStorage,
    locks,
    requestIds: ["web-98989898989898989898989898989898"],
  });
  assert.strictEqual(
    await retryB.api.getOrCreateRequestId(fingerprint, 1900000000002),
    requestA,
  );
  assert.strictEqual(retryB.requestIdCalls, 0, "stratený ACK nesmie po tombstone vytvoriť nové ID");
});

test("AP14 migruje platný legacy single-key marker bez vytvorenia nového ID", async () => {
  const localStorage = memoryStorage();
  const instance = loadAp14Idempotency({
    sessionStorage: memoryStorage(),
    localStorage,
    requestIds: ["web-56565656565656565656565656565656"],
  });
  const now = 1900000000000;
  const fingerprint = await instance.api.createFingerprint(instance.api.payloadFromForm());
  const legacyId = "web-78787878787878787878787878787878";
  localStorage.setItem(instance.api.legacyStorageKey, JSON.stringify({
    version: 1,
    requestId: legacyId,
    fingerprint,
    expiresAt: now + 24 * 60 * 60 * 1000,
  }));

  assert.strictEqual(await instance.api.getOrCreateRequestId(fingerprint, now), legacyId);
  assert.strictEqual(instance.requestIdCalls, 0);
  assert.ok(localStorage.getItem(instance.api.legacyStorageKey), "legacy marker ostáva read-only do TTL");
  const migrated = JSON.parse(localStorage.getItem(instance.api.storageKeyForFingerprint(fingerprint)));
  assert.strictEqual(migrated.requestId, legacyId);
  assert.strictEqual(migrated.state, "pending");
});

test("AP14 nezmaže legacy marker inej cacheovanej verzie s odlišným ID", async () => {
  const localStorage = memoryStorage();
  const instance = loadAp14Idempotency({
    sessionStorage: memoryStorage(),
    localStorage,
    requestIds: ["web-89898989898989898989898989898989"],
  });
  const now = 1900000000000;
  const fingerprint = await instance.api.createFingerprint(instance.api.payloadFromForm());
  const exactId = await instance.api.getOrCreateRequestId(fingerprint, now);
  const legacyId = "web-91919191919191919191919191919191";
  localStorage.setItem(instance.api.legacyStorageKey, JSON.stringify({
    version: 1,
    requestId: legacyId,
    fingerprint,
    expiresAt: now + 24 * 60 * 60 * 1000,
  }));

  assert.strictEqual(await instance.api.getOrCreateRequestId(fingerprint, now + 1), exactId);
  const legacy = JSON.parse(localStorage.getItem(instance.api.legacyStorageKey));
  assert.strictEqual(legacy.requestId, legacyId, "nová karta nesmie zmazať pending starej cacheovanej verzie");
});

test("inline JavaScript stránky AP14 je syntakticky platný", () => {
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(match => match[1]);
  assert.ok(scripts.length > 0, "nenašiel sa inline JavaScript");
  for (const script of scripts) new Function(script);
});
