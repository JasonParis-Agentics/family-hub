/* Family Money: local presentation state; financial records remain in the host state. */
(() => {
  'use strict';
  const RATE = 0.0075;
  // per kid in data.js: dob (YYYY-MM-DD, drives the age-18 projection), investFrom (hide history before this date), icon
  const KIDS_SEED = (window.HUB_SEED && window.HUB_SEED.kids) || [];
  const pick = key => Object.fromEntries(KIDS_SEED.filter(k=>k[key]).map(k=>[k.id,k[key]]));
  const DOB = pick('dob'), CUTOFF = pick('investFrom'), ICONS = pick('icon');
  const state = {selected:null,early:false,years:5,pointTime:null};
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const dollars = value => new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',maximumFractionDigits:0}).format(value);
  const stamp = date => Date.parse(date+'T00:00:00Z');
  const iso = time => new Date(time).toISOString().slice(0,10);
  const month = date => new Intl.DateTimeFormat('en-US',{month:'short',year:'numeric',timeZone:'UTC'}).format(new Date(stamp(date)));
  const fullDate = date => new Intl.DateTimeFormat('en-US',{month:'long',day:'numeric',year:'numeric',timeZone:'UTC'}).format(new Date(stamp(date)));
  const monthEnd = date => {const [y,m] = date.split('-').map(Number); return iso(Date.UTC(y,m,0));};
  const path = points => points.map((p,i)=>(i?'L':'M')+p[0].toFixed(2)+','+p[1].toFixed(2)).join(' ');
  const nearest = (points,time) => points.reduce((best,p,i)=>Math.abs(p.t-time)<Math.abs(points[best].t-time)?i:best,0);
  function validRows(rows) {
    return (Array.isArray(rows)?rows:[]).filter(r=>r&&/^\d{4}-\d{2}-\d{2}$/.test(r.date)&&Number.isFinite(Number(r.value))&&Number(r.value)>=0&&!Number.isNaN(stamp(r.date)));
  }
  function historyFor(id,money) {
    const shared=validRows(money?.invest?.[id]), packaged=validRows(window.HUB_MONEY_HISTORY?.invest?.[id]);
    const latest = rows => rows.reduce((date,row)=>row.date>date?row.date:date,'');
    const sheetRows=shared.filter(r=>r.note==='sheet');
    const fresh=latest(sheetRows.length?sheetRows:shared)>=latest(packaged);
    // An outdated shared sheet must not hide the corrected monthly snapshot. Manual entries survive.
    const source=fresh?shared:[...packaged,...shared.filter(r=>r.note!=='sheet')];
    const byDate=new Map();
    for(const row of source){
      const date=row.note==='sheet'?monthEnd(row.date):row.date;
      byDate.set(date,{date,t:stamp(date),balance:Number(row.value),kind:'recorded',added:row.note==='deposit'?Number(row.added)||0:0});
    }
    return [...byDate.values()].sort((a,b)=>a.t-b.t);
  }
  function forecast(id,start) {
    if(!DOB[id]||!start)return null;
    const birthday=DOB[id].replace(/^\d{4}/,year=>String(Number(year)+18));
    const end=stamp(birthday),begin=start.t;
    const monthly=[{...start,kind:'current'}],curve=[{t:begin,balance:start.balance}];
    if(end<=begin)return {birthday,monthly,curve,endBalance:start.balance,already18:true};
    let cursor=begin,balance=start.balance;
    while(cursor<end){
      const d=new Date(cursor);
      let nextMonthEnd=Date.UTC(d.getUTCFullYear(),d.getUTCMonth()+1,0);
      if(nextMonthEnd<=cursor)nextMonthEnd=Date.UTC(d.getUTCFullYear(),d.getUTCMonth()+2,0);
      const previousMonthEnd=Date.UTC(new Date(nextMonthEnd).getUTCFullYear(),new Date(nextMonthEnd).getUTCMonth(),0);
      const next=Math.min(nextMonthEnd,end);
      const fraction=(next-cursor)/(nextMonthEnd-previousMonthEnd);
      const after=balance*Math.pow(1+RATE,fraction);
      for(let step=1;step<=8;step++)curve.push({t:cursor+(next-cursor)*step/8,balance:balance*Math.pow(1+RATE,fraction*step/8)});
      monthly.push({t:next,date:iso(next),balance:after,kind:'projected'});
      cursor=next;balance=after;
    }
    return {birthday,monthly,curve,endBalance:balance,already18:false};
  }
  function render(container,{kids=[],avatars={},money={}}={}) {
    const root=document.createElement('section');root.className='fm-root';root.setAttribute('aria-label','Family Money');container.append(root);
    const abort=new AbortController();let observer=null,plot=null,points=[],record=null,projection=null,dead=false;
    const query=s=>root.querySelector(s);
    const person=id=>kids.find(k=>k.id===id);
    const color=k=>/^#[0-9a-f]{3,8}$/i.test(k?.color||'')?k.color:'var(--ink)';
    const avatar=k=>`<span class="fm-avatar" aria-hidden="true">${esc(avatars[k.id]||ICONS[k.id]||k.emoji||k.name.slice(0,1))}</span>`;
    const entry=k=>`<button type="button" class="fm-entry" data-open="${esc(k.id)}" style="--fm-person:${color(k)}" aria-label="Open ${esc(k.name)}’s money page">${avatar(k)}<strong>${esc(k.name)}</strong><span>Open my money</span></button>`;
    const familyEntry=()=>'<button type="button" class="fm-entry fm-family-entry" data-open="family" aria-label="Open the Family money page"><span class="fm-avatar" aria-hidden="true">🏡</span><strong>Family</strong><span>Plan together</span></button>';
    function build(focus=false) {
      observer?.disconnect();plot=null;
      const kid=person(state.selected);
      if(!kid&&state.selected!=='family')state.selected=null;
      root.className='fm-root '+(kid?'fm-profile':state.selected==='family'?'fm-family':'fm-home');
      if(!state.selected){
        root.innerHTML=`<div class="fm-overview"><section class="fm-playground" aria-labelledby="fm-play-title"><div class="fm-play-copy"><span class="fm-eyebrow">A LITTLE EXPERIMENT</span><h2 id="fm-play-title">What can time do?</h2><p>Start with $100. Give it time to grow.</p><div class="fm-example-result"><strong data-example-value></strong><span data-example-period></span></div><div class="fm-year-control"><div class="fm-year-presets" aria-label="Example years">${[1,5,10,15,20].map(n=>`<button type="button" data-years="${n}">${n} ${n===1?'year':'years'}</button>`).join('')}</div><div class="fm-year-stepper"><button type="button" data-action="less" aria-label="One fewer year">−</button><strong data-years-label aria-live="polite"></strong><button type="button" data-action="more" aria-label="One more year">+</button></div></div><p class="fm-assumption">Example · 0.75% monthly (≈9.38% yearly)<br> No additional deposits or withdrawals</p></div><div class="fm-example-chart" data-chart></div></section><div class="fm-picker-heading"><h2>Now explore your own money</h2><span>Choose your page</span></div><nav class="fm-entry-grid" aria-label="Money pages">${kids.map(entry).join('')}${familyEntry()}</nav></div>`;
        drawExample();
      }else if(state.selected==='family'){
        root.innerHTML=`<div class="fm-family-page"><button type="button" class="fm-back" data-open="overview">‹ All money pages</button><section class="fm-family-placeholder"><span class="fm-family-symbol" aria-hidden="true">🏡</span><h2>Family money</h2><p>A place to plan together.</p><div class="fm-family-topics"><span>Personal financial statement</span><span>Family budget</span></div><p class="fm-muted">Coming next</p></section></div>`;
      }else{
        record=historyFor(kid.id,money);projection=forecast(kid.id,record.at(-1));
        root.style.setProperty('--fm-person',color(kid));
        root.innerHTML=`<div class="fm-profile-layout"><div class="fm-profile-main"><button type="button" class="fm-back" data-open="overview">‹ All money pages</button><div class="fm-child-summary">${avatar(kid)}<div><h2>${esc(kid.name)}’s money</h2><p>Growing toward age 18</p></div>${record.length?`<div class="fm-current"><strong>${dollars(record.at(-1).balance)}</strong><span>Recorded · ${month(record.at(-1).date)}</span></div>`:''}</div>${record.length&&projection?`<section class="fm-timeline-panel" aria-label="Recorded balances and projection"><div class="fm-chart-heading"><div><h3>Growth to age 18</h3><p>Tap the line to explore a month.</p></div><div class="fm-selected-value" data-selected-value></div></div><div class="fm-chart-options"><button type="button" class="fm-early-toggle" data-action="early" aria-pressed="${state.early}"><span class="fm-switch" aria-hidden="true"></span>Show early history</button><span data-cutoff class="fm-muted"></span></div><div class="fm-timeline-chart" data-chart tabindex="0" role="group" aria-label="Money timeline. Tap a month or use left and right arrow keys."></div><div class="fm-legend"><span><i></i>Recorded</span><span><i class="fm-dashed"></i>Projected</span><span>0.75% monthly · No added or withdrawn money</span></div><div class="fm-explore-controls"><button type="button" data-action="previous" aria-label="Previous month">‹ <span>Previous month</span></button><div class="fm-period" data-selected-period aria-live="polite"></div><button type="button" data-action="next" aria-label="Next month"><span>Next month</span> ›</button><div class="fm-jump-buttons"><button type="button" data-action="today">Today</button><button type="button" data-action="age18">Age 18</button></div></div><p class="fm-selection-status" data-selected-status></p><div class="fm-projection-note"><span>18th birthday · ${fullDate(projection.birthday)}</span><span>≈9.38% effective yearly · Includes partial-month growth.</span></div></section>`:'<div class="fm-empty">No recorded balances yet.</div>'}</div><nav class="fm-sibling-rail" aria-label="Money pages">${kids.map(k=>`<button type="button" class="fm-sibling" data-open="${esc(k.id)}" style="--fm-person:${color(k)}" aria-pressed="${k.id===kid.id}" aria-label="${esc(k.name)}’s money page">${avatar(k)}<strong>${esc(k.name)}</strong></button>`).join('')}<button type="button" class="fm-sibling fm-family-sibling" data-open="family"><span class="fm-avatar" aria-hidden="true">🏡</span><strong>Family</strong></button></nav></div>`;
        if(record.length&&projection)drawTimeline();
      }
      const chart=query('[data-chart]');
      if(chart){observer=new ResizeObserver(()=>{if(!dead){if(state.selected)drawTimeline();else drawExample();}});observer.observe(chart);}
      if(focus)query('.fm-back, .fm-entry')?.focus({preventScroll:true});
    }
    function drawExample(){
      const chart=query('[data-chart]');if(!chart)return;
      const years=state.years,end=100*Math.pow(1+RATE,years*12);
      query('[data-example-value]').textContent=dollars(end);
      query('[data-example-period]').textContent=`after ${years} ${years===1?'year':'years'}`;
      query('[data-years-label]').textContent=`${years} ${years===1?'year':'years'}`;
      root.querySelectorAll('[data-years]').forEach(b=>b.setAttribute('aria-pressed',String(Number(b.dataset.years)===years)));
      query('[data-action="less"]').disabled=years<=1;query('[data-action="more"]').disabled=years>=30;
      const width=Math.max(200,chart.clientWidth),height=Math.max(200,chart.clientHeight),left=70,right=32,top=44,bottom=height-50;
      const max=Math.ceil(end*1.14/50)*50,x=m=>left+m/(years*12)*(width-left-right),y=v=>bottom-v/max*(bottom-top);
      const line=path(Array.from({length:years*12+1},(_,i)=>[x(i),y(100*Math.pow(1+RATE,i))]));
      chart.innerHTML=`<svg class="fm-chart-svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="An example $100 grows to ${dollars(end)} after ${years} years at 0.75 percent monthly, without new deposits or withdrawals."><text x="0" y="22">Balance (USD)</text>${[0,max/2,max].map(v=>`<line class="fm-grid" x1="${left}" x2="${width-right}" y1="${y(v)}" y2="${y(v)}"/><text x="${left-12}" y="${y(v)+6}" text-anchor="end">${dollars(v)}</text>`).join('')}<path class="fm-example-fill" d="${line} L${x(years*12)},${bottom} L${left},${bottom} Z"/><path class="fm-example-line" d="${line}"/><circle class="fm-example-dot" cx="${x(years*12)}" cy="${y(end)}" r="6"/><text x="${left}" y="${height-14}">Start · $100</text><text x="${width-right}" y="${height-14}" text-anchor="end">${years} ${years===1?'year':'years'}</text></svg>`;
    }
    function drawTimeline(){
      const chart=query('[data-chart]');if(!chart||!record?.length||!projection)return;
      let history=state.early?record:record.filter(p=>p.date>=(CUTOFF[state.selected]||record[0].date));
      if(!history.length)history=record.slice(-1);
      points=[...history.slice(0,-1),...projection.monthly];
      query('[data-cutoff]').textContent=state.early?'Full recorded history':`From ${month(history[0].date)}`;
      const width=Math.max(200,chart.clientWidth),height=Math.max(260,chart.clientHeight),left=80,right=24,top=54,bottom=height-44;
      const start=history[0].t,current=record.at(-1).t,end=Math.max(projection.monthly.at(-1).t,current+86400000);
      const lowest=Math.min(...history.map(p=>p.balance));
      const floor=state.early?0:Math.min(history[0].balance,lowest);
      const maximum=Math.max(...history.map(p=>p.balance),projection.endBalance);
      const ceiling=Math.max(floor+100,Math.ceil(maximum*1.04/1000)*1000);
      const x=t=>left+(t-start)/(end-start||1)*(width-left-right),y=b=>bottom-(b-floor)/(ceiling-floor)*(bottom-top);
      const historicPath=path(history.map(p=>[x(p.t),y(p.balance)])),futurePath=path(projection.curve.map(p=>[x(p.t),y(p.balance)]));
      const nowAnchor=x(current)>width-200?'end':'start',nowX=x(current)+(nowAnchor==='end'?-8:8);
      chart.innerHTML=`<svg class="fm-chart-svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="${esc(person(state.selected).name)}’s recorded balances through ${month(record.at(-1).date)}, followed by a dashed projection at 0.75 percent monthly, without deposits or withdrawals, to ${dollars(projection.endBalance)} on ${fullDate(projection.birthday)}."><text x="0" y="22">Balance (USD)</text>${[floor,(floor+ceiling)/2,ceiling].map(v=>`<line class="fm-grid" x1="${left}" x2="${width-right}" y1="${y(v)}" y2="${y(v)}"/><text x="${left-10}" y="${y(v)+6}" text-anchor="end">${dollars(v)}</text>`).join('')}<line class="fm-now-line" x1="${x(current)}" x2="${x(current)}" y1="${top}" y2="${bottom}"/><text x="${nowX}" y="43" text-anchor="${nowAnchor}">Now · ${month(record.at(-1).date)}</text><path class="fm-history-fill" d="${historicPath} L${x(current)},${bottom} L${x(start)},${bottom} Z"/><path class="fm-history-line" data-segment="recorded" d="${historicPath}"/><path class="fm-future-line" data-segment="projected" d="${futurePath}"/>${history.filter(p=>p.added>0).map(p=>`<circle class="fm-deposit" cx="${x(p.t)}" cy="${y(p.balance)}" r="5"/>`).join('')}<line class="fm-guide" data-guide y1="${top}" y2="${bottom}"/><circle class="fm-point" data-point r="7"/><text x="${left}" y="${height-13}">${month(history[0].date)}</text><text x="${width-right}" y="${height-13}" text-anchor="end">Age 18 · ${month(projection.birthday)}</text></svg>`;
      plot={x,y,left,right,width,start,end,index:0};
      const fresh=state.pointTime===null?points.findLastIndex(p=>p.added>0&&Date.now()-p.t<7*86400000):-1;
      select(fresh>=0?fresh:state.pointTime===null?points.length-1:nearest(points,state.pointTime));
    }
    function select(index){
      if(!plot||!points.length)return;
      index=Math.max(0,Math.min(points.length-1,index));const p=points[index];plot.index=index;state.pointTime=p.t;
      const birthday=p.date===projection.birthday&&p.kind==='projected';
      const label=p.added>0?`+${dollars(p.added)} added`:p.kind==='recorded'?'Recorded balance':p.kind==='current'?'Current balance':birthday?'Projected at age 18':'Projected balance';
      query('[data-selected-value]').innerHTML=`<strong>${dollars(p.balance)}</strong><span>${label}</span>`;
      query('[data-selected-period]').textContent=birthday||p.added>0?fullDate(p.date):month(p.date);
      query('[data-selected-status]').textContent=p.added>0?`🎉 You added ${dollars(p.added)} on ${fullDate(p.date)}! It starts growing next month.`:p.kind==='projected'?'Projection · 0.75% monthly, with no deposits or withdrawals.':p.kind==='current'?`Recorded ${month(p.date)} balance · Projection begins here.`:'Recorded balance · Kids Invests';
      query('[data-action="previous"]').disabled=index===0;query('[data-action="next"]').disabled=index===points.length-1;
      query('[data-action="today"]').setAttribute('aria-pressed',String(p.kind==='current'));
      query('[data-action="age18"]').setAttribute('aria-pressed',String(birthday));
      const guide=query('[data-guide]'),dot=query('[data-point]');
      guide.setAttribute('x1',plot.x(p.t));guide.setAttribute('x2',plot.x(p.t));dot.setAttribute('cx',plot.x(p.t));dot.setAttribute('cy',plot.y(p.balance));
    }
    root.addEventListener('click',event=>{
      const button=event.target.closest('button');
      if(button?.dataset.open){state.selected=button.dataset.open==='overview'?null:button.dataset.open;state.pointTime=null;build(true);return;}
      if(button?.dataset.years){state.years=Number(button.dataset.years);drawExample();return;}
      switch(button?.dataset.action){
        case 'less':state.years=Math.max(1,state.years-1);drawExample();return;
        case 'more':state.years=Math.min(30,state.years+1);drawExample();return;
        case 'early':state.early=!state.early;button.setAttribute('aria-pressed',String(state.early));drawTimeline();return;
        case 'previous':select(plot.index-1);return;
        case 'next':select(plot.index+1);return;
        case 'today':select(points.findIndex(p=>p.kind==='current'));return;
        case 'age18':select(points.length-1);return;
      }
      const chart=event.target.closest('.fm-timeline-chart');
      if(chart&&plot){const rect=chart.getBoundingClientRect();const localX=(event.clientX-rect.left)*plot.width/rect.width;const ratio=Math.max(0,Math.min(1,(localX-plot.left)/(plot.width-plot.left-plot.right)));select(nearest(points,plot.start+ratio*(plot.end-plot.start)));}
    },{signal:abort.signal});
    root.addEventListener('keydown',event=>{if(event.target.matches('.fm-timeline-chart')&&plot){if(event.key==='ArrowLeft'||event.key==='ArrowRight'){event.preventDefault();select(plot.index+(event.key==='ArrowLeft'?-1:1));}if(event.key==='Home'){event.preventDefault();select(0);}if(event.key==='End'){event.preventDefault();select(points.length-1);}}},{signal:abort.signal});
    build();
    return ()=>{dead=true;observer?.disconnect();abort.abort();root.remove();};
  }
  window.HubMoney={render,reset(){state.selected=null;state.pointTime=null;}};
})();
