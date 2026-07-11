// prune(): zneplatnenie závislých výsledkov, potvrdenie kaskády, undo.
"use strict";
const assert = require("node:assert");
const { makeContext } = require("./harness");
const { test, suite } = require("./t");

function playedSetup() {
  const c = makeContext();
  c.setWinner(2, "S9"); c.setWinner(3, "S5"); c.setWinner(4, "S13");
  c.setWinner(5, "S3"); c.setWinner(6, "S11");
  c.setWinner(9, "S9"); c.setWinner(10, "S5"); c.setWinner(11, "S3");
  c.setWinner(21, "S9");
  return c;
}

suite("prune() a kaskádové zmeny");

test("zmena skoršieho výsledku zneplatní IBA skutočne závislé výsledky", () => {
  const c = playedSetup();
  c.setWinner(2, "S8"); // zmena víťaza Z2 (confirm stub odpovie áno)
  const WIN = c.__get().WIN;
  assert.equal(WIN[2], "S8");
  assert.ok(!(9 in WIN), "Z9 závisí od Z2 — musí sa zneplatniť");
  assert.ok(!(21 in WIN), "Z21 závisí od Z9 — musí sa zneplatniť");
  for (const id of [3, 4, 5, 6, 10, 11]) assert.ok(id in WIN, `Z${id} nezávisí od Z2 — musí ostať`);
});

test("kaskáda vyžaduje potvrdenie a vypíše, čo sa zmaže", () => {
  const c = playedSetup();
  c.__confirmLog.length = 0;
  c.setWinner(2, "S8");
  assert.equal(c.__confirmLog.length, 1);
  assert.match(c.__confirmLog[0], /Z2/);
  assert.match(c.__confirmLog[0], /Z9, Z21/);
});

test("odmietnutie potvrdenia nechá všetky výsledky nedotknuté", () => {
  const c = playedSetup();
  c.__confirmAnswer = false;
  c.setWinner(2, "S8");
  const WIN = c.__get().WIN;
  assert.equal(WIN[2], "S9");
  assert.equal(WIN[9], "S9");
  assert.equal(WIN[21], "S9");
});

test("zmena bez kaskády nepýta potvrdenie", () => {
  const c = playedSetup();
  c.__confirmLog.length = 0;
  c.setWinner(21, "S5"); // Z21 je posledný zapísaný vo svojej vetve — nič ďalšie sa nezneplatní
  assert.equal(c.__confirmLog.length, 0);
  assert.equal(c.__get().WIN[21], "S5");
});

test("výmena porazeného účastníka neskoršieho zápasu zneplatní jeho starý výsledok", () => {
  const c = makeContext();
  c.setWinner(3, "S5"); c.setWinner(4, "S13"); // L3=S12, L4=S4
  c.setWinner(14, "S12");                      // Z14: S12 vs S4
  c.setWinner(3, "S12");                       // teraz L3=S5 → Z14 sa reálne nehral v novej podobe
  const WIN = c.__get().WIN;
  assert.ok(!(14 in WIN), "Z14 musí byť zneplatnený — porazený účastník sa vymenil");
});

suite("Undo");

test("undo vráti stav pred kaskádovou zmenou", () => {
  const c = playedSetup();
  c.setWinner(2, "S8");
  assert.ok(!(9 in c.__get().WIN));
  c.undo();
  const WIN = c.__get().WIN;
  assert.equal(WIN[2], "S9");
  assert.equal(WIN[9], "S9");
  assert.equal(WIN[21], "S9");
});

test("undo vráti stav pred resetom výsledkov", () => {
  const c = playedSetup();
  const before = Object.keys(c.__get().WIN).length;
  c.pushUndo();
  // simulácia resetBtn: pushUndo + vymazanie
  const g = c.__get();
  for (const k of Object.keys(g.WIN)) delete g.WIN[k];
  assert.equal(Object.keys(c.__get().WIN).length, 0);
  c.undo();
  assert.equal(Object.keys(c.__get().WIN).length, before);
});

test("odznačenie výsledku (toggle) zmaže len vlastný výsledok", () => {
  const c = makeContext();
  c.setWinner(2, "S9"); c.setWinner(3, "S5");
  c.setWinner(2, "S9"); // toggle off
  const WIN = c.__get().WIN;
  assert.ok(!(2 in WIN));
  assert.equal(WIN[3], "S5");
});
