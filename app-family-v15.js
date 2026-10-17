// CManager PWA v9: manual performance and remaining discounts; preserves prior records and backup compatibility.
'use strict';
/* Personal data stays in this device's browser storage; the hosting server never receives it. */
const STORAGE='cmanager_family_db_v1';
const TIER_STORAGE='cmanager_family_tiers_v1';
const MANUAL_STORAGE='cmanager_family_manual_v1';
let manualRecords=readManual();
const RULE_STORAGE='cmanager_family_recurring_rules_v1';
const ENTRY_STORAGE='cmanager_family_recurring_entries_v1';
let recurringRules=readArray(RULE_STORAGE),recurringEntries=readArray(ENTRY_STORAGE);
function readArray(k){try{const x=JSON.parse(localStorage.getItem(k)||'[]');return Array.isArray(x)?x:[]}catch{return []}}
function writeRecurring(){localStorage.setItem(RULE_STORAGE,JSON.stringify(recurringRules));localStorage.setItem(ENTRY_STORAGE,JSON.stringify(recurringEntries));queueCloudSync()}

function readManual(){try{const d=JSON.parse(localStorage.getItem(MANUAL_STORAGE)||'{}');return d&&typeof d==='object'&&!Array.isArray(d)?d:{}}catch{return {}}}
function writeManual(){localStorage.setItem(MANUAL_STORAGE,JSON.stringify(manualRecords));queueCloudSync()}
const manualKey=(cid,m)=>cid+'|'+m;

let tierSettings=readTiers();
function readTiers(){try{const x=JSON.parse(localStorage.getItem(TIER_STORAGE)||'{}');return x&&typeof x==='object'&&!Array.isArray(x)?x:{}}catch{return {}}}
function saveTiers(){try{localStorage.setItem(TIER_STORAGE,JSON.stringify(tierSettings));queueCloudSync()}catch(e){alert('목표 실적 설정을 저장하지 못했어. '+e.message)}}

const KEYS=['cards','records','expenses','benefits','usages'];
const EMPTY=()=>({cards:[],records:[],expenses:[],benefits:[],usages:[]});
let db=readDB();
const $=s=>document.querySelector(s);
const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const won=n=>Number(n||0).toLocaleString('ko-KR')+'원';
const day=()=>{let d=new Date();return [d.getFullYear(),String(d.getMonth()+1).padStart(2,'0'),String(d.getDate()).padStart(2,'0')].join('-')};
const month=()=>day().slice(0,7);
const monthLabel=s=>s?`${s.slice(0,4)}년 ${s.slice(5,7)}월`:'';
const id=()=>globalThis.crypto?.randomUUID?.()||'id-'+Date.now()+'-'+Math.random().toString(36).slice(2);
const colors=['#2563eb','#149b7f','#7752bd','#e07939','#298caf','#c04f81'];
const icons=['▣','◆','▤','✈','★','▰'];
let ownerFilter='all';
function filteredCards(){return db.cards.filter(c=>ownerFilter==='all'||(c.owner||'shared')===ownerFilter)}

