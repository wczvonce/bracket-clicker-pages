// PDF a Excel parser: mená bez čísel zápasov a skóre, W/L prepojenia, importy.
"use strict";
const assert = require("node:assert");
const path = require("node:path");
const { makeContext, REPO } = require("./harness");
const { test, suite } = require("./t");

const XLSX = require(path.join(REPO, "vendor", "xlsx.full.min.js"));

suite("PDF parser — mená tímov");

test("číslo zápasu neostane v prvom mene a skóre v druhom", () => {
  const c = makeContext();
  const res = c.parsePdfText("1 Team A (S1) vs Team B (S16) 2:0");
  assert.deepEqual(res.teams, [{ seed: "S1", name: "Team A" }, { seed: "S16", name: "Team B" }]);
  assert.deepEqual(res.rows, [{ num: 1, winnerSide: "A" }]);
});

test("'vs.' s bodkou a skóre s medzerami", () => {
  const c = makeContext();
  const res = c.parsePdfText("1 Team A (S1) vs. Team B (S16) 2 : 1");
  assert.deepEqual(res.teams, [{ seed: "S1", name: "Team A" }, { seed: "S16", name: "Team B" }]);
  assert.equal(res.rows[0].winnerSide, "A");
});

test("nula na začiatku čísla a VS veľkými", () => {
  const c = makeContext();
  const res = c.parsePdfText("01 Team A (S1) VS Team B (S16)");
  assert.deepEqual(res.teams, [{ seed: "S1", name: "Team A" }, { seed: "S16", name: "Team B" }]);
  assert.equal(res.rows[0].winnerSide, null);
});

test("diakritika a lomka v menách dvojíc ostávajú nedotknuté", () => {
  const c = makeContext();
  const res = c.parsePdfText("3 Šebök / Blažo (S11) vs Gréč / Žák (S5) 0:2");
  assert.deepEqual(res.teams, [{ seed: "S11", name: "Šebök / Blažo" }, { seed: "S5", name: "Gréč / Žák" }]);
  assert.equal(res.rows[0].winnerSide, "B");
});

test("W/L riadok so zapísaným výsledkom sa parsuje (číslo aj skóre sa odstránia)", () => {
  const c = makeContext();
  const res = c.parsePdfText("21 W9 vs W10 2:0\n29 L27 vs L28");
  assert.deepEqual(res.rows, [{ num: 21, winnerSide: "A" }, { num: 29, winnerSide: null }]);
});

test("kompletné PDF s 30 zápasmi vyrobí validný model", () => {
  const c = makeContext();
  const M = c.__get().M;
  const lines = [];
  for (let id = 1; id <= 30; id++) {
    const s = x => typeof x === "string" ? (x === "BYE" ? "BYE" : `${c.__get().TEAMS[x] || x} (${x})`) : (x.W ? "W" + x.W : "L" + x.L);
    lines.push(`${id} ${s(M[id].A)} vs ${s(M[id].B)}`);
  }
  const res = c.parsePdfText(lines.join("\n"));
  assert.ok(res.model, "model sa musí načítať celý");
  assert.equal(Object.keys(res.model).length, 30);
  assert.ok(c.validateModel(res.model));
});

suite("Excel parser");

function buildSheet(rows) {
  return XLSX.utils.aoa_to_sheet([["Č.", "Tím 1", "Tím 2", "Výsledok"], ...rows]);
}

test("mená, prepojenia a výsledky z hárku Main Draw", () => {
  const c = makeContext();
  c.XLSX = XLSX; // parseExcelDraw číta globálny XLSX vo VM
  const M = c.__get().M;
  const rows = [];
  for (let id = 1; id <= 30; id++) {
    const s = x => typeof x === "string" ? (x === "BYE" ? "BYE" : `${c.__get().TEAMS[x] || x} (${x})`) : (x.W ? "W" + x.W : "L" + x.L);
    rows.push([String(id), s(M[id].A), s(M[id].B), id === 2 ? "2:1" : ""]);
  }
  const res = c.parseExcelDraw(buildSheet(rows));
  assert.ok(res.model);
  assert.equal(Object.keys(res.model).length, 30);
  assert.equal(res.teams.find(t => t.seed === "S9").name, "Purdeš / Zavacký");
  assert.deepEqual(res.rows.find(r => r.num === 2), { num: 2, winnerSide: "A" });
});

suite("applyParsed — bezpečnosť importu");

test("nekonzistentný import (duplicitný seed) nič nezmení", () => {
  const c = makeContext();
  c.setWinner(2, "S9");
  const badModel = JSON.parse(JSON.stringify(c.__get().M));
  badModel[3] = { A: "S9", B: "S12" }; // S9 duplicitne
  assert.throws(() => c.applyParsed({ model: badModel, teams: [], rows: [] }), /nekonzistentný/);
  assert.equal(c.__get().WIN[2], "S9", "pôvodné výsledky musia ostať");
});

test("import nesmie ponechať mená zo starého turnaja", () => {
  const c = makeContext();
  const model = JSON.parse(JSON.stringify(c.__get().M));
  const out = c.applyParsed({ model, teams: [{ seed: "S1", name: "Nový tím" }], rows: [] });
  const TEAMS = c.__get().TEAMS;
  assert.equal(TEAMS.S1, "Nový tím");
  assert.equal(TEAMS.S5, undefined, "S5 nesmie zdediť meno zo starého turnaja");
  assert.equal(c.__label("S5"), "S5", "nenačítaný seed sa zobrazuje ako seed");
  assert.ok(out.missing.includes("S5"), "chýbajúce mená musia byť nahlásené");
});

test("import rozohraného turnaja vyžaduje potvrdenie; odmietnutie nič nezmení", () => {
  const c = makeContext();
  c.setWinner(2, "S9");
  c.__confirmAnswer = false;
  c.__confirmLog.length = 0;
  const model = JSON.parse(JSON.stringify(c.__get().M));
  const out = c.applyParsed({ model, teams: [{ seed: "S1", name: "Nový tím" }], rows: [] });
  assert.equal(out.cancelled, true);
  assert.equal(c.__confirmLog.length, 1);
  assert.equal(c.__get().WIN[2], "S9");
  assert.equal(c.__get().TEAMS.S9, "Purdeš / Zavacký");
});

test("import sa dá vrátiť tlačidlom Späť", () => {
  const c = makeContext();
  c.setWinner(2, "S9");
  const model = JSON.parse(JSON.stringify(c.__get().M));
  c.applyParsed({ model, teams: [{ seed: "S1", name: "Nový tím" }], rows: [] });
  assert.equal(c.__get().TEAMS.S5, undefined);
  c.undo();
  assert.equal(c.__get().TEAMS.S5, "Gréč / Žák");
  assert.equal(c.__get().WIN[2], "S9");
});

test("výsledky z importu sa zapíšu aj s kontextom pre prune()", () => {
  const c = makeContext();
  const model = JSON.parse(JSON.stringify(c.__get().M));
  c.applyParsed({
    model,
    teams: [{ seed: "S9", name: "A / B" }, { seed: "S8", name: "C / D" }],
    rows: [{ num: 2, winnerSide: "A" }],
  });
  assert.equal(c.__get().WIN[2], "S9");
  assert.deepEqual(c.__get().WINCTX[2], { a: "S9", b: "S8" });
});
