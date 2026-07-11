// Turnajová logika: postup pavúkom, BYE scenáre, dvojitá eliminácia po Final Four.
"use strict";
const assert = require("node:assert");
const { makeContext } = require("./harness");
const { test, suite } = require("./t");

suite("Pavúk — postup a BYE");

// Kompletne rozohraný turnaj: S9 ide bez prehry až po titul.
function playFullRun(c) {
  c.setWinner(2, "S9"); c.setWinner(3, "S5"); c.setWinner(4, "S13"); c.setWinner(5, "S3");
  c.setWinner(6, "S11"); c.setWinner(7, "S7"); c.setWinner(8, "S15");
  c.setWinner(9, "S9"); c.setWinner(10, "S5"); c.setWinner(11, "S3"); c.setWinner(12, "S7");
  c.setWinner(14, "S12"); c.setWinner(15, "S14"); c.setWinner(16, "S10");
  c.setWinner(17, "S8"); c.setWinner(18, "S12"); c.setWinner(19, "S14"); c.setWinner(20, "S10");
  c.setWinner(21, "S9"); c.setWinner(22, "S3");
  c.setWinner(23, "S8"); c.setWinner(24, "S14");
  c.setWinner(25, "S14"); c.setWinner(26, "S8");
  c.setWinner(27, "S9"); c.setWinner(28, "S3");
  c.setWinner(29, "S8"); c.setWinner(30, "S9");
}

test("tím prejde celý hlavný pavúk bez prehry a vyhrá turnaj", () => {
  const c = makeContext();
  playFullRun(c);
  assert.equal(c.matchState(30).w, "S9");
  c.__setSeed("S9");
  assert.match(c.branchText(), /VÍŤAZ TURNAJA/);
});

test("BYE proti tímu: zápas sa rozhodne automaticky", () => {
  const c = makeContext();
  const st = c.matchState(1); // S1 vs BYE
  assert.equal(st.w, "S1");
  assert.equal(st.auto, true);
});

test("tím prehrá prvý zápas a pokračuje spodným pavúkom", () => {
  const c = makeContext();
  c.setWinner(2, "S9"); // S8 prehral
  const st13 = c.matchState(13); // A=BYE, B=L2
  assert.equal(st13.b, "S8");
  assert.equal(st13.w, "S8"); // BYE ho púšťa ďalej automaticky
  c.__setSeed("S8");
  assert.ok(c.targetPath().includes(17), "S8 má pokračovať v Z17");
});

test("tím prehrá druhý zápas a turnaj preňho končí", () => {
  const c = makeContext();
  c.setWinner(2, "S9");                       // 1. prehra S8 → Z13 (auto cez BYE) → Z17
  c.setWinner(7, "S7"); c.setWinner(8, "S15");
  c.setWinner(12, "S7");                      // L12 = S15 → Z17: S8 vs S15
  const st17 = c.matchState(17);
  assert.deepEqual([st17.a, st17.b], ["S8", "S15"]);
  c.setWinner(17, "S15");                     // 2. prehra S8
  c.__setSeed("S8");
  const ids = c.targetPath();
  assert.equal(ids[ids.length - 1], 17, "po 2. prehre sa S8 už nesmie objaviť v ďalšom zápase");
  assert.match(c.branchText(), /VYRADENÝ PO 2\. PREHRE/);
});

test("BYE proti BYE: víťaz aj porazený je BYE a šíri sa ďalej", () => {
  const c = makeContext();
  c.__get().M[1] = { A: "BYE", B: "BYE" };
  const st1 = c.matchState(1);
  assert.equal(st1.w, "BYE");
  assert.equal(st1.auto, true);
  // Z13 = L1 v BASE modeli; v defaultnom M je A rovno BYE — over aspoň Z9: W1=BYE => auto postup W2
  c.setWinner(2, "S9");
  const st9 = c.matchState(9);
  assert.equal(st9.a, "BYE");
  assert.equal(st9.w, "S9");
  assert.equal(st9.auto, true);
});

test("viacero po sebe idúcich BYE sa prepadáva pavúkom", () => {
  const c = makeContext();
  // Vyrob 3 BYE v prvom kole za sebou
  c.__get().M[1] = { A: "BYE", B: "BYE" };
  c.__get().M[2] = { A: "S9", B: "BYE" };
  const st9 = c.matchState(9); // W1=BYE vs W2=S9 → auto S9
  assert.equal(st9.w, "S9");
  const st13 = c.matchState(13); // A=BYE, B=L2=BYE → auto BYE
  assert.equal(st13.w, "BYE");
  const st17 = c.matchState(17); // W13=BYE vs L12 → čaká na L12, ale slot A=BYE
  assert.equal(st17.a, "BYE");
});

suite("Formát záveru (dvojitá eliminácia po Final Four)");

test("finalista bez prehry po prehratom finále NEmá odvetu (bez bracket resetu)", () => {
  const c = makeContext();
  playFullRun(c);
  // S3 vyhral finále nad S9; S9 mal jedinú prehru — model nemá žiadny Z31
  const M = c.__get().M;
  assert.equal(Object.keys(M).length, 30);
  assert.ok(!(31 in M));
});

test("semifinále je kríž: víťaz hlavného pavúka vs. preživší z bazín", () => {
  const c = makeContext();
  const M = c.__get().M;
  assert.deepEqual(M[27], { A: { W: 21 }, B: { W: 25 } });
  assert.deepEqual(M[28], { A: { W: 22 }, B: { W: 26 } });
  assert.deepEqual(M[29], { A: { L: 27 }, B: { L: 28 } });
  assert.deepEqual(M[30], { A: { W: 27 }, B: { W: 28 } });
});