function readDB(){try{const parsed=JSON.parse(localStorage.getItem(STORAGE));if(parsed&&KEYS.every(k=>Array.isArray(parsed[k])))return parsed}catch{}return EMPTY()}
function save(){try{localStorage.setItem(STORAGE,JSON.stringify(db))}catch(e){alert('저장 공간이 부족하거나 저장이 차단되어 있어요. 백업 파일을 저장해 주세요.\n'+e.message)}render();queueCloudSync()}
const expenseMonth=e=>String(e.date||'').slice(0,7);
const legacy=(cid,m)=>db.records.find(x=>x.cardID===cid&&x.month===m);
const monthExpenses=(cid,m)=>db.expenses.filter(x=>x.cardID===cid&&expenseMonth(x)===m);
const cardBenefits=cid=>db.benefits.filter(x=>x.cardID===cid);
const usageMonth=u=>String(u.date||'').slice(0,7);
// The manual base is the card issuer's cumulative approved performance, not an amount to double-count.
// Recurring items that the issuer has already included must be flagged as includedInBase.
function recurrenceFor(cid,m){
 const today=day(),thisMonth=month(),todayDay=Number(today.slice(8));
 let total=0,extras=[];
 for(const rule of recurringRules.filter(r=>r.cardID===cid&&r.active!==false&&r.startMonth<=m)){
  const effectiveDay=Math.min(rule.day,new Date(Number(m.slice(0,4)),Number(m.slice(5,7)),0).getDate());
  const due=m+'-'+String(effectiveDay).padStart(2,'0');
  if(m>thisMonth||(m===thisMonth&&todayDay<effectiveDay))continue;
  const saved=recurringEntries.find(e=>e.ruleID===rule.id&&e.month===m);
  if(saved?.status==='skipped')continue;
  const amount=saved?.status==='entered'?Number(saved.amount)||0:(rule.type==='fixed'?Number(rule.amount)||0:0);
  const counted=amount>0&&!saved?.includedInBase;
  if(counted)total+=amount;
  extras.push({rule,due,amount,saved,entered:!!saved&&saved.status==='entered',included:!!saved?.includedInBase,counted});
 }
 return{extra:total,items:extras};
}
function stats(cid,m){
 const entered=manualRecords[manualKey(cid,m)];
 const ex=monthExpenses(cid,m),old=legacy(cid,m);
 const priorEligible=ex.length?sum(ex.filter(e=>!e.excluded),'amount'):(old?.spending||0);
 const bid=new Set(cardBenefits(cid).map(x=>x.id));
 const uses=db.usages.filter(x=>bid.has(x.benefitID)&&usageMonth(x)===m);
 const priorUsed=uses.length?sum(uses,'amount'):(old?.benefitUsed||0);
 const card=db.cards.find(x=>x.id===cid);
 const benefitCeiling=tierFor(card||{target:1,benefitLimit:0,id:cid}).tiers.filter(t=>t.threshold<=priorEligible).at(-1)?.benefit ?? Number(card?.benefitLimit||0);
 const base=entered?Number(entered.eligible)||0:priorEligible;
 const recurring=recurrenceFor(cid,m);
 return {base,eligible:base+recurring.extra,recurringAmount:recurring.extra,recurringItems:recurring.items,
   benefitRemaining:entered?Math.max(0,Number(entered.benefitRemaining)||0):Math.max(0,benefitCeiling-priorUsed),manual:!!entered};
}
function sum(items,k){return items.reduce((s,x)=>s+(Number(x[k])||0),0)}
function tierFor(card){
 const raw=tierSettings[card.id];
 const fallback=Math.max(1,Number(card.target)||1);
 let tiers=Array.isArray(raw?.tiers)?raw.tiers.filter(x=>Number.isFinite(x.threshold)&&x.threshold>0&&Number.isFinite(x.benefit)&&x.benefit>=0).map(x=>({threshold:Math.round(x.threshold),benefit:Math.round(x.benefit)})):[];
 if(!tiers.length)tiers=[{threshold:fallback,benefit:Math.max(0,Number(card.benefitLimit)||0)}];
 tiers.sort((a,b)=>a.threshold-b.threshold);
 const goal=tiers.some(x=>x.threshold===raw?.goal)?raw.goal:(tiers.find(x=>x.threshold===Number(card.target))?.threshold||tiers[0].threshold);
 return{tiers,goal};
}
function tierStatus(card,eligible){
 const cfg=tierFor(card);
 const current=cfg.tiers.filter(t=>eligible>=t.threshold).at(-1)||null;
 const next=cfg.tiers.find(t=>eligible<t.threshold)||null;
 return{...cfg,current,next,remaining:Math.max(0,cfg.goal-eligible)};
}
function parseTierRows(value){
 const lines=value.split(/\r?\n/).map(s=>s.trim()).filter(Boolean);
 const parsed=[];
 for(const row of lines){
  const match=row.match(/^(\d+)\s*[:：,]\s*(\d+)$/);
  if(!match)return {error:'구간은 300000:10000 형식으로 한 줄씩 입력해 줘.'};
  const threshold=Number(match[1]),benefit=Number(match[2]);
  if(!Number.isSafeInteger(threshold)||threshold<=0||!Number.isSafeInteger(benefit)||benefit<0)return {error:'금액은 올바른 0 이상의 숫자로 입력해 줘.'};
  parsed.push({threshold,benefit});
 }
 if(!parsed.length)return {error:'실적 구간을 한 개 이상 입력해 줘.'};
 if(new Set(parsed.map(t=>t.threshold)).size!==parsed.length)return {error:'같은 실적 구간 금액이 중복되어 있어.'};
 return {tiers:parsed.sort((a,b)=>a.threshold-b.threshold)};
}
function tierLines(card,eligible){
 const cfg=tierStatus(card,eligible);
 return `<p class="note">원하는 구간을 누르면 내 목표로 바로 저장돼요.</p><div class="tier-list">${cfg.tiers.map(t=>`<button type="button" class="tier-line tier-choice ${eligible>=t.threshold?'tier-done':''} ${t.threshold===cfg.goal?'tier-goal':''}" data-select-goal="${t.threshold}" aria-pressed="${t.threshold===cfg.goal}"><span>${eligible>=t.threshold?'✓':'○'} ${won(t.threshold)} 이상</span><b>할인 한도 ${won(t.benefit)}</b><em>${t.threshold===cfg.goal?'● 내 목표':'선택'}</em></button>`).join('')}</div>`;
}
function setGoal(cid,goal,m=month()){
 const card=db.cards.find(c=>c.id===cid);
 if(!card)return;
 const cfg=tierFor(card);
 if(!cfg.tiers.some(t=>t.threshold===goal))return;
 tierSettings[cid]={tiers:cfg.tiers,goal};
 saveTiers();render();cardDetail(cid,m);
}
function tierEdit(cid,m=month()){
 const card=db.cards.find(c=>c.id===cid);if(!card)return;
 const cfg=tierFor(card);
 const rows=cfg.tiers.map(x=>`${x.threshold}:${x.benefit}`).join('\n');
 let chosenGoal=cfg.goal;
 openSheet('실적 구간 설정',`<form><p class="note">실적금액:혜택금액을 한 줄씩 입력한 후, 아래 구간을 탭해 목표를 선택해 줘.</p><label class="formlabel">실적 구간과 혜택 금액</label><textarea name="tiers" rows="6" required placeholder="300000:10000\n500000:20000">${esc(rows)}</textarea><p class="note">예시: 300000:10000 (실적 30만 원 · 혜택 1만 원). 입력을 바꾸면 아래 선택지가 자동으로 바뀌어.</p><label class="formlabel">목표 실적 구간 선택</label><div id="tier-options" class="tier-options" role="group" aria-label="목표 실적 구간 선택"></div><p id="tier-error" class="note warn" aria-live="polite"></p><div class="actions"><button class="primary" type="submit">구간 및 목표 저장</button><button type="button" class="secondary" id="cancel-tier">취소</button></div></form>`);
 const textarea=body.querySelector('textarea[name="tiers"]'),choices=$('#tier-options'),error=$('#tier-error');
 function redrawChoices(){
  const result=parseTierRows(textarea.value);
  if(result.error){choices.innerHTML='';error.textContent=result.error;return null;}
  const parsed=result.tiers;
  if(!parsed.some(x=>x.threshold===chosenGoal))chosenGoal=parsed[0].threshold;
  error.textContent='';
  choices.innerHTML=parsed.map(t=>`<button type="button" class="tier-option ${t.threshold===chosenGoal?'selected':''}" data-goal-option="${t.threshold}" aria-pressed="${t.threshold===chosenGoal}"><span><strong>${won(t.threshold)} 이상</strong><small>혜택 ${won(t.benefit)}</small></span><span class="tier-check">${t.threshold===chosenGoal?'✓ 선택됨':'선택하기'}</span></button>`).join('');
  choices.querySelectorAll('[data-goal-option]').forEach(btn=>btn.addEventListener('click',()=>{chosenGoal=Number(btn.dataset.goalOption);redrawChoices()}));
  return parsed;
 }
 textarea.addEventListener('input',redrawChoices);redrawChoices();
 $('#cancel-tier').onclick=()=>cardDetail(cid,m);
 bindForm(()=>{
  const parsed=redrawChoices();if(!parsed)return;
  tierSettings[cid]={tiers:parsed,goal:chosenGoal};
  saveTiers();render();cardDetail(cid,m);
 });
}
// v10: show each saved spending milestone along the current goal progress bar.
// Markers are display-only: they never change selected goals or stored data.
function tierProgressMarkers(ts, eligible){
 const goal=Math.max(1,Number(ts.goal)||1);
 const visible=ts.tiers.filter(t=>t.threshold<=goal);
 const labels=visible.map(t=>{
  const pct=Math.min(100,Math.max(0,(t.threshold/goal)*100));
  const reached=eligible>=t.threshold;
  const label=Number(t.threshold/10000).toLocaleString('ko-KR',{maximumFractionDigits:2})+'만';
  const last=pct>=99.99;
  return `<span class="milestone ${reached?'reached':''} ${last?'last':''}" style="left:${pct}%" title="${won(t.threshold)} ${reached?'달성':'미달성'}"><span class="milestone-dot"></span><span class="milestone-label">${label}</span></span>`;
 }).join('');
 return `<div class="milestone-progress" aria-label="목표 ${won(goal)}. 실적 구간: ${visible.map(t=>won(t.threshold)).join(', ')}"><div class="milestone-track"><div class="milestone-fill" style="width:${Math.min(100, Math.max(0,eligible/goal*100))}%"></div></div>${labels}</div>`;
}
function render(){
 const m=month();const visible=filteredCards();
 // The hero always shows household-wide totals, even when list filters are selected.
 const allCards=db.cards;
 const remainingFor=card=>tierStatus(card,stats(card.id,m).eligible).remaining;
 const myCards=allCards.filter(card=>card.owner!=='wife');
 const wifeCards=allCards.filter(card=>card.owner==='wife');
 const myRemaining=myCards.reduce((total,card)=>total+remainingFor(card),0);
 const wifeRemaining=wifeCards.reduce((total,card)=>total+remainingFor(card),0);
 $('#current-month').textContent=monthLabel(m)+' 이용 현황';
 $('#card-count').textContent=allCards.length+'개';
 $('#card-achieved').textContent=allCards.filter(c=>remainingFor(c)===0).length+' / '+allCards.length;
 $('#total-remaining').textContent=won(myRemaining+wifeRemaining);
 $('#mine-count').textContent=myCards.length+'개';
 $('#wife-count').textContent=wifeCards.length+'개';
 $('#mine-remaining').textContent=won(myRemaining);
 $('#wife-remaining').textContent=won(wifeRemaining);
 $('#cards').innerHTML=visible.length?visible.map((c,i)=>{
  const st=stats(c.id,m),ts=tierStatus(c,st.eligible),pct=Math.min(100,Math.round(st.eligible/ts.goal*100)),col=colors[i%colors.length];
  const owner=c.owner==='mine'?'내 카드':c.owner==='wife'?'와이프 카드':'공동 카드';
  const ownerClass=c.owner==='mine'?'owner-mine':c.owner==='wife'?'owner-wife':'owner-shared';
  return `<article class="card card-selectable" data-card-id="${esc(c.id)}" tabindex="0" role="button" aria-label="${esc(c.name)} 실적과 할인 잔여 금액 관리. 길게 누르면 카드 관리 메뉴">
  <div class="cardtop"><div class="cardico" style="background:${col}">${icons[i%icons.length]}</div><div class="tap"><div class="cardname-line"><div class="cardname">${esc(c.name)}</div><span class="owner-badge ${ownerClass}">${owner}</span></div><div class="sub">선택 목표 ${won(ts.goal)}</div></div><span class="pill">${ts.remaining===0?'목표 달성':'진행 중'}</span></div>
  <div class="card-summary"><div class="row"><span class="label">이번 달 예상 인정 실적</span><b style="color:${col}">${pct}%</b></div>${tierProgressMarkers(ts, st.eligible)}<div class="row"><b>${won(st.eligible)}</b><span class="label">${ts.remaining===0?'내 목표 달성':won(ts.remaining)+' 남음'}</span></div><p class="note">카드사 기준 ${won(st.base)} + 미포함 정기 실적 ${won(st.recurringAmount)}</p></div>
  <div class="manual-benefit"><span>남은 할인 혜택</span><strong>${won(st.benefitRemaining)}</strong></div>
  <div class="tier-hint"><span>${ts.current?'현재 '+won(ts.current.threshold)+' 구간 달성':'달성한 구간 없음'}</span><span>${ts.next?'다음 '+won(ts.next.threshold)+' · '+won(ts.next.threshold-st.eligible)+' 남음':'최고 구간 달성'}</span></div>
  </article>`;
 }).join(''):'<div class="empty">💳<h3>표시할 카드가 없어요</h3><p>카드를 등록하거나 다른 필터를 선택하세요.</p></div>';
 renderDueBanner();
}
function dueItems(){let result=[];for(const c of db.cards){for(const entry of recurrenceFor(c.id,month()).items){if(entry.rule.type==='variable'&&!entry.entered&&!entry.saved?.status)result.push({card:c,...entry})}}return result}
function renderDueBanner(){
 const list=dueItems();const banner=$('#due-banner');if(!banner)return;
 banner.hidden=!list.length;
 if(list.length)banner.innerHTML=`<b>🔔 이번 달 정기 실적 입력 대기 ${list.length}건</b><p>${list.slice(0,3).map(x=>esc(x.card.name+' · '+x.rule.title)).join(' / ')}${list.length>3?' 외':''}</p><button type="button" class="secondary small" id="open-pending">금액 입력하기</button>`;
 banner.querySelector('#open-pending')?.addEventListener('click',()=>regularOpen(list[0].card.id));
}
const modal=$('#modal'),title=$('#sheet-title'),body=$('#sheet-body');
function openSheet(t,html){title.textContent=t;body.innerHTML=html;modal.hidden=false;document.body.style.overflow='hidden';body.scrollTop=0}
function closeSheet(){modal.hidden=true;document.body.style.overflow='';body.innerHTML=''}
const numeric=(form,name)=>Math.max(0,Math.round(Number(new FormData(form).get(name))||0));
const v=(form,name)=>String(new FormData(form).get(name)||'').trim();
const dateInput=(name,value=day())=>`<label class="formlabel">날짜</label><input name="${name}" type="date" value="${esc(value)}" required>`;
const numberInput=(label,name,value='')=>`<label class="formlabel">${label}</label><input name="${name}" type="number" inputmode="numeric" min="0" step="1" value="${esc(value)}" required>`;
function bindForm(fn){const f=body.querySelector('form');f?.addEventListener('submit',e=>{e.preventDefault();fn(f)})}
function cardAdd(){openSheet('카드 추가',`<form><label class="formlabel">카드 이름</label><input name="name" placeholder="예: 롯데카드" maxlength="80" required><label class="formlabel">카드 구분</label><select name="owner"><option value="mine">내 카드</option><option value="wife">와이프 카드</option></select>${numberInput('목표 실적 (원)','target')}${numberInput('월 최대 혜택 (원)','limit')}<div class="actions"><button class="primary" type="submit">카드 저장</button></div></form>`);bindForm(f=>{const name=v(f,'name');if(!name)return;db.cards.push({id:id(),name,owner:v(f,'owner')||'mine',target:numeric(f,'target'),benefitLimit:numeric(f,'limit')});save();closeSheet()})}
// Rename in place: preserve the card UUID referenced by expenses, monthly records, and benefits.
function cardRename(cid){
  const card=db.cards.find(c=>c.id===cid);
  if(!card)return;
  openSheet('카드 이름 수정',`<form><label class="formlabel">카드 이름</label><input name="name" maxlength="80" required value="${esc(card.name)}"><p class="note">이름만 바뀌고 결제 내역, 월별 기록, 혜택 정보는 그대로 유지돼요.</p><div class="actions"><button class="primary" type="submit">이름 저장</button><button class="secondary" type="button" id="cancel-rename">취소</button></div></form>`);
  $('#cancel-rename').onclick=closeSheet;
  bindForm(f=>{const name=v(f,'name');if(!name){alert('카드 이름을 입력해 줘.');return;}card.name=name;save();cardManage(cid);});
}
// Only moves the item in the existing array. All card IDs and related data remain unchanged.
function cardManage(focusID){
  const list=db.cards.map((c,i)=>`<div class="manage-item${c.id===focusID?' is-focused':''}">
      <div class="manage-header"><div class="manage-icon" style="background:${colors[i%colors.length]}">${icons[i%icons.length]}</div><div class="manage-title"><b>${esc(c.name)}</b><small>목표 실적 ${won(c.target)}</small></div></div>
      <div class="manage-buttons"><button class="secondary" data-manage-edit="${esc(c.id)}">✎ 이름 수정</button><button class="secondary" data-manage-owner="${esc(c.id)}">카드 구분</button><button class="secondary" data-manage-move="${esc(c.id)}" data-direction="-1" ${i===0?'disabled':''}>↑ 위로</button><button class="secondary" data-manage-move="${esc(c.id)}" data-direction="1" ${i===db.cards.length-1?'disabled':''}>↓ 아래로</button><button class="danger" data-manage-delete="${esc(c.id)}">삭제</button></div>
    </div>`).join('');
  openSheet('카드 관리',`<p class="note">여기에서만 카드 이름과 순서를 변경할 수 있어요. 카드의 실적 및 결제 기록은 그대로 유지됩니다.</p>${list||'<p class="empty">등록된 카드가 없어요.</p>'}`);
  body.querySelectorAll('[data-manage-edit]').forEach(el=>el.onclick=()=>cardRename(el.dataset.manageEdit));
  body.querySelectorAll('[data-manage-owner]').forEach(el=>el.onclick=()=>changeOwner(el.dataset.manageOwner));
  body.querySelectorAll('[data-manage-move]').forEach(el=>el.onclick=()=>{const cid=el.dataset.manageMove;moveCard(cid,Number(el.dataset.direction));cardManage(cid)});
  body.querySelectorAll('[data-manage-delete]').forEach(el=>el.onclick=()=>{
    if(!confirm('이 카드를 삭제할까요? 과거 월별 기록은 남겨둡니다.'))return;
    db.cards=db.cards.filter(c=>c.id!==el.dataset.manageDelete);save();cardManage();
  });
}
function changeOwner(cid){const c=db.cards.find(x=>x.id===cid);if(!c)return;
 openSheet('카드 구분 변경',`<form><label class="formlabel">카드 구분</label><select name="owner"><option value="mine" ${c.owner==='mine'?'selected':''}>내 카드</option><option value="wife" ${c.owner==='wife'?'selected':''}>와이프 카드</option></select><div class="actions"><button class="primary">저장</button></div></form>`);
 bindForm(f=>{c.owner=v(f,'owner');save();cardManage(cid)});
}
function moveCard(cid,delta){
  const i=db.cards.findIndex(c=>c.id===cid);
  const j=i+delta;
  if(i<0||j<0||j>=db.cards.length)return;
  [db.cards[i],db.cards[j]]=[db.cards[j],db.cards[i]];
  save();
}
function cardDetail(cid,m=month()){
 const c=db.cards.find(x=>x.id===cid);if(!c){closeSheet();return}
 const st=stats(cid,m),ts=tierStatus(c,st.eligible);
 const checkboxItems=st.recurringItems.map(e=>`<label class="checkrow"><input type="checkbox" data-in-base="${esc(e.rule.id)}" ${e.included?'checked':''}> <span>${esc(e.rule.title)} ${won(e.amount)} — 카드사 기준 실적에 이미 포함됨</span></label>`).join('');
 openSheet(c.name,`<div class="panel"><div class="row"><b>${monthLabel(m)} 실적 · 혜택</b><input class="monthpick" type="month" id="detail-month" value="${esc(m)}"></div>
 <p class="note">카드사 앱에서 확인한 <b>인정 실적 누계</b>를 기준 실적으로 입력해요. 이미 누계에 포함된 정기 항목에는 체크해야 중복 합산되지 않아요.</p>
 <form id="manual-form">${numberInput('카드사 기준 인정 실적 (원)','eligible',st.base)}${numberInput('남은 할인 혜택 (원)','benefitRemaining',st.benefitRemaining)}
 ${checkboxItems?`<div class="includes-list"><b>중복 방지 체크</b>${checkboxItems}</div>`:''}
 <div class="actions"><button class="primary" type="submit">금액 및 중복 방지 설정 저장</button></div></form>
 <div class="manual-summary"><div class="row"><span>카드사 기준 실적</span><strong>${won(st.base)}</strong></div><div class="row"><span>추가할 정기 실적</span><strong>${won(st.recurringAmount)}</strong></div><div class="row"><span>예상 인정 실적</span><strong class="highlight">${won(st.eligible)}</strong></div><div class="row"><span>선택 목표까지</span><strong>${won(ts.remaining)}</strong></div></div></div>
 <div class="panel"><div class="row"><h3>정기 실적 관리</h3><button class="secondary" id="open-regular">설정·입력</button></div><p class="note">보험료는 지정일부터 예상 실적으로 자동 반영하고, 관리비·가스요금은 입력할 때 반영해요.</p></div>
 <div class="panel"><div class="row"><h3>실적 구간 · 목표 설정</h3><button class="secondary" id="edit-tiers">구간 수정</button></div>
 <p class="note">실적·혜택 구간은 한 번 설정하고, 원하는 목표 구간을 눌러 변경할 수 있어요.</p>${tierLines(c,st.eligible)}</div>`);
 $('#detail-month').addEventListener('change',e=>cardDetail(cid,e.target.value));
 $('#manual-form').addEventListener('submit',e=>{
  e.preventDefault();const f=e.currentTarget;
  const a=Number(new FormData(f).get('eligible')),b=Number(new FormData(f).get('benefitRemaining'));
  if(!Number.isSafeInteger(a)||a<0||!Number.isSafeInteger(b)||b<0){alert('두 금액을 0 이상의 정수로 입력해 줘.');return}
  manualRecords[manualKey(cid,m)]={eligible:a,benefitRemaining:b,updatedAt:new Date().toISOString()};
  // Each recurring item is explicitly flagged when already counted in the issuer's cumulative figure.
  for(const box of body.querySelectorAll('[data-in-base]')){
   const rule=recurringRules.find(r=>r.id===box.dataset.inBase);if(!rule)continue;
   const previous=recurringEntries.find(e=>e.ruleID===rule.id&&e.month===m);
   const defaultAmount=rule.type==='fixed'?rule.amount:0;
   if(previous){previous.includedInBase=box.checked;previous.updatedAt=new Date().toISOString()}
   else recurringEntries.push({id:rule.id+'|'+m,ruleID:rule.id,month:m,status:'entered',amount:defaultAmount,includedInBase:box.checked,updatedAt:new Date().toISOString()});
  }
  writeManual();writeRecurring();render();cardDetail(cid,m);
 });
 body.querySelectorAll('[data-select-goal]').forEach(btn=>btn.onclick=()=>setGoal(cid,Number(btn.dataset.selectGoal),m));
 $('#edit-tiers').onclick=()=>tierEdit(cid,m);
 $('#open-regular').onclick=()=>regularOpen(cid,m);
}
function regularOpen(cid,m=month()){
 const card=db.cards.find(c=>c.id===cid);if(!card)return;
 const rules=recurringRules.filter(r=>r.cardID===cid);
 const rows=rules.map(r=>{
  const entered=recurringEntries.find(e=>e.ruleID===r.id&&e.month===m);
  const dayOfMonth=Math.min(r.day,new Date(Number(m.slice(0,4)),Number(m.slice(5,7)),0).getDate());
  const due=m+'-'+String(dayOfMonth).padStart(2,'0');
  const dueNow=due<=day();
  return `<div class="manage-item"><div class="row"><b>${esc(r.title)}</b><span class="chip">매월 ${r.day}일 · ${r.type==='fixed'?'고정':'변동'}</span></div>
    <p class="note">${r.type==='fixed'?`기본 ${won(r.amount)}`:'매월 금액 입력 필요'} · ${dueNow?'결제일 도래':'결제일 전'}</p>
    <p class="note">이번 달: ${entered?.status==='skipped'?'건너뜀':entered?.status==='entered'?won(entered.amount):r.type==='fixed'&&dueNow?'자동 예상 반영':'미입력'}${entered?.includedInBase?' · 카드사 기준에 포함됨':''}</p>
    <div class="actions"><button class="secondary" data-enter-rule="${esc(r.id)}">이번 달 입력·수정</button><button class="secondary" data-edit-rule="${esc(r.id)}">규칙 수정</button><button class="danger" data-delete-rule="${esc(r.id)}">삭제</button></div></div>`;
 }).join('');
 openSheet('정기 실적 · '+card.name,`<p class="note">${monthLabel(m)} · 고정 금액은 결제일이 되면 자동으로 예상 실적에 포함돼요. 변동 금액은 직접 입력해야 해요. 실제 청구와 다르면 수정·건너뛰기를 선택하세요.</p>
 <p id="regular-sync-status" class="sync-status">${esc($('#sync-status')?.textContent||'공유 상태 확인 중')}</p><div class="row"><input class="monthpick" type="month" id="regular-month" value="${esc(m)}"><button class="primary small" id="add-regular">+ 정기 항목 추가</button></div>${rows||'<div class="empty">정기 항목이 없어요.</div>'}
 <button class="secondary" id="regular-back">카드 상세로 돌아가기</button>`);
 $('#regular-month').onchange=e=>regularOpen(cid,e.target.value);
 $('#add-regular').onclick=()=>regularEdit(cid,null,m);
 $('#regular-back').onclick=()=>cardDetail(cid,m);
 body.querySelectorAll('[data-enter-rule]').forEach(el=>el.onclick=()=>regularEntryEdit(cid,el.dataset.enterRule,m));
 body.querySelectorAll('[data-edit-rule]').forEach(el=>el.onclick=()=>regularEdit(cid,el.dataset.editRule,m));
 body.querySelectorAll('[data-delete-rule]').forEach(el=>el.onclick=()=>{
  if(!confirm('이 정기 항목과 월별 입력 내역을 삭제할까요?'))return;
  recurringRules=recurringRules.filter(r=>r.id!==el.dataset.deleteRule);
  recurringEntries=recurringEntries.filter(e=>e.ruleID!==el.dataset.deleteRule);writeRecurring();render();regularOpen(cid,m);
 });
}
function regularEdit(cid,rid=null,m=month()){
 const r=recurringRules.find(x=>x.id===rid);
 openSheet(r?'정기 실적 규칙 수정':'정기 실적 추가',`<form>
 <label class="formlabel">항목 이름</label><input name="title" maxlength="70" value="${esc(r?.title||'')}" placeholder="보험료 / 가스요금 / 아파트 관리비" required>
 <label class="formlabel">금액 유형</label><select name="type" id="regular-type"><option value="fixed" ${r?.type!=='variable'?'selected':''}>고정 금액 · 지정일부터 예상 실적 자동 반영</option><option value="variable" ${r?.type==='variable'?'selected':''}>변동 금액 · 결제일부터 입력 알림</option></select>
 <label class="formlabel" for="regular-day">매월 결제일</label><div class="day-select-wrap"><select class="day-select" id="regular-day" name="day" required>${Array.from({length:31},(_,i)=>`<option value="${i+1}" ${Number(r?.day??15)===i+1?'selected':''}>${i+1}일</option>`).join('')}</select><span class="day-select-arrow" aria-hidden="true"></span></div><p class="note">선택한 날짜가 없는 달에는 해당 월의 마지막 날에 반영돼요.</p><div id="fixed-amount">${numberInput('매월 고정 인정 금액 (원)','amount',r?.amount??0)}</div>
 <label class="formlabel">적용 시작 월</label><input name="startMonth" type="month" value="${esc(r?.startMonth||m)}" required>
 <div class="actions"><button class="primary" type="submit">규칙 저장</button><button type="button" class="secondary" id="cancel-regular">취소</button></div></form>`);
 const ty=$('#regular-type'),amt=$('#fixed-amount');function updateAmount(){amt.hidden=ty.value!=='fixed'}ty.onchange=updateAmount;updateAmount();
 $('#cancel-regular').onclick=()=>regularOpen(cid,m);
 bindForm(f=>{
  const d=numeric(f,'day'),t=v(f,'type'),a=numeric(f,'amount'),start=v(f,'startMonth');
  if(d<1||d>31||!/^\d{4}-\d{2}$/.test(start)){alert('날짜는 1~31일, 시작 월은 YYYY-MM 형식으로 입력해 줘.');return}
  const data={id:r?.id||id(),cardID:cid,title:v(f,'title'),type:t,day:d,amount:t==='fixed'?a:0,startMonth:start,active:true,updatedAt:new Date().toISOString()};
  if(r)recurringRules=recurringRules.map(item=>item.id===r.id?data:item);else recurringRules.push(data);
  writeRecurring();render();regularOpen(cid,m);
 });
}
function regularEntryEdit(cid,ruleID,m){
 const r=recurringRules.find(x=>x.id===ruleID);if(!r)return;
 const entry=recurringEntries.find(e=>e.ruleID===ruleID&&e.month===m);
 const initial=entry?.amount??(r.type==='fixed'?r.amount:0);
 openSheet('이번 달 정기 실적 입력',`<form><p class="note">${esc(r.title)} · ${monthLabel(m)}. 카드사 기준 누계에 이미 들어간 금액이라면 아래 체크를 켜 줘.</p>
 ${numberInput('이번 달 인정 금액 (원)','amount',initial)}
 <label class="checkrow"><input name="included" type="checkbox" ${entry?.includedInBase?'checked':''}> 카드사 기준 실적에 이미 포함됨 (중복 가산 안 함)</label>
 <div class="actions"><button class="primary" type="submit">입력 완료</button><button class="secondary" type="button" id="skip-regular">이번 달 반영하지 않기</button><button class="secondary" type="button" id="back-regular">취소</button></div></form>`);
 const upsert=(status,amount,included)=>{
  const item={id:ruleID+'|'+m,ruleID,month:m,status,amount,includedInBase:included,updatedAt:new Date().toISOString()};
  const i=recurringEntries.findIndex(e=>e.id===item.id);if(i>=0)recurringEntries[i]=item;else recurringEntries.push(item);
  writeRecurring();render();regularOpen(cid,m);
 };
 $('#skip-regular').onclick=()=>upsert('skipped',0,false);
 $('#back-regular').onclick=()=>regularOpen(cid,m);
 bindForm(f=>upsert('entered',numeric(f,'amount'),!!new FormData(f).get('included')));
}
function history(){
 const months=[...new Set([...db.records.map(x=>x.month),...db.expenses.map(expenseMonth),...db.usages.map(usageMonth),...Object.keys(manualRecords).map(k=>k.slice(-7)),...recurringEntries.map(e=>e.month),...(recurringRules.length?[month()]:[])])].filter(m=>/^\d{4}-\d{2}$/.test(m)).sort().reverse();
 const historicalIds=[...new Set([...db.cards.map(x=>x.id),...db.records.map(x=>x.cardID),...db.expenses.map(x=>x.cardID)])];
 const blocks=months.map(m=>{
  const list=historicalIds.filter(cid=>manualRecords[manualKey(cid,m)]||legacy(cid,m)||monthExpenses(cid,m).length||recurrenceFor(cid,m).items.length).map(cid=>{
   const c=db.cards.find(x=>x.id===cid),st=stats(cid,m);
   return `<div class="panel"><b>${esc(c?.name||'삭제된 카드')}</b><div class="item row"><span>인정 실적</span><b class="highlight">${won(st.eligible)}</b></div><div class="item row"><span>남은 할인 혜택</span><b>${won(st.benefitRemaining)}</b></div></div>`;
  }).join('');return list?`<div class="groupheader">${monthLabel(m)}</div>${list}`:'';
 }).join('');
 openSheet('월별 기록',blocks||'<div class="empty">아직 저장된 기록이 없어요.</div>');
}
const APPLE_EPOCH_MS=978307200000;
const toSwiftDate=d=>(new Date(String(d).length===7?d+'-01':d+'T12:00:00').getTime()-APPLE_EPOCH_MS)/1000;
const localDateString=d=>[d.getFullYear(),String(d.getMonth()+1).padStart(2,'0'),String(d.getDate()).padStart(2,'0')].join('-');
const fromSwiftDate=v=>{if(typeof v==='number')return localDateString(new Date(APPLE_EPOCH_MS+v*1000));if(typeof v==='string'){const date=new Date(v);if(!Number.isNaN(date.getTime()))return localDateString(date)}throw new Error('날짜 형식을 읽을 수 없어요')};
function exportBackup(){const out={version:1,tierSettings,manualRecords,recurringRules,recurringEntries,createdAt:(Date.now()-APPLE_EPOCH_MS)/1000,cards:db.cards,records:db.records,expenses:db.expenses.map(x=>({...x,date:toSwiftDate(x.date)})),benefits:db.benefits,usages:db.usages.map(x=>({...x,date:toSwiftDate(x.date)}))};const blob=new Blob([JSON.stringify(out,null,2)],{type:'application/json'});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download='CardManager_Backup_'+new Date().toISOString().slice(0,10)+'.json';document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),30000)}
function validateBackup(x){if(!x||x.version!==1||!['cards','records','expenses','benefits','usages'].every(k=>Array.isArray(x[k])))throw new Error('지원되지 않는 백업 파일이야. 기존 카드관리 앱의 JSON 파일인지 확인해 줘.');if(x.tierSettings!==undefined&&(typeof x.tierSettings!=='object'||x.tierSettings===null||Array.isArray(x.tierSettings)))throw Error('목표 구간 설정 형식이 잘못됐어');if(x.manualRecords!==undefined&&(typeof x.manualRecords!=='object'||x.manualRecords===null||Array.isArray(x.manualRecords)))throw Error('직접 입력 기록 형식이 잘못됐어');if(x.manualRecords){for(const rec of Object.values(x.manualRecords)){if(!rec||!Number.isSafeInteger(rec.eligible)||rec.eligible<0||!Number.isSafeInteger(rec.benefitRemaining)||rec.benefitRemaining<0)throw Error('수동 실적/혜택 기록 형식이 잘못됐어')}}if(x.recurringRules!==undefined&&!Array.isArray(x.recurringRules))throw Error('정기 규칙 형식이 잘못됐어');if(x.recurringEntries!==undefined&&!Array.isArray(x.recurringEntries))throw Error('정기 실적 기록 형식이 잘못됐어');for(const c of x.cards){if(typeof c.id!=='string'||typeof c.name!=='string'||!Number.isFinite(c.target)||!Number.isFinite(c.benefitLimit))throw Error('카드 정보 형식이 잘못됐어')}for(const e of x.expenses){if(typeof e.id!=='string'||typeof e.cardID!=='string'||typeof e.merchant!=='string'||!Number.isFinite(e.amount))throw Error('결제 기록 형식이 잘못됐어')}for(const r of x.records){if(typeof r.cardID!=='string'||typeof r.month!=='string'||!Number.isFinite(r.spending)||!Number.isFinite(r.benefitUsed))throw Error('월별 기록 형식이 잘못됐어')}for(const b of x.benefits){if(typeof b.id!=='string'||typeof b.cardID!=='string'||typeof b.title!=='string'||!Number.isFinite(b.monthlyLimit))throw Error('혜택 정보 형식이 잘못됐어')}for(const u of x.usages){if(typeof u.id!=='string'||typeof u.benefitID!=='string'||!Number.isFinite(u.amount))throw Error('혜택 사용 기록 형식이 잘못됐어')}}
function importBackup(file){if(!file)return;const reader=new FileReader();reader.onload=()=>{try{const x=JSON.parse(reader.result);validateBackup(x);const next={cards:x.cards,records:x.records,expenses:x.expenses.map(e=>({...e,date:fromSwiftDate(e.date)})),benefits:x.benefits,usages:x.usages.map(u=>({...u,date:fromSwiftDate(u.date)}))};if(confirm(`백업 파일에 카드 ${next.cards.length}개, 결제 내역 ${next.expenses.length}건이 있어요.\n\n현재 웹앱의 모든 기록을 백업 파일의 내용으로 교체할까요?`)){db=next;tierSettings=x.tierSettings||{};manualRecords=x.manualRecords||{};recurringRules=x.recurringRules||[];recurringEntries=x.recurringEntries||[];suppressCloud=true;saveTiers();writeManual();writeRecurring();save();suppressCloud=false;if(cloud.householdId&&confirm("현재 가족 공유 데이터도 이 백업으로 교체할까요? 두 사람의 기존 기록이 교체됩니다.")){replaceCloudFromLocal().catch(err=>alert("공유 데이터 교체 실패: "+err.message))}closeSheet();alert('복원했어. 현재 카드와 기록을 확인해 줘.')}}catch(e){alert('백업 복원에 실패했어.\n'+e.message)}};reader.onerror=()=>alert('파일을 읽지 못했어.');reader.readAsText(file)}
function backup(){openSheet('백업 및 복원',`<div class="panel"><h3>iCloud Drive 파일 백업</h3><p class="note">직접 입력한 실적·남은 혜택과 실적 구간, 기존 결제·혜택·월별 기록까지 하나의 JSON 파일로 저장해요. 앱 파일은 GitHub에 있지만 개인 기록은 이 기기에만 저장돼요.</p><div class="actions"><button class="primary" id="export">⬆ 백업 파일 만들기</button></div><p class="note">iPhone Safari에서 다운로드한 파일은 파일 앱의 '다운로드'에서 찾을 수 있어요. 필요하면 파일 앱에서 iCloud Drive로 이동해 줘.</p></div><div class="panel"><h3>백업에서 복원</h3><label class="formlabel">기존 Swift 앱 또는 웹앱에서 만든 JSON 백업 선택</label><input type="file" id="import" accept=".json,application/json"><p class="warn note">복원 시 웹앱의 현재 데이터가 모두 교체돼요. 현재 데이터도 먼저 백업해 줘.</p></div><div class="panel"><h3>주의사항</h3><p class="note">이 웹앱의 데이터는 아이폰의 웹 저장 공간에 보관돼요. Safari 데이터 삭제나 앱 제거 시 사라질 수 있으므로 정기적으로 JSON 백업을 만들어 iCloud Drive에 보관해 줘. 같은 주소여도 부부의 아이폰은 각자의 데이터를 사용해요.</p></div>`);$('#export').onclick=exportBackup;$('#import').onchange=e=>importBackup(e.target.files[0])}
$('#add-card').onclick=cardAdd;
$('#history-open').onclick=history;
$('#backup-open').onclick=backup;
$('#shared-open').onclick=cloudOpen;
document.querySelectorAll('[data-owner-filter]').forEach(button=>button.addEventListener('click',()=>{ownerFilter=button.dataset.ownerFilter;document.querySelectorAll('[data-owner-filter]').forEach(b=>{const selected=b===button;b.classList.toggle('active',selected);b.setAttribute('aria-pressed',String(selected))});render()}));
modal.addEventListener('click',e=>{if(e.target.closest('[data-close]'))closeSheet()});
const cardsElement=$('#cards');
let pressTimer=null, pressedID=null, pressStart=null, suppressClick=false;
function clearPress(){if(pressTimer!==null){clearTimeout(pressTimer);pressTimer=null;}pressedID=null;pressStart=null;}
cardsElement.addEventListener('pointerdown',e=>{
  const card=e.target.closest('[data-card-id]');
  if(!card||e.button!==0)return;
  clearPress();pressedID=card.dataset.cardId;
  pressStart={x:e.clientX,y:e.clientY};
  pressTimer=setTimeout(()=>{
    if(!pressedID)return;
    const selected=pressedID;
    clearPress();suppressClick=true;
    cardManage(selected);
  },650);
});
cardsElement.addEventListener('pointermove',e=>{
  if(pressStart&&Math.hypot(e.clientX-pressStart.x,e.clientY-pressStart.y)>12)clearPress();
});
['pointerup','pointercancel','pointerleave'].forEach(type=>cardsElement.addEventListener(type,clearPress));
cardsElement.addEventListener('contextmenu',e=>{
  const card=e.target.closest('[data-card-id]');
  if(!card)return;
  e.preventDefault();clearPress();suppressClick=true;
  if(modal.hidden)cardManage(card.dataset.cardId);
});
cardsElement.addEventListener('click',e=>{
  const card=e.target.closest('[data-card-id]');
  if(!card)return;
  if(suppressClick){suppressClick=false;return;}
  cardDetail(card.dataset.cardId);
});
cardsElement.addEventListener('keydown',e=>{
  if(e.target.matches('[data-card-id]')&&(e.key==='Enter'||e.key===' ')){
    e.preventDefault();cardDetail(e.target.dataset.cardId);
  }
});

