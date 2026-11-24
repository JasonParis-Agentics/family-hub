/* Family Hub prototype v4 — sections: calendar · chores · meals · verse. State in localStorage (KV/D1 later). */
(() => {
const SEED = window.HUB_SEED;
const $ = (s, el=document) => el.querySelector(s);
const el = (tag, cls, html) => { const n=document.createElement(tag); if(cls) n.className=cls; if(html!=null) n.innerHTML=html; return n; };
const pad = n => String(n).padStart(2,"0");
const iso = d => `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
const parse = s => { const [y,m,d]=s.split("-").map(Number); return new Date(y,m-1,d); };
const addDays = (d,n) => { const x=new Date(d); x.setDate(x.getDate()+n); return x; };
const startOfWeek = d => addDays(d, -((d.getDay()-SEED.settings.weekStartsOn+7)%7));
const DOW = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
const dowOrder = () => Array.from({length:7},(_,i)=>(SEED.settings.weekStartsOn+i)%7);
const weekOffset = d => (d.getDay()-SEED.settings.weekStartsOn+7)%7;
const MON = ["January","February","March","April","May","June","July","August","September","October","November","December"];
const fmtTime = t => { if(!t) return ""; let [h,m]=t.split(":").map(Number); const ap=h>=12?"pm":"am"; h=h%12||12; return m?`${h}:${pad(m)}${ap}`:`${h}${ap}`; };
const mins = t => { const [h,m]=t.split(":").map(Number); return h*60+(m||0); };
const kidById = id => SEED.kids.find(k=>k.id===id);

// ---------- state ----------
const KEY="hub.state.v2";
const fresh = () => ({ done:{}, weekly:{}, extra:{}, redemptions:[], prices:{}, schoolToday:{...SEED.schoolToday}, log:[], avatars:{}, sound:true, bonus:[], familyGoal:null, verse:null, sweep:{}, money:{goals:[],budget:[],invest:{}} });
let S; try { S = JSON.parse(localStorage.getItem(KEY)) || fresh(); } catch(e){ S = fresh(); }
for (const [k,v] of Object.entries(fresh())) if (S[k]===undefined) S[k]=v;
const save = () => { try{ localStorage.setItem(KEY, JSON.stringify(S)); }catch(e){} pushState(); };
// ---------- shared state (Worker KV): the wall and any phone/laptop see the same points ----------
const isKiosk = new URLSearchParams(location.search).get("kiosk")==="1";
let pushT=null, syncing=false, unsynced=false;
function pushState(){ clearTimeout(pushT); pushT=setTimeout(async()=>{ S._rev=Date.now(); try{ localStorage.setItem(KEY, JSON.stringify(S)); }catch(e){}
  try{ const r=await fetch("/api/state",{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify(S)});
    if(r.status===409){ const j=await r.json(); if(j.state) adoptState(j.state); } unsynced=false; }catch(e){ unsynced=true; } },800); }   // offline taps stay local until the next good pull
const editing = () => { const a=document.activeElement; return (a && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName)) || !!document.querySelector(".overlay"); };
function adoptState(remote){ if(!remote || typeof remote!=="object") return; S=remote; for (const [k,v] of Object.entries(fresh())) if (S[k]===undefined) S[k]=v; try{ localStorage.setItem(KEY, JSON.stringify(S)); }catch(e){} applyTheme(); render(); }
async function pullState(first=false){ if(syncing) return; syncing=true; try{ const r=await fetch("/api/state",{cache:"no-store"}); if(!r.ok) return; setOnline(true); const remote=await r.json();
    if(unsynced){ pushState(); return; }   // back online: send what was tapped while offline
    if(!remote){ if((first || S._rev!=null) && (Object.keys(S.done).length || S.log.length)) pushState(); return; }   // nothing shared yet: this screen seeds it
    if(first && isKiosk && S._rev==null && Object.keys(S.done).length){ pushState(); return; }      // the wall's un-synced history wins over anything older
    if(typeof remote._rev==="number" && remote._rev>(S._rev||0) && !editing()) adoptState(remote);
  }catch(e){ setOnline(false); if(first) setTimeout(()=>pullState(true),10000); } finally{ syncing=false; } }   // boot before Wi-Fi is up: try again
const resetState = () => { S = fresh(); save(); };
// offline chip: the wall keeps running on its saved copy; this just says so
let offlineSince=null;
function setOnline(ok){ if(ok){ offlineSince=null; document.body.classList.remove("offline"); return; }
  if(offlineSince==null) offlineSince=Date.now(); document.body.classList.add("offline");
  let c=document.querySelector(".offline-chip"); if(!c){ c=document.createElement("div"); c.className="offline-chip"; document.body.append(c); }
  c.textContent="No internet · showing saved info from "+new Date(offlineSince).toLocaleTimeString([], {hour:"numeric",minute:"2-digit"}); }
if ("serviceWorker" in navigator && location.protocol==="https:") navigator.serviceWorker.register("sw.js").catch(()=>{});


// ---------- dev / kiosk ----------
const Q = new URLSearchParams(location.search);
let now = () => new Date();
if (Q.get("date")) { const fixed = parse(Q.get("date")); now = () => { const n=new Date(); const f=new Date(fixed); f.setHours(n.getHours(),n.getMinutes(),n.getSeconds()); return f; }; }
const fastTimers = Q.get("fast")==="1";
// look: light / grey (evening) / dark — S.theme, tap the top-bar button to cycle or pick in Parents → Screen & sound
const THEMES=[["light","☀️","Light"],["grey","🌥️","Grey"],["dark","🌙","Dark"]];
const themeId = () => THEMES.some(t=>t[0]===S.theme) ? S.theme : "light";
function applyTheme(){ screen.dataset.theme=themeId(); }
// settings: Parents → Screen & sound overrides (S.settings) win over data.js
const setting = k => (S.settings && S.settings[k]!=null && S.settings[k]!=="") ? S.settings[k] : SEED.settings[k];
const idleMs = () => (fastTimers?0.25:+setting("idleMinutes"))*60000;
const artMs  = () => (fastTimers?0.5:+setting("artMinutes"))*60000;
// wall controls: tiny local service on the Pi (pi/hub-local.py, 127.0.0.1:8777) drives backlight, display power, system volume
const WALL="http://127.0.0.1:8777"; let wallOk=null, displayOff=false;
const wall = (path,v) => fetch(`${WALL}/${path}${v!=null?"?v="+encodeURIComponent(v):""}`,{mode:"cors"}).then(r=>{ if(!r.ok) throw new Error(r.status); wallOk=true; return r.json(); }).catch(e=>{ wallOk=false; throw e; });
const volumeLevel = () => { const v=+setting("volume"); return isNaN(v)?100:Math.max(0,Math.min(100,v)); };
function applyBrightness(v){ v=Math.max(5,Math.min(100,+v||100)); wall("brightness",v).then(()=>{ screen.style.filter=""; }).catch(()=>{ screen.style.filter=(isKiosk&&v<100)?`brightness(${v/100})`:""; }); }   // 10/21: CSS dim only on the wall; brightness is shared state, so a laptop would go black
let lastOnAt=0; function displayPower(on){ if(!on && displayOff) return; if(on && !displayOff && Date.now()-lastOnAt<30000) return; if(on) lastOnAt=Date.now(); displayOff=!on; wall("display",on?"on":"off").catch(()=>{}); }   // 11/20: always send "on" — a reload while the panel slept left displayOff=false, so taps never woke it
if (isKiosk) setTimeout(()=>wall("display","on").catch(()=>{}),1500);   // never start a fresh page behind a sleeping panel
// quiet hours: screen goes black instead of art mode; any touch wakes it
const hm = t => { const [h,m]=String(t||"0:00").split(":").map(Number); return h*60+(m||0); };
const inQuiet = () => { if (Q.get("quiet")==="1") return true; if (Q.get("quiet")==="0") return false;
  const st=setting("quietStart"), en=setting("quietEnd"); if(!st||!en) return false;
  const n=now(), cur=n.getHours()*60+n.getMinutes(), a=hm(st), b=hm(en);
  return a<b ? (cur>=a && cur<b) : (cur>=a || cur<b); };

// ---------- points ----------
const chores = kid => (S.chores&&S.chores[kid])||SEED.chores[kid]||[];
const editableChores = kid => { S.chores=S.chores||{}; if(!S.chores[kid]) S.chores[kid]=JSON.parse(JSON.stringify(SEED.chores[kid]||[])); return S.chores[kid]; };
const chore = (kid,id) => chores(kid).find(c=>c.id===id);
const weekKey = d => iso(startOfWeek(d));
const doneCount = (kid,id,d=now()) => ((S.done[iso(d)]||{})[kid]||{})[id]||0;
// weekly chores can be done perWeek times (Ninja 2–3×); S.weekly stores a count (older saves hold true = 1)
const wkN = v => v===true ? 1 : (+v||0);
const weeklyCount = (kid,id,d=now()) => wkN(((S.weekly[weekKey(d)]||{})[kid]||{})[id]);
const weeklyDone = (kid,id,d=now()) => weeklyCount(kid,id,d)>0;
const weeklyCap = c => Math.max(1, +c.perWeek||1);
const extraPts = (date,kid,id) => (((S.extra[date]||{})[kid]||{})[id])||0;
const price = r => S.prices[r.id] ?? r.cost;
const rewards = () => S.rewards||SEED.rewards;
const rewardFor = (r,kid) => !r.kids || !r.kids.length || r.kids.includes(kid);
const rewardsFor = kid => rewards().filter(r=>rewardFor(r,kid));
const editableRewards = () => { if(!S.rewards) S.rewards=JSON.parse(JSON.stringify(SEED.rewards)); return S.rewards; };
const familyGoal = () => S.familyGoal || SEED.settings.familyGoal;
// ---------- memory-verse plan: each passage = ~4 weekly parts (whole verses, word-balanced), then the whole passage on week 5 ----------
const vsWords = t => t.split(/\s+/).filter(Boolean).length;
function splitParts(vv,k=4){ const n=vv.length; if(n<=k) return vv.map((_,i)=>[i,i+1]);
  const pre=[0]; vv.forEach(x=>pre.push(pre[pre.length-1]+vsWords(x.t))); const tgt=pre[n]/k; let best=null;
  const go=(start,cuts)=>{ if(cuts.length===k-1){ const b=[0,...cuts,n]; let c=0; for(let i=0;i<k;i++) c+=(pre[b[i+1]]-pre[b[i]]-tgt)**2; if(!best||c<best.c) best={c,b}; return; }
    for(let j=start+1;j<=n-(k-1-cuts.length);j++) go(j,[...cuts,j]); };
  go(0,[]); return best.b.slice(0,k).map((a,i)=>[a,best.b[i+1]]); }
const seriesList = () => { const m={}; [...(SEED.verseSeries||[]),...(S.verseSeries||[])].forEach(x=>m[x.start]=x); return Object.values(m).sort((a,b)=>a.start<b.start?-1:1); };
function seriesWeeks(s){ const ch=s.ref.replace(/:.*/,"");
  const parts=s.parts ? s.parts.map(([a,b])=>s.verses.filter(v=>v.n>=a&&v.n<=b)) : splitParts(s.verses).map(([a,b])=>s.verses.slice(a,b));
  const r=vv=>`${ch}:${vv[0].n}${vv.length>1?"–"+vv[vv.length-1].n:""}`;
  return [...parts.map((vv,i)=>({ref:r(vv),verses:vv,part:i+1,of:parts.length})), {ref:s.ref,verses:s.verses,whole:true,of:parts.length}]; }
const weeksBetween = (a,b) => Math.round((parse(b)-parse(a))/(7*864e5));
function seriesVerse(d=now()){ const wk=weekKey(d); let cur=null;
  for (const s of seriesList()){ if(s.start>wk) break; const ws=seriesWeeks(s); const i=weeksBetween(s.start,wk); cur={...ws[Math.min(i,ws.length-1)], series:s.ref, holding:i>=ws.length}; }
  return cur; }
const verse = () => { const sv=seriesVerse();
  if (S.verse && (!sv || S.verse.wk===weekKey(now()))) return S.verse;   // a parent's this-week override (or the old single verse before the plan starts)
  if (sv) return {...sv, text:sv.verses.map(x=>x.t).join(" "), version:"ESV", pts:SEED.verse.pts};
  return S.verse || SEED.verse; };
// verse text with superscript verse numbers; hideIdx = word indexes to blank out (practice levels)
function verseNodes(txt,vs,hideIdx=new Set()){ let i=0;
  const word=w=>el("span",hideIdx.has(i++)?"w hid":"w",w);
  if(!vs.verses){ vs.text.split(" ").forEach(w=>{ txt.append(word(w)); txt.append(document.createTextNode(" ")); }); return; }
  for (const v of vs.verses){ const ws=v.t.split(/\s+/).filter(Boolean); ws.forEach((w,j)=>{
    if(j===0){ const g=el("span","vw"); g.append(el("sup","vn",v.n),word(w)); txt.append(g); } else txt.append(word(w));
    txt.append(document.createTextNode(" ")); }); } }
function points(kid){
  let p = kidById(kid).startPoints;
  for (const date in S.done) for (const id in (S.done[date][kid]||{})) { const c=chore(kid,id); if(c) p += c.pts*S.done[date][kid][id] + extraPts(date,kid,id); }
  for (const wk in S.weekly) for (const id in (S.weekly[wk][kid]||{})) { const c=chore(kid,id); const n=wkN(S.weekly[wk][kid][id]); if(c && n) p += c.pts*n + extraPts(wk,kid,id); }
  for (const date in (S.sweep||{})) p += (S.sweep[date][kid]||0);
  for (const r of S.redemptions) if (r.kid===kid) p -= r.cost;
  return p;
}
function weekPoints(kid, d=now()){
  const wk=weekKey(d); const start=startOfWeek(d); let p=0;
  for (let i=0;i<7;i++){ const k=iso(addDays(start,i)); for (const id in ((S.done[k]||{})[kid]||{})) { const c=chore(kid,id); if(c) p+=c.pts*S.done[k][kid][id]+extraPts(k,kid,id); } }
  for (const id in ((S.weekly[wk]||{})[kid]||{})) { const c=chore(kid,id); const n=wkN(S.weekly[wk][kid][id]); if(c && n) p+=c.pts*n+extraPts(wk,kid,id); }
  for (let i=0;i<7;i++){ const k=iso(addDays(start,i)); p += ((S.sweep||{})[k]||{})[kid]||0; }
  return p;
}
const familyWeek = () => SEED.kids.reduce((s,k)=>s+weekPoints(k.id),0);
const baseList = kid => chores(kid).filter(c=>c.kind==="base");
const baseDone = (kid,d=now()) => baseList(kid).every(c=>doneCount(kid,c.id,d)>0);
const todayDone = (kid,d=now()) => chores(kid).filter(c=>c.kind!=="weekly" && doneCount(kid,c.id,d)>0).length;
function streak(kid){ let n=0; let d=now(); if(!baseDone(kid,d)) d=addDays(d,-1); while(baseDone(kid,d)){ n++; d=addDays(d,-1); if(n>365) break; } return n; }
function sweepStreak(kid){ let n=0; let d=now(); if(!sweepDone(kid,d)) d=addDays(d,-1); while(sweepDone(kid,d)){ n++; d=addDays(d,-1); if(n>365) break; } return n; }
const dayMark = (kid,d) => sweepDone(kid,d) ? "sweep" : baseDone(kid,d) ? "base" : "";
function weekMarks(kid, d=now()){ const start=startOfWeek(d); return [0,1,2,3,4,5,6].map(i=>{ const x=addDays(start,i); const key=iso(x), tk=iso(d); return { key, mark: key>tk?"":dayMark(kid,x), today:key===tk, future:key>tk }; }); }
const perfectWeek = (kid, kind, d=now()) => weekMarks(kid,d).every(m => kind==="sweep" ? m.mark==="sweep" : m.mark!=="");
const weekDots = (kid, cls="wdots") => `<span class="${cls}">${weekMarks(kid).map(m=>`<i class="${m.mark}${m.today?" today":""}${m.future?" future":""}" title="${m.key}">${m.mark==="sweep"?"🌈":m.mark==="base"?"✨":""}</i>`).join("")}</span>`;
const dailyAll = kid => chores(kid).filter(c=>c.kind!=="weekly");
const sweepDone = (kid,d=now()) => dailyAll(kid).every(c=>doneCount(kid,c.id,d)>0);
function syncSweep(kid){ const k=iso(now()); S.sweep=S.sweep||{}; S.sweep[k]=S.sweep[k]||{}; const had=!!S.sweep[k][kid]; const has=sweepDone(kid); if(has&&!had) S.sweep[k][kid]=SEED.settings.sweepBonus||0; if(!has&&had) delete S.sweep[k][kid]; save(); return has&&!had; }
const avatarOf = kid => (S.avatars||{})[kid] || null;
const avNode = (kid, cls="av") => { const k=kidById(kid); const a=avatarOf(kid); return el("span", cls+(a?" emo":""), a||k.name[0]); };
// bonus hours: {date, kids:"all"|[ids], chore, mult, until:"HH:MM"}
function activeBonus(kid,choreId,d=now()){
  const k=iso(d), t=`${pad(d.getHours())}:${pad(d.getMinutes())}`;
  return (S.bonus||[]).find(b=>b.date===k && b.chore===choreId && (b.kids==="all"||b.kids.includes(kid)) && t<=b.until) || null;
}
function toggle(kid,c){
  const d=now(); const k=iso(d); const b=activeBonus(kid,c.id,d);
  if (c.kind==="weekly") {
    const wk=weekKey(d); S.weekly[wk]=S.weekly[wk]||{}; S.weekly[wk][kid]=S.weekly[wk][kid]||{};
    const cur=weeklyCount(kid,c.id,d), cap=weeklyCap(c); const next= cur>=cap ? 0 : cur+1; S.weekly[wk][kid][c.id]=next;
    S.extra[wk]=S.extra[wk]||{}; S.extra[wk][kid]=S.extra[wk][kid]||{}; S.extra[wk][kid][c.id]= next>0&&b ? c.pts*(b.mult-1)*next : 0;
  } else {
    S.done[k]=S.done[k]||{}; S.done[k][kid]=S.done[k][kid]||{};
    const cur=S.done[k][kid][c.id]||0; const cap=c.capPerDay||1; const next= cur>=cap ? 0 : cur+1; S.done[k][kid][c.id]=next;
    S.extra[k]=S.extra[k]||{}; S.extra[k][kid]=S.extra[k][kid]||{}; S.extra[k][kid][c.id]= next>0&&b ? c.pts*(b.mult-1)*next : 0;
  }
  S.log.push({t:Date.now(),kid,chore:c.id}); save();
}

// ---------- celebration ----------
const screen=$("#screen");
let fxCanvas, fxCtx, particles=[], fxRunning=false;
function fxInit(){ if(fxCanvas) return; fxCanvas=document.createElement("canvas"); fxCanvas.id="fx"; screen.append(fxCanvas); fxCtx=fxCanvas.getContext("2d"); }
function fxSize(){ fxCanvas.width=screen.clientWidth; fxCanvas.height=screen.clientHeight; }
function confetti(x,y,n=60,spread=1){
  fxInit(); fxSize(); const cols=["#f28c28","#3cb44b","#e8559a","#3a7bd5","#e9c400","#6f4fb3","#1f8a8a"];
  for(let i=0;i<n;i++){ const a=Math.random()*Math.PI*2, v=(4+Math.random()*9)*spread; particles.push({x,y,vx:Math.cos(a)*v,vy:Math.sin(a)*v-6,g:.35,r:4+Math.random()*6,c:cols[i%cols.length],rot:Math.random()*6,vr:(Math.random()-.5)*.4,life:70+Math.random()*40}); }
  if(!fxRunning){ fxRunning=true; requestAnimationFrame(fxTick); }
}
function fxTick(){ fxCtx.clearRect(0,0,fxCanvas.width,fxCanvas.height); particles=particles.filter(p=>p.life>0);
  for(const p of particles){ p.vy+=p.g; p.x+=p.vx; p.y+=p.vy; p.vx*=.98; p.rot+=p.vr; p.life--; fxCtx.save(); fxCtx.translate(p.x,p.y); fxCtx.rotate(p.rot); fxCtx.globalAlpha=Math.min(1,p.life/30); fxCtx.fillStyle=p.c; fxCtx.fillRect(-p.r/2,-p.r/2,p.r,p.r*.6); fxCtx.restore(); }
  if(particles.length) requestAnimationFrame(fxTick); else fxRunning=false;
}
function rain(n=220){ fxInit(); fxSize(); for(let i=0;i<n;i++) setTimeout(()=>confetti(Math.random()*fxCanvas.width, -10, 1, .6), i*6); }
let audio; const SOUNDS={
  base:    {type:"sine",     notes:[[880,0,.12],[1174.7,.1,.2]]},                               // two-note "ding-ding"
  anytime: {type:"triangle", notes:[[659.3,0,.14],[880,.09,.22]]},                              // softer, lower
  weekly:  {type:"square",   notes:[[523.3,0,.1],[659.3,.1,.1],[784,.2,.1],[1046.5,.3,.3]]},    // 4-step climb
  extra:   {type:"sine",     notes:[[1318.5,0,.08],[1567.9,.07,.08],[2093,.14,.25]]},           // quick sparkle
  unlock:  {type:"sine",     notes:[[523.3,0,.15],[659.3,.12,.15],[784,.24,.15],[1046.5,.36,.4]]},
  sweep:   {type:"triangle", notes:[[392,0,.14],[523.3,.12,.14],[659.3,.24,.14],[784,.36,.14],[1046.5,.48,.2],[1318.5,.62,.2],[1568,.76,.6]]}, // long rising fanfare
  goal:    {type:"sine",     notes:[[523.3,0,.12],[659.3,.1,.12],[784,.2,.12],[1046.5,.3,.12],[1318.5,.4,.5]]},
  tap:     {type:"sine",     notes:[[880,0,.12],[1174.7,.1,.18]]}
};
function chime(kind="tap"){
  if(S.sound===false) return; try{ audio=audio||new (window.AudioContext||window.webkitAudioContext)(); const t=audio.currentTime; const s=SOUNDS[kind]||SOUNDS.tap;
    const vol = (s.type==="square"?.08:.18)*(SEED.settings.chimeGain||2)*(volumeLevel()/100);   // 10/20: louder on the wall (HDMI speakers are quiet)
    for(const [f,dt,dur] of s.notes){ const o=audio.createOscillator(), g=audio.createGain(); o.type=s.type; o.frequency.value=f; g.gain.setValueAtTime(0,t+dt); g.gain.linearRampToValueAtTime(vol,t+dt+.02); g.gain.exponentialRampToValueAtTime(.001,t+dt+dur); o.connect(g).connect(audio.destination); o.start(t+dt); o.stop(t+dt+dur+.05); }
  }catch(e){}
}
const soundFor = c => c.kind==="base" ? "base" : c.ungated ? "anytime" : c.kind==="weekly" ? "weekly" : "extra";
function flyPts(x,y,txt){ const f=el("div","fly",txt); f.style.left=x+"px"; f.style.top=y+"px"; screen.append(f); setTimeout(()=>f.remove(),1200); }
function banner(big,h,p){ const b=el("div","banner",`<div class="big">${big}</div><h2>${h}</h2><p>${p||""}</p>`); screen.append(b); setTimeout(()=>b.remove(),3300); }
function posIn(node){ const r=node.getBoundingClientRect(), s=screen.getBoundingClientRect(); const sc=s.width/screen.clientWidth; return {x:(r.left-s.left)/sc+r.width/sc/2, y:(r.top-s.top)/sc+r.height/sc/2}; }
function toast(msg){ const t=$(".toast"); if(!t) return; t.textContent=msg; t.classList.add("show"); clearTimeout(t._t); t._t=setTimeout(()=>t.classList.remove("show"),1800); }

// ---------- idle ----------
let idleT, artT, lastTouch=0;
function bump(){ lastTouch=Date.now();
  clearTimeout(idleT); clearTimeout(artT);
  manualOff=false; if(manualSS) ssClear(); screen.classList.remove("art","dark","vsleep"); if(view.section!=="photos"){ screen.classList.remove("photos"); ssStop(); } displayPower(true);
  const home = view.section==="calendar" && !view.kid;
  if (view.section==="photos" || view.section==="plans") return;   // keep slideshows/exploring open until someone taps out; iframe touches do not bubble up
  if (!home) idleT=setTimeout(()=>go({section:"calendar",kid:null}),idleMs());
  artT=setTimeout(rest, home?artMs():idleMs()+artMs());
}
function rest(){ if(view.section!=="calendar") return; if(inQuiet()){ screen.classList.add("dark"); setTimeout(()=>{ if(screen.classList.contains("dark")) displayPower(false); },1500); } else artOn(); }
// sleep screen = memory verse by default; the slideshow button (manualSS) plays family pictures on demand until a touch
function artOn(){ screen.classList.add("art"); const m=manualSS?"photos":sleepMode();
  screen.classList.toggle("vsleep", m==="verse"); if(m==="verse") vsShow();
  if(m==="photos"){ screen.classList.add("photos"); if(!ssOn) ssStart(true); } else { screen.classList.remove("photos"); ssStop(); } }
let manualSS=false, manualOff=false, ssAt=0;
function ssClear(){ manualSS=false; try{ localStorage.removeItem("hub.ss.on"); localStorage.removeItem("hub.ss.at"); }catch{} }
function slideshowNow(resume){ if(!PH.list.length) return toast("No family pictures yet"); clearTimeout(idleT); clearTimeout(artT); manualSS=true; manualOff=false;
  ssAt=Date.now(); try{ if(resume===true) ssAt=+localStorage.getItem("hub.ss.at")||ssAt; localStorage.setItem("hub.ss.on","1"); localStorage.setItem("hub.ss.at",ssAt); }catch{}
  screen.classList.remove("dark"); displayPower(true); artOn(); }
// 11/15: night (7 PM-7 AM) = a slideshow or an open Photos tab hands the screen back to sleep after 15 untouched minutes; ?ssnight=1 (+?fast=1 for 30 s) to test
const ssNightMs = () => (fastTimers?0.5:15)*60000;
const nightAgo = () => { if(Q.get("ssnight")==="1") return Infinity; const n=now(), h=n.getHours(); if(h>=7&&h<19) return -1; const s=new Date(n); s.setHours(19,0,0,0); if(h<7) s.setDate(s.getDate()-1); return n-s; };   // ms since 7 PM, -1 in the daytime
// back to the calendar and asleep. off=true is the top-bar power button: black + panel off right now, any time of day, until a touch
function sleepNow(off){ clearTimeout(idleT); clearTimeout(artT); if(manualSS) ssClear(); screen.classList.remove("art","photos","vsleep"); ssStop();
  if(view.section!=="calendar"||view.kid){ if(VA.playing) vaStop(); view={...view,section:"calendar",kid:null,shop:false,anchor:now()}; render(); }
  if(!off) return rest();
  manualOff=true; screen.classList.add("dark"); setTimeout(()=>{ if(screen.classList.contains("dark")) displayPower(false); },1500); }
// minute tick: slide art→dark at quiet start, dark→art at quiet end, without waiting for a touch
setInterval(()=>{ const q=inQuiet(), d=screen.classList.contains("dark"), a=screen.classList.contains("art");
  if (q && a && !manualSS) { screen.classList.remove("art","photos","vsleep"); ssStop(); screen.classList.add("dark"); setTimeout(()=>{ if(screen.classList.contains("dark")) displayPower(false); },1500); }
  if (q && manualOff) manualOff=false;   // night took over; the morning wake-up runs as usual
  if (!q && d && !manualOff) { screen.classList.remove("dark"); artOn(); displayPower(true); }
  const na=nightAgo(); if (na>=0 && !d && (manualSS || view.section==="photos") && Math.min(na, Date.now()-(manualSS?ssAt:lastTouch)) >= ssNightMs()) sleepNow(); }, 20000);

// ---------- view ----------
const top=$(".top"), main=$("main");
let view = { section:"calendar", cal:"week", anchor: now(), kid:null, shopKid:null, mealAnchor: now(), kidMode:"day" };
function go(patch){ if(patch.section==="money") window.HubMoney.reset(); if(VA.playing && patch.section && patch.section!=="verse") vaStop(); view={...view,...patch}; if(patch.section==="calendar") view.anchor=now(); render(); bump(); }
function render(){ renderTop(); renderMain(); renderClock(); }
function renderClock(){ const n=now(); const t=`${(n.getHours()%12)||12}:${pad(n.getMinutes())}`; const c=$(".clock"); if(c) c.textContent=t; $(".artclock .t").textContent=t; $(".artclock .d").textContent=`${DOW[n.getDay()]}, ${MON[n.getMonth()]} ${n.getDate()}`; const nl=$(".nowline"); if(nl){ nl.style.top=timeTop(n.getHours()*60+n.getMinutes())+"px"; } }
setInterval(renderClock, 15000);

const PLANS_URL=(SEED.settings&&SEED.settings.plansUrl)||"";   // optional: any embeddable page (e.g. a 3D model of a remodel); empty hides the Plans tab
const SECTIONS=[["calendar","📅","Calendar"],["chores","✅","Chores"],["meals","🍽️","Meals"],["verse","📖","Verse"],["photos","🖼️","Photos"],["money","💰","Money"],["plans","🏡","Plans"]].filter(s=>s[0]!=="plans"||PLANS_URL);
// calendar filter: Family hides feeds marked kind:"jason" (a parent's work calendars); Dad shows only those (+ travel); All shows everything. Shared setting.
const CALF=[["family","Family"],["dad","Dad"],["all","All"]];
const calFilter = () => CALF.some(x=>x[0]===setting("calFilter")) ? setting("calFilter") : "family";
const calKeep = e => { const f=calFilter(); if(f==="all") return true; if(f==="dad") return e.kind==="jason"||e.kind==="travel"||e.kind==="vacation"||e.kind==="birthday"; return e.kind!=="jason"; };
function renderTop(){
  top.innerHTML="";
  const left=el("div","tl"); const mid=el("div","tm"); const right=el("div","tr");
  if (view.section==="calendar"){
    const a=view.anchor; let title;
    if (view.cal==="week"){ const s=startOfWeek(a), e=addDays(s,6); title = s.getMonth()===e.getMonth() ? `${MON[s.getMonth()]} ${s.getDate()}–${e.getDate()}` : `${MON[s.getMonth()].slice(0,3)} ${s.getDate()} – ${MON[e.getMonth()].slice(0,3)} ${e.getDate()}`; }
    else if (view.cal==="day") title=`${DOW[a.getDay()]}, ${MON[a.getMonth()]} ${a.getDate()}`;
    else if (view.cal==="month") title=`${MON[a.getMonth()]} ${a.getFullYear()}`; else title=`${a.getFullYear()}`;
    left.append(el("h1",null,title), el("div","sub",SEED.familyName||"Our Family"));
    const prev=el("button","navbtn","‹"), next=el("button","navbtn","›"), today=el("button","navbtn","Today");
    const step={day:1,week:7}[view.cal];
    prev.onclick=()=>{ view.anchor = step? addDays(view.anchor,-step) : (view.cal==="month"? new Date(view.anchor.getFullYear(),view.anchor.getMonth()-1,1) : new Date(view.anchor.getFullYear()-1,0,1)); render(); };
    next.onclick=()=>{ view.anchor = step? addDays(view.anchor,step) : (view.cal==="month"? new Date(view.anchor.getFullYear(),view.anchor.getMonth()+1,1) : new Date(view.anchor.getFullYear()+1,0,1)); render(); };
    today.onclick=()=>{ view.anchor=now(); render(); };
    const pills=el("div","pills"); for (const [k,l] of [["day","D"],["week","W"],["month","M"],["year","Y"]]) { const b=el("button",k===view.cal?"on":"",l); b.onclick=()=>{view.cal=k;render();}; pills.append(b); }
    const fp=el("div","pills filt"); for (const [k,l] of CALF){ const b=el("button",k===calFilter()?"on":"",l); b.title=k==="family"?"Hide Dad's work calendars":k==="dad"?"Only Dad's calendars":"Everything"; b.onclick=()=>{ S.settings=S.settings||{}; S.settings.calFilter=k; save(); render(); toast(k==="family"?"Family calendar":k==="dad"?"Dad's calendar":"All calendars"); }; fp.append(b); }
    mid.append(prev,today,next,pills,fp);
  } else if (view.section==="chores"){
    left.append(el("h1",null, view.kid ? kidById(view.kid).name : view.kid===null && view.shop ? "Reward Shop" : "Chores"), el("div","sub",`${DOW[now().getDay()]}, ${MON[now().getMonth()]} ${now().getDate()}`));
    if (view.kid || view.shop){ const back=el("button","navbtn","‹ All kids"); back.onclick=()=>go({kid:null,shop:false}); mid.append(back); }
  } else if (view.section==="meals"){
    const s=startOfWeek(view.mealAnchor), e=addDays(s,6);
    left.append(el("h1",null,"Meals"), el("div","sub",`${MON[s.getMonth()].slice(0,3)} ${s.getDate()} – ${MON[e.getMonth()].slice(0,3)} ${e.getDate()} · Plan to Eat`));
    const prev=el("button","navbtn","‹"), next=el("button","navbtn","›"), today=el("button","navbtn","This week");
    prev.onclick=()=>{view.mealAnchor=addDays(view.mealAnchor,-7);render();}; next.onclick=()=>{view.mealAnchor=addDays(view.mealAnchor,7);render();}; today.onclick=()=>{view.mealAnchor=now();render();};
    mid.append(prev,today,next);
  } else if (view.section==="photos"){ left.append(el("h1",null,"Photos"), el("div","sub", PH.list.length?`${PH.list.length} family pictures · tap for the next one`:"no pictures yet"));
    if(PH.list.length){ const fs=el("button","navbtn","▶ Full-screen slideshow"); fs.onclick=slideshowNow; mid.append(fs); }
  } else if (view.section==="money"){ left.append(el("h1",null,"Family Money"), el("div","sub","Explore · grow · plan together"));
  } else if (view.section==="plans"){
    left.append(el("h1",null,"Addition Plans"),el("div","sub","View only · One finger: rotate · Two fingers: pan / zoom"));
  } else { const vs=verse(); left.append(el("h1",null,"Memory Verse"), el("div","sub", vs.whole?`This week · the whole passage!`:vs.part?`This week · part ${vs.part} of ${vs.of} · ${vs.series}`:"This week")); }
  const nav=el("nav","secnav"); for (const [id,ic,l] of SECTIONS){ const b=el("button",id===view.section?"on":"",`<span class="ic">${ic}</span>${l}`); b.title=id==="plans"?"Addition plans":l; b.onclick=()=>go({section:id,kid:null,shop:false}); nav.append(b); }
  const lock=el("button","navbtn lock","🔒"); lock.title="Parents"; lock.onclick=()=>pin(openParent,"Parents");
  const th=THEMES.find(t=>t[0]===themeId()); const tb=el("button","navbtn theme",th[1]); tb.title="Look: "+th[2]; tb.onclick=()=>{ const i=THEMES.findIndex(t=>t[0]===themeId()); S.theme=THEMES[(i+1)%THEMES.length][0]; save(); applyTheme(); renderTop(); toast("Look: "+THEMES.find(t=>t[0]===S.theme)[2]); };
  const ssb=el("button","navbtn ssbtn","🎞️"); ssb.title="Family picture slideshow"; ssb.onclick=slideshowNow;
  const ob=el("button","navbtn offbtn","⏻"); ob.title="Screen off (tap anywhere to wake)"; ob.onclick=()=>sleepNow(true);
  right.append(nav, el("div","clock"), ssb, ob, tb, lock);
  top.append(left,mid,right);
}

// ---------- events ----------
// live events from /api/events (Google Calendar iCal feeds via the worker); cached in localStorage so the wall still shows them offline
let LIVE={events:[],at:0,errors:[]}; try{ const c=JSON.parse(localStorage.getItem("hub.live.v1")||"null"); if(c&&Array.isArray(c.events)) LIVE=c; }catch{}
async function loadLive(){ try{ const r=await fetch("/api/events",{cache:"no-store"}); if(!r.ok) return; const j=await r.json(); if(!Array.isArray(j.events)) return; if(!j.events.length && (j.errors||[]).length) return;
  const same=JSON.stringify(j.events)===JSON.stringify(LIVE.events); LIVE={events:j.events,at:Date.now(),errors:j.errors||[]}; localStorage.setItem("hub.live.v1",JSON.stringify(LIVE)); if(!same) render(); }catch{} }
const baseEvents = () => LIVE.events.length ? SEED.events.filter(e=>e.source==="manual").concat(LIVE.events) : SEED.events;

// ---------- local weather (separate from shared family state) ----------
const WEATHER_KEY="hub.weather.v1", WEATHER_MAX_AGE=24*60*60000;
let WEATHER=null, weatherFailed=false, weatherLoading=false;
function validWeather(j){
  return j && j.timezone==="America/Chicago" && j.unit==="°F" && Number.isFinite(Date.parse(j.generated)) && Array.isArray(j.days) && j.days.length &&
    j.days.every(d=>d && /^\d{4}-\d{2}-\d{2}$/.test(d.date) && Number.isFinite(d.high) && Number.isFinite(d.low) && d.high>=d.low && Number.isInteger(d.code));
}
try{ const saved=JSON.parse(localStorage.getItem(WEATHER_KEY)||"null"); if(validWeather(saved)) WEATHER=saved; }catch{}
const weatherAge = () => WEATHER ? Math.max(0,Date.now()-Date.parse(WEATHER.generated)) : Infinity;
const weatherDay = date => weatherAge()<=WEATHER_MAX_AGE ? WEATHER.days.find(d=>d.date===date) : null;
function weatherCondition(code){
  if(code===0) return ["☀️","Clear"];
  if(code===1) return ["🌤️","Mostly clear"];
  if(code===2) return ["⛅","Partly cloudy"];
  if(code===3) return ["☁️","Overcast"];
  if([45,48].includes(code)) return ["🌫️","Fog"];
  if([51,53,55].includes(code)) return ["🌦️","Drizzle"];
  if([56,57,66,67].includes(code)) return ["🌧️","Freezing rain"];
  if([61,63,65,80,81,82].includes(code)) return ["🌧️","Rain"];
  if([71,73,75,77,85,86].includes(code)) return ["🌨️","Snow"];
  if([95,96,99].includes(code)) return ["⛈️","Thunderstorms"];
  return ["🌡️","Weather"];
}
function weatherNode(date, compact=false){
  const n=el("div","day-weather"+(compact?" compact":"")); n.dataset.date=date;
  const d=weatherDay(date);
  if(!d){ n.classList.add("wx-empty"); n.textContent="—"; n.title=weatherFailed?"Weather temporarily unavailable":"Weather unavailable for this date"; n.setAttribute("aria-label",n.title); return n; }
  const [icon,label]=weatherCondition(d.code), hi=Math.round(d.high), lo=Math.round(d.low);
  const saved=weatherFailed || weatherAge()>3*60*60000;
  const description=`${(SEED.settings.place||"Weather")}: ${label}, high ${hi}°F, low ${lo}°F${saved?" (saved weather)":""}`;
  n.title=description; n.setAttribute("aria-label",description);
  n.innerHTML=`<span class="wx-icon" aria-hidden="true">${icon}</span><span class="wx-high" aria-hidden="true"><small>H</small> ${hi}°</span><span class="wx-low" aria-hidden="true"><small>L</small> ${lo}°</span>`;
  return n;
}
function weatherMeta(){
  const n=el("div","weather-meta"); let status="";
  if(!WEATHER || weatherAge()>WEATHER_MAX_AGE) status=weatherFailed || WEATHER?" · Weather unavailable":" · Loading weather…";
  else if(weatherFailed || weatherAge()>3*60*60000) status=" · Saved weather · updated "+new Date(WEATHER.generated).toLocaleString("en-US",{timeZone:"America/Chicago",month:"short",day:"numeric",hour:"numeric",minute:"2-digit"});
  n.append(document.createTextNode((SEED.settings.place?SEED.settings.place+" · ":"")+"°F"+status+" · "));
  const source=el("a",null,"Open-Meteo"); source.href="https://open-meteo.com/"; source.target="_blank"; source.rel="noopener noreferrer"; n.append(source);
  return n;
}
function updateWeather(){
  main.querySelectorAll(".day-weather").forEach(n=>n.replaceWith(weatherNode(n.dataset.date,n.classList.contains("compact"))));
  const meta=main.querySelector(".weather-meta"); if(meta) meta.replaceWith(weatherMeta());
}
async function loadWeather(){
  if(weatherLoading) return; weatherLoading=true;
  const controller=new AbortController(), timeout=setTimeout(()=>controller.abort(),12000);
  try{
    const r=await fetch("/api/weather",{cache:"no-store",signal:controller.signal}); if(!r.ok) throw new Error("weather "+r.status);
    const j=await r.json(); if(!validWeather(j)) throw new Error("invalid weather");
    WEATHER=j; weatherFailed=false;
    try{ localStorage.setItem(WEATHER_KEY,JSON.stringify(j)); }catch{}
  }catch{ weatherFailed=true; }
  finally{ clearTimeout(timeout); weatherLoading=false; updateWeather(); }
}

function eventsOn(d){
  const k=iso(d); const out=[];
  for (const e of baseEvents()){ if (!calKeep(e)) continue; if (e.endDate ? (k>=e.date && k<e.endDate) : e.date===k) out.push({...e}); }
  for (const h of SEED.highlights||[]){ if (k>=h.date && k<h.endDate) out.push({date:k,allDay:true,title:h.title,kind:h.category,source:h.source,band:true}); }
  for (const b of SEED.birthdays||[]){ if (k.slice(5)===b.md) out.push({date:k,allDay:true,title:`🎂 ${b.who}'s birthday`,kind:"birthday",kid:b.kid}); }
  const rank=e=>e.kind==="birthday"?0:e.band?1:(!e.time?2:3);
  out.sort((a,b)=>rank(a)-rank(b) || ((a.time||"")<(b.time||"")?-1:1));
  return out;
}
const kindCls = e => e.kind==="kid"?"evkid":(["school","jason","travel","vacation","birthday","family"].includes(e.kind)?e.kind:"family");
function evNode(e, cls=""){
  const n=el("div","ev "+(e.time?"":"allday ")+kindCls(e)+" "+cls);
  if (e.kind==="kid") n.style.setProperty("--kc", kidById(e.kids[0]).color);
  n.innerHTML = (e.time?`<span class="t">${fmtTime(e.time)}${e.end?"–"+fmtTime(e.end):""}</span>`:"") + `<span class="tt">${e.title}</span>`;
  return n;
}
// time grid geometry
let HOUR_PX=100; const dayStart=()=>SEED.settings.dayStart, dayEnd=()=>SEED.settings.dayEnd;
const timeTop = m => (m/60-dayStart())*HOUR_PX;
function layoutTimed(evs){ // assign columns to overlapping events
  const items=evs.filter(e=>e.time).map(e=>({e,s:mins(e.time),en:e.end?mins(e.end):mins(e.time)+60})).sort((a,b)=>a.s-b.s||b.en-a.en);
  const out=[]; let cluster=[], clusterEnd=-1;
  const flush=()=>{ if(!cluster.length) return; const cols=[]; for(const it of cluster){ let c=cols.findIndex(end=>end<=it.s); if(c<0){c=cols.length; cols.push(0);} cols[c]=it.en; it.col=c; } for(const it of cluster){ it.ncol=cols.length; out.push(it); } cluster=[]; clusterEnd=-1; };
  for (const it of items){ if(cluster.length && it.s>=clusterEnd) flush(); cluster.push(it); clusterEnd=Math.max(clusterEnd,it.en); }
  flush(); return out;
}
function timeColumn(d, wide){
  const col=el("div","tcol"); const evs=eventsOn(d);
  for (const it of layoutTimed(evs)){ const n=evNode(it.e,"timed"); const top=timeTop(Math.max(it.s,dayStart()*60)), h=Math.max(28,timeTop(Math.min(it.en,dayEnd()*60))-top);
    n.style.top=top+"px"; n.style.height=(h-4)+"px"; const w=100/it.ncol; n.style.left=`calc(${w*it.col}% + 2px)`; n.style.width=`calc(${w}% - 4px)`; if(h<48) n.classList.add("short"); col.append(n); }
  if (iso(d)===iso(now())){ const nl=el("div","nowline"); nl.style.top=timeTop(now().getHours()*60+now().getMinutes())+"px"; col.append(nl); }
  return col;
}
function timeGrid(days){
  const g=el("div","tgrid"); g.style.setProperty("--ncols",days.length);
  const weather=el("div","weather-row"); weather.append(el("div","gutter","°F"));
  for(const d of days) weather.append(weatherNode(iso(d)));
  g.append(weather);
  const head=el("div","thead"); head.append(el("div","gutter"));
  for (const d of days){ const h=el("div","dh"+(iso(d)===iso(now())?" today":""),`<span class="dow">${DOW[d.getDay()]}</span><span class="num">${d.getDate()}</span>`); head.append(h); }
  g.append(head);
  const all=el("div","allday"); all.append(el("div","gutter","all day")); let anyAll=false;
  for (const d of days){ const c=el("div","acell"); eventsOn(d).filter(e=>!e.time).forEach(e=>{ c.append(evNode(e)); anyAll=true; }); all.append(c); }
  if (anyAll) g.append(all);
  const body=el("div","tbody"); const hours=dayEnd()-dayStart();
  const sizer=()=>{ const avail=body.clientHeight||600; HOUR_PX=Math.max(44,Math.floor(avail/hours)); body.style.setProperty("--hpx",HOUR_PX+"px"); };
  const gut=el("div","gutter hours"); for(let h=dayStart();h<dayEnd();h++) gut.append(el("div","hr",fmtTime(`${h}:00`)));
  body.append(gut); const cols=[]; for (const d of days){ const c=el("div","tcolwrap"); for(let h=dayStart();h<dayEnd();h++) c.append(el("div","hline")); cols.push([c,d]); body.append(c); }
  g.append(body);
  requestAnimationFrame(()=>{ sizer(); for(const [c,d] of cols) c.append(timeColumn(d)); });
  return g;
}

// ---------- main ----------
let moneyCleanup=null;
function renderMain(){
  if(moneyCleanup){moneyCleanup();moneyCleanup=null;}
  screen.classList.toggle("money-active",view.section==="money");
  // Shared-state/event refreshes and resizes must not reset the kids' camera in the plans.
  if(view.section==="plans" && main.querySelector(".plans-view iframe")) return;
  main.innerHTML=""; const v=el("div","view"); main.append(v); main.append(el("div","toast"));
  if (view.section!=="photos" && !screen.classList.contains("art")){ screen.classList.remove("photos"); ssStop(); }
  if (view.section==="calendar") renderCalendar(v);
  else if (view.section==="chores") renderChores(v);
  else if (view.section==="meals") renderMeals(v);
  else if (view.section==="photos") renderPhotos(v);
  else if (view.section==="money") renderMoney(v);
  else if (view.section==="plans"){
    v.classList.add("plans-view");
    const frame=el("iframe"); frame.src=PLANS_URL; frame.title="Our addition plans — view-only 3D model"; frame.setAttribute("sandbox","allow-scripts allow-same-origin");   // 11/15: no pointer lock / fullscreen on the wall. Walkthrough "lock mouse look" trapped touch with no Esc key
    v.append(frame);
  }
  else renderVerse(v);
}
function renderCalendar(v){
  if (view.cal==="week"){ const s=startOfWeek(view.anchor); v.append(timeGrid([0,1,2,3,4,5,6].map(i=>addDays(s,i)))); }
  else if (view.cal==="day"){ v.append(timeGrid([view.anchor])); }
  else if (view.cal==="month"){
    const a=view.anchor; const first=new Date(a.getFullYear(),a.getMonth(),1); const s=startOfWeek(first); const g=el("div","month"); const tk=iso(now());
    dowOrder().forEach(i=>g.append(el("div","dow",DOW[i])));
    for (let i=0;i<42;i++){ const d=addDays(s,i); const md=el("div","mday"+(d.getMonth()!==a.getMonth()?" out":"")+(iso(d)===tk?" today":""));
      const mh=el("div","mday-head"); mh.append(el("div","n",d.getDate()),weatherNode(iso(d),true)); md.append(mh); eventsOn(d).slice(0,4).forEach(e=>{ const mi=el("div","mini "+kindCls(e),e.title); if(e.kind==="kid") mi.style.setProperty("--kc",kidById(e.kids[0]).color); md.append(mi); }); g.append(md); }
    v.append(g);
  } else {
    const y=view.anchor.getFullYear(); const tk=iso(now()); const wrap=el("div","yearwrap");
    wrap.append(el("div","legend",`<span class="lg vacation">Vacation</span><span class="lg travel">Dad traveling</span><span class="lg birthday">Birthday</span><span class="lg has">Something on the calendar</span>`));
    const g=el("div","year");
    const catOf=dd=>{ const evs=eventsOn(dd); if(evs.some(e=>e.kind==="birthday")) return "birthday"; if(evs.some(e=>e.kind==="vacation")) return "vacation"; if(evs.some(e=>e.kind==="travel"&&e.band)) return "travel"; return evs.length?"has":""; };
    for (let m=0;m<12;m++){ const box=el("div","ymon"); box.append(el("h3",null,MON[m])); const gg=el("div","g");
      dowOrder().forEach(i=>gg.append(el("span","dw",DOW[i][0]))); const first=new Date(y,m,1); for (let i=0;i<weekOffset(first);i++) gg.append(el("span"));
      const dim=new Date(y,m+1,0).getDate(); for (let d=1;d<=dim;d++){ const dd=new Date(y,m,d); gg.append(el("span",(iso(dd)===tk?"tod ":"")+catOf(dd),d)); }
      box.append(gg); g.append(box); }
    wrap.append(g);
    const items=[]; for (const h of SEED.highlights||[]) items.push({date:h.date,title:h.title,kind:h.category,end:h.endDate});
    for (const b of SEED.birthdays||[]) for (const yy of [y,y+1]) items.push({date:`${yy}-${b.md}`,title:`🎂 ${b.who}'s birthday`,kind:"birthday"});
    items.sort((a,b)=>a.date<b.date?-1:1); const up=items.filter(i=>i.date>=tk).slice(0,6);
    const cu=el("div","comingup"); cu.append(el("h3",null,"Coming up"));
    for (const i of up){ const d=parse(i.date); const span=i.end?` – ${(()=>{const e=addDays(parse(i.end),-1);return `${MON[e.getMonth()].slice(0,3)} ${e.getDate()}`})()}`:""; cu.append(el("div","cu "+i.kind,`<b>${MON[d.getMonth()].slice(0,3)} ${d.getDate()}${span}</b> ${i.title}`)); }
    wrap.append(cu); v.append(wrap);
  }
  if(view.cal!=="year") v.append(weatherMeta());
}

// ---------- chores ----------
function tileFor(k, small=false){
  const b=el("button","tile"+(small?" small":"")+(view.kid===k.id?" on":"")); b.style.setProperty("--kc",k.color);
  const base=baseList(k.id); const bd=base.filter(c=>doneCount(k.id,c.id)>0).length; const st=streak(k.id); const gold=bd===base.length;
  const swept=sweepDone(k.id); if (swept) b.classList.add("sweep"); else if (gold) b.classList.add("gold");
  b.append(avNode(k.id));
  const ss=sweepStreak(k.id), pw=perfectWeek(k.id,"sweep")?"👑":perfectWeek(k.id,"base")?"🏅":"";
  b.insertAdjacentHTML("beforeend",`<span class="nm">${k.name}</span><span class="pt">${weekPoints(k.id)} / ${k.goal} this week<small>bank ${points(k.id)}${st>=2?` · 🔥${st}`:""}${ss>=2?` · 🌈${ss}`:""}</small></span>${weekDots(k.id)}${pw?`<span class="crown">${pw}</span>`:""}${swept?'<span class="badge sweep">🧹 clean sweep</span>':gold?'<span class="badge gold">✨ base done</span>':bd?`<span class="badge">${bd}/${base.length}</span>`:""}`);
  b.onclick=()=>go({section:"chores",kid:k.id,shop:false});
  return b;
}
function shopTile(small=false){ const t=el("button","tile shop"+(small?" small":"")+(view.shop?" on":""),`<span class="av">🎁</span><span class="nm">Reward Shop</span><span class="pt">spend your bank</span>`); t.onclick=()=>go({section:"chores",kid:null,shop:true}); return t; }
function famBar(){ const fg=familyGoal(), fw=familyWeek(); return el("div","famgoal",`<b>🍕 ${fg.label}</b><span class="track"><i style="width:${Math.min(100,Math.round(fw/fg.points*100))}%"></i></span><span class="n">${fw} / ${fg.points}</span>`); }
function renderChores(v){
  if (!view.kid && !view.shop){ const grid=el("div","tilesgrid"); grid.append(famBar()); SEED.kids.forEach(k=>grid.append(tileFor(k))); grid.append(shopTile()); v.append(grid); return; }
  const wrap=el("div","choreswrap"); const content=el("div","chorecontent"); wrap.append(content);
  const strip=el("div","kidstrip"); strip.append(famBar()); SEED.kids.forEach(k=>strip.append(tileFor(k,true))); strip.append(shopTile(true)); wrap.append(strip);
  if (view.shop) content.append(renderShop()); else content.append(renderKid(view.kid));
  v.append(wrap);
}
function afterToggle(kid, c, cellNode, wasUnlocked, wasWeek, wasFam, wasPW={}){
  const k=kidById(kid); const isW=c.kind==="weekly"; const nowDone = isW ? weeklyDone(kid,c.id) : doneCount(kid,c.id)>0; const sweptNow=syncSweep(kid); render();
  if(!nowDone) return;
  if(wasPW.sweep!==perfectWeek(kid,"sweep") && perfectWeek(kid,"sweep")){ setTimeout(()=>{ chime("goal"); rain(700); banner("👑",`Perfect week, ${k.name}!`,"A clean sweep every single day this week"); },2800); }
  else if(wasPW.base!==perfectWeek(kid,"base") && perfectWeek(kid,"base")){ setTimeout(()=>{ chime("goal"); rain(450); banner("🏅",`Perfect base week, ${k.name}!`,"Base chores done all seven days"); },2800); }
  const earned=weekPoints(kid)-wasWeek; chime(soundFor(c));
  const nc=[...document.querySelectorAll(".cgrid .cc.today")].find(x=>x.dataset.cid===c.id) || [...document.querySelectorAll(".cgrid .cc")].find(x=>x.dataset.cid===c.id);
  const pos=nc?posIn(nc):{x:540,y:700}; confetti(pos.x,pos.y,28,.8); flyPts(pos.x,pos.y-30,`+${earned}`); if(nc){ nc.classList.add("pop"); }
  if(sweptNow){ setTimeout(()=>{ chime("sweep"); rain(500); banner("🧹✨",`Clean sweep, ${k.name}!`,`Every chore on today's list is done · +${SEED.settings.sweepBonus} bonus pts`); },250); }
  else if(!wasUnlocked && baseDone(kid)){ setTimeout(()=>{ chime("unlock"); rain(160); banner("🔓",`${k.name}, base is done!`,"Bonus chores are open — go earn some points"); document.querySelectorAll(".cgrid .cc.wasLocked").forEach(n=>n.classList.add("pop")); },250); }
  else if(wasWeek<k.goal && weekPoints(kid)>=k.goal){ setTimeout(()=>{ chime("goal"); rain(320); banner("🏆",`${k.name} hit the weekly goal!`,`${k.goal} points this week`); },250); }
  else if(wasFam<familyGoal().points && familyWeek()>=familyGoal().points){ setTimeout(()=>{ chime("goal"); rain(400); banner("🍕","Family goal reached!",familyGoal().label); },250); }
}
function renderKid(kid){
  const k=kidById(kid); const wrap=el("div","kidview"); wrap.style.setProperty("--kc",k.color);
  const start=startOfWeek(now()); const days=[0,1,2,3,4,5,6].map(i=>addDays(start,i)); const tk=iso(now()); const wk=weekKey(now());
  const wp=weekPoints(kid), st=streak(kid), unlocked=baseDone(kid), base=baseList(kid), swept=sweepDone(kid);
  const head=el("div","khead"+(swept?" sweep":"")); head.append(avNode(kid));
  const ss=sweepStreak(kid), pwS=perfectWeek(kid,"sweep"), pwB=perfectWeek(kid,"base");
  head.append(el("div",null,`<h2>${k.name}${st>=2?`<span class="streak">🔥 ${st}-day base streak</span>`:""}${ss>=2?`<span class="streak rb">🌈 ${ss}-day sweep streak</span>`:""}${pwS?`<span class="streak crown">👑 Perfect sweep week!</span>`:pwB?`<span class="streak crown">🏅 Perfect base week!</span>`:""}</h2><div class="sub">${swept?"🧹 Clean sweep — everything's done today!":unlocked?"Base done ✓ — bonus is open":`${base.filter(c=>doneCount(kid,c.id)>0).length} of ${base.length} base done · bonus locked`}</div>`));
  head.append(el("div","goal",`<div class="n">${wp} <small>/ ${k.goal} this week</small></div><div class="bar"><i style="width:${Math.min(100,Math.round(wp/k.goal*100))}%"></i></div><div class="bank">Bank: <b>${points(kid)} pts</b> to spend</div>`));
  wrap.append(head);
  const grid=el("div","cgrid"+(unlocked?" open":" gated")+" t"+weekOffset(now()));
  const row=(cls)=>{ const r=el("div","crow "+cls); grid.append(r); return r; };
  // header
  const hr=row("chead"); hr.append(el("div","ch lab",""));
  days.forEach(d=>{ const key=iso(d); const m=key>tk?"":dayMark(kid,d); hr.append(el("div","ch d"+(key===tk?" today":key>tk?" future":"")+(m?" "+m:""),`<span class="dow">${key===tk?"Today":DOW[d.getDay()]}</span><span class="num">${d.getDate()}</span><span class="dm">${m==="sweep"?"🌈 sweep":m==="base"?"✨ base":key>tk?"":"&nbsp;"}</span>`)); });
  hr.append(el("div","ch pts","PTS"));
  const dayCell=(c, d, locked)=>{
    const key=iso(d); const n=doneCount(kid,c.id,d); const b=key===tk?activeBonus(kid,c.id):null;
    const cell=el("button","cc"+(key===tk?" today":"")+(key>tk?" future":" past")+(n>0?" done":"")+(locked&&key===tk&&n===0?" locked wasLocked":"")); cell.dataset.cid=c.id;
    if (n>0) cell.innerHTML = n>1?`<span class="tally">${"|".repeat(n)}</span>`:`<span class="mark">✓</span>`;
    else if (key===tk){ const detail = c.id==="school" ? (S.schoolToday[kid]||c.detail||"") : (c.detail||"");
      cell.innerHTML = locked ? `<span class="lk">🔒</span>` : `<span class="tapme">${b?`<b class="boost">⚡ ${c.pts*b.mult} pts till ${fmtTime(b.until)}</b>`:`<b>${c.pts} pts</b>`}${detail?`<small>${detail}</small>`:""}</span>`; if(b&&!locked) cell.classList.add("boosted"); }
    if (key===tk){ cell.onclick=()=>{ if(locked){ cell.classList.remove("shake"); void cell.offsetWidth; cell.classList.add("shake"); toast("Finish the base chores first"); return; } const wasU=unlocked, wasW=weekPoints(kid), wasF=familyWeek(), wasPW={base:perfectWeek(kid,"base"),sweep:perfectWeek(kid,"sweep")}; toggle(kid,c); afterToggle(kid,c,cell,wasU,wasW,wasF,wasPW); }; }
    else cell.disabled=true;
    return cell;
  };
  const section=(label, chip)=>{ const r=row("csec"); r.append(el("div","cs lab",label)); const s=el("div","cs span",chip||""); r.append(s); r.append(el("div","cs")); };
  const groups=[
    ["base", base, `Do these first`, unlocked?`<span class="chip ok">✓ done — bonus open</span>`:`<span class="chip">🔒 finish these to unlock the rest</span>`],
    ["anytime", chores(kid).filter(c=>c.ungated&&c.kind!=="weekly"), "Any time", `<span class="chip soft">never locked</span>`],
    ["daily", chores(kid).filter(c=>c.kind==="daily"&&!c.ungated), "Extra today", unlocked?`<span class="chip ok">open</span>`:`<span class="chip">🔒 locked</span>`]
  ];
  for (const [g,list,label,chip] of groups){ if(!list.length) continue; section(label,chip);
    list.forEach((c,i)=>{ const r=row("cr "+g+(i%2?" alt":"")); r.append(el("div","cl",`<span class="ic">${c.icon}</span><span class="t">${c.label}</span>`));
      const locked = g==="daily" && !unlocked; let rowPts=0;
      for (const d of days){ const key=iso(d); const n=doneCount(kid,c.id,d); if(n>0) rowPts+=c.pts*n+extraPts(key,kid,c.id); r.append(dayCell(c,d,locked)); }
      r.append(el("div","cp",rowPts?String(rowPts):"")); }); }
  const weekly=chores(kid).filter(c=>c.kind==="weekly");
  if (weekly.length){ section("Weekly", unlocked?`<span class="chip ok">this week</span>`:(weekly.some(c=>c.ungated)?`<span class="chip">🔒 some locked until base is done</span>`:`<span class="chip">🔒 locked until base is done</span>`));
    weekly.forEach((c,i)=>{ const r=row("cr weekly"+(i%2?" alt":"")); r.append(el("div","cl",`<span class="ic">${c.icon}</span><span class="t">${c.label}${c.ungated?'<small class="free">never locked</small>':""}</span>`));
      const cnt=weeklyCount(kid,c.id), cap=weeklyCap(c), done=cnt>=cap, part=cnt>0&&!done; const locked=!c.ungated && !unlocked; const b=activeBonus(kid,c.id);
      const cell=el("button","cc span7"+(done?" done":"")+(part?" partial":"")+(locked&&!cnt?" locked wasLocked":"")+(b&&!done&&!locked?" boosted":"")); cell.dataset.cid=c.id;
      const ptsTxt=b?`⚡ ${c.pts*b.mult} pts till ${fmtTime(b.until)}`:`${c.pts} pts`; const times=cap>1?`up to ${cap}× this week`:"once this week";
      cell.innerHTML= done?`<span class="mark">✓ ${cap>1?`${cnt} of ${cap} this week — all done`:"done this week"}</span>`
        : part?`<span class="tally">${"|".repeat(cnt)}</span><b class="wp">${cnt} of ${cap} · ${ptsTxt} each</b><span class="muted">tap again for the next one</span>`
        : locked?`<span class="lk">🔒</span><span class="muted">${times}</span>`
        : `<b class="wp">${ptsTxt}${cap>1?" each":""}</b><span class="muted">${times} — tap when it's done</span>`;
      cell.onclick=()=>{ if(locked){ cell.classList.remove("shake"); void cell.offsetWidth; cell.classList.add("shake"); toast("Finish the base chores first"); return; } const wasU=unlocked, wasW=weekPoints(kid), wasF=familyWeek(); toggle(kid,c); afterToggle(kid,c,cell,wasU,wasW,wasF); };
      r.append(cell); r.append(el("div","cp",cnt?String(c.pts*cnt+extraPts(wk,kid,c.id)):"")); }); }
  // totals
  const tr=row("ctot"); tr.append(el("div","ct lab","Points"));
  for (const d of days){ const key=iso(d); let p=0; for (const id in ((S.done[key]||{})[kid]||{})) { const c=chore(kid,id); if(c) p+=c.pts*S.done[key][kid][id]+extraPts(key,kid,id); } const sw=((S.sweep||{})[key]||{})[kid]||0; p+=sw; tr.append(el("div","ct"+(key===tk?" today":""),p?`${p}${sw?" 🧹":""}`:"")); }
  tr.append(el("div","ct pts",`${wp}`));
  wrap.append(grid);
  wrap.append(el("div","cfoot",`<span><b>Goal</b> ${k.goal}</span><span><b>Total</b> ${wp}</span><span><b>Bank</b> ${points(kid)}</span><span class="st">🧹 = clean sweep day (+${SEED.settings.sweepBonus})</span>`));
  return wrap;
}
function renderShop(){
  const wrap=el("div","shopview"); const kid = view.shopKid || SEED.kids[0].id; view.shopKid=kid; const k=kidById(kid);
  const who=el("div","who"); for (const x of SEED.kids){ const b=el("button",x.id===kid?"on":"",x.name); b.style.setProperty("--kc",x.color); b.onclick=()=>{view.shopKid=x.id;render();}; who.append(b); } wrap.append(who);
  const pts=points(kid); wrap.append(el("div","sec",`<span>${k.name} has ${pts} pts in the bank</span><span class="st">tap a reward → a parent enters the PIN</span>`));
  const list=el("div","rwlist");
  const mine=rewardsFor(kid); if(!mine.length) list.append(el("div","sub","No rewards set up for "+k.name+" yet."));
  for (const r of mine){ const cost=price(r); const ok=pts>=cost; const n=el("button","rw"+(ok?"":" no"));
    n.innerHTML=`<span class="ic">${r.icon}</span><span class="lb">${r.label}</span><span class="cost">${cost}</span>${ok?"":`<span class="need">need ${cost-pts} more</span>`}`;
    n.onclick=()=>{ if(!ok){ toast(`${cost-pts} more points for that one`); return; } pin(()=>{ S.redemptions.push({t:Date.now(),kid,reward:r.id,cost}); save(); render(); chime("goal"); rain(200); banner(r.icon,`${r.label}!`,`${k.name} spent ${cost} points`); }, `Redeem ${r.label} for ${k.name}?`); };
    list.append(n); }
  wrap.append(list); return wrap;
}

// ---------- meals ----------
function renderMeals(v){
  const s=startOfWeek(view.mealAnchor); const g=el("div","meals"); const tk=iso(now());
  for (let i=0;i<7;i++){ const d=addDays(s,i); const k=iso(d); const m=SEED.meals[k]; const row=el("div","mealday"+(k===tk?" today":""));
    row.append(el("div","md",`<span class="dow">${DOW[d.getDay()]}</span><span class="num">${d.getDate()}</span>`));
    const body=el("div","mb"); if(m){ m.split(" · ").forEach(x=>body.append(el("div","dish",x))); } else body.append(el("div","dish none","Nothing planned yet")); row.append(body); g.append(row); }
  v.append(g);
  v.append(el("div","mealsfoot",`Synced from Plan to Eat. Planned meals show here the next time the wall refreshes.`));
}

// ---------- verse ----------
let hideLevel=0;
function renderVerse(v){
  const vs=verse(); const words=vs.verses?vs.verses.flatMap(x=>x.t.split(/\s+/).filter(Boolean)):vs.text.split(" "); const wrap=el("div","verseview");
  const card=el("div","versecard");
  const txt=el("p","versetext"); const n=Math.round(words.length*hideLevel/4);
  // uniform hiding: split the verse into n equal slices and hide one pseudo-random word per slice (fixed seed → stable between taps)
  const hideIdx=new Set(); if(n>0){ let seed=7; const rnd=()=>{ seed=(seed*9301+49297)%233280; return seed/233280; }; const step=words.length/n;
    for(let k=0;k<n;k++){ const a=Math.floor(k*step), b=Math.max(a+1,Math.floor((k+1)*step)); hideIdx.add(a+Math.floor(rnd()*(b-a))); }
    let i=0; while(hideIdx.size<n && i<words.length){ hideIdx.add(i++); } }
  verseNodes(txt,vs,hideIdx);
  card.append(txt, el("div","verseref",`${vs.ref} <small>${vs.version||""}</small>`));
  wrap.append(card);
  const ctl=el("div","versectl");
  const lv=el("div","pills"); [["Show all",0],["Hide some",1],["Hide half",2],["Hide most",3],["Hide all",4]].forEach(([l,n])=>{ const b=el("button",hideLevel===n?"on":"",l); b.onclick=()=>{hideLevel=n;render();}; lv.append(b); });
  const hear=el("button","hearbtn"+(VA.playing?" on":""),VA.playing?"⏹ Stop":"🔊 Hear it"); hear.onclick=()=>hearVerse(vs); const prow=el("div","practrow"); prow.append(lv,hear);
  ctl.append(el("div","sec","<span>Practice</span><span class='st'>tap a level, then say it out loud</span>"), prow);
  const vweekly=(chore(SEED.kids[0].id,"verse")||{}).kind==="weekly"; ctl.append(el("div","sec",`<span>${vweekly?"Who's got it this week?":"Who's said it today?"}</span><span class='st'>${vs.pts} pts each</span>`));
  const who=el("div","versewho");
  for (const k of SEED.kids){ const c=chore(k.id,"verse"); if(!c) continue; const vdone=()=>c.kind==="weekly"?weeklyDone(k.id,"verse"):doneCount(k.id,"verse")>0; const done=vdone(); const b=el("button","vk"+(done?" done":"")); b.style.setProperty("--kc",k.color); b.append(avNode(k.id)); b.append(el("span","nm",k.name)); b.append(el("span","st",done?"✓ said it":"tap when recited"));
    b.onclick=()=>{ const pos=posIn(b); const was=weekPoints(k.id); toggle(k.id,c); render(); if(vdone()){ chime("weekly"); confetti(pos.x,pos.y,80,1); flyPts(pos.x,pos.y-40,`+${weekPoints(k.id)-was}`); } };
    who.append(b); }
  ctl.append(who); wrap.append(ctl); v.append(wrap);
  requestAnimationFrame(()=>fitVerse(card,txt));
}
// verse audio: ESV narration via /api/verse-audio (worker proxy, cached); browser speech as the offline fallback
const VA={ playing:false, audio:null };
function vaStop(){ if(VA.audio){ VA.audio.pause(); VA.audio.src=""; VA.audio=null; } if(window.speechSynthesis) speechSynthesis.cancel(); VA.playing=false; const b=$(".hearbtn"); if(b){ b.textContent="🔊 Hear it"; b.classList.remove("on"); } }
function hearVerse(vs){
  if (VA.playing) return vaStop();
  const b=$(".hearbtn"); const setOn=()=>{ VA.playing=true; if(b){ b.textContent="⏹ Stop"; b.classList.add("on"); } };
  const speak=()=>{ if(!window.speechSynthesis) return toast("No audio available"); const u=new SpeechSynthesisUtterance(vs.text); u.rate=.9; u.onend=u.onerror=vaStop; setOn(); speechSynthesis.speak(u); };
  const a=new Audio("/api/verse-audio?q="+encodeURIComponent(vs.ref)); a.volume=volumeLevel()/100; VA.audio=a;
  a.onended=vaStop; a.onerror=()=>{ VA.audio=null; speak(); };
  if(b){ b.textContent="…"; }
  a.play().then(setOn).catch(()=>{ VA.audio=null; speak(); });
}
// grow the verse to the biggest size that still fits the card (binary search on font-size)
function fitVerse(card,txt){
  const ref=card.querySelector(".verseref"); const cs=getComputedStyle(card);
  const availH=card.clientHeight-parseFloat(cs.paddingTop)-parseFloat(cs.paddingBottom)-(ref?ref.offsetHeight+parseFloat(getComputedStyle(ref).marginTop):0);
  const availW=card.clientWidth-parseFloat(cs.paddingLeft)-parseFloat(cs.paddingRight);
  if(availH<50||availW<50) return;
  let lo=16, hi=260;
  while(hi-lo>1){ const mid=(lo+hi)>>1; txt.style.fontSize=mid+"px"; if(txt.scrollHeight<=availH && txt.scrollWidth<=availW) lo=mid; else hi=mid; }
  txt.style.fontSize=lo+"px";
}

// ---------- photos: family slideshow (pictures live in Worker KV via /api/photos; Parents → Photos uploads from a phone) ----------
let PH={list:[],at:0}; try{ const c=JSON.parse(localStorage.getItem("hub.photos.v1")||"null"); if(c&&Array.isArray(c.list)) PH=c; }catch{}
const photoUrl = p => `/api/photos/${p.id}`;
async function loadPhotos(){ try{ const r=await fetch("/api/photos",{cache:"no-store"}); if(!r.ok) return; const j=await r.json(); if(!Array.isArray(j.photos)) return;
  const recent=PH.list.filter(q=>Date.now()-(q.added||0)<120000 && !j.photos.some(r=>r.id===q.id)); const merged=j.photos.concat(recent);
  const same=JSON.stringify(merged.map(q=>q.id))===JSON.stringify(PH.list.map(q=>q.id)); PH={list:merged,at:Date.now()}; try{ localStorage.setItem("hub.photos.v1",JSON.stringify(PH)); }catch{}
  if(!same){ if(view.section==="photos") render(); ssOrder=[]; } }catch{} }   // new list: reshuffle at the next slide instead of cutting the current one short
const sleepChoice = () => { const m=setting("sleepScreen"); return m==="photos"||m==="art" ? m : "verse"; };   // old "auto" saves → verse
const sleepMode = () => { const m=sleepChoice(); return m==="photos" ? (PH.list.length?"photos":"verse") : m; };
// verse sleep screen: this week's memory verse, full screen, under the art clock
let vsLayer=null;
function vsShow(){ if(!vsLayer){ vsLayer=el("div","versesleep"); screen.append(vsLayer); } const vs=verse(); vsLayer.innerHTML="";
  const card=el("div","vscard"); const txt=el("p","versetext"); verseNodes(txt,vs); const ref=el("div","verseref"); ref.textContent=vs.ref; if(vs.version) ref.append(el("small",null,vs.version));
  card.append(txt,ref); vsLayer.append(card); requestAnimationFrame(()=>fitVerse(card,txt)); }
let ssT=null, ssOn=false, ssGen=0, ssIdx=-1, ssLayer=null, ssOrder=[];
const ssDelay = () => Math.max(5,+setting("photoSeconds")||20)*1000;   // counted from when the photo actually appears (slow loads used to eat the interval)
function ssLayerEl(){ if(ssLayer) return ssLayer; ssLayer=el("div","slideshow"); ssLayer.append(el("div","slide"),el("div","slide"),el("div","sscap")); ssLayer.onclick=()=>{ if(view.section==="photos" && !screen.classList.contains("art")) ssStart(false); }; screen.append(ssLayer); return ssLayer; }
function ssShuffle(){ ssOrder=PH.list.map((_,i)=>i); for(let i=ssOrder.length-1;i>0;i--){ const j=Math.floor(Math.random()*(i+1)); [ssOrder[i],ssOrder[j]]=[ssOrder[j],ssOrder[i]]; } ssIdx=-1; }
function ssNext(){ clearTimeout(ssT); if(!ssOn||!PH.list.length) return; if(!ssOrder.length||ssIdx>=ssOrder.length-1) ssShuffle(); ssIdx++; const p=PH.list[ssOrder[ssIdx]]; if(!p){ ssT=setTimeout(ssNext,500); return; }
  const gen=++ssGen; const L=ssLayerEl(); const slides=[...L.querySelectorAll(".slide")]; const cur=slides.find(x=>x.classList.contains("on"))||slides[1]; const nxt=slides.find(x=>x!==cur);
  const img=new Image(); img.onerror=()=>{ if(gen===ssGen && ssOn) ssT=setTimeout(ssNext,500); };   // missing photo: keep the current one up, try the next
  img.onload=()=>{ if(gen!==ssGen || !ssOn) return; ssT=setTimeout(ssNext, ssDelay()); const u=`url("${photoUrl(p)}")`; nxt.style.backgroundImage=u; nxt.style.setProperty("--img",u);
    nxt.classList.toggle("fit", img.naturalWidth/img.naturalHeight < 1.5);   // portraits + squarish shots: show whole, blurred copy fills the sides (cover would crop heads off)
    nxt.classList.remove("kb1","kb2"); void nxt.offsetWidth; nxt.classList.add(Math.random()<.5?"kb1":"kb2","on"); cur.classList.remove("on"); L.querySelector(".sscap").textContent=p.caption||p.album||""; }; img.src=photoUrl(p);
  const n=PH.list[ssOrder[(ssIdx+1)%ssOrder.length]]; if(n && n!==p){ const pre=new Image(); pre.src=photoUrl(n); } }
function ssStart(reset){ ssOn=true; if(reset||!ssOrder.length) ssShuffle(); ssNext(); }
function ssStop(){ clearTimeout(ssT); ssT=null; ssOn=false; ssGen++; }
function renderPhotos(v){ if(!PH.list.length){ screen.classList.remove("photos"); ssStop(); v.append(el("div","phempty",`<div class="big">🖼️</div><h2>No family pictures yet</h2><p>On a phone: open this page, tap 🔒 → Photos → Add pictures. Then tap 🎞️ any time for the slideshow.</p>`)); return; }
  screen.classList.add("photos"); if(!ssOn) ssStart(true); }
function shrinkImage(file,max=1920,q=.85){ return new Promise((res,rej)=>{ const url=URL.createObjectURL(file); const im=new Image(); im.onload=()=>{ const sc=Math.min(1,max/Math.max(im.naturalWidth,im.naturalHeight)); const c=document.createElement("canvas"); c.width=Math.round(im.naturalWidth*sc); c.height=Math.round(im.naturalHeight*sc); c.getContext("2d").drawImage(im,0,0,c.width,c.height); URL.revokeObjectURL(url); c.toBlob(b=>b?res(b):rej(new Error("could not encode")),"image/jpeg",q); }; im.onerror=()=>{ URL.revokeObjectURL(url); rej(new Error("can't read "+(file.name||"file"))); }; im.src=url; }); }
async function uploadPhoto(file){ const blob=await shrinkImage(file); const r=await fetch("/api/photos",{method:"POST",headers:{"Content-Type":"image/jpeg","X-Name":encodeURIComponent(file.name||"")},body:blob}); if(!r.ok) throw new Error("server "+r.status); return r.json(); }

// ---------- money: family goals · monthly budget · kids' investments (all entered in Parents → Money, shared state) ----------
const money = () => { if(!S.money||typeof S.money!=="object") S.money={}; S.money.goals=S.money.goals||[]; S.money.budget=S.money.budget||[]; S.money.invest=S.money.invest||{}; return S.money; };
const usd = n => "$"+Math.round(+n||0).toLocaleString("en-US");
const fmtShort = d0 => { const d=parse(d0); return `${MON[d.getMonth()].slice(0,3)} ${d.getDate()}${d.getFullYear()!==now().getFullYear()?" "+d.getFullYear():""}`; };
function sparkline(vals, color, w=320, h=90){ if(vals.length<2) return ""; const mn=Math.min(...vals), mx=Math.max(...vals), sp=(mx-mn)||1;
  const pts=vals.map((v,i)=>[4+(i/(vals.length-1))*(w-8), h-8-((v-mn)/sp)*(h-18)]); const line=pts.map(p=>p.map(x=>x.toFixed(1)).join(",")).join(" "); const last=pts[pts.length-1];
  return `<svg class="spark" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none"><polygon points="${pts[0][0]},${h} ${line} ${last[0]},${h}" fill="${color}" opacity=".14"/><polyline points="${line}" fill="none" stroke="${color}" stroke-width="4" stroke-linejoin="round" stroke-linecap="round"/><circle cx="${last[0]}" cy="${last[1]}" r="7" fill="${color}"/></svg>`; }
function renderMoney(v){
  moneyCleanup=window.HubMoney.render(v,{kids:SEED.kids,avatars:S.avatars||{},money:money()});
}

// ---------- PIN + parents ----------
function pin(onOk, title="Parents"){
  const ov=el("div","overlay"); const m=el("div","modal"); let code="";
  const dots=el("div","dots"); const draw=()=>{ dots.textContent="●".repeat(code.length)+"○".repeat(4-code.length); };
  m.append(el("h2",null,title), el("div","sub","Enter the parent PIN"), dots);
  const kp=el("div","kp"); for (const k of ["1","2","3","4","5","6","7","8","9","","0","⌫"]){ const b=el("button",null,k); if(!k) b.style.visibility="hidden";
    b.onclick=()=>{ if(k==="⌫") code=code.slice(0,-1); else if(code.length<4) code+=k; draw(); if(code.length===4){ if(code===SEED.settings.pin){ ov.remove(); onOk(); } else { code=""; draw(); m.classList.add("shake"); setTimeout(()=>m.classList.remove("shake"),400); } } };
    kp.append(b); }
  const cancel=el("button","btn ghost","Cancel"); cancel.onclick=()=>ov.remove(); m.append(kp,cancel); ov.append(m); draw(); screen.append(ov);
}
function openParent(){
  const ov=el("div","overlay"); const m=el("div","modal wide"); let tab=Q.get("ptab")||"school"; let ckid=Q.get("pkid")||SEED.kids[0].id;
  const prow=(label)=>{ const r=el("div","prow"); r.innerHTML=`<span class="lb">${label}</span>`; return r; };
  const draw=()=>{ m.innerHTML=""; const hd=el("div","mhead"); hd.append(el("h2",null,"Parents"));
    const tabs=el("div","ptabs"); for (const [k,l] of [["school","Today's school"],["chores","Chore chart"],["bonus","Bonus hours"],["goal","Family goal"],["verse","Verse"],["avatars","Avatars"],["screen","Screen & sound"],["photos","Photos"],["money","Money"],["prices","Rewards"],["redeem","Redemptions"],["reset","Reset"]]){ const b=el("button",k===tab?"on":"",l); b.onclick=()=>{tab=k;draw();}; tabs.append(b); } hd.append(tabs);
    const close=el("button","navbtn mclose","Done"); close.onclick=()=>{ov.remove();render();}; hd.append(close); m.append(hd);
    const body=el("div","mbody"); m.append(body); const mAppend=m.append.bind(m); m.append=(...a)=>body.append(...a);
    S.settings=S.settings||{};
    const num=(label,key,min,max,unit)=>{ const r=prow(label); const i=el("input"); i.type="number"; i.min=min; i.max=max; i.value=setting(key); i.oninput=()=>{ const v=+i.value; if(v>=min&&v<=max){ S.settings[key]=v; save(); bump(); } }; r.append(i, el("span","st",unit)); m.append(r); };
    const armed=(btn,label,fn)=>{ btn.onclick=()=>{ if(btn.dataset.armed){ btn.dataset.armed=""; btn.textContent=label; fn(); } else { btn.dataset.armed="1"; btn.textContent="Sure?"; setTimeout(()=>{btn.dataset.armed="";btn.textContent=label;},2500); } }; return btn; };
    if (tab==="school"){ m.append(el("div","sub","What each kid's School task means today."));
      for (const k of SEED.kids){ const r=prow(`<b>${k.name}</b>`); const i=el("input","wide"); i.value=S.schoolToday[k.id]||""; i.oninput=()=>{S.schoolToday[k.id]=i.value;save();}; r.append(i); m.append(r);} }
    if (tab==="chores"){ m.append(el("div","sub","Each kid's chart. Changes show on the wall right away; points already earned stay."));
      const kp=el("div","kidpills"); for (const k of SEED.kids){ const b=el("button",k.id===ckid?"on":"",k.name); b.style.setProperty("--kc",k.color); b.onclick=()=>{ckid=k.id;draw();}; kp.append(b); } m.append(kp);
      const list=editableChores(ckid); const KINDS=[["base","Do these first"],["anytime","Any time"],["daily","Extra today"],["weekly","Weekly"],["weeklyfree","Weekly · never locked"]];
      const kindOf=c => c.kind==="base"?"base" : c.kind==="weekly" ? (c.ungated?"weeklyfree":"weekly") : (c.ungated?"anytime":"daily");
      const setKind=(c,v)=>{ if(v==="base"){c.kind="base";delete c.ungated;} else if(v==="anytime"){c.kind="daily";c.ungated=true;} else if(v==="daily"){c.kind="daily";delete c.ungated;} else if(v==="weekly"){c.kind="weekly";delete c.ungated;} else {c.kind="weekly";c.ungated=true;} };
      const hdr=el("div","cedit chead"); hdr.innerHTML='<span>Icon</span><span>Chore</span><span>Section</span><span>Points</span><span></span>'; m.append(hdr);
      list.forEach((c,i)=>{ const r=el("div","cedit");
        const ic=el("input","ic"); ic.value=c.icon||""; ic.maxLength=4; ic.oninput=()=>{c.icon=ic.value;save();};
        const lb=el("input","lb"); lb.value=c.label; lb.placeholder="Chore name"; lb.oninput=()=>{c.label=lb.value;save();};
        const kd=el("select"); KINDS.forEach(([v,l])=>kd.append(new Option(l,v))); kd.value=kindOf(c); kd.onchange=()=>{setKind(c,kd.value);save();draw();};
        const pw=el("select","pw"); [1,2,3,4,5,6,7].forEach(n=>pw.append(new Option(n===1?"once a week":`up to ${n}× a week`,n))); pw.value=weeklyCap(c); pw.onchange=()=>{ c.perWeek=+pw.value; if(c.perWeek<=1) delete c.perWeek; save(); };
        const kcell=el("div","kcell"); kcell.append(kd); if(c.kind==="weekly") kcell.append(pw);
        const st=el("div","stepper"); const minus=el("button",null,"−"), val=el("span",null,c.pts), plus=el("button",null,"+"); val.style.cssText="width:48px;text-align:center;font-weight:700";
        minus.onclick=()=>{c.pts=Math.max(0,c.pts-5);save();val.textContent=c.pts;}; plus.onclick=()=>{c.pts+=5;save();val.textContent=c.pts;}; st.append(minus,val,plus);
        const ops=el("div","ops"); const up=el("button",null,"↑"), dn=el("button",null,"↓"), rm=el("button","rm","✕");
        up.disabled=i===0; dn.disabled=i===list.length-1; up.onclick=()=>{[list[i-1],list[i]]=[list[i],list[i-1]];save();draw();}; dn.onclick=()=>{[list[i+1],list[i]]=[list[i],list[i+1]];save();draw();};
        rm.onclick=()=>{ if(rm.dataset.armed){ list.splice(i,1); save(); draw(); } else { rm.dataset.armed="1"; rm.textContent="Remove?"; setTimeout(()=>{rm.dataset.armed="";rm.textContent="✕";},2500);} };
        ops.append(up,dn,rm); r.append(ic,lb,kcell,st,ops); m.append(r); });
      const foot=el("div","cfootbar");
      const add=el("button","btn","+ Add chore"); add.onclick=()=>{ list.push({id:"c"+Date.now().toString(36),label:"",kind:"daily",pts:5,icon:"⭐",capPerDay:1}); save(); draw(); setTimeout(()=>{ const ins=m.querySelectorAll(".cedit input.lb"); ins[ins.length-1]&&ins[ins.length-1].focus(); },0); };
      const cp=el("select"); cp.append(new Option("Copy this chart to…","")); SEED.kids.filter(k=>k.id!==ckid).forEach(k=>cp.append(new Option(k.name,k.id))); cp.onchange=()=>{ if(!cp.value) return; S.chores[cp.value]=JSON.parse(JSON.stringify(list)); save(); toast(`Copied to ${kidById(cp.value).name}`); cp.value=""; };
      const rs=el("button","navbtn",`Reset ${kidById(ckid).name} to the acrylic chart`); rs.onclick=()=>{ delete S.chores[ckid]; save(); draw(); };
      foot.append(add,cp,rs); m.append(foot); }
    if (tab==="bonus"){ m.append(el("div","sub","Flag a chore for extra points until a time today. Kids see ⚡ on the row."));
      const todayK=iso(now()); const act=(S.bonus||[]).filter(b=>b.date===todayK);
      if (act.length){ for (const b of act){ const r=prow(`⚡ <b>${b.mult}×</b> ${(chore(b.kids==="all"?SEED.kids[0].id:b.kids[0],b.chore)||{}).label||b.chore} · ${b.kids==="all"?"all kids":b.kids.map(x=>kidById(x).name).join(", ")} · until ${fmtTime(b.until)}`); const x=el("button","navbtn","Remove"); x.onclick=()=>{S.bonus=S.bonus.filter(q=>q!==b);save();draw();}; r.append(x); m.append(r);} }
      const f=el("div","bonusform"); const who=el("select"); who.append(new Option("All kids","all")); SEED.kids.forEach(k=>who.append(new Option(k.name,k.id)));
      const ch=el("select"); const fill=()=>{ ch.innerHTML=""; const kid=who.value==="all"?SEED.kids[0].id:who.value; const seen=new Set(); (who.value==="all"?SEED.kids.flatMap(k=>chores(k.id)):chores(kid)).forEach(c=>{ if(!seen.has(c.id)){ seen.add(c.id); ch.append(new Option(`${c.icon} ${c.label}`,c.id)); } }); }; fill(); who.onchange=fill;
      const mult=el("select"); [2,3].forEach(x=>mult.append(new Option(`${x}× points`,x)));
      const until=el("select"); ["09:00","10:00","12:00","15:00","17:00","20:00","23:59"].forEach(t=>until.append(new Option(t==="23:59"?"end of day":`until ${fmtTime(t)}`,t)));
      const add=el("button","btn","Add bonus hour"); add.onclick=()=>{ S.bonus=S.bonus||[]; S.bonus.push({date:todayK,kids:who.value==="all"?"all":[who.value],chore:ch.value,mult:+mult.value,until:until.value}); save(); draw(); };
      f.append(who,ch,mult,until,add); m.append(f); }
    if (tab==="goal"){ m.append(el("div","sub","The shared weekly goal every kid's points count toward.")); const fg={...familyGoal()};
      const r1=prow("Reward"); const i=el("input","wide"); i.value=fg.label; i.oninput=()=>{ S.familyGoal={...familyGoal(),label:i.value}; save(); }; r1.append(i); m.append(r1);
      const r2=prow("Points needed"); const st=el("div","stepper"); const minus=el("button",null,"−"), val=el("span",null,fg.points), plus=el("button",null,"+"); val.style.cssText="width:90px;text-align:center;font-weight:700";
      minus.onclick=()=>{ S.familyGoal={...familyGoal(),points:Math.max(100,familyGoal().points-50)}; save(); val.textContent=familyGoal().points; }; plus.onclick=()=>{ S.familyGoal={...familyGoal(),points:familyGoal().points+50}; save(); val.textContent=familyGoal().points; };
      st.append(minus,val,plus); r2.append(st); m.append(r2); }
    if (tab==="verse"){ const wk=weekKey(now());
      m.append(el("div","sub","The plan: each passage runs in about 4 weekly parts (whole verses only), then the whole passage on week 5. It turns over every Monday."));
      const fmtD=d=>{ const x=parse(d); return `${DOW[x.getDay()]} ${x.getMonth()+1}/${x.getDate()}`; };
      for (const s of seriesList()){ const mine=(S.verseSeries||[]).some(x=>x.start===s.start); const ws=seriesWeeks(s);
        const hd=prow(`<b>${s.ref}</b>`); if(mine){ const del=el("button","navbtn","Remove"); del.onclick=()=>{ S.verseSeries=S.verseSeries.filter(x=>x.start!==s.start); save(); draw(); }; hd.append(del); } m.append(hd);
        ws.forEach((w,i)=>{ const d=iso(addDays(parse(s.start),7*i)); const r=prow(`${d===wk?"▶ ":""}${fmtD(d)} · ${w.whole?"Whole passage · ":""}${w.ref}`); if(d===wk) r.style.fontWeight="700"; m.append(r); }); }
      const last=seriesList().slice(-1)[0]; const nextStart=last?iso(addDays(parse(last.start),7*seriesWeeks(last).length)):weekKey(addDays(now(),7));
      m.append(el("div","sub","Add a passage (ESV text loads by itself)."));
      const f=el("div","bonusform"); const ref=el("input","wide"); ref.placeholder="e.g. Psalm 23:1-6"; const st=el("input"); st.type="date"; st.value=nextStart;
      const add=el("button","btn","Add passage"); add.onclick=async()=>{ const q=ref.value.trim(); if(!q) return; add.textContent="Loading…";
        try{ const r=await fetch("/api/verse-text?q="+encodeURIComponent(q)); const j=await r.json(); if(!j.verses||!j.verses.length) throw 0;
          S.verseSeries=[...(S.verseSeries||[]).filter(x=>x.start!==weekKey(parse(st.value))),{ref:j.ref,start:weekKey(parse(st.value)),verses:j.verses}]; save(); draw(); }
        catch{ add.textContent="Add passage"; toast("Couldn't load that passage"); } };
      f.append(ref,st,add); m.append(f);
      const vs={...verse()}; const ov=S.verse&&S.verse.wk===wk;
      m.append(el("div","sub",ov?"This week is overridden by hand.":"Override just this week (optional)."));
      const setOv=patch=>{ const b=verse(); S.verse={ref:b.ref,text:b.text,version:b.version,pts:b.pts,...(ov?S.verse:{}),...patch,wk}; save(); };
      const r1=prow("Reference"); const a=el("input","wide"); a.value=vs.ref; a.onchange=()=>{setOv({ref:a.value}); draw();}; r1.append(a); m.append(r1);
      const r2=prow("Text"); const t=el("textarea","wide"); t.value=vs.text; t.rows=3; t.onchange=()=>{setOv({text:t.value}); draw();}; r2.append(t); m.append(r2);
      if(ov){ const back=el("button","btn","Back to the plan"); back.onclick=()=>{ S.verse=null; save(); draw(); }; m.append(back); } }
    if (tab==="avatars"){ m.append(el("div","sub","Pick each kid's icon. Tap the letter to go back to initials.")); S.avatars=S.avatars||{};
      for (const k of SEED.kids){ const r=prow(`<b>${k.name}</b>`); const a=avNode(k.id); a.style.setProperty("--kc",k.color); a.style.background=k.color; r.prepend(a); m.append(r);
        const g=el("div","avgrid"); const cur=avatarOf(k.id); const b0=el("button",cur?"":"on",k.name[0]); b0.style.fontWeight="800"; b0.onclick=()=>{ delete S.avatars[k.id]; save(); draw(); }; g.append(b0);
        for (const e of SEED.avatarChoices){ const b=el("button",cur===e?"on":"",e); b.onclick=()=>{ S.avatars[k.id]=e; save(); draw(); }; g.append(b); } m.append(g); }
    }
    if (tab==="screen"){ m.append(el("div","sub","Wall volume, brightness and sleep. Changes save as you go."));
      const slider=(label,key,min,max,apply)=>{ const r=prow(label); const i=el("input"); i.type="range"; i.min=min; i.max=max; i.value=setting(key)??max; const val=el("span","st",i.value+"%"); let t;
        i.oninput=()=>{ val.textContent=i.value+"%"; S.settings[key]=+i.value; save(); clearTimeout(t); t=setTimeout(()=>apply(+i.value),250); }; r.append(i,val); m.append(r); return i; };
      const lr=prow("Look"); const lp=el("div","lookpick"); for (const [id,ic,l] of THEMES){ const b=el("button",id===themeId()?"on":"",ic+" "+l); b.onclick=()=>{ S.theme=id; save(); applyTheme(); draw(); }; lp.append(b); } lr.append(lp); m.append(lr);
      slider("Volume","volume",0,100,()=>chime("base"));
      const br=slider("Brightness","brightness",5,100,applyBrightness);
      const cs=prow("Calendars"); const csv=el("span","st", LIVE.events.length ? `live · ${LIVE.events.length} events · updated ${new Date(LIVE.at).toLocaleTimeString([],{hour:"numeric",minute:"2-digit"})}${LIVE.errors.length?" · "+LIVE.errors.join("; "):""}` : "not connected yet (showing the built-in list)"); const cb=el("button","navbtn","Refresh"); cb.onclick=()=>{ loadLive().then(draw); }; cs.append(csv,cb); m.append(cs);
      const cf=prow("Calendar shows"); const cfp=el("div","lookpick"); for (const [k,l] of CALF){ const b=el("button",k===calFilter()?"on":"",l); b.onclick=()=>{ S.settings.calFilter=k; save(); draw(); }; cfp.append(b); } cf.append(cfp, el("span","st","Family = hides Dad's work calendars")); m.append(cf);
      const st=prow("Wall controls"); const stv=el("span","st","checking…"); st.append(stv); m.append(st);
      wall("status").then(j=>{ stv.textContent=`connected · backlight ${j.brightness}% · system volume ${j.volume}%`; if(S.settings.brightness==null&&j.brightness){ br.value=j.brightness; br.nextSibling.textContent=j.brightness+"%"; } }).catch(()=>{ stv.textContent="not reachable (brightness falls back to a software dim)"; });
      num("Back to calendar after","idleMinutes",1,120,"min"); num("Art mode after","artMinutes",1,120,"min");
      const time=(label,key)=>{ const r=prow(label); const i=el("input","tm"); i.type="time"; i.value=setting(key)||""; i.onchange=()=>{ S.settings[key]=i.value; save(); bump(); }; r.append(i); m.append(r); };
      time("Screen off from","quietStart"); time("Screen back on at","quietEnd");
      const sr=prow("Chimes"); const sb=el("button","navbtn",S.sound===false?"Off":"On"); sb.onclick=()=>{ S.sound=S.sound===false?true:false; save(); draw(); }; sr.append(sb); m.append(sr); }
    if (tab==="photos"){ m.append(el("div","sub","Family pictures for the slideshow (🎞️ in the top bar) and the Photos tab. Add them from a phone: open this page, tap 🔒, Photos, Add. Pictures are shrunk before upload."));
      const mode=prow("Sleep screen"); const mp=el("div","lookpick"); for (const [id,l] of [["verse","Memory verse"],["photos","Photos"],["art","Calendar art"]]){ const b=el("button",sleepChoice()===id?"on":"",l); b.onclick=()=>{ S.settings.sleepScreen=id; save(); draw(); }; mp.append(b); } mode.append(mp, el("span","st","🎞️ plays pictures any time")); m.append(mode);
      num("Seconds per picture","photoSeconds",5,600,"sec");
      const ar=prow("Add pictures"); const inp=el("input"); inp.type="file"; inp.accept="image/*"; inp.multiple=true; const prog=el("span","st","");
      inp.onchange=async()=>{ const files=[...inp.files]; let n=0, ok=0; for (const f of files){ prog.textContent=`uploading ${++n} of ${files.length}…`; try{ const j=await uploadPhoto(f); if(j&&j.id&&!PH.list.some(q=>q.id===j.id)) PH.list.push({id:j.id,added:Date.now(),name:f.name||""}); ok++; }catch(e){ toast("Upload failed: "+e.message); } } prog.textContent=ok?`added ${ok}`:""; PH.at=Date.now(); try{ localStorage.setItem("hub.photos.v1",JSON.stringify(PH)); }catch{} ssOrder=[]; draw(); }; /* optimistic: KV listing lags */
      ar.append(inp,prog); m.append(ar);
      const g=el("div","phgrid"); for (const p of PH.list){ const c=el("div","ph"); c.style.backgroundImage=`url("${photoUrl(p)}")`; const x=armed(el("button","rm","✕"),"✕",async()=>{ try{ await fetch(photoUrl(p),{method:"DELETE"}); }catch{} PH.list=PH.list.filter(q=>q.id!==p.id); PH.at=Date.now(); try{ localStorage.setItem("hub.photos.v1",JSON.stringify(PH)); }catch{} ssOrder=[]; draw(); }); /* KV reads lag ~60 s, so drop it locally instead of re-listing */ c.append(x); g.append(c); }
      m.append(g); if(!PH.list.length) m.append(prow("No pictures yet.")); }
    if (tab==="money"){ const M=money(); m.append(el("div","sub","What the Money tab shows: family goals, this month's budget, and a balance history per kid. Numbers save as you type."));
      const numIn=(obj,key)=>{ const i=el("input","num"); i.type="number"; i.inputMode="decimal"; i.value=obj[key]??""; i.oninput=()=>{ obj[key]=i.value===""?0:+i.value; save(); }; return i; };
      const txtIn=(obj,key,ph,cls="lb")=>{ const i=el("input",cls); i.value=obj[key]||""; i.placeholder=ph; i.oninput=()=>{ obj[key]=i.value; save(); }; return i; };
      const rmBtn=(list,i)=>armed(el("button","rm","✕"),"✕",()=>{ list.splice(i,1); save(); draw(); });
      m.append(el("h3","msub","🎯 Family money goals"));
      const gh=el("div","cedit medit chead"); gh.innerHTML="<span>Icon</span><span>Goal</span><span>Saved $</span><span>Target $</span><span>By when</span><span></span>"; m.append(gh);
      M.goals.forEach((g,i)=>{ const r=el("div","cedit medit"); const ops=el("div","ops"); ops.append(rmBtn(M.goals,i)); r.append(txtIn(g,"icon","🎯","ic"),txtIn(g,"label","e.g. Disney trip"),numIn(g,"saved"),numIn(g,"target"),txtIn(g,"by","e.g. June","by"),ops); m.append(r); });
      const ga=el("button","navbtn","+ Add goal"); ga.onclick=()=>{ M.goals.push({id:"g"+Date.now().toString(36),icon:"🎯",label:"",saved:0,target:1000,by:""}); save(); draw(); }; m.append(ga);
      m.append(el("h3","msub","🧾 Budget this month"));
      const bh=el("div","cedit medit chead"); bh.innerHTML="<span>Icon</span><span>Category</span><span>Spent $</span><span>Planned $</span><span></span><span></span>"; m.append(bh);
      M.budget.forEach((b,i)=>{ const r=el("div","cedit medit"); const ops=el("div","ops"); ops.append(rmBtn(M.budget,i)); r.append(txtIn(b,"icon","💵","ic"),txtIn(b,"label","e.g. Groceries"),numIn(b,"spent"),numIn(b,"planned"),el("span"),ops); m.append(r); });
      const bf=el("div","cfootbar"); const ba=el("button","navbtn","+ Add category"); ba.onclick=()=>{ M.budget.push({id:"b"+Date.now().toString(36),icon:"💵",label:"",planned:0,spent:0}); save(); draw(); };
      const bz=armed(el("button","navbtn","New month: zero out spent"),"New month: zero out spent",()=>{ M.budget.forEach(b=>b.spent=0); save(); draw(); }); bf.append(ba,bz); m.append(bf);
      m.append(el("h3","msub","📈 Kids' investments"));
      const kp=el("div","kidpills"); for (const k of SEED.kids){ const b=el("button",k.id===ckid?"on":"",k.name); b.style.setProperty("--kc",k.color); b.onclick=()=>{ckid=k.id;draw();}; kp.append(b); } m.append(kp);
      const rows=M.invest[ckid]=M.invest[ckid]||[]; rows.sort((a,b)=>a.date<b.date?-1:1);
      const sheetRows=rows.filter(e=>e.note==="sheet"); if(sheetRows.length){ const lastS=sheetRows[sheetRows.length-1]; m.append(el("div","sub",`${sheetRows.length} monthly balances come from the ${(M.investSource||{}).label||"finances sheet"} (latest ${fmtShort(lastS.date)}: ${usd(lastS.value)}) and refresh nightly — edit those in the sheet. Rows you add here are kept.`)); }
      const ih=el("div","cedit iedit chead"); ih.innerHTML="<span>Date</span><span>Balance $</span><span>Note</span><span></span>"; m.append(ih);
      rows.forEach((e,i)=>{ if(e.note==="sheet") return; const r=el("div","cedit iedit"); const d=el("input"); d.type="date"; d.value=e.date; d.onchange=()=>{ e.date=d.value; save(); draw(); }; const ops=el("div","ops"); ops.append(rmBtn(rows,i)); r.append(d,numIn(e,"value"),txtIn(e,"note","optional"),ops); m.append(r); });
      const ia=el("button","navbtn",`+ Add a balance for ${kidById(ckid).name}`); ia.onclick=()=>{ const last=rows[rows.length-1]; rows.push({date:iso(now()),value:last?+last.value:0,note:""}); save(); draw(); }; m.append(ia); }
    if (tab==="prices"){ m.append(el("div","sub","Under each reward, tap who can earn it: Anyone, or just certain kids."));
      const list=editableRewards();
      const hdr=el("div","cedit redit chead"); hdr.innerHTML='<span>Icon</span><span>Reward</span><span>Cost</span><span></span>'; m.append(hdr);
      list.forEach((r,i)=>{ const row=el("div","cedit redit");
        const ic=el("input","ic"); ic.value=r.icon||""; ic.maxLength=4; ic.oninput=()=>{r.icon=ic.value;save();};
        const lb=el("input","lb"); lb.value=r.label; lb.placeholder="Reward"; lb.oninput=()=>{r.label=lb.value;save();};
        const st=el("div","stepper"); const minus=el("button",null,"−"), val=el("span",null,price(r)), plus=el("button",null,"+"); val.style.cssText="width:56px;text-align:center;font-weight:700";
        minus.onclick=()=>{r.cost=Math.max(5,price(r)-5);delete S.prices[r.id];save();val.textContent=price(r);}; plus.onclick=()=>{r.cost=price(r)+5;delete S.prices[r.id];save();val.textContent=price(r);}; st.append(minus,val,plus);
        const ops=el("div","ops"); const up=el("button",null,"↑"), dn=el("button",null,"↓"), rm=el("button","rm","✕");
        up.disabled=i===0; dn.disabled=i===list.length-1; up.onclick=()=>{[list[i-1],list[i]]=[list[i],list[i-1]];save();draw();}; dn.onclick=()=>{[list[i+1],list[i]]=[list[i],list[i+1]];save();draw();};
        rm.onclick=()=>{ if(rm.dataset.armed){ list.splice(i,1); save(); draw(); } else { rm.dataset.armed="1"; rm.textContent="Remove?"; setTimeout(()=>{rm.dataset.armed="";rm.textContent="✕";},2500);} };
        ops.append(up,dn,rm); row.append(ic,lb,st,ops); m.append(row);
        const who=el("div","rwho"); const all=el("button",(!r.kids||!r.kids.length)?"on":"","Anyone"); all.onclick=()=>{ delete r.kids; save(); draw(); }; who.append(all);
        for (const k of SEED.kids){ const b=el("button",(r.kids||[]).includes(k.id)?"on":"",k.name); b.style.setProperty("--kc",k.color); b.onclick=()=>{ const set=new Set(r.kids||[]); set.has(k.id)?set.delete(k.id):set.add(k.id); r.kids=[...set]; if(!r.kids.length) delete r.kids; save(); draw(); }; who.append(b); }
        m.append(who); });
      const foot=el("div","cfootbar");
      const add=el("button","btn","+ Add reward"); add.onclick=()=>{ list.push({id:"r"+Date.now().toString(36),label:"",cost:50,icon:"🎁"}); save(); draw(); setTimeout(()=>{ const ins=m.querySelectorAll(".redit input.lb"); ins[ins.length-1]&&ins[ins.length-1].focus(); },0); };
      const rs=el("button","navbtn","Reset to the starter list"); rs.onclick=()=>{ delete S.rewards; S.prices={}; save(); draw(); };
      foot.append(add,rs); m.append(foot); }
    if (tab==="redeem"){ m.append(el("div","sub","Recent redemptions. Tap to undo.")); if(!S.redemptions.length) m.append(prow("Nothing redeemed yet."));
      [...S.redemptions].reverse().slice(0,10).forEach(x=>{ const rw=rewards().find(q=>q.id===x.reward); const r=prow(`${kidById(x.kid).name} · ${rw?rw.label:x.reward} · ${x.cost} pts`); const u=el("button","navbtn","Undo"); u.onclick=()=>{S.redemptions=S.redemptions.filter(q=>q!==x);save();draw();}; r.append(u); m.append(r); }); }
    if (tab==="reset"){ m.append(el("div","sub","Wipe this device's prototype data back to the seed.")); const b=el("button","btn","Reset all data"); b.onclick=()=>{resetState();ov.remove();render();toast("Reset");}; m.append(b); }
    m.append=mAppend; };
  draw(); ov.append(m); ov.classList.add("top"); screen.append(ov);
}

// ---------- boot ----------
screen.addEventListener("pointerdown", bump, true); document.addEventListener("keydown", bump);
{ const v0=Q.get("view"); if(v0){ const [n,k]=v0.split(":"); if(n==="kid") view={...view,section:"chores",kid:k}; if(n==="shop") view={...view,section:"chores",shop:true}; if(n==="cal") view.cal=k; if(["chores","meals","verse","photos","money","plans"].includes(n)) view.section=n; if(n==="parents") setTimeout(openParent,50); } if(Q.get("mode")) view.kidMode=Q.get("mode"); }
applyTheme(); render(); bump(); loadLive(); setInterval(loadLive, 10*60000); loadWeather(); setInterval(loadWeather, 15*60000); addEventListener("online",loadWeather); loadPhotos(); setInterval(loadPhotos, 10*60000); pullState(true); setInterval(pullState, 30000);
// 10/21: pick up new deploys on their own — the wall has no keyboard. Poll the asset ETags; reload when one changes and nobody's mid-tap.
const ASSETS=["app.js","app.css","data.js","money-view.js","money-view.css","money-history.js"]; let assetTags=null;
async function checkDeploy(){ try{ const t=(await Promise.all(ASSETS.map(a=>fetch(a,{method:"HEAD",cache:"no-store"}).then(r=>r.headers.get("etag")||"")))).join("|"); if(!t.replace(/\|/g,"")) return;
  if(assetTags===null) assetTags=t; else if(t!==assetTags && !editing() && Date.now()-lastTouch>60000) location.reload(); }catch(e){} }
checkDeploy(); setInterval(checkDeploy, 5*60000); if (Q.get("view")==="art") artOn();
try{ if(localStorage.getItem("hub.ss.on")==="1") setTimeout(()=>{ if(PH.list.length) slideshowNow(true); },1500); }catch{}   // slideshow survives deploy reloads + the 4 AM reboot
if (setting("brightness")!=null) setTimeout(()=>applyBrightness(setting("brightness")),12000);
addEventListener("resize", ()=>render());
window.HUB = { go, render, resetState, state:()=>S, parents:openParent };
})();
