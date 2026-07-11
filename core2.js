"use strict";
const MAX_XLSX_BYTES=10*1024*1024, MAX_PDF_BYTES=20*1024*1024, MAX_PDF_PAGES=10;

function loadScript(src){return new Promise((ok,no)=>{const s=document.createElement("script");s.src=src;s.onload=ok;s.onerror=()=>no(Error("Knižnica sa nenačítala: "+src));document.head.append(s)})}
async function getXLSX(){if(!window.XLSX)await loadScript("vendor/xlsx.full.min.js");if(!window.XLSX)throw Error("Knižnica XLSX sa nenačítala");return window.XLSX}
async function getPdfjs(){
 if(window.pdfjsLib)return window.pdfjsLib;
 const lib=await import("./vendor/pdf.min.mjs");
 lib.GlobalWorkerOptions.workerSrc="vendor/pdf.worker.min.mjs";
 window.pdfjsLib=lib;
 return lib;
}

function parseSlotText(value){const s=String(value??"").replace(/\s+/g," ").trim();if(!s)return null;if(/^BYE$/i.test(s)||/voľn[ýy]\s+žreb/i.test(s))return BYE;let m=s.match(/^W\s*(\d{1,2})$/i);if(m)return{W:+m[1]};m=s.match(/^L\s*(\d{1,2})$/i);if(m)return{L:+m[1]};m=s.match(/\(S(1[0-6]|[1-9])\)/i)||s.match(/^S(1[0-6]|[1-9])$/i);if(m)return"S"+(m[1]||m[0].replace(/\D/g,""));return null}
// Meno tímu = text PRED zátvorkou (Sx): prípadné skóre či poznámky za ňou
// nie sú súčasť mena. Úvodné číslo zápasu („1 ", „01. ") sa odstráni.
function teamFromText(value){
 const s=String(value??"").replace(/\s+/g," ").trim(),m=s.match(/\(S(1[0-6]|[1-9])\)/i);
 if(!m)return null;
 const name=s.slice(0,m.index).replace(/^\d{1,2}\s*[.)]?\s+/,"").trim();
 return name?{seed:"S"+m[1],name}:null;
}
function scoreSide(value){const m=String(value??"").match(/\b([0-2])\s*:\s*([0-2])\b/);if(!m||m[1]===m[2])return null;return +m[1]>+m[2]?"A":"B"}
// Rozohraný/dohraný oficiálny hárok má v kolách II–F už VYRIEŠENÉ mená
// (napr. Z9: „... (S1) vs ... (S8)"), nie odkazy W1/W2. Priamy zápis seedov
// by v modeli vyrobil duplicity. Preto sa pre zápasy 9–30 seed prevedie na
// štrukturálny odkaz: účastník = víťaz/porazený svojho POSLEDNÉHO
// odohraného zápasu. Chýbajúce riadky doplní štandardné prepojenie
// BASE_MODEL (rovnaké vo všetkých turnajoch SVF).
function finalizeModel(model,rows){
 for(let n=1;n<=8;n++)if(!model[n])return null; // 1. kolo (nasadenie) musí byť v súbore
 const winnerSide={};for(const r of rows)if(winnerSide[r.num]===undefined)winnerSide[r.num]=r.winnerSide;
 const out={},outcome={},played={};
 const seedOf=s=>typeof s==="string"?s:(s.W?outcome[s.W]?.w:outcome[s.L]?.l)||null;
 const convert=s=>{if(typeof s==="string"&&s!==BYE&&played[s])return played[s].won?{W:played[s].id}:{L:played[s].id};return s};
 for(let num=1;num<=30;num++){
  const m=model[num]||BASE_MODEL[num];
  out[num]=num>8?{A:convert(m.A),B:convert(m.B)}:{A:m.A,B:m.B};
  const sA=seedOf(out[num].A),sB=seedOf(out[num].B);
  if(!sA||!sB)continue;
  let w=null;
  if(sA===BYE&&sB===BYE)w=BYE;
  else if(sA===BYE)w=sB;else if(sB===BYE)w=sA;
  else{const ws=winnerSide[num];if(ws)w=ws==="A"?sA:sB}
  if(!w)continue;
  const l=sA===w?sB:sA;
  outcome[num]={w,l};
  if(w!==BYE)played[w]={id:num,won:true};
  if(l!==BYE)played[l]={id:num,won:false};
 }
 return out;
}
function applyParsed(res){
 if(res.model&&!validateModel(res.model))throw Error("Importovaný rozpis je nekonzistentný (duplicitné alebo neplatné prepojenia) — nič sa nezmenilo");
 // Import nahrádza celý turnaj — pri rozohranom turnaji ho treba výslovne potvrdiť.
 const resultCount=Object.keys(WIN).length;
 if(resultCount&&!confirm(`Import nahradí aktuálny turnaj vrátane ${resultCount} zapísaných výsledkov (vrátiť sa dá tlačidlom Späť). Pokračovať?`))return{cancelled:true};
 pushUndo();
 if(res.model){
  M=res.model;
  // Nový turnaj nesmie zdediť mená zo starého — nerozpoznaný seed ostane ako „S8", nie cudzie meno.
  for(const k of Object.keys(TEAMS))delete TEAMS[k];
 }
 WIN={};WINCTX={};
 for(const t of res.teams||[])if(t.name&&isSeed(t.seed))TEAMS[t.seed]=String(t.name).slice(0,80);
 for(const r of (res.rows||[]).sort((a,b)=>a.num-b.num)){if(!r.winnerSide)continue;const st=matchState(r.num),w=r.winnerSide==="A"?st.a:st.b;if(w&&w!==BYE){WIN[r.num]=w;WINCTX[r.num]={a:st.a,b:st.b}}}
 prune();buildSelect();render();
 return{cancelled:false,missing:activeSeeds().filter(s=>!TEAMS[s])};
}
function parseExcelDraw(ws){const grid=XLSX.utils.sheet_to_json(ws,{header:1,raw:false,defval:""}),rows=[],model={},teams=[];let hdr=-1,numCol=0,aCol=5,bCol=7,resCol=8;for(let i=0;i<grid.length;i++){const r=grid[i].map(x=>String(x).trim());if(r.some(x=>/^Tím\s*1$/i.test(x))&&r.some(x=>/^Tím\s*2$/i.test(x))){hdr=i;numCol=r.findIndex(x=>/^Č\.?$/i.test(x));aCol=r.findIndex(x=>/^Tím\s*1$/i.test(x));bCol=r.findIndex(x=>/^Tím\s*2$/i.test(x));resCol=r.findIndex(x=>/^Výsledok$/i.test(x));if(numCol<0)throw Error("V hárku chýba stĺpec Č. (číslo zápasu)");break}}if(hdr<0)hdr=4;for(let i=hdr+1;i<grid.length;i++){const r=grid[i],num=+r[numCol];
// Number.isInteger: NaN prejde cez porovnania <1/>30 a vyrobil by kľúč model[NaN].
if(!Number.isInteger(num)||num<1||num>30)continue;const A=parseSlotText(r[aCol]),B=parseSlotText(r[bCol]);if(A&&B)model[num]={A,B};const ta=teamFromText(r[aCol]),tb=teamFromText(r[bCol]);if(ta)teams.push(ta);if(tb)teams.push(tb);rows.push({num,winnerSide:resCol<0?null:scoreSide(r[resCol])})}return{rows,model:finalizeModel(model,rows),teams}}
function parseSeeding(ws){const grid=XLSX.utils.sheet_to_json(ws,{header:1,raw:false,defval:""}),teams=[];for(const row of grid){let si=-1,seed=null;for(let i=row.length-1;i>=0;i--){const m=String(row[i]).trim().match(/^S(1[0-6]|[1-9])$/i);if(m){si=i;seed="S"+m[1];break}}if(si<0)continue;let found=null;for(let i=si-1;i>=0;i--){const c=String(row[i]).replace(/\s+/g," ").trim();if(!c)continue;const m=c.match(/\(S(1[0-6]|[1-9])\)\s*$/i);if(m&&"S"+m[1]===seed){const name=c.replace(/\s*\(S\d+\)\s*$/i,"").trim();if(name)found={seed,name};break}}if(found)teams.push(found)}return teams}
function parsePdfText(text){const rows=[],model={},teams=[];
// Bez lookbehind (Safari<16.4 by inak spadol na parse celého súboru) a s
// podporou „vs." — detekcia aj split musia akceptovať ROVNAKÉ tvary, inak
// riadok prejde testom, split ho nerozdelí a celý import zlyhá.
const VS_TEST=/(^|[^A-Za-z0-9_])vs\.?([^A-Za-z0-9_]|$)/i,VS_SPLIT=/\s+vs\.?\s+/i;
// Pred parsovaním slotu odstráň úvodné číslo zápasu (ľavá strana) a koncové
// skóre (pravá strana) — inak by W/L riadky s výsledkom vôbec neprešli.
const stripNum=v=>String(v).replace(/^\s*\d{1,2}\s*[.)]?\s*/,""),stripScore=v=>String(v).replace(/\b[0-2]\s*:\s*[0-2]\b.*$/,"").trim();
for(const line of text.split(/\n+/)){const h=line.match(/^\s*(\d{1,2})\b/);if(!h||!VS_TEST.test(line))continue;const num=+h[1];if(num<1||num>30)continue;const p=line.split(VS_SPLIT),A=parseSlotText(stripScore(stripNum(p[0]))),B=parseSlotText(stripScore(p[1]));if(A&&B)model[num]={A,B};const ta=teamFromText(p[0]),tb=teamFromText(p[1]);if(ta)teams.push(ta);if(tb)teams.push(tb);rows.push({num,winnerSide:scoreSide(p[1])})}return{rows,model:finalizeModel(model,rows),teams}}