render();if('serviceWorker' in navigator)window.addEventListener('load',()=>navigator.serviceWorker.register('./service-worker-family-v15.js', {updateViaCache:'none'}).catch(()=>{}));


// MARK: family shared storage via Supabase. Each card and monthly record is a separate row.
// Public publishable key is not secret; RLS grants access ONLY to household members.
const CLOUD_CONFIG='cmanager_family_cloud_config_v1';
const CLOUD_SESSION='cmanager_family_cloud_session_v1';
const CLOUD_QUEUE='cmanager_family_queue_v1';
const CLOUD_SNAPSHOT='cmanager_family_snapshot_v1';
function jsonRead(k,fallback){try{return JSON.parse(localStorage.getItem(k)||'null')??fallback}catch{return fallback}}
let cloud={config:jsonRead(CLOUD_CONFIG,null),session:jsonRead(CLOUD_SESSION,null),householdId:null,busy:false,timer:null};
let pendingOps=jsonRead(CLOUD_QUEUE,[]),lastSnapshot=jsonRead(CLOUD_SNAPSHOT,{}),suppressCloud=false;
let localEditRevision=0;
function cloudStatus(message,isError=false){for(const selector of ['#sync-status','#regular-sync-status']){const el=$(selector);if(el){el.textContent=message;el.className='sync-status'+(isError?' sync-error':'')}}}
function cloudURL(path){return cloud.config.url.replace(/\/+$/,'')+path}
function goodConfig(c){try{const u=new URL(c.url);return u.protocol==='https:'&&/^[a-z0-9-]+\.supabase\.co$/.test(u.hostname)&&u.pathname==='/'&&c.key.startsWith('sb_publishable_')}catch{return false}}
async function cloudRequest(path,options={},auth=false,retry=true){
 if(!cloud.config)throw Error('Supabase 연결 정보가 필요합니다.');
 let headers={'apikey':cloud.config.key,'Content-Type':'application/json',...(options.headers||{})};
 if(auth){if(!cloud.session?.access_token)throw Error('로그인이 필요합니다.');headers.Authorization='Bearer '+cloud.session.access_token}
 const response=await fetch(cloudURL(path),{...options,headers});
 if(response.status===401&&auth&&retry&&cloud.session?.refresh_token){await cloudRefresh();return cloudRequest(path,options,auth,false)}
 let raw=await response.text(),obj;try{obj=raw?JSON.parse(raw):null}catch{obj=raw}
 if(!response.ok)throw Error(response.status+': '+(obj?.message||obj?.error_description||obj?.error||String(raw)));
 return obj;
}
async function cloudRefresh(){
 const r=await cloudRequest('/auth/v1/token?grant_type=refresh_token',{method:'POST',body:JSON.stringify({refresh_token:cloud.session.refresh_token})});
 if(!r.access_token)throw Error('세션이 만료됐습니다. 다시 로그인하세요.');
 cloud.session={...r,expires_at:Math.floor(Date.now()/1000)+(r.expires_in||3600)};
 localStorage.setItem(CLOUD_SESSION,JSON.stringify(cloud.session));
}
async function cloudEnsure(){if(!cloud.session)return false;if(cloud.session.expires_at&&Date.now()/1000>cloud.session.expires_at-90)await cloudRefresh();return true}
async function cloudLogin(email,password){
 const result=await cloudRequest('/auth/v1/token?grant_type=password',{method:'POST',body:JSON.stringify({email,password})});
 if(!result?.user?.id)throw Error('로그인 응답에 사용자 정보가 없습니다.');
 cloud.session={...result,expires_at:Math.floor(Date.now()/1000)+(result.expires_in||3600)};
 localStorage.setItem(CLOUD_SESSION,JSON.stringify(cloud.session));
 const memberships=await cloudRequest('/rest/v1/household_members?select=household_id&user_id=eq.'+encodeURIComponent(result.user.id),{},true);
 if(!Array.isArray(memberships)||memberships.length!==1)throw Error('가족 공유 공간을 1개만 연결해야 합니다.');
 cloud.householdId=memberships[0].household_id;
 cloudStatus('공유 로그인 성공 · '+result.user.email);
 await cloudPull(true);
}
function cloudLogout(){cloud.session=null;cloud.householdId=null;localStorage.removeItem(CLOUD_SESSION);cloudStatus('로그아웃됨 · 이 기기에 남아 있는 기록은 오프라인 참고용입니다.');}
// Stored row objects omit Supabase-generated metadata and are kept separate for independent edits.
function localRows(){
 const rows={};const put=(t,id,value)=>rows[t+'|'+id]={item_type:t,item_id:id,data:JSON.parse(JSON.stringify(value))};
 db.cards.forEach((c,index)=>put('card',c.id,{...c,order:index}));
 for(const [cid,setting] of Object.entries(tierSettings))put('tier',cid,setting);
 for(const [k,rec] of Object.entries(manualRecords))put('manual',k,rec);
 recurringRules.forEach(r=>put('recurring_rule',r.id,r));
 recurringEntries.forEach(e=>put('recurring_entry',e.id,e));
 if(db.records.length||db.expenses.length||db.benefits.length||db.usages.length)put('legacy','archive',{records:db.records,expenses:db.expenses,benefits:db.benefits,usages:db.usages});
 return rows;
}
function applyCloudRows(rows){
 const parsed={cards:[],records:[],expenses:[],benefits:[],usages:[]},tiers={},manual={},rules=[],entries=[];
 for(const row of rows){let d=row.data;if(!d||typeof d!=='object')continue;
  switch(row.item_type){
   case 'card':if(typeof d.id==='string')parsed.cards.push(d);break;
   case 'tier':tiers[row.item_id]=d;break;
   case 'manual':manual[row.item_id]=d;break;
   case 'recurring_rule':if(d.id)rules.push(d);break;
   case 'recurring_entry':if(d.id)entries.push(d);break;
   case 'legacy':if(row.item_id==='archive')for(const k of ['records','expenses','benefits','usages'])if(Array.isArray(d[k]))parsed[k]=d[k];break;
  }
 }
 parsed.cards.sort((a,b)=>(a.order??9999)-(b.order??9999));
 db=parsed;tierSettings=tiers;manualRecords=manual;recurringRules=rules;recurringEntries=entries;
 suppressCloud=true;
 localStorage.setItem(STORAGE,JSON.stringify(db));localStorage.setItem(TIER_STORAGE,JSON.stringify(tierSettings));localStorage.setItem(MANUAL_STORAGE,JSON.stringify(manualRecords));
 localStorage.setItem(RULE_STORAGE,JSON.stringify(recurringRules));localStorage.setItem(ENTRY_STORAGE,JSON.stringify(recurringEntries));
 suppressCloud=false;render();
}
function queueCloudSync(){
 if(suppressCloud||!cloud.householdId)return;
 // Stage changes synchronously. A cloud pull must never erase a newly edited day
 // before a delayed debounce handler has noticed it.
 localEditRevision++;
 const now=localRows();
 for(const [key,row] of Object.entries(now))if(JSON.stringify(row)!==JSON.stringify(lastSnapshot[key])){
   pendingOps=pendingOps.filter(op=>op.key!==key);
   pendingOps.push({key,kind:'upsert',row});
 }
 for(const key of Object.keys(lastSnapshot))if(!now[key]){
   pendingOps=pendingOps.filter(op=>op.key!==key);
   pendingOps.push({key,kind:'delete',row:lastSnapshot[key]});
 }
 localStorage.setItem(CLOUD_QUEUE,JSON.stringify(pendingOps));
 cloudStatus(navigator.onLine?'변경 내용 공유 저장 중…':'인터넷 연결 없음 · 변경 내용은 이 기기에 저장됨');
 clearTimeout(cloud.timer);
 cloud.timer=setTimeout(()=>cloudFlush().catch(e=>cloudStatus('동기화 대기: '+e.message,true)),250);
}
async function cloudFlush(){
 if(cloud.busy||!cloud.householdId||!navigator.onLine)return;
 cloud.busy=true;
 try{
  await cloudEnsure();
  while(pendingOps.length){
   const op=pendingOps[0],r=op.row;
   if(op.kind==='delete'){
    await cloudRequest(`/rest/v1/shared_card_data?household_id=eq.${cloud.householdId}&item_type=eq.${encodeURIComponent(r.item_type)}&item_id=eq.${encodeURIComponent(r.item_id)}`,{method:'DELETE'},true);
    delete lastSnapshot[op.key];
   }else{
    await cloudRequest('/rest/v1/shared_card_data?on_conflict=household_id%2Citem_type%2Citem_id',{
     method:'POST',headers:{Prefer:'resolution=merge-duplicates,return=minimal'},
     body:JSON.stringify({household_id:cloud.householdId,item_type:r.item_type,item_id:r.item_id,data:r.data,updated_at:new Date().toISOString(),updated_by:cloud.session.user.id})
    },true);
    lastSnapshot[op.key]=JSON.parse(JSON.stringify(r));
   }
   // An edit may have replaced this queue entry during the async request.
   // Remove only the completed operation, never a newer edit.
   const opIndex=pendingOps.indexOf(op);
   if(opIndex>=0)pendingOps.splice(opIndex,1);
   localStorage.setItem(CLOUD_QUEUE,JSON.stringify(pendingOps));localStorage.setItem(CLOUD_SNAPSHOT,JSON.stringify(lastSnapshot));
  }
  cloudStatus('공유 저장 완료 · '+new Date().toLocaleTimeString('ko-KR',{hour:'2-digit',minute:'2-digit'}));
 }finally{
   cloud.busy=false;
   if(pendingOps.length&&navigator.onLine){
     clearTimeout(cloud.timer);
     cloud.timer=setTimeout(()=>cloudFlush().catch(e=>cloudStatus('동기화 대기: '+e.message,true)),300);
   }
 }
}
async function cloudPull(silent=false){
 if(!cloud.householdId)return;
 // A pending/in-flight upload must settle before downloading and replacing the UI.
 if(cloud.busy)return;
 if(pendingOps.length){
   await cloudFlush();
   if(cloud.busy||pendingOps.length)throw Error('공유 저장 중이에요. 잠시 후 새로고침하세요.');
 }
 const revisionBefore=localEditRevision;
 const data=await cloudRequest('/rest/v1/shared_card_data?select=item_type,item_id,data&household_id=eq.'+cloud.householdId+'&limit=10000',{},true);
 if(!Array.isArray(data))throw Error('공유 데이터를 읽지 못했습니다.');
 // A user may edit while fetch is in flight. Never overwrite that edit.
 if(revisionBefore!==localEditRevision||cloud.busy||pendingOps.length){
   cloudStatus('수정한 내용을 먼저 공유 저장하는 중…');
   return;
 }
 lastSnapshot=Object.fromEntries(data.map(row=>[row.item_type+'|'+row.item_id,row]));
 localStorage.setItem(CLOUD_SNAPSHOT,JSON.stringify(lastSnapshot));
 applyCloudRows(data);
 if(!silent)cloudStatus('공유 데이터 최신 상태로 갱신됨');
 maybeShowReminder();
}
async function replaceCloudFromLocal(){
 if(!cloud.householdId)throw Error('로그인해야 공동 데이터를 바꿀 수 있습니다.');
 await cloudEnsure();
 const old=await cloudRequest('/rest/v1/shared_card_data?select=item_type,item_id&household_id=eq.'+cloud.householdId,{},true);
 const rows=localRows();
 for(const item of old){if(!rows[item.item_type+'|'+item.item_id]){
  await cloudRequest('/rest/v1/shared_card_data?household_id=eq.'+cloud.householdId+'&item_type=eq.'+encodeURIComponent(item.item_type)+'&item_id=eq.'+encodeURIComponent(item.item_id),{method:'DELETE'},true);
 }}
 lastSnapshot={};pendingOps=[];localStorage.setItem(CLOUD_QUEUE,'[]');
 queueCloudSync();
 await new Promise(resolve=>setTimeout(resolve,550));await cloudFlush();
 cloudStatus('공유 데이터 교체 요청 완료');
}
function cloudOpen(){
 openSheet('부부 공유 설정',`<div class="panel"><h3>공유 상태</h3><p id="cloud-sheet-status" class="note"></p><div class="actions"><button id="cloud-refresh" class="secondary">최신 데이터 불러오기</button><button id="cloud-logout" class="secondary">로그아웃</button></div></div>
 <div class="panel"><h3>① Supabase 연결</h3><p class="note">Project URL은 https://프로젝트ID.supabase.co 형식만 입력해요. 관리자 비밀 키는 사용하지 마세요.</p><label class="formlabel">Project URL</label><input id="cloud-url" type="url" autocomplete="off" value="${esc(cloud.config?.url||'')}" placeholder="https://xxxx.supabase.co"><label class="formlabel">Publishable key</label><input id="cloud-key" autocapitalize="off" autocomplete="off" value="${esc(cloud.config?.key||'')}" placeholder="sb_publishable_..."><div class="actions"><button class="primary" id="cloud-save-config">연결 정보 저장</button></div><p id="config-message" class="note"></p></div>
 <div class="panel"><h3>② 앱 계정 로그인</h3><label class="formlabel">이메일</label><input id="cloud-email" type="email" autocomplete="username" placeholder="이메일"><label class="formlabel">비밀번호</label><input id="cloud-password" type="password" autocomplete="current-password" placeholder="비밀번호"><div class="actions"><button class="primary" id="cloud-login">로그인하고 가족 공유 시작</button></div><p id="login-message" class="note"></p></div>
 <div class="panel"><h3>데이터 주의사항</h3><p class="note">공유 로그인 후 서버 데이터가 이 테스트 앱의 로컬 데이터보다 우선합니다. 기존 cmanager 앱은 별도로 유지되며, JSON 백업은 언제든 만들 수 있습니다. 오프라인 변경 후 두 사람이 같은 항목을 동시에 수정하면 마지막 저장 내용이 우선할 수 있습니다.</p></div>`);
 $('#cloud-sheet-status').textContent=cloud.householdId?'가족 공유 연결됨 · '+(cloud.session?.user?.email||''):'가족 공유 로그인 전';
 $('#cloud-save-config').onclick=()=>{const next={url:$('#cloud-url').value.trim().replace(/\/+$/,''),key:$('#cloud-key').value.trim()};
  if(!goodConfig(next)){$('#config-message').textContent='URL은 https://프로젝트ID.supabase.co, 키는 sb_publishable_... 형식이어야 합니다.';return}
  cloud.config=next;localStorage.setItem(CLOUD_CONFIG,JSON.stringify(next));$('#config-message').textContent='이 기기에 연결 정보를 저장했어요.';
 };
 $('#cloud-login').onclick=async()=>{const btn=$('#cloud-login');btn.disabled=true;$('#login-message').textContent='로그인 중...';
 try{await cloudLogin($('#cloud-email').value.trim(),$('#cloud-password').value);$('#login-message').textContent='가족 공유 로그인 성공!';$('#cloud-sheet-status').textContent='가족 공유 연결됨 · '+cloud.session.user.email;}
 catch(e){$('#login-message').textContent='로그인 오류: '+e.message;}finally{btn.disabled=false}
 };
 $('#cloud-refresh').onclick=async()=>{try{await cloudPull();$('#cloud-sheet-status').textContent='공유 데이터 새로고침 완료'}catch(e){$('#cloud-sheet-status').textContent='오류: '+e.message}};
 $('#cloud-logout').onclick=()=>{cloudLogout();closeSheet()};
}
function maybeShowReminder(){
 const due=dueItems();if(!due.length||!modal.hidden)return;
 const key='cmanager_family_reminder_'+day();if(localStorage.getItem(key))return;
 localStorage.setItem(key,'1');
 // In-app reminder only: no background push permission is implied.
 if(modal.hidden)setTimeout(()=>{if(modal.hidden&&dueItems().length)regularOpen(due[0].card.id)},500);
}
async function cloudInit(){
 if(!cloud.config||!cloud.session)return;
 try{
  await cloudEnsure();const user=cloud.session.user;
  if(!user?.id)throw Error('로그인 정보가 없어요');
  const list=await cloudRequest('/rest/v1/household_members?select=household_id&user_id=eq.'+encodeURIComponent(user.id),{},true);
  if(list?.length!==1)throw Error('가족 관리 공간을 찾지 못했습니다');
  cloud.householdId=list[0].household_id;
  // Clear pending operations from another household; this app is scoped to one family space.
  cloudStatus('가족 공유 연결됨 · 최신 기록 확인 중');
  await cloudPull(true);cloudStatus('가족 공유 연결됨');
 }catch(e){cloudStatus('공유 연결 확인 필요: '+e.message,true)}
}
window.addEventListener('online',()=>{cloudFlush().then(()=>cloudPull()).catch(e=>cloudStatus(e.message,true))});
window.addEventListener('focus',()=>{if(cloud.householdId&&!cloud.busy&&modal.hidden)cloudPull(true).catch(()=>{})});
setInterval(()=>{if(cloud.householdId&&navigator.onLine&&!cloud.busy&&modal.hidden)cloudPull(true).catch(()=>{})},30000);
cloudInit();setTimeout(()=>maybeShowReminder(),1100);
