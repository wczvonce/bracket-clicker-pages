"use strict";

const BYE="BYE";
const STATE_KEY="pavuk_state_v1"; // kľúč ostáva kvôli kontinuite so staršími uloženiami
const STATE_VERSION=2;
const TEAMS={S1:"Povrazník / Petro",S2:"Petráš / Neštický",S3:"Michalovič / Patúc",S4:"Pavlinský / Jarošík (CZE)",S5:"Gréč / Žák",S6:"Janto / Žiaček",S7:"Naňo / Regina",S8:"Ondrušek / Matušovský",S9:"Purdeš / Zavacký",S10:"Brilla L. / Velička",S11:"Šebök / Blažo",S12:"Holienka / Kúdelčík",S13:"Nataniel - Hajzuš / Červenák L.",S14:"Sekera / Sekera ml.",S15:"Mazák / Križák",S16:"S16"};
let M={
1:{A:"S1",B:BYE},2:{A:"S9",B:"S8"},3:{A:"S5",B:"S12"},4:{A:"S13",B:"S4"},5:{A:"S3",B:"S14"},6:{A:"S11",B:"S6"},7:{A:"S7",B:"S10"},8:{A:"S15",B:"S2"},
9:{A:{W:1},B:{W:2}},10:{A:{W:3},B:{W:4}},11:{A:{W:5},B:{W:6}},12:{A:{W:7},B:{W:8}},
13:{A:BYE,B:{L:2}},14:{A:{L:3},B:{L:4}},15:{A:{L:5},B:{L:6}},16:{A:{L:7},B:{L:8}},
17:{A:{W:13},B:{L:12}},18:{A:{W:14},B:{L:11}},19:{A:{W:15},B:{L:10}},20:{A:{W:16},B:{L:9}},
21:{A:{W:9},B:{W:10}},22:{A:{W:11},B:{W:12}},23:{A:{W:17},B:{W:18}},24:{A:{W:19},B:{W:20}},
25:{A:{W:24},B:{L:22}},26:{A:{W:23},B:{L:21}},27:{A:{W:21},B:{W:25}},28:{A:{W:22},B:{W:26}},29:{A:{L:27},B:{L:28}},30:{A:{W:27},B:{W:28}}
};
// Štandardné SVF prepojenie pavúka pre 16 dvojíc — rovnaké vo všetkých
// turnajoch (overené proti oficiálnemu rozpisu Niké Summer Beach Tour,
// Prešov „A", 27.–28. 6. 2026). Používa ho OCR aj fallback importu.
const BASE_MODEL={1:{A:"S1",B:"S16"},2:{A:"S9",B:"S8"},3:{A:"S5",B:"S12"},4:{A:"S13",B:"S4"},5:{A:"S3",B:"S14"},6:{A:"S11",B:"S6"},7:{A:"S7",B:"S10"},8:{A:"S15",B:"S2"},9:{A:{W:1},B:{W:2}},10:{A:{W:3},B:{W:4}},11:{A:{W:5},B:{W:6}},12:{A:{W:7},B:{W:8}},13:{A:{L:1},B:{L:2}},14:{A:{L:3},B:{L:4}},15:{A:{L:5},B:{L:6}},16:{A:{L:7},B:{L:8}},17:{A:{W:13},B:{L:12}},18:{A:{W:14},B:{L:11}},19:{A:{W:15},B:{L:10}},20:{A:{W:16},B:{L:9}},21:{A:{W:9},B:{W:10}},22:{A:{W:11},B:{W:12}},23:{A:{W:17},B:{W:18}},24:{A:{W:19},B:{W:20}},25:{A:{W:24},B:{L:22}},26:{A:{W:23},B:{L:21}},27:{A:{W:21},B:{W:25}},28:{A:{W:22},B:{W:26}},29:{A:{L:27},B:{L:28}},30:{A:{W:27},B:{W:28}}};
const TRACKS=[
{title:"Hlavný pavúk",cols:[{name:"1. kolo",ids:[1,2,3,4,5,6,7,8]},{name:"2. kolo",ids:[9,10,11,12]},{name:"3. kolo",ids:[21,22]}]},
{title:"Baziny (losers)",cols:[{name:"Prehra 13–16",ids:[16,15,14,13]},{name:"Prehra 9–12",ids:[20,19,18,17]},{name:"Prehra 7–8",ids:[24,23]},{name:"Prehra 5–6",ids:[25,26]}]},
{title:"Záver",cols:[{name:"Semifinále",ids:[27,28]},{name:"O 3. miesto",ids:[29]},{name:"Finále",ids:[30]}]}
];
let WIN={};
// Kontext výsledku: kto proti komu hral, keď sa výsledok zapisoval. Bez neho
// prune() nezneplatní nadväzujúci výsledok pri VÝMENE porazeného účastníka
// (oprava skoršieho zápasu) a appka by tvrdila výsledok neodohraného zápasu.
let WINCTX={};
let MY_SEED=(()=>{try{const s=localStorage.getItem("pavuk_my_seed");return /^S\d{1,2}$/.test(s||"")?s:"S1"}catch{return "S1"}})();
const $=id=>document.getElementById(id), label=s=>s===BYE?"BYE":(TEAMS[s]||s||"—");
function escHtml(v){return String(v).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#39;")}
function showMsg(t,c=""){const m=$("msg");if(m){m.textContent=t;m.className="msg "+c}}

// ---------- Undo: deštruktívne akcie (kaskáda, reset, import, nový pavúk) sa dajú vrátiť ----------
const UNDO=[];
const snapshot=()=>JSON.parse(JSON.stringify({M,TEAMS,WIN,WINCTX}));
function pushUndo(){UNDO.push(snapshot());if(UNDO.length>20)UNDO.shift()}
function undo(){
 const s=UNDO.pop();if(!s)return;
 M=s.M;WIN=s.WIN;WINCTX=s.WINCTX;
 for(const k of Object.keys(TEAMS))delete TEAMS[k];Object.assign(TEAMS,s.TEAMS);
 buildSelect();render();showMsg("Posledná zmena bola vrátená späť.","ok");
}
function updateUndoBtn(){const b=$("undoBtn");if(b){b.hidden=!UNDO.length;b.disabled=!UNDO.length}}

// ---------- Validácia modelu a uloženého stavu ----------
const isSeed=v=>typeof v==="string"&&/^S(1[0-6]|[1-9])$/.test(v);
function validateModel(model){const used=new Set();for(let id=1;id<=30;id++){const m=model[id];if(!m||!m.A||!m.B)return false;for(const s of [m.A,m.B]){if(typeof s==="object"){const r=+(s.W||s.L);if(!r||r>=id)return false;const key=(s.W?"W":"L")+r;if(used.has(key))return false;used.add(key)}else if(s!==BYE){
 // Každý seed a každá W/L referencia smie byť v pavúku len raz — inak by tím
 // existoval v dvoch vetvách alebo hral sám so sebou.
 if(used.has(s))return false;used.add(s)}}
 if(typeof m.A==="string"&&m.A===m.B&&m.A!==BYE)return false}
 return true}
function sanitizeSlot(s){
 if(s===BYE)return BYE;
 if(isSeed(s))return s;
 if(s&&typeof s==="object"){
  const W=+s.W,L=+s.L;
  if(Number.isInteger(W)&&W>=1&&W<=30&&s.L===undefined)return{W};
  if(Number.isInteger(L)&&L>=1&&L<=30&&s.W===undefined)return{L};
 }
 return null;
}
function sanitizeModel(raw){
 if(!raw||typeof raw!=="object")return null;
 const model={};
 for(let id=1;id<=30;id++){
  const m=raw[id];if(!m||typeof m!=="object")return null;
  const A=sanitizeSlot(m.A),B=sanitizeSlot(m.B);
  if(A===null||B===null)return null;
  model[id]={A,B};
 }
 return validateModel(model)?model:null;
}
function sanitizeTeams(raw){
 const out={};
 if(raw&&typeof raw==="object")for(const [k,v] of Object.entries(raw))if(isSeed(k)&&typeof v==="string"&&v.trim())out[k]=v.trim().slice(0,80);
 return out;
}
function sanitizeWinners(raw){
 const out={};
 if(raw&&typeof raw==="object")for(const [k,v] of Object.entries(raw)){const id=+k;if(Number.isInteger(id)&&id>=1&&id<=30&&isSeed(v))out[id]=v}
 return out;
}
function sanitizeCtx(raw){
 const ok=v=>v===BYE||isSeed(v);
 const out={};
 if(raw&&typeof raw==="object")for(const [k,v] of Object.entries(raw)){const id=+k;if(Number.isInteger(id)&&id>=1&&id<=30&&v&&typeof v==="object"&&ok(v.a)&&ok(v.b))out[id]={a:v.a,b:v.b}}
 return out;
}

// ---------- Persistencia: refresh/zabitie tabu nesmie zmazať rozohraný turnaj ----------
function saveState(){try{localStorage.setItem(STATE_KEY,JSON.stringify({version:STATE_VERSION,updatedAt:new Date().toISOString(),model:M,teams:TEAMS,winners:WIN,winnerContexts:WINCTX}))}catch{}}
function loadState(){
 let raw=null;
 try{raw=JSON.parse(localStorage.getItem(STATE_KEY)||"null")}catch{}
 if(!raw||typeof raw!=="object")return;
 // v1 nemal version a používal kľúče M/TEAMS/WIN/WINCTX — zmigruj ich
 const legacy=raw.version===undefined;
 const srcModel=legacy?raw.M:raw.model, srcTeams=legacy?raw.TEAMS:raw.teams,
       srcWin=legacy?raw.WIN:raw.winners, srcCtx=legacy?raw.WINCTX:raw.winnerContexts;
 const model=srcModel===undefined?undefined:sanitizeModel(srcModel);
 if(model===null){
  // Poškodený uložený turnaj nesmie rozbiť aplikáciu: odlož zálohu a začni od predvoleného rozpisu.
  try{localStorage.setItem(STATE_KEY+"_corrupt",localStorage.getItem(STATE_KEY))}catch{}
  showMsg("Uložený turnaj bol poškodený, načítal sa predvolený rozpis. Pôvodné dáta ostali v zálohe (pavuk_state_v1_corrupt).","err");
  return;
 }
 if(model)M=model;
 const teams=sanitizeTeams(srcTeams);
 if(Object.keys(teams).length){for(const k of Object.keys(TEAMS))delete TEAMS[k];Object.assign(TEAMS,teams)}
 WIN=sanitizeWinners(srcWin);
 WINCTX=sanitizeCtx(srcCtx);
 prune(); // dorovná výsledky, ktoré nesedia s modelom (napr. ručne upravený localStorage)
}

function resolveSlot(slot,seen=new Set()){
 if(typeof slot==="string") return slot;
 const ref=slot&&(+slot.W||+slot.L); if(!ref) return null;
 const st=matchState(ref,seen); return slot.W?st.w:st.l;
}
function matchState(id,seen=new Set()){
 if(!M[id]||seen.has(id)) return {a:null,b:null,w:null,l:null,auto:false};
 const next=new Set(seen); next.add(id);
 const a=resolveSlot(M[id].A,next),b=resolveSlot(M[id].B,next);
 let w=null,auto=false;
 if(a&&b){
  if(a===BYE&&b===BYE){w=BYE;auto=true}
  else if(a===BYE){w=b;auto=true}
  else if(b===BYE){w=a;auto=true}
  else if(WIN[id]===a||WIN[id]===b) w=WIN[id];
 }
 return {a,b,w,l:w?(a===w?b:a):null,auto};
}
function prune(){let changed=true;while(changed){changed=false;for(const k of Object.keys(WIN)){const id=+k,st=matchState(id),ctx=WINCTX[id];
 // Zmaž výsledok, keď (1) zápas už nemá oboch účastníkov / je BYE, (2) zapísaný
 // víťaz už nie je účastníkom, alebo (3) sa zmenil KTORÝKOĽVEK účastník oproti
 // stavu pri zápise (výmena porazeného = zápas sa reálne nehral v tejto podobe).
 if(!st.a||!st.b||st.a===BYE||st.b===BYE||(WIN[id]!==st.a&&WIN[id]!==st.b)||(ctx&&(ctx.a!==st.a||ctx.b!==st.b))){delete WIN[id];delete WINCTX[id];changed=true}}}}
function setWinner(id,seed){
 const st=matchState(id);
 if(!seed||seed===BYE||st.auto||!(seed===st.a||seed===st.b))return;
 const snap=snapshot();
 if(WIN[id]===seed){delete WIN[id];delete WINCTX[id]}
 else{WIN[id]=seed;WINCTX[id]={a:st.a,b:st.b}}
 prune();
 // Kaskáda: ak zmena zneplatnila aj iné výsledky, používateľ to musí výslovne potvrdiť.
 const removed=Object.keys(snap.WIN).map(Number).filter(k=>k!==id&&!(k in WIN)).sort((a,b)=>a-b);
 if(removed.length&&!confirm(`Zmenou výsledku Z${id} sa zneplatnia výsledky ${removed.map(k=>"Z"+k).join(", ")}. Pokračovať?`)){
  WIN=snap.WIN;WINCTX=snap.WINCTX;
  return;
 }
 UNDO.push(snap);if(UNDO.length>20)UNDO.shift();
 render();
}
function targetPath(){const out=[];for(let id=1;id<=30;id++){const st=matchState(id);if(st.a===MY_SEED||st.b===MY_SEED)out.push(id)}return out}
function activeSeeds(){const s=new Set();for(const m of Object.values(M))for(const x of [m.A,m.B])if(typeof x==="string"&&/^S\d+$/.test(x))s.add(x);return [...s].sort((a,b)=>+a.slice(1)-+b.slice(1))}
function sourceHint(slot){if(typeof slot==="string")return slot===BYE?"voľný žreb":label(slot);if(slot&&slot.W)return `víťaz Z${slot.W}`;if(slot&&slot.L)return `porazený Z${slot.L}`;return "čaká sa"}
function slotButton(id,which,st){const slot=M[id][which],seed=which==="A"?st.a:st.b,b=document.createElement("button");b.className="slot";if(!seed){b.classList.add("tbd");b.disabled=true;b.innerHTML=`<span class="seed">—</span><span class="name">${escHtml(sourceHint(slot))}</span>`;return b}b.innerHTML=`<span class="seed">${seed===BYE?"—":escHtml(seed)}</span><span class="name">${escHtml(label(seed))}</span><svg class="check" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" aria-hidden="true"><path d="M20 6L9 17l-5-5"/></svg>`;if(seed===MY_SEED)b.classList.add("target");const doubleBye=seed===BYE&&st.a===BYE&&st.b===BYE;const isWin=st.w===seed&&!doubleBye;if(isWin)b.classList.add("win");else if(st.w&&!doubleBye)b.classList.add("lose");
 // Čítačka obrazovky: výhru/prehru nesmie niesť iba farba a ikona.
 b.setAttribute("aria-pressed",String(isWin));
 b.setAttribute("aria-label",`Zápas Z${id}: ${label(seed)}${isWin?" — víťaz":st.w&&!doubleBye?" — prehral":""}`);
 if(seed===BYE||st.auto)b.disabled=true;else b.onclick=()=>setWinner(id,seed);return b}
function matchEl(id,path){const st=matchState(id),d=document.createElement("div");d.className="match"+(path.has(id)?" path":"");d.setAttribute("role","group");d.setAttribute("aria-label",`Zápas Z${id}`);d.innerHTML=`<span class="mid">Z${id}</span>${st.auto?'<span class="auto">AUTO</span>':''}`;d.append(slotButton(id,"A",st),slotButton(id,"B",st));return d}
function render(){const path=new Set(targetPath()),v=$("view");v.innerHTML="";for(const tr of TRACKS){const t=document.createElement("section");t.className="track";t.innerHTML=`<div class="track-title">${tr.title}</div>`;const sc=document.createElement("div");sc.className="track-scroll";
 // Horizontálne časti pavúka musia byť dosiahnuteľné klávesnicou (scroll šípkami).
 sc.tabIndex=0;sc.setAttribute("role","region");sc.setAttribute("aria-label",tr.title);
 tr.cols.forEach((col,i)=>{const c=document.createElement("div");c.className="col"+(i?" stagger":"");c.innerHTML=`<div class="col-head">${col.name}</div>`;const stack=document.createElement("div");stack.className="col-stack";col.ids.forEach(id=>stack.append(matchEl(id,path)));c.append(stack);sc.append(c)});t.append(sc);v.append(t)}buildSelect();updateUndoBtn();saveState()}
function buildSelect(){const sel=$("teamSel"),seeds=activeSeeds();if(!seeds.includes(MY_SEED))MY_SEED=seeds[0]||"S1";const old=sel.value;sel.innerHTML="";for(const s of seeds){const o=document.createElement("option");o.value=s;o.textContent=`${s} — ${label(s)}`;o.selected=s===MY_SEED;sel.append(o)}sel.onchange=()=>{MY_SEED=sel.value;try{localStorage.setItem("pavuk_my_seed",MY_SEED)}catch{}updateTitle();render()};updateTitle()}
function updateTitle(){$("myName").textContent=label(MY_SEED);$("mySeed").textContent=`(${MY_SEED})`}
// Záverečný stav tímu: rozlišuje boj o titul, zápas o 3. miesto, konečné
// umiestnenie a skutočné vyradenie — nikdy nesmie tvrdiť „vyradený", kým tím
// ešte má pred sebou zápas (napr. o 3. miesto).
function finalStatus(){
 const ids=targetPath();if(!ids.length)return null;
 const lastId=ids[ids.length-1],last=matchState(lastId);
 const losses=ids.filter(id=>{const w=matchState(id).w;return w&&w!==MY_SEED}).length;
 if(lastId===30&&last.w===MY_SEED)return"VÍŤAZ TURNAJA 🏆";
 if(lastId===30&&last.w)return"2. MIESTO — prehra až vo finále";
 if(lastId===29&&last.w===MY_SEED)return"3. MIESTO";
 if(lastId===29&&last.w)return"4. MIESTO";
 if(!last.w)return lastId===29?"mimo boja o titul — hrá o 3. miesto":null; // inak turnaj pokračuje
 return losses>=2?"VYRADENÝ PO 2. PREHRE":null;
}
function branchText(){const ids=targetPath(),out=[`Vetva — ${label(MY_SEED)} (${MY_SEED})`,""];for(const id of ids){const st=matchState(id),opp=st.a===MY_SEED?st.b:st.a,tag=st.w?(st.w===MY_SEED?"[výhra]":"[prehra]"):"[hrá]";out.push(`${tag} Z${id}: proti ${opp?label(opp):"zatiaľ neurčenému súperovi"}`)}const status=finalStatus();if(status)out.push("",`→ ${status}`);return out.join("\n")}

// Obnov rozohraný turnaj z localStorage (musí bežať pred úvodným renderom v core2.js).
loadState();

// Dve karty: zápis v inej karte sa premietne aj sem, aby staršia karta
// pri ďalšom uložení ticho neprepísala novší stav.
window.addEventListener?.("storage",e=>{
 if(e.key!==STATE_KEY||e.newValue===null)return;
 loadState();render();
 showMsg("Turnaj bol aktualizovaný v inej karte prehliadača.","ok");
});
