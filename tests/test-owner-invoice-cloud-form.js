"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");
const assert = require("node:assert");
const { TextDecoder } = require("node:util");
const { webcrypto } = require("node:crypto");
const { test } = require("./t");

const root = path.join(__dirname, "..", "owner-invoice-cloud");
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
const script = fs.readFileSync(path.join(root, "app.js"), "utf8");
const style = fs.readFileSync(path.join(root, "style.css"), "utf8");

function makeEventTarget(target) {
  const listeners = Object.create(null);
  target.addEventListener = function (name, handler) {
    (listeners[name] ||= []).push(handler);
  };
  target.removeEventListener = function (name, handler) {
    listeners[name] = (listeners[name] || []).filter(candidate => candidate !== handler);
  };
  target.dispatch = function (name, event) {
    for (const handler of (listeners[name] || []).slice()) handler(event || {});
  };
  target.__listeners = listeners;
  return target;
}

function makeElement(tagName) {
  const classes = new Set();
  const element = makeEventTarget({
    tagName: String(tagName || "div").toUpperCase(),
    value: "",
    textContent: "",
    disabled: false,
    selected: false,
    checked: false,
    hidden: false,
    dataset: {},
    children: [],
    parentNode: null,
    focused: false,
    submitted: false,
    attributes: Object.create(null),
    classList: {
      add(name) { classes.add(name); },
      remove(name) { classes.delete(name); },
      contains(name) { return classes.has(name); },
      toggle(name, force) {
        const enabled = force === undefined ? !classes.has(name) : Boolean(force);
        enabled ? classes.add(name) : classes.delete(name);
        return enabled;
      }
    },
    appendChild(child) {
      child.parentNode = this;
      this.children.push(child);
      return child;
    },
    removeChild(child) {
      this.children = this.children.filter(candidate => candidate !== child);
      child.parentNode = null;
      return child;
    },
    setAttribute(name, value) { this.attributes[name] = String(value); },
    getAttribute(name) { return this.attributes[name] || null; },
    querySelectorAll() { return this.__queryResults || []; },
    focus() { this.focused = true; },
    submit() { this.submitted = true; }
  });
  if (element.tagName === "IFRAME") element.contentWindow = {};
  return element;
}

function makeWindow() {
  return makeEventTarget({});
}

function makeTimers() {
  let nextId = 1;
  const pending = new Map();
  return {
    setTimeout(handler) {
      const id = nextId++;
      pending.set(id, handler);
      return id;
    },
    clearTimeout(id) { pending.delete(id); },
    fireNext() {
      const entry = pending.entries().next();
      assert.equal(entry.done, false, "expected a pending timer");
      const [id, handler] = entry.value;
      pending.delete(id);
      handler();
    },
    get size() { return pending.size; }
  };
}

function createSandbox(hash) {
  const elements = Object.create(null);
  const documentListeners = Object.create(null);
  const historyCalls = [];
  const body = makeElement("body");
  const document = {
    readyState: "loading",
    title: "Doplnenie údajov k faktúre",
    body,
    getElementById(id) {
      if (!elements[id]) elements[id] = makeElement();
      return elements[id];
    },
    createElement(tagName) { return makeElement(tagName); },
    addEventListener(name, handler) { documentListeners[name] = handler; }
  };
  const browserWindow = makeWindow();
  const sandbox = Object.assign(browserWindow, {
    __OWNER_INVOICE_TEST__: true,
    document,
    location: { hash: hash || "", pathname: "/owner-invoice-cloud/" },
    history: {
      replaceState(state, title, url) { historyCalls.push({ state, title, url }); }
    },
    URL,
    URLSearchParams,
    TextDecoder,
    Uint8Array,
    crypto: webcrypto,
    setTimeout,
    clearTimeout,
    console,
    atob(value) { return Buffer.from(value, "base64").toString("binary"); }
  });
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  vm.runInNewContext(script, sandbox, { filename: "owner-invoice-cloud/app.js" });
  return {
    sandbox,
    api: sandbox.__OWNER_INVOICE_TEST_API__,
    elements,
    document,
    documentListeners,
    historyCalls
  };
}

function tokenFor(claims) {
  const payload = Buffer.from(JSON.stringify(claims), "utf8").toString("base64url");
  return payload + "." + "s".repeat(43);
}

