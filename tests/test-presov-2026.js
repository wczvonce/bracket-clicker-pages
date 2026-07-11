// Regresný test proti REÁLNEMU turnaju: Niké Summer Beach Tour, Prešov „A",
// 27.–28. 6. 2026 (oficiálny rozpis SVF, všetkých 30 zápasov dohraných).
// Overuje, že prepojenia pavúka v aplikácii zodpovedajú skutočnému systému
// a že import vyplneného hárku (vyriešené mená namiesto W/L) funguje.
"use strict";
const assert = require("node:assert");
const path = require("node:path");
const { makeContext, REPO } = require("./harness");
const { test, suite } = require("./t");
const XLSX = require(path.join(REPO, "vendor", "xlsx.full.min.js"));

const NAMES = {
  S1: "Nemec / Berčík J. (CZE)", S2: "Marčok / Pavlinský", S3: "Petro / Zsoldos",
  S4: "Šíma / Lukáč", S5: "Ludha / Kubš", S6: "Povrazník / Pokopec",
  S7: "Petráš / Neštický", S8: "Janto / Královič", S9: "Hajzuš / Červenák L.",
  S10: "Dzurík / Šemanský", S11: "Gréč / Žák", S12: "Sýkora / Korec",
  S13: "Kvíčala(CZE) / Andrš(CZE)", S14: "Ondrušek / Matušovský",
  S15: "Tůma(CZE) / Vyoral(CZE)", S16: "Brilla L. / Velička",
};
// [zápas, tím A, tím B, výsledok] presne podľa oficiálneho hárku
const MATCHES = [
  [1, "S1", "S16", "2 : 0"], [2, "S9", "S8", "0 : 2"], [3, "S5", "S12", "2 : 0"], [4, "S13", "S4", "1 : 2"],
  [5, "S3", "S14", "1 : 2"], [6, "S11", "S6", "0 : 2"], [7, "S7", "S10", "2 : 0"], [8, "S15", "S2", "0 : 2"],
  [9, "S1", "S8", "2 : 1"], [10, "S5", "S4", "0 : 2"], [11, "S14", "S6", "0 : 2"], [12, "S7", "S2", "1 : 2"],
  [13, "S16", "S9", "2 : 0"], [14, "S12", "S13", "0 : 2"], [15, "S3", "S11", "1 : 2"], [16, "S10", "S15", "1 : 2"],
  [17, "S16", "S7", "0 : 2"], [18, "S13", "S14", "2 : 0"], [19, "S11", "S5", "1 : 2"], [20, "S15", "S8", "2 : 1"],
  [21, "S1", "S4", "2 : 0"], [22, "S6", "S2", "1 : 2"],
  [23, "S7", "S13", "0 : 2"], [24, "S5", "S15", "0 : 2"],
  [25, "S15", "S6", "2 : 0"], [26, "S13", "S4", "2 : 1"],
  [27, "S1", "S15", "0 : 2"], [28, "S2", "S13", "0 : 2"],
  [29, "S1", "S2", "2 : 1"], [30, "S15", "S13", "2 : 1"],
];
const winnerOf = ([, a, b, res]) => res.split(":")[0].trim() > res.split(":")[1].trim() ? a : b;

suite("Prešov 2026 — prehratie celého turnaja klikaním");

test("účastníci všetkých 30 zápasov zodpovedajú oficiálnemu rozpisu", () => {
  const c = makeContext();
  c.__setModel(JSON.parse(JSON.stringify(c.__get().BASE_MODEL)));
  for (const m of MATCHES) {
    const [num, a, b] = m;
    const st = c.matchState(num);
    assert.deepEqual([st.a, st.b], [a, b], `Z${num}: aplikácia tvrdí ${st.a} vs ${st.b}, turnaj hral ${a} vs ${b}`);
    c.setWinner(num, winnerOf(m));
  }
  assert.equal(Object.keys(c.__get().WIN).length, 30);
});

test("konečné umiestnenia zodpovedajú skutočnosti (S15 titul z bazín po prehre v 1. kole)", () => {
  const c = makeContext();
  c.__setModel(JSON.parse(JSON.stringify(c.__get().BASE_MODEL)));
  for (const m of MATCHES) c.setWinner(m[0], winnerOf(m));
  c.__setSeed("S15"); assert.match(c.branchText(), /VÍŤAZ TURNAJA/);
  c.__setSeed("S13"); assert.match(c.branchText(), /2\. MIESTO/);
  c.__setSeed("S1");  assert.match(c.branchText(), /3\. MIESTO/);
  c.__setSeed("S2");  assert.match(c.branchText(), /4\. MIESTO/);
  c.__setSeed("S9");  assert.match(c.branchText(), /VYRADENÝ PO 2\. PREHRE/);
});

suite("Prešov 2026 — import dohraného hárku (vyriešené mená namiesto W/L)");

function officialSheet(matches) {
  const rows = [["Č.", "Kolo", "Dátum", "Čas", "Ihr.", "Tím 1", "", "Tím 2", "Výsledok"]];
  for (const [num, a, b, res] of matches)
    rows.push([String(num), "I", "27/6", "8:00", "1", `${NAMES[a]} (${a})`, "vs", `${NAMES[b]} (${b})`, res]);
  return XLSX.utils.aoa_to_sheet(rows);
}

test("parser odvodí W/L prepojenia z výsledkov — model je presne štandardný pavúk", () => {
  const c = makeContext();
  c.XLSX = XLSX;
  const res = c.parseExcelDraw(officialSheet(MATCHES));
  assert.deepEqual(res.model, c.__get().BASE_MODEL);
});

test("import celého turnaja: výsledky, mená aj umiestnenia sedia", () => {
  const c = makeContext();
  c.XLSX = XLSX;
  const res = c.parseExcelDraw(officialSheet(MATCHES));
  const out = c.applyParsed(res);
  assert.equal(out.cancelled, false);
  assert.equal(out.missing.length, 0, "všetkých 16 mien sa musí načítať");
  const g = c.__get();
  assert.equal(Object.keys(g.WIN).length, 30);
  for (const m of MATCHES) assert.equal(g.WIN[m[0]], winnerOf(m), `Z${m[0]}`);
  assert.equal(g.TEAMS.S15, NAMES.S15);
  assert.equal(g.TEAMS.S1, NAMES.S1);
  c.__setSeed("S15"); assert.match(c.branchText(), /VÍŤAZ TURNAJA/);
  c.__setSeed("S1"); assert.match(c.branchText(), /3\. MIESTO/);
});

test("rozohraný hárok (len 1. kolo) sa importuje — zvyšok doplní štandardné prepojenie", () => {
  const c = makeContext();
  c.XLSX = XLSX;
  const res = c.parseExcelDraw(officialSheet(MATCHES.slice(0, 8)));
  assert.ok(res.model, "model sa musí doplniť z BASE_MODEL");
  assert.deepEqual(res.model, c.__get().BASE_MODEL);
  const out = c.applyParsed(res);
  assert.equal(Object.keys(c.__get().WIN).length, 8);
  const st9 = c.matchState(9); // W1 vs W2 = S1 vs S8
  assert.deepEqual([st9.a, st9.b], ["S1", "S8"]);
});

test("hárok bez 1. kola sa odmietne (nasadenie sa nedá odvodiť)", () => {
  const c = makeContext();
  c.XLSX = XLSX;
  const res = c.parseExcelDraw(officialSheet(MATCHES.slice(8)));
  assert.equal(res.model, null);
});
