(()=>{
"use strict";
const MAX_IMG_BYTES=15*1024*1024, MAX_IMG_PIXELS=24e6;
let workerPromise=null, ocrRunning=false;
const $=id=>document.getElementById(id),clone=o=>JSON.parse(JSON.stringify(o));
function ui(){const old=$("uploadBtn"),btn=document.createElement("button");btn.id="seedUploadBtn";btn.className="upload seed";btn.textContent="📷 Upload nasadenie";old.parentNode.insertBefore(btn,old);const input=document.createElement("input");input.id="seedImageInput";input.type="file";input.accept="image/*";input.hidden=true;old.parentNode.insertBefore(input,old);const prog=document.createElement("div");prog.id="ocrProgress";prog.className="ocr-progress";prog.innerHTML="<span></span>";$("msg").after(prog);const sec=document.createElement("section");sec.id="seedReview";sec.className="seed-review hidden";sec.innerHTML='<h2>Kontrola nasadenia</h2><p id="seedSummary">Skontroluj rozpoznané dvojice. Prázdne riadky na konci sa automaticky použijú ako BYE.</p><img id="seedPreview" class="seed-preview" alt="Rozpoznaná tabuľka nasadenia"><div id="seedRows" class="seed-list"></div><div class="seed-hint">OCR môže pomýliť diakritiku. Mená môžeš pred vytvorením pavúka opraviť.</div><div id="seedInlineError" class="seed-inline-error" hidden></div><div class="seed-actions"><button id="seedCancel">Zrušiť</button><button id="seedCreate" class="primary">Vytvoriť pavúka</button></div>';$("view").before(sec);
 btn.onclick=()=>{if(ocrRunning){msg("OCR už beží — počkaj na dokončenie.","err");return}input.click()};
 input.onchange=async e=>{const f=e.target.files[0];if(!f)return;if(ocrRunning)return;ocrRunning=true;btn.disabled=true;try{const data=await recognize(f);review(data);msg("Nasadenie bolo rozpoznané. Skontroluj ho a potvrď vytvorenie pavúka.","ok")}catch(err){console.error(err);progress(0,false);msg("Chyba: "+err.message,"err")}finally{ocrRunning=false;btn.disabled=false;e.target.value=""}};
 $("seedCancel").onclick=()=>{sec.classList.add("hidden");msg("Načítanie nasadenia bolo zrušené.")};$("seedCreate").onclick=create}
function msg(t,c=""){showMsg(t,c)}
function progress(p,on=true){const e=$("ocrProgress");e.classList.toggle("on",on);e.firstElementChild.style.width=Math.max(0,Math.min(100,p))+"%"}
function load(file){
 if(file.size>MAX_IMG_BYTES)return Promise.reject(Error(`Obrázok je príliš veľký (${(file.size/1048576).toFixed(1)} MB, limit 15 MB)`));
 return new Promise((ok,no)=>{const u=URL.createObjectURL(file),i=new Image;i.onload=()=>{URL.revokeObjectURL(u);if(i.naturalWidth*i.naturalHeight>MAX_IMG_PIXELS){no(Error("Obrázok má priveľké rozlíšenie (limit 24 Mpx). Zmenši ho alebo orež na tabuľku."));return}ok(i)};i.onerror=()=>{URL.revokeObjectURL(u);no(Error("Obrázok sa nepodarilo otvoriť"))};i.src=u})}
function clusters(a,g=4){const out=[];for(const v of a){if(!out.length||v>out.at(-1).at(-1)+g)out.push([v]);else out.at(-1).push(v)}return out.map(x=>Math.round(x.reduce((a,b)=>a+b)/x.length))}
function run(a){let best=[0,0,0],s=-1;for(let i=0;i<=a.length;i++){const on=i<a.length&&a[i];if(on&&s<0)s=i;if(s>=0&&(!on||i===a.length)){const e=on?i+1:i;if(e-s>best[0])best=[e-s,s,e];s=-1}}return best}
function table(image){const k=Math.min(1,1400/image.naturalWidth),w=Math.round(image.naturalWidth*k),h=Math.round(image.naturalHeight*k),c=document.createElement("canvas");c.width=w;c.height=h;const x=c.getContext("2d",{willReadFrequently:true});x.drawImage(image,0,0,w,h);const d=x.getImageData(0,0,w,h).data,g=new Uint8Array(w*h);for(let i=0,j=0;i<d.length;i+=4,j++)g[j]=(d[i]*30+d[i+1]*59+d[i+2]*11)/100;const ys=[];for(let y=0;y<h;y++){let n=0;for(let xx=w*.03|0;xx<w*.97;xx++)if(g[y*w+xx]<140)n++;if(n>Math.max(80,w*.32))ys.push(y)}const strong=[];for(const y of clusters(ys)){const a=[];for(let xx=0;xx<w;xx++)a.push(g[y*w+xx]<140);const r=run(a);if(r[0]>w*.35)strong.push({y,x0:r[1],x1:r[2]})}if(strong.length<3)throw Error("Nenašiel som tabuľku. Skús obrázok orezať na tabuľku MUŽI/MEN.");let y0=strong[0].y,y1=strong.at(-1).y,x0=Math.min(...strong.map(r=>r.x0)),x1=Math.max(...strong.map(r=>r.x1));if(y1-y0<h*.12)throw Error("Tabuľka je príliš malá.");x0=Math.max(0,x0-5);x1=Math.min(w,x1+5);y0=Math.max(0,y0-5);y1=Math.min(h,y1+5);const o=document.createElement("canvas");o.width=x1-x0;o.height=y1-y0;o.getContext("2d").drawImage(c,x0,y0,o.width,o.height,0,0,o.width,o.height);return o}
function grid(c){const w=c.width,h=c.height,x=c.getContext("2d",{willReadFrequently:true}),d=x.getImageData(0,0,w,h).data,dark=(xx,yy)=>{const i=(yy*w+xx)*4;return(d[i]*30+d[i+1]*59+d[i+2]*11)/100<145},ys=[];for(let y=0;y<h;y++){let n=0;for(let xx=0;xx<w;xx++)if(dark(xx,y))n++;if(n>w*.54)ys.push(y)}const all=clusters(ys),hl=all.slice(-17);if(hl.length<17)throw Error("Neviem rozpoznať 16 riadkov. Skús obrázok orezať tesnejšie.");const gaps=hl.slice(1).map((v,i)=>v-hl[i]),med=[...gaps].sort((a,b)=>a-b)[8];if(med<7||gaps.some(v=>v<med*.45||v>med*1.8))throw Error("Riadky tabuľky nie sú dostatočne čitateľné.");const xs=[];for(let xx=0;xx<w;xx++){let n=0;for(let y=hl[0];y<=hl[16];y++)if(dark(xx,y))n++;if(n>(hl[16]-hl[0])*.52)xs.push(xx)}let vl=clusters(xs);if(vl.length<7)vl=[w*.015,w*.11,w*.38,w*.48,w*.75,w*.85,w*.985].map(Math.round);return{hl,vl:vl.slice(0,7)}}
function contact(c,{hl,vl}){const scale=4,px=10,py=7,gx=70,gy=18,cw=Math.max(vl[2]-vl[1],vl[4]-vl[3]),ch=Math.max(...hl.slice(1).map((v,i)=>v-hl[i])),bw=(cw+px*2)*scale,bh=(ch+py*2)*scale,o=document.createElement("canvas");o.width=bw*2+gx;o.height=bh*16+gy*15;const x=o.getContext("2d");x.fillStyle="#fff";x.fillRect(0,0,o.width,o.height);const boxes=[];for(let r=0;r<16;r++){const sy=hl[r]+2,sh=Math.max(1,hl[r+1]-hl[r]-4);for(let q=0;q<2;q++){const l=(q?vl[3]:vl[1])+3,rr=(q?vl[4]:vl[2])-3,sw=Math.max(1,rr-l),dx=q*(bw+gx),dy=r*(bh+gy);x.save();x.filter="grayscale(1) contrast(2)";x.drawImage(c,l,sy,sw,sh,dx+px*scale,dy+py*scale,sw*scale,sh*scale);x.restore();boxes.push({r,q,x0:dx,y0:dy,x1:dx+bw,y1:dy+bh})}}return{canvas:o,boxes}}
function clean(s){return String(s||"").replace(/[|\[\]{}_]/g," ").replace(/\s+/g," ").replace(/^[-–—.,:;\s]+|[-–—.,:;\s]+$/g,"").trim()}
async function getWorker(){
// Cache PROMISE, nie hotový worker: dva rýchle kliky by inak vytvorili dva
// Web Workery (leak WASM pamäte) a druhý by prepísal prvý.
if(workerPromise)return workerPromise;workerPromise=(async()=>{if(!window.Tesseract)await new Promise((ok,no)=>{const s=document.createElement("script");s.src="vendor/tesseract.min.js";s.onload=ok;s.onerror=()=>no(Error("OCR knižnica sa nenačítala"));document.head.append(s)});const log=m=>{if(typeof m.progress==="number"){const p=Math.round(m.progress*100);progress(Math.max(5,p));msg(`Rozpoznávam nasadenie… ${p}%`)}};
// Worker beží lokálne; jadro (WASM) a jazykové dáta sú pripnuté na konkrétne verzie.
const opts={logger:log,workerPath:"vendor/tesseract-worker.min.js",corePath:"https://cdn.jsdelivr.net/npm/tesseract.js-core@5.1.1",langPath:"https://tessdata.projectnaptha.com/4.0.0"};
let worker;try{worker=await Tesseract.createWorker(["slk","eng"],1,opts)}catch{worker=await Tesseract.createWorker("eng",1,opts)}
await worker.setParameters({tessedit_pageseg_mode:"6",preserve_interword_spaces:"1",user_defined_dpi:"300"});return worker})();workerPromise.catch(()=>{workerPromise=null});return workerPromise}
// Worker sa po dobehnutí OCR vždy ukončí — inak by WASM inštancia (desiatky MB)
// ostala v pamäti mobilu po celý zvyšok relácie.
async function releaseWorker(){const wp=workerPromise;workerPromise=null;if(wp)try{const w=await wp;await w.terminate()}catch{}}
async function recognize(file){msg("Hľadám tabuľku nasadenia…");progress(3);try{
 const img=await load(file),tab=table(img),g=grid(tab),ct=contact(tab,g),w=await getWorker(),res=await w.recognize(ct.canvas,{}, {tsv:true}),words=[];
 for(const line of(res.data.tsv||"").split(/\r?\n/).slice(1)){const a=line.split("\t");if(a.length>=12&&+a[0]===5)words.push({t:a.slice(11).join(" "),c:+a[10],x0:+a[6],y0:+a[7],x1:+a[6]+ +a[8],y1:+a[7]+ +a[9]})}
 const cells=Array.from({length:16},()=>[[],[]]),cf=Array.from({length:16},()=>[[],[]]);
 for(const z of words){const cx=(z.x0+z.x1)/2,cy=(z.y0+z.y1)/2,b=ct.boxes.find(b=>cx>=b.x0&&cx<=b.x1&&cy>=b.y0&&cy<=b.y1);if(!b)continue;const t=clean(z.t);if(!t||/^\d+(?:[.,]\d+)?$/.test(t))continue;cells[b.r][b.q].push({x:z.x0,t});if(z.c>=0)cf[b.r][b.q].push(z.c)}
 const rows=[];
 for(let r=0;r<16;r++){
  const p=cells[r].map(a=>clean(a.sort((u,v)=>u.x-v.x).map(v=>v.t).join(" ")));
  // Čiastočne rozpoznaný riadok NEsmie ticho zmiznúť (a stať sa BYE) — zachovaj
  // rozpoznanú časť a označ riadok na ručnú kontrolu.
  const partial=(!!p[0])!==(!!p[1]);
  let name=p[0]&&p[1]?p[0]+" / "+p[1]:(p[0]||p[1]||"");
  if(/^(TD|PH|O\s*77|-)+$/i.test(name))name="";
  const v=cf[r][0].concat(cf[r][1]),avg=v.length?v.reduce((a,b)=>a+b)/v.length:100;
  rows.push({seed:"S"+(r+1),name,warn:!!name&&(avg<65||partial)});
 }
 progress(100);setTimeout(()=>progress(0,false),500);
 return{rows,preview:tab.toDataURL("image/jpeg",.9)};
}finally{releaseWorker()}}
function esc(s){return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;")}

// ---------- Kontrola nasadenia: BYE len s potvrdením, validácia dvojíc ----------
function suspicious(v){
 if(!v)return true;
 const parts=v.split("/").map(x=>x.trim());
 return parts.length!==2||parts.some(x=>x.length<2);
}
function inlineError(text=""){const box=$("seedInlineError");if(!box)return;box.textContent=text;box.hidden=!text}
function seedRowEls(){return [...document.querySelectorAll("#seedRows .seed-row")]}
function refreshRows(){
 const all=seedRowEls();if(!all.length)return;
 const values=all.map(r=>r.querySelector(".seed-input")?.value.trim()||"");
 let lastFilled=-1;values.forEach((v,i)=>{if(v)lastFilled=i});
 all.forEach((row,i)=>{
  const input=row.querySelector(".seed-input"),btn=row.querySelector(".bye-btn");if(!input||!btn)return;
  const value=input.value.trim(),trailing=!value&&i>lastFilled,manual=input.dataset.manualBye==="1";
  // Automatické BYE je povolené len pre prázdne riadky NA KONCI tabuľky;
  // prázdny riadok uprostred musí používateľ výslovne potvrdiť.
  input.dataset.byeConfirmed=trailing||manual?"1":"0";
  const confirmed=input.dataset.byeConfirmed==="1";
  const warn=(!value&&!confirmed)||(!!value&&suspicious(value));
  row.classList.toggle("warn",warn);
  row.classList.toggle("bye",!value);
  btn.textContent=value?"Nastaviť BYE":(trailing?"BYE automaticky":confirmed?"BYE potvrdené":"Potvrdiť BYE");
 });
}
function review(data){
 const list=$("seedRows");list.innerHTML="";let n=0,warned=[];
 for(const row of data.rows){
  if(row.name)n++;if(row.warn)warned.push(row.seed);
  const d=document.createElement("div");
  d.className="seed-row"+(row.warn?" warn":"")+(!row.name?" bye":"");
  d.innerHTML=`<span class="seed-tag">${row.seed}</span><input class="seed-input" value="${esc(row.name)}" placeholder="BYE" aria-label="Dvojica ${row.seed}"><button class="bye-btn">BYE</button>`;
  const i=d.querySelector("input"),b=d.querySelector("button");
  i.dataset.manualBye="0";i.dataset.byeConfirmed="0";
  b.onclick=()=>{i.value="";i.dataset.manualBye="1";refreshRows()};
  i.oninput=()=>{i.dataset.manualBye="0";refreshRows()};
  list.append(d);
 }
 $("seedPreview").src=data.preview;
 $("seedSummary").textContent=`Rozpoznané: ${n} dvojíc + ${16-n} BYE.`+(warned.length?` Skontroluj neisté riadky: ${warned.join(", ")}.`:"")+" Prázdne riadky na konci sa použijú ako BYE automaticky.";
 inlineError("");refreshRows();
 $("seedReview").classList.remove("hidden");$("seedReview").scrollIntoView({behavior:"smooth"});
}
function create(){
 refreshRows();
 const all=seedRowEls(),names=[],unconfirmed=[],bad=[],seen=new Map(),dupes=[];
 all.forEach((row,i)=>{
  const input=row.querySelector(".seed-input"),v=input?.value.trim()||"";
  names.push(v);
  if(!v&&input?.dataset.byeConfirmed!=="1")unconfirmed.push("S"+(i+1));
  if(v&&suspicious(v))bad.push("S"+(i+1));
  if(v){const key=v.toLocaleLowerCase("sk").replace(/\s+/g," ");if(seen.has(key))dupes.push("S"+(i+1));else seen.set(key,i)}
 });
 let text="";
 if(!names.some(Boolean))text="Zadaj aspoň jednu dvojicu.";
 else if(unconfirmed.length)text=`Doplň chýbajúcu dvojicu alebo potvrď BYE pri: ${unconfirmed.join(", ")}.`;
 else if(bad.length)text=`Skontroluj formát dvojice pri: ${bad.join(", ")}. Použi tvar Hráč 1 / Hráč 2.`;
 else if(dupes.length)text=`Rovnaká dvojica je uvedená viackrát pri: ${dupes.join(", ")}.`;
 inlineError(text);
 if(text){document.querySelector("#seedRows .seed-row.warn")?.scrollIntoView({behavior:"smooth",block:"center"});return}
 const teamCount=names.filter(Boolean).length,byeCount=16-teamCount,resultCount=Object.keys(WIN).length;
 if(!confirm(`Vytvoriť pavúka: ${teamCount} dvojíc + ${byeCount} BYE. Nahradí aktuálny turnaj${resultCount?` vrátane ${resultCount} zapísaných výsledkov`:""} (vrátiť sa dá tlačidlom Späť). Pokračovať?`))return;
 pushUndo();
 M=clone(BASE_MODEL);
 for(const k of Object.keys(TEAMS))delete TEAMS[k];
 for(let i=1;i<=16;i++){const s="S"+i,n=names[i-1];if(n)TEAMS[s]=n;else for(let id=1;id<=8;id++){if(M[id].A===s)M[id].A=BYE;if(M[id].B===s)M[id].B=BYE}}
 WIN={};WINCTX={};
 MY_SEED=names.findIndex(Boolean)>=0?"S"+(names.findIndex(Boolean)+1):"S1";
 try{localStorage.setItem("pavuk_my_seed",MY_SEED)}catch{}
 $("seedReview").classList.add("hidden");
 prune();buildSelect();render();
 msg(`Pavúk vytvorený: ${teamCount} dvojíc, ${byeCount} BYE.`,"ok");
 window.scrollTo({top:0,behavior:"smooth"});
}
ui();
})();