function validClaims(overrides) {
  return Object.assign({
    v: 2,
    rid: "web-0123456789abcdef0123456789abcdef",
    name: "Ivan Povrazník",
    bid: "123456789",
    exp: 1900000000,
    props: [
      { code: "KAMZIK26", label: "Apartmán Kamzík 26" },
      { code: "KAMZIK64", label: "Apartmán Kamzík 64" }
    ]
  }, overrides || {});
}

function validValues() {
  return {
    propertyCode: "APT14",
    bookingId: "123456789",
    checkIn: "2026-08-02",
    checkOut: "2026-08-05",
    totalGross: "158.00",
    emailVerified: true
  };
}

function startTransport(api, payload, overrides) {
  const document = overrides?.document || {
    body: makeElement("body"),
    createElement: makeElement
  };
  const browserWindow = overrides?.window || makeWindow();
  const timers = overrides?.timers || makeTimers();
  const accepted = [];
  const rejected = [];
  const nonce = overrides?.nonce || "n".repeat(32);
  const controller = api.startUrlEncodedIframePost(
    api.intakeEndpoint,
    payload,
    {
      resolve(value) { accepted.push(value); },
      reject(error) { rejected.push(error); }
    },
    {
      document,
      window: browserWindow,
      nonce,
      timeoutMs: 1000,
      setTimeout: timers.setTimeout,
      clearTimeout: timers.clearTimeout
    }
  );
  const frame = document.body.children.find(child => child.tagName === "IFRAME");
  const form = document.body.children.find(child => child.tagName === "FORM");
  return { document, browserWindow, timers, accepted, rejected, nonce, controller, frame, form };
}

function ack(transport, overrides) {
  const values = Object.assign({
    source: transport.frame.contentWindow,
    origin: "https://n-abcd1234-script.googleusercontent.com",
    data: {
      channel: "booking-invoice-intake-v1",
      ok: true,
      ack_nonce: transport.nonce,
      event_id: "evt_test_1"
    }
  }, overrides || {});
  transport.browserWindow.dispatch("message", values);
}