function importDoneMsg(kind,res,extra){
 let t=`${kind} načítaný: 30 zápasov a presné prepojenia.${extra||""}`;
 if(res.missing&&res.missing.length)t+=` Mená sa nenačítali pre: ${res.missing.join(", ")} — v pavúku ostane označenie seedu.`;
 showMsg(t,res.missing&&res.missing.length?"":"ok");
}
async function handleExcel(file){
 if(file.size>MAX_XLSX_BYTES)throw Error(`Excel je príliš veľký (${(file.size/1048576).toFixed(1)} MB, limit 10 MB)`);
 const XLSX=await getXLSX();
 const wb=XLSX.read(await file.arrayBuffer(),{type:"array"}),drawName=wb.SheetNames.find(n=>/main\s*draw|draw|zápas|rozpis/i.test(n)),seedName=wb.SheetNames.find(n=>/nasaden|seeding/i.test(n));
 if(!drawName)throw Error("Nenašiel som hárok Main Draw");
 const res=parseExcelDraw(wb.Sheets[drawName]);
 if(seedName)res.teams.push(...parseSeeding(wb.Sheets[seedName]));
 if(!res.model)throw Error("Nenačítalo sa všetkých 30 zápasov");
 const out=applyParsed(res);
 if(out.cancelled){showMsg("Import bol zrušený — nič sa nezmenilo.");return}
 importDoneMsg("Excel",out,` ${new Set(res.teams.map(x=>x.seed)).size} dvojíc, BYE a všetky W/L prepojenia sú aktívne.`);
}
async function handlePdf(file){
 if(file.size>MAX_PDF_BYTES)throw Error(`PDF je príliš veľké (${(file.size/1048576).toFixed(1)} MB, limit 20 MB)`);
 const lib=await getPdfjs();
 // isEvalSupported:false — škodlivé PDF nesmie spustiť JavaScript (CVE-2024-4367).
 const task=lib.getDocument({data:await file.arrayBuffer(),isEvalSupported:false});
 try{
  const pdf=await task.promise;
  if(pdf.numPages>MAX_PDF_PAGES)throw Error(`PDF má priveľa strán (${pdf.numPages}, limit ${MAX_PDF_PAGES})`);
  let text="";
  for(let p=1;p<=pdf.numPages;p++){const page=await pdf.getPage(p),tc=await page.getTextContent(),items=tc.items.map(x=>({x:x.transform[4],y:x.transform[5],s:x.str})).sort((a,b)=>b.y-a.y||a.x-b.x),lines=[];for(const it of items){let l=lines.find(x=>Math.abs(x.y-it.y)<=3.5);if(!l){l={y:it.y,a:[]};lines.push(l)}l.a.push(it)}for(const l of lines)text+=l.a.sort((a,b)=>a.x-b.x).map(x=>x.s).join(" ")+"\n"}
  const res=parsePdfText(text);
  if(!res.model)throw Error("Z PDF sa nepodarilo načítať všetkých 30 prepojení");
  const out=applyParsed(res);
  if(out.cancelled){showMsg("Import bol zrušený — nič sa nezmenilo.");return}
  importDoneMsg("PDF",out);
 }finally{
  // Uvoľni worker a pamäť PDF dokumentu aj pri chybe.
  task.destroy().catch(()=>{});
 }
}
$("uploadBtn").onclick=()=>$("fileInput").click();
$("fileInput").onchange=async e=>{
 const f=e.target.files[0];if(!f)return;showMsg("Načítavam…");
 try{
  if(/\.xlsx$/i.test(f.name)||/spreadsheet/.test(f.type))await handleExcel(f);
  else if(/\.pdf$/i.test(f.name)||f.type==="application/pdf")await handlePdf(f);
  else throw Error("Podporovaný je iba súbor .xlsx alebo .pdf");
 }catch(err){console.error(err);showMsg("Chyba: "+err.message,"err")}
 finally{e.target.value=""}
};
$("resetBtn").onclick=()=>{if(!confirm("Naozaj vymazať VŠETKY zadané výsledky? Prepojenia a mená dvojíc ostanú."))return;pushUndo();WIN={};WINCTX={};render();showMsg("Výsledky boli vymazané. Prepojenia a mená ostali.","ok")};
$("undoBtn").onclick=()=>undo();
$("copyBtn").onclick=async()=>{const b=$("copyBtn"),o=b.textContent;try{await navigator.clipboard.writeText(branchText());b.textContent="Skopírované ✓";b.classList.add("ok")}catch{b.textContent="Kopírovanie zlyhalo"}setTimeout(()=>{b.textContent=o;b.classList.remove("ok")},1400)};
buildSelect();render();
