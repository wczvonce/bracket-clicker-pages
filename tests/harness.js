// Testovací harness: načíta core1.js + core2.js do Node VM so stub DOM a
// localStorage, aby sa dala volať reálna logika aplikácie bez prehliadača.
"use strict";
const fs = require("fs"), path = require("path"), vm = require("vm");
const REPO = path.join(__dirname, "..");

function makeEl() {
  const el = {
    children: [], dataset: {}, style: {},
    classList: {
      _s: new Set(),
      add(...c) { c.forEach(x => el.classList._s.add(x)); },
      remove(...c) { c.forEach(x => el.classList._s.delete(x)); },
      toggle(c, f) {
        if (f === undefined) f = !el.classList._s.has(c);
        f ? el.classList._s.add(c) : el.classList._s.delete(c);
      },
      contains(c) { return el.classList._s.has(c); },
    },
    innerHTML: "", textContent: "", value: "", className: "", hidden: false, disabled: false,
    append(...n) { el.children.push(...n); },
    appendChild(n) { el.children.push(n); },
    querySelector() { return null; },
    querySelectorAll() { return []; },
    setAttribute(k, v) { (el._attrs ||= {})[k] = String(v); },
    getAttribute(k) { return el._attrs?.[k] ?? null; },
    removeAttribute(k) { delete el._attrs?.[k]; },
    addEventListener() {}, insertBefore() {}, after() {}, before() {}, scrollIntoView() {},
    firstElementChild: null,
  };
  return el;
}

function makeContext({ localStorageData = {}, files = ["core1.js", "core2.js"] } = {}) {
  const store = { ...localStorageData };
  const byId = {};
  const document = {
    getElementById(id) { return byId[id] || (byId[id] = makeEl()); },
    createElement() { return makeEl(); },
    querySelector() { return null; },
    querySelectorAll() { return []; },
    head: makeEl(), body: makeEl(),
  };
  const localStorage = {
    getItem: k => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: k => { delete store[k]; },
  };
  const sandbox = {
    console, document, localStorage,
    navigator: { clipboard: { writeText: async () => {} } },
    __confirmAnswer: true, __confirmLog: [],
    alert: () => {},
    setTimeout: () => {},
    __events: {},
    addEventListener(type, fn) { (sandbox.__events[type] ||= []).push(fn); },
    scrollTo() {},
    URL, Image: function () {},
    XLSX: null, // testy parserov si ho doplnia z vendor/
  };
  sandbox.confirm = m => { sandbox.__confirmLog.push(m); return sandbox.__confirmAnswer; };
  sandbox.window = sandbox;
  const ctx = vm.createContext(sandbox);
  for (const f of files) {
    vm.runInContext(fs.readFileSync(path.join(REPO, f), "utf8"), ctx, { filename: f });
  }
  // let/const deklarácie nie sú na globalThis — sprístupni ich accessormi
  vm.runInContext(`
    globalThis.__get = () => ({ M, WIN, WINCTX, TEAMS, MY_SEED, UNDO, BASE_MODEL });
    globalThis.__label = label;
    globalThis.__setModel = m => { M = m; };
    globalThis.__setSeed = s => { MY_SEED = s; };
    globalThis.__storage = k => localStorage.getItem(k);
    globalThis.__fireStorage = (key, newValue) => { for (const f of (__events.storage || [])) f({ key, newValue }); };
  `, ctx);
  return ctx;
}

module.exports = { makeContext, REPO };
