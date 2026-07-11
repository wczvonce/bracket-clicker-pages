// branchText(): stavové texty nesmú protirečiť skutočnému stavu turnaja.
"use strict";
const assert = require("node:assert");
const { makeContext } = require("./harness");
const { test, suite } = require("./t");

// Rozohrá turnaj tak, že S8 prehrá Z2, prejde bazinami do semifinále (Z28) a tam prehrá.
function semifinalLoserSetup() {
  const c = makeContext();
  c.setWinner(2, "S9");
  c.setWinner(3, "S5"); c.setWinner(4, "S13"); c.setWinner(5, "S3");
  c.setWinner(6, "S11"); c.setWinner(7, "S7"); c.setWinner(8, "S15");
  c.setWinner(9, "S9"); c.setWinner(10, "S5"); c.setWinner(11, "S3"); c.setWinner(12, "S7");
  c.setWinner(14, "S12"); c.setWinner(15, "S14"); c.setWinner(16, "S10");
  c.setWinner(17, "S8"); c.setWinner(18, "S12"); c.setWinner(19, "S14"); c.setWinner(20, "S10");
  c.setWinner(21, "S9"); c.setWinner(22, "S3");
  c.setWinner(23, "S8"); c.setWinner(24, "S14");
  c.setWinner(26, "S8"); c.setWinner(25, "S14");
  c.setWinner(28, "S3"); // 2. prehra S8 v semifinále → čaká ho Z29
  c.__setSeed("S8");
  return c;
}

suite("branchText — stavové texty");

test("porazený zo semifinále NIE JE 'vyradený': hrá o 3. miesto", () => {
  const c = semifinalLoserSetup();
  const txt = c.branchText();
  assert.match(txt, /\[hrá\] Z29/);
  assert.doesNotMatch(txt, /VYRADENÝ/, "text nesmie protirečiť: hrá Z29 a zároveň vraj vyradený");
  assert.match(txt, /mimo boja o titul — hrá o 3\. miesto/);
});

test("víťaz zápasu o 3. miesto má konečné 3. miesto", () => {
  const c = semifinalLoserSetup();
  c.setWinner(27, "S9"); // doplní druhého účastníka Z29 (L27 = S14)
  c.setWinner(29, "S8");
  assert.match(c.branchText(), /3\. MIESTO/);
});

test("porazený zo zápasu o 3. miesto má konečné 4. miesto", () => {
  const c = semifinalLoserSetup();
  c.setWinner(27, "S9");
  c.setWinner(29, "S14");
  assert.match(c.branchText(), /4\. MIESTO/);
});

test("porazený finalista má 2. miesto, nie 'vyradený po 2. prehre'", () => {
  const c = semifinalLoserSetup();
  c.setWinner(27, "S9");
  c.setWinner(30, "S3"); // S9 prehral jediný zápas — finále
  c.__setSeed("S9");
  const txt = c.branchText();
  assert.match(txt, /2\. MIESTO/);
  assert.doesNotMatch(txt, /VYRADENÝ/);
});

test("víťaz finále je víťaz turnaja", () => {
  const c = semifinalLoserSetup();
  c.setWinner(27, "S9");
  c.setWinner(30, "S9");
  c.__setSeed("S9");
  assert.match(c.branchText(), /VÍŤAZ TURNAJA/);
});

test("skutočne vyradený tím (2 prehry, žiadny ďalší zápas) je označený ako vyradený", () => {
  const c = makeContext();
  c.setWinner(2, "S9");
  c.setWinner(7, "S7"); c.setWinner(8, "S15"); c.setWinner(12, "S7");
  c.setWinner(17, "S15");
  c.__setSeed("S8");
  assert.match(c.branchText(), /VYRADENÝ PO 2\. PREHRE/);
});

test("rozohraný tím bez prehry nemá žiadny záverečný verdikt", () => {
  const c = makeContext();
  c.setWinner(2, "S9");
  c.__setSeed("S9");
  const txt = c.branchText();
  assert.doesNotMatch(txt, /VYRADENÝ|MIESTO|VÍŤAZ/);
});
