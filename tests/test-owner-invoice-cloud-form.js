"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");
const assert = require("node:assert");
const { TextDecoder } = require("node:util");
const { test } = require("./t");

const root = path.join(__dirname, "..", "owner-invoice-cloud");
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
const script = fs.readFileSync(path.join(root, "app.js"), "utf8");
const style = fs.readFileSync(path.join(root, "style.css"), "utf8");

function makeElement() {
  const classes = new Set();
  const listeners = Object.create(null);
  return {
    value: "",
    textContent: "",
    disabled: false,
    selected: false,
    checked: false,
    dataset: {},
    children: [],
    focused: false,
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
    appendChild(child) { this.children.push(child); return child; },
    addEventListener(name, handler) { listeners[name] = handler; },
    querySelectorAll() { return []; },
    focus() { this.focused = true; },
    __listeners: listeners
  };
}

function createSandbox(hash) {
  const elements = Object.create(null);
  const documentListeners = Object.create(null);
  const historyCalls = [];
  const document = {
    readyState: "loading",
    title: "Doplnenie údajov k faktúre",
    getElementById(id) {
      if (!elements[id]) elements[id] = makeElement();
      return elements[id];
    },
    createElement() { return makeElement(); },
    addEventListener(name, handler) { documentListeners[name] = handler; }
  };
  const sandbox = {
    __OWNER_INVOICE_TEST__: true,
    document,
    location: { hash: hash || "", pathname: "/owner-invoice-cloud/" },
    history: {
      replaceState(state, title, url) { historyCalls.push({ state, title, url }); }
    },
    URLSearchParams,
    TextDecoder,
    Uint8Array,
    AbortController,
    setTimeout,
    clearTimeout,
    console,
    atob(value) { return Buffer.from(value, "base64").toString("binary"); },
    fetch() { throw new Error("unexpected fetch"); }
  };
  sandbox.globalThis = sandbox;
  vm.runInNewContext(script, sandbox, { filename: "owner-invoice-cloud/app.js" });
  return { sandbox, api: sandbox.__OWNER_INVOICE_TEST_API__, elements, documentListeners, historyCalls };
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

test("cloud formulár je mobilný, súkromný a bez Google prihlásenia", () => {
  assert.ok(html.includes('name="viewport"'));
  assert.ok(html.includes('content="noindex,nofollow,noarchive,nosnippet,noimageindex"'));
  assert.ok(html.includes('name="referrer" content="no-referrer"'));
  assert.ok(html.includes("default-src 'none'"));
  assert.ok(html.includes("script-src 'self'"));
  assert.ok(html.includes("connect-src https://formsubmit.co"));
  assert.ok(!html.includes("accounts.google.com"));
  assert.ok(!html.includes("script.google.com"));
  assert.ok(!html.includes("drive.google.com"));
  assert.ok(!/<script[^>]+src=["']https?:/i.test(html), "nesmie načítať cudzie JavaScripty");
  assert.ok(!script.includes("localStorage"));
  assert.ok(!script.includes("document.cookie"));
  assert.ok(style.includes("env(safe-area-inset-top)"));
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
  assert.equal(historyCalls.length, 0, "token musí zostať do úspešného POST");

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
  api.initialize();

  assert.equal(elements.singleProperty.classList.contains("hidden"), false);
  assert.equal(elements.singleProperty.dataset.propertyCode, "APT14");
  assert.equal(elements.singlePropertyLabel.textContent, "Apartmán 14 · Školská");
  assert.equal(elements.propertyCode.children.length, 0);
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

test("odosielaný payload používa presné serverové názvy a celý podpísaný token", () => {
  const { api } = createSandbox();
  const token = tokenFor(validClaims({ props: ["APT14"] }));
  const claims = api.decodeClaims(token, 1800000000);
  const values = {
    propertyCode: "APT14",
    bookingId: "123456789",
    checkIn: "2026-08-02",
    checkOut: "2026-08-05",
    totalGross: "158.00",
    emailVerified: true
  };
  assert.equal(api.validateValues(values, claims), "");
  const payload = api.createPayload(token, claims, values);
  assert.equal(payload._subject, "[FAKTURA-DOPLNENIE] web-0123456789abcdef0123456789abcdef");
  assert.equal(payload.owner_form_version, "2");
  assert.equal(payload.owner_form_token, token);
  assert.equal(payload.request_id, claims.requestId);
  assert.equal(payload.property_code, "APT14");
  assert.equal(payload.check_in, "2026-08-02");
  assert.equal(payload.check_out, "2026-08-05");
  assert.equal(payload.total_gross, "158.00");
  assert.equal(payload.booking_id, "123456789");
  assert.equal(payload.email_verified, "true");
  assert.equal(Object.prototype.hasOwnProperty.call(payload, "gross_eur"), false);
});

test("cena, dátumy, apartmán a potvrdenie sa validujú pred odoslaním", () => {
  const { api } = createSandbox();
  const claims = api.decodeClaims(tokenFor(validClaims({ props: ["APT14"] })), 1800000000);
  assert.equal(api.normalizeGross("158,5"), "158.50");
  assert.equal(api.normalizeGross("0"), "");
  assert.equal(api.normalizeGross("10000,01"), "");

  const values = {
    propertyCode: "APT7",
    bookingId: "123456789",
    checkIn: "2026-08-02",
    checkOut: "2026-08-05",
    totalGross: "158.00",
    emailVerified: true
  };
  assert.match(api.validateValues(values, claims), /apartmán/i);
  values.propertyCode = "APT14";
  values.checkOut = "2026-08-01";
  assert.match(api.validateValues(values, claims), /odchodu/i);
  values.checkOut = "2026-08-05";
  values.emailVerified = false;
  assert.match(api.validateValues(values, claims), /potvrďte/i);
});

test("úspech akceptuje iba boolean true alebo presný reťazec true", () => {
  const { api, historyCalls } = createSandbox("#token=abc.def");
  assert.equal(api.formSubmitAccepted({ success: true }), true);
  assert.equal(api.formSubmitAccepted({ success: "true" }), true);
  assert.equal(api.formSubmitAccepted({ success: "Submission successful" }), false);
  assert.equal(api.formSubmitAccepted({ success: false }), false);
  assert.equal(api.formSubmitAccepted(null), false);
  assert.ok(html.includes("do jednej minúty"));
  assert.ok(script.includes("Neodosielajte formulár hneď znova"));

  api.scrubTokenFromUrl();
  assert.equal(historyCalls.length, 1);
  assert.equal(historyCalls[0].url, "/owner-invoice-cloud/");
  const acceptedGuard = script.indexOf("!formSubmitAccepted(responseData)");
  const scrubAfterGuard = script.indexOf("scrubTokenFromUrl();", acceptedGuard);
  assert.ok(acceptedGuard > -1 && scrubAfterGuard > acceptedGuard, "fragment sa čistí až po potvrdenom úspechu");
});

test("cloud JavaScript je syntakticky platný a nepoužíva vzdialené knižnice", () => {
  new vm.Script(script);
  assert.ok(script.includes("https://formsubmit.co/ajax/povraznikovav@gmail.com"));
  assert.ok(!script.includes("https://accounts.google.com"));
  assert.ok(!script.includes("https://script.google.com"));
});
