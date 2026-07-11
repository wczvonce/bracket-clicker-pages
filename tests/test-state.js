// Uloženie, obnovenie, migrácia a odolnosť voči poškodenému localStorage.
"use strict";
const assert = require("node:assert");
const { makeContext } = require("./harness");
const { test, suite } = require("./t");

const KEY = "pavuk_state_v1";

suite("Persistencia stavu");

test("uloženie a obnovenie turnaja (roundtrip v2)", () => {
  const c = makeContext();
  c.setWinner(2, "S9"); c.setWinner(3, "S5"); c.setWinner(9, "S9");
  const saved = c.__storage(KEY);
  const parsed = JSON.parse(saved);
  assert.equal(parsed.version, 2);
  assert.ok(parsed.updatedAt);
  const c2 = makeContext({ localStorageData: { [KEY]: saved } });
  assert.deepEqual(c2.__get().WIN, { 2: "S9", 3: "S5", 9: "S9" });
  assert.deepEqual(c2.__get().M, c.__get().M);
  assert.deepEqual(c2.__get().TEAMS, c.__get().TEAMS);
});

test("migrácia starého formátu v1 ({M,TEAMS,WIN,WINCTX})", () => {
  const c = makeContext();
  c.setWinner(2, "S9");
  const g = c.__get();
  const v1 = JSON.stringify({ M: g.M, TEAMS: g.TEAMS, WIN: g.WIN, WINCTX: g.WINCTX });
  const c2 = makeContext({ localStorageData: { [KEY]: v1 } });
  assert.deepEqual(c2.__get().WIN, { 2: "S9" });
  assert.equal(c2.__get().TEAMS.S9, "Purdeš / Zavacký");
});

test("poškodený model v localStorage nezhodí aplikáciu a odloží zálohu", () => {
  const bad = JSON.stringify({ M: { 1: { A: "S1" } }, TEAMS: { S1: 12345 }, WIN: { 30: { x: 1 } }, WINCTX: "x" });
  const c = makeContext({ localStorageData: { [KEY]: bad } }); // nesmie hodiť výnimku pri štarte
  assert.equal(Object.keys(c.__get().M).length, 30, "musí sa použiť predvolený rozpis");
  assert.deepEqual(c.__get().WIN, {});
  assert.ok(c.__storage(KEY + "_corrupt"), "poškodené dáta musia ostať v zálohe");
});

test("nevalidný JSON v localStorage nezhodí aplikáciu", () => {
  const c = makeContext({ localStorageData: { [KEY]: "toto nie je json {" } });
  assert.equal(Object.keys(c.__get().M).length, 30);
});

test("nezmyselné výsledky sa pri načítaní zahodia (sanitizácia + prune)", () => {
  const c0 = makeContext();
  const g = c0.__get();
  const state = JSON.parse(c0.__storage(KEY));
  state.winners = { 2: "S9", 9: "S5", 21: 42, "abc": "S3", 31: "S2" }; // Z9: S5 nie je účastník (S1 vs S9)
  const c = makeContext({ localStorageData: { [KEY]: JSON.stringify(state) } });
  assert.deepEqual(c.__get().WIN, { 2: "S9" }, "ostane len konzistentný výsledok");
});

test("mená tímov sa pri načítaní validujú (nečíselné hodnoty sa zahodia)", () => {
  const c0 = makeContext();
  const state = JSON.parse(c0.__storage(KEY));
  state.teams = { S1: "Platný / Tím", S2: 123, EVIL: "x", S3: "  " };
  const c = makeContext({ localStorageData: { [KEY]: JSON.stringify(state) } });
  const TEAMS = c.__get().TEAMS;
  assert.equal(TEAMS.S1, "Platný / Tím");
  assert.equal(TEAMS.S2, undefined);
  assert.equal(TEAMS.EVIL, undefined);
});

suite("Dve karty");

test("zápis z inej karty sa premietne cez storage event", () => {
  const c = makeContext();
  assert.ok(c.__events.storage?.length, "listener na storage event musí existovať");
  const other = makeContext();
  other.setWinner(2, "S8");
  const newState = other.__storage(KEY);
  // simuluj event z inej karty: najprv zapíš do storage, potom dispatchni
  c.localStorage.setItem(KEY, newState);
  c.__fireStorage(KEY, newState);
  assert.deepEqual(c.__get().WIN, { 2: "S8" });
});