test("cloud formulár je mobilný, súkromný a používa iba ohraničený Apps Script iframe", () => {
  assert.ok(html.includes('name="viewport"'));
  assert.ok(html.includes('content="noindex,nofollow,noarchive,nosnippet,noimageindex"'));
  assert.ok(html.includes('name="referrer" content="no-referrer"'));
  assert.ok(html.includes("default-src 'none'"));
  assert.ok(html.includes("script-src 'self'"));
  assert.ok(html.includes("connect-src 'none'"));
  assert.ok(html.includes("form-action https://script.google.com https://script.googleusercontent.com https://*.googleusercontent.com"));
  assert.ok(html.includes("frame-src https://script.google.com https://script.googleusercontent.com https://*.googleusercontent.com"));
  assert.ok(!html.includes("formsubmit.co"));
  assert.ok(!html.includes("accounts.google.com"));
  assert.ok(!html.includes("drive.google.com"));
  assert.ok(!/<script[^>]+src=["']https?:/i.test(html), "nesmie načítať cudzie JavaScripty");
  assert.ok(!script.includes("localStorage"));
  assert.ok(!script.includes("document.cookie"));
  assert.ok(!script.includes("fetch("));
  assert.ok(script.includes('frame.referrerPolicy = "no-referrer"'));
  assert.ok(script.includes('frame.setAttribute("sandbox", "allow-scripts allow-same-origin")'));
  assert.ok(style.includes("env(safe-area-inset-top)"));
  assert.ok(html.includes('app.js?v=20260808-2'));
  assert.ok(html.includes('style.css?v=20260808-2'));
});

test("v2 token sa číta iba z fragmentu a kontroluje základný tvar claims", () => {
  const { api } = createSandbox();
  const token = tokenFor(validClaims());
  const claims = api.decodeClaims(token, 1800000000);
  assert.equal(claims.version, 2);
  assert.equal(claims.requestId, "web-0123456789abcdef0123456789abcdef");
  assert.equal(claims.guestName, "Ivan Povrazník");
  assert.equal(claims.properties.length, 2);
  assert.equal(claims.properties[1].code, "KAMZIK64");
  assert.ok(script.includes("location.hash.slice(1)"));
  assert.ok(!script.includes("location.search"));
  assert.throws(() => api.decodeClaims(tokenFor(validClaims({ v: 1 })), 1800000000));
  assert.throws(() => api.decodeClaims(tokenFor(validClaims({ exp: 1700000000 })), 1800000000));
  assert.throws(() => api.decodeClaims(tokenFor(validClaims({ props: [] })), 1800000000));
});

test("mobilné DOM zobrazenie vytvorí výber pri viacerých povolených apartmánoch", () => {
  const token = tokenFor(validClaims());
  const { api, elements, historyCalls } = createSandbox("#token=" + token);
  api.initialize();

  assert.equal(elements.guestName.textContent, "Ivan Povrazník");
  assert.equal(elements.bookingSummary.textContent, "123456789");
  assert.equal(elements.bookingId.value, "123456789");
  assert.equal(elements.propertyField.classList.contains("hidden"), false);
  assert.equal(elements.propertyCode.children.length, 3);
  assert.equal(elements.propertyCode.children[1].value, "KAMZIK26");
  assert.equal(elements.propertyCode.children[2].value, "KAMZIK64");
  assert.equal(elements.formPanel.classList.contains("hidden"), false);
  assert.equal(elements.loadingPanel.classList.contains("hidden"), true);
  assert.equal(historyCalls.length, 0, "token musí zostať do potvrdeného prijatia");

  const reloaded = createSandbox("#token=" + token);
  reloaded.api.initialize();
  assert.equal(reloaded.elements.formPanel.classList.contains("hidden"), false);
  assert.equal(reloaded.elements.guestName.textContent, "Ivan Povrazník");
  assert.equal(reloaded.elements.propertyCode.children.length, 3);
  assert.equal(reloaded.historyCalls.length, 0);
});

test("jeden povolený apartmán sa zobrazí bez zbytočného výberu", () => {
  const claims = validClaims({ props: ["APT14"] });
  const { api, elements } = createSandbox("#token=" + tokenFor(claims));
  elements.propertyCode = makeElement();
  elements.propertyCode.required = true;
  api.initialize();

  assert.equal(elements.singleProperty.classList.contains("hidden"), false);
  assert.equal(elements.singleProperty.dataset.propertyCode, "APT14");
  assert.equal(elements.singlePropertyLabel.textContent, "Apartmán 14 · Školská");
  assert.equal(elements.propertyCode.children.length, 0);
  assert.equal(elements.propertyCode.required, false);
  assert.equal(elements.propertyCode.disabled, true);
});

test("neplatný alebo chýbajúci token otvorí zrozumiteľný chybový stav", () => {
  const { api, elements, historyCalls } = createSandbox("");
  api.initialize();
  assert.equal(elements.invalidPanel.classList.contains("hidden"), false);
  assert.equal(elements.invalidPanel.focused, true);
  assert.match(elements.invalidMessage.textContent, /neplatný|neúplný/i);
  assert.equal(elements.formPanel.classList.contains("hidden"), true);
  assert.equal(historyCalls.length, 0);
});

test("owner payload zodpovedá zmluve verejného intake a nesie celý podpísaný token", () => {
  const { api } = createSandbox();
  const token = tokenFor(validClaims({ props: ["APT14"] }));
  const claims = api.decodeClaims(token, 1800000000);
  const values = validValues();
  assert.equal(api.validateValues(values, claims), "");
  const payload = api.createPayload(token, claims, values);
  assert.equal(payload.action, "owner_completion");
  assert.equal(payload.source_site, "wczvonce.github.io");
  assert.equal(payload.owner_form_version, "2");
  assert.equal(payload.owner_form_token, token);
  assert.equal(payload.request_id, claims.requestId);
  assert.equal(payload.property_code, "APT14");
  assert.equal(payload.check_in, "2026-08-02");
  assert.equal(payload.check_out, "2026-08-05");
  assert.equal(payload.total_gross, "158.00");
  assert.equal(payload.booking_id, "123456789");
  assert.equal(payload.email_verified, "true");
  assert.equal(Object.prototype.hasOwnProperty.call(payload, "_subject"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(payload, "confirmed_guest_name"), false);
});

test("cena, dátumy, apartmán a potvrdenie sa validujú pred odoslaním", () => {
  const { api } = createSandbox();
  const claims = api.decodeClaims(tokenFor(validClaims({ props: ["APT14"] })), 1800000000);
  assert.equal(api.normalizeGross("158,5"), "158.50");
  assert.equal(api.normalizeGross("0"), "");
  assert.equal(api.normalizeGross("10000,01"), "");

  const values = Object.assign(validValues(), { propertyCode: "APT7" });
  assert.match(api.validateValues(values, claims), /apartmán/i);
  values.propertyCode = "APT14";
  values.checkOut = "2026-08-01";
  assert.match(api.validateValues(values, claims), /odchodu/i);
  values.checkOut = "2026-08-05";
  values.emailVerified = false;
  assert.match(api.validateValues(values, claims), /potvrďte/i);
});

test("iframe POST je classic urlencoded, token ostáva iba v tele a nonce je bezpečný", () => {
  const { api } = createSandbox();
  const generated = api.createAckNonce({
    getRandomValues(bytes) {
      for (let index = 0; index < bytes.length; index += 1) bytes[index] = index;
      return bytes;
    }
  });
  assert.match(generated, /^[a-f0-9]{32}$/);
  assert.equal(api.isValidIntakeEndpoint(api.intakeEndpoint), true);
  assert.equal(api.isValidIntakeEndpoint(api.intakeEndpoint + "?token=secret"), false);
  assert.equal(api.isValidIntakeEndpoint("http://script.google.com/macros/s/x/exec"), false);
  assert.equal(api.isValidIntakeEndpoint("https://evil.example/macros/s/x/exec"), false);
  assert.equal(api.isAllowedAckOrigin("https://script.google.com"), true);
  assert.equal(api.isAllowedAckOrigin("https://script.googleusercontent.com"), true);
  assert.equal(api.isAllowedAckOrigin("https://n-abcd1234-script.googleusercontent.com"), true);
  assert.equal(api.isAllowedAckOrigin("https://evil-googleusercontent.com"), false);
  assert.equal(api.isAllowedAckOrigin("https://script.googleusercontent.com.evil.example"), false);

  const payload = { action: "owner_completion", owner_form_token: "secret.fragment.token" };
  const transport = startTransport(api, payload);
  assert.equal(transport.form.method, "POST");
  assert.equal(transport.form.enctype, "application/x-www-form-urlencoded");
  assert.equal(transport.form.action, api.intakeEndpoint);
  assert.equal(transport.form.action.includes("secret.fragment.token"), false);
  assert.equal(transport.form.submitted, true);
  assert.equal(transport.form.target, transport.frame.name);
  assert.equal(transport.frame.referrerPolicy, "no-referrer");
  assert.equal(transport.frame.getAttribute("sandbox"), "allow-scripts allow-same-origin");
  const fields = Object.fromEntries(transport.form.children.map(input => [input.name, input.value]));
  assert.equal(fields.owner_form_token, "secret.fragment.token");
  assert.equal(fields.ack_nonce, transport.nonce);
  assert.equal(transport.timers.size, 1);
});

test("validný ACK prijme aj vnorený googleusercontent iframe a bezpečne uprace transport", () => {
  const { api } = createSandbox();
  const transport = startTransport(api, { action: "owner_completion" });
  const innerAppsScriptWindow = { parent: transport.frame.contentWindow };
  ack(transport, { source: innerAppsScriptWindow });

  assert.equal(transport.accepted.length, 1);
  assert.equal(transport.accepted[0].event_id, "evt_test_1");
  assert.equal(transport.rejected.length, 0);
  assert.equal(transport.document.body.children.length, 0);
  assert.equal(transport.timers.size, 0);
});

test("spoofnutý source window, origin, channel alebo nonce sa ignoruje", () => {
  const { api } = createSandbox();
  const transport = startTransport(api, { action: "owner_completion" });
  const attackerWindow = {};
  attackerWindow.parent = attackerWindow;

  ack(transport, { source: attackerWindow });
  ack(transport, { origin: "https://evil.example" });
  ack(transport, { data: { channel: "wrong", ok: true, ack_nonce: transport.nonce } });
  ack(transport, { data: { channel: "booking-invoice-intake-v1", ok: true, ack_nonce: "x".repeat(32) } });
  assert.equal(transport.accepted.length, 0);
  assert.equal(transport.rejected.length, 0);
  assert.equal(transport.document.body.children.length, 2);

  ack(transport);
  assert.equal(transport.accepted.length, 1);
  ack(transport);
  assert.equal(transport.accepted.length, 1, "ACK po cleanup sa už nespracuje");
});

test("timeout, iframe chyba a záporný serverový ACK skončia kontrolovanou chybou", () => {
  const { api } = createSandbox();

  const timedOut = startTransport(api, { action: "owner_completion" });
  timedOut.timers.fireNext();
  assert.equal(timedOut.rejected.length, 1);
  assert.equal(timedOut.rejected[0].code, "timeout");
  assert.equal(timedOut.document.body.children.length, 0);
  ack(timedOut);
  assert.equal(timedOut.accepted.length, 0);

  const brokenFrame = startTransport(api, { action: "owner_completion" });
  brokenFrame.frame.dispatch("error", {});
  assert.equal(brokenFrame.rejected.length, 1);
  assert.equal(brokenFrame.rejected[0].code, "transport");

  const rejected = startTransport(api, { action: "owner_completion" });
  ack(rejected, {
    data: {
      channel: "booking-invoice-intake-v1",
      ok: false,
      ack_nonce: rejected.nonce,
      code: "INVALID_CAPABILITY"
    }
  });
  assert.equal(rejected.accepted.length, 0);
  assert.equal(rejected.rejected.length, 1);
  assert.equal(rejected.rejected[0].code, "INVALID_CAPABILITY");
});

test("token prežije spoof aj chybu a odstráni sa až po validnom ACK", () => {
  const token = tokenFor(validClaims({ props: ["APT14"] }));
  const { api, document, elements, historyCalls, sandbox } = createSandbox("#token=" + token);
  const fields = [makeElement("input"), makeElement("button")];
  const uiForm = makeElement("form");
  uiForm.__queryResults = fields;
  const formPanel = document.getElementById("formPanel");
  const successPanel = document.getElementById("successPanel");
  successPanel.classList.add("hidden");

  const transport = startTransport(api, { owner_form_token: token }, { document });
  assert.equal(historyCalls.length, 0);
  assert.equal(sandbox.location.hash, "#token=" + token);

  const attacker = {};
  attacker.parent = attacker;
  ack(transport, { source: attacker });
  assert.equal(historyCalls.length, 0);

  // Use a second controller whose synchronous resolve callback is the real UI
  // success transition. This proves the URL is scrubbed only after validated ACK.
  transport.controller.cancel();
  assert.equal(historyCalls.length, 0, "transport error must keep the capability for retry");
  const timers = makeTimers();
  const browserWindow = makeWindow();
  const acceptedTransport = api.startUrlEncodedIframePost(
    api.intakeEndpoint,
    { owner_form_token: token },
    {
      resolve() { api.showSubmissionAccepted(uiForm, formPanel, successPanel); },
      reject() {}
    },
    {
      document,
      window: browserWindow,
      nonce: "z".repeat(32),
      timeoutMs: 1000,
      setTimeout: timers.setTimeout,
      clearTimeout: timers.clearTimeout
    }
  );
  const frame = document.body.children.find(child => child.tagName === "IFRAME");
  assert.equal(historyCalls.length, 0);
  browserWindow.dispatch("message", {
    source: frame.contentWindow,
    origin: "https://n-abcd1234-script.googleusercontent.com",
    data: { channel: "booking-invoice-intake-v1", ok: true, ack_nonce: acceptedTransport.nonce }
  });

  assert.equal(historyCalls.length, 1);
  assert.equal(historyCalls[0].url, "/owner-invoice-cloud/");
  assert.equal(formPanel.classList.contains("hidden"), true);
  assert.equal(successPanel.classList.contains("hidden"), false);
  assert.equal(successPanel.focused, true);
  assert.ok(fields.every(field => field.disabled));
});

test("text úspechu aj chyby hovoria o prijatí a spracovaní, nie o druhom e-maile", () => {
  assert.ok(html.includes("Údaje boli prijaté na spracovanie"));
  assert.ok(html.includes("Program ich teraz bezpečne spracuje"));
  assert.ok(script.includes("Nepodarilo sa potvrdiť prijatie údajov na spracovanie"));
  assert.ok(!html.includes("do jednej minúty"));
  assert.ok(!script.includes("skontrolujte e-mail"));
});

test("cloud JavaScript je syntakticky platný a používa produkčný intake endpoint", () => {
  new vm.Script(script);
  assert.ok(script.includes("https://script.google.com/macros/s/AKfycbwD7RRz5nJdp6FsU3vL1CTgsPNwXPuCrx1ad9JMBa8LQNDYZCTltMAtN48IRzb8NsYo/exec"));
  assert.ok(script.includes("SUBMIT_TIMEOUT_MS = 120000"));
  assert.ok(!script.includes("REPLACE_WITH_PUBLIC_INTAKE_DEPLOYMENT_ID"));
  assert.ok(script.includes('action: "owner_completion"'));
  assert.ok(script.includes('INTAKE_ACK_CHANNEL = "booking-invoice-intake-v1"'));
  assert.ok(!script.includes("formsubmit.co"));
  assert.ok(!script.includes("https://accounts.google.com"));
});
