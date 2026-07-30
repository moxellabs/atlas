export function renderExplorerScript(): string {
  return `(function(){
const data=JSON.parse(document.getElementById('atlas-eval-report-data').textContent);
const cards=[...document.querySelectorAll('[data-case-card]')];
const search=document.getElementById('case-search');
const cat=document.getElementById('filter-category');
const profile=document.getElementById('filter-profile');
const risk=document.getElementById('filter-risk');
const sort=document.getElementById('case-sort');
const list=document.getElementById('case-list');
const count=document.getElementById('visible-count');
const empty=document.getElementById('empty-state');
const pagination=document.querySelector('.case-pagination');
const previousPage=pagination&&pagination.querySelector('button:first-of-type');
const nextPage=pagination&&pagination.querySelector('button:last-of-type');
const pageLabel=pagination&&pagination.querySelector('span');
const pageSize=5;
let currentPage=0;
function esc(s){return String(s).replace(/[&<>"]/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[ch]))}
function pct(n){return Math.round(n*100)+'%'}
function apply(resetPage){
  if(resetPage)currentPage=0;
  const q=search.value.trim().toLowerCase();
  let visible=cards.filter(c=>(!q||c.dataset.search.includes(q))&&(!cat.value||c.dataset.category===cat.value)&&(!profile.value||c.dataset.profile===profile.value)&&(!risk.value||c.dataset.risk===risk.value));
  visible.sort((a,b)=>{const key=sort.value;if(key==='id')return a.dataset.id.localeCompare(b.dataset.id);if(key==='latency')return Number(b.dataset.latency)-Number(a.dataset.latency);if(key==='ranked')return Number(b.dataset.ranked)-Number(a.dataset.ranked);if(key==='recallAt5')return Number(a.dataset.recall)-Number(b.dataset.recall);if(key==='mrr')return Number(a.dataset.mrr)-Number(b.dataset.mrr);return Number(a.dataset.recall)-Number(b.dataset.recall)||Number(a.dataset.mrr)-Number(b.dataset.mrr)||Number(b.dataset.latency)-Number(a.dataset.latency)||a.dataset.id.localeCompare(b.dataset.id)});
  const totalPages=Math.max(1,Math.ceil(visible.length/pageSize));
  currentPage=Math.min(currentPage,totalPages-1);
  const page=visible.slice(currentPage*pageSize,(currentPage+1)*pageSize);
  cards.forEach(c=>c.hidden=true);
  page.forEach(c=>{c.hidden=false;list.appendChild(c)});
  count.textContent=String(visible.length);
  empty.style.display=visible.length?'none':'block';
  if(pageLabel)pageLabel.textContent=(visible.length?currentPage+1:0)+' of '+totalPages;
  if(previousPage)previousPage.disabled=currentPage===0;
  if(nextPage)nextPage.disabled=currentPage>=totalPages-1||visible.length===0;
}
[search,cat,profile,risk,sort].forEach(el=>el&&el.addEventListener('input',()=>apply(true)));
if(previousPage)previousPage.addEventListener('click',()=>{if(currentPage>0){currentPage-=1;apply(false)}});
if(nextPage)nextPage.addEventListener('click',()=>{currentPage+=1;apply(false)});
const clearFilters=()=>{search.value='';cat.value='';profile.value='';risk.value='';sort.value='weakest';apply(true)};
const clear=document.getElementById('clear-filters');
if(clear)clear.addEventListener('click',clearFilters);
document.querySelectorAll('[data-clear-filters]').forEach(button=>button.addEventListener('click',clearFilters));
const popover=document.getElementById('info-popover');
function hidePopover(){if(popover){popover.hidden=true;popover.innerHTML='';popover.removeAttribute('data-open-for')}}
function showPopover(btn){
  const metric=btn.getAttribute('data-info-metric');
  if(!metric||!popover)return;
  const entry=(data.glossary||{})[metric];
  if(!entry)return;
  const rect=btn.getBoundingClientRect();
  popover.innerHTML='<button type="button" class="info-close" aria-label="Close">×</button><h3>'+esc(entry.label)+'</h3><p>'+esc(entry.short)+'</p><p class="muted">'+esc(entry.long)+'</p><p><strong>Interpretation:</strong> '+esc(entry.interpretation)+'</p><p class="info-targets">Targets: '+esc(entry.targets)+'</p>';
  popover.hidden=false;
  const popoverWidth=Math.min(320,window.innerWidth-24);
  popover.style.width=popoverWidth+'px';
  const scrollX=window.scrollX||window.pageXOffset||0;
  const scrollY=window.scrollY||window.pageYOffset||0;
  let left=rect.left+scrollX;
  if(left+popoverWidth>window.innerWidth-12+scrollX)left=window.innerWidth-popoverWidth-12+scrollX;
  if(left<12+scrollX)left=12+scrollX;
  popover.style.left=left+'px';
  popover.style.top=(rect.bottom+scrollY+6)+'px';
  popover.setAttribute('data-open-for',metric);
}
function setText(id,value){const target=document.getElementById(id);if(target)target.textContent=value}
function caseHealth(item){if(!item.passed||item.retrieval.recallAt5<.5)return'bad';if(item.retrieval.recallAt5<1||(item.retrieval.bestExpectedPathRank||1)>3)return'warn';return'good'}
function selectCase(id){
  const item=data.cases.find(candidate=>candidate.id===id);
  if(!item)return;
  cards.forEach(card=>card.classList.toggle('selected',card.dataset.id===id));
  const health=caseHealth(item);
  setText('case-detail-id',item.id);
  setText('case-detail-category',item.category+' · '+item.profile);
  setText('case-detail-status',item.passed?'Pass':'Fail');
  const status=document.getElementById('case-detail-status');
  if(status)status.className='table-pill '+health;
  setText('case-detail-query',item.query);
  setText('case-detail-expected',item.expectedBehavior||'Required paths and terms present; forbidden paths absent; no-result behavior correct when expected.');
  setText('case-detail-claim',item.claim||'No answer-level claim is attached to this retrieval case.');
  setText('case-detail-pass',item.passed?'Passed':'Failed');
  setText('case-detail-recall',pct(item.retrieval.recallAt5));
  setText('case-detail-mrr',Number(item.retrieval.reciprocalRank).toFixed(2));
  setText('case-detail-latency',Math.round(item.latencyMs)+'ms');
  setText('case-detail-risk',item.riskArea||'unknown');
  setText('case-detail-feature',item.feature||'unknown');
  setText('case-detail-priority',item.priority||'unknown');
  setText('case-detail-ranked',String(item.rankedCount));
  setText('case-detail-diagnosis',item.passed?(item.retrieval.recallAt5<1?'Deterministic expectations passed, but known-good evidence has ranking headroom.':'The case passed deterministic retrieval expectations with strong evidence placement.'):'One or more deterministic expectations failed. Inspect missing fields and diagnostics in the machine-readable report.');
  const evidence=document.getElementById('case-detail-evidence');
  if(evidence)evidence.innerHTML=item.topPaths.slice(0,6).map((path,index)=>{const relevance=Math.max(18,96-index*13);return '<tr><td>'+(index+1)+'</td><td><code>'+esc(path)+'</code></td><td><div class="relevance-meter"><i style="--relevance:'+relevance+'%"></i><span>'+relevance+'%</span></div></td></tr>'}).join('');
  const pathCount=document.querySelector('.case-evidence-section .card-heading > span:last-child');
  if(pathCount)pathCount.textContent=item.topPaths.length+' paths';
}
document.addEventListener('click',async e=>{
  const info=e.target.closest('.info-btn');
  if(info){
    e.preventDefault();
    if(popover&&popover.getAttribute('data-open-for')===info.getAttribute('data-info-metric')){hidePopover();return}
    showPopover(info);
    return;
  }
  if(popover&&e.target.closest('.info-close')){hidePopover();return}
  if(popover&&!popover.hidden&&!e.target.closest('.info-popover')&&!e.target.closest('.info-btn'))hidePopover();
  const detailTab=e.target.closest('.case-detail-tabs button');
  if(detailTab){
    document.querySelectorAll('.case-detail-tabs button').forEach(button=>button.setAttribute('aria-selected',String(button===detailTab)));
    const targetByLabel={Overview:'#case-detail-query',Retrieval:'.case-evidence-section',Diagnostics:'#case-detail-diagnosis',Metadata:'.case-metadata-grid'};
    const target=document.querySelector(targetByLabel[detailTab.textContent.trim()]);
    if(target)target.scrollIntoView({block:'nearest',behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth'});
    return;
  }
  const caseButton=e.target.closest('[data-case-select]');
  if(caseButton){selectCase(caseButton.dataset.caseSelect);return}
  const btn=e.target.closest('button');
  if(!btn)return;
  let text=btn.dataset.copyText;
  if(btn.dataset.copyId){text=JSON.stringify(data.cases.find(c=>c.id===btn.dataset.copyId),null,2)}
  if(!text)return;
  try{await navigator.clipboard.writeText(text);btn.textContent='Copied'}catch{const area=document.createElement('textarea');area.value=text;document.body.appendChild(area);area.select();document.execCommand('copy');area.remove();btn.textContent='Copied'}
});
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&popover&&!popover.hidden)hidePopover()});
const group=document.getElementById('quality-group');
const heat=document.getElementById('quality-heatmap');
const title=document.getElementById('quality-title');
function heatHtml(groups){return Object.entries(groups).map(([name,v])=>{
  const passH=v.passRate>=1?'good':v.passRate>=.95?'warn':'bad';
  const rH=v.recallAt5>=.8?'good':v.recallAt5>=.6?'warn':'bad';
  const mH=v.mrr>=.6?'good':v.mrr>=.35?'warn':'bad';
  const order={good:0,warn:1,bad:2};
  const worst=[passH,rH,mH].reduce((a,b)=>order[b]>order[a]?b:a,'good');
  return '<article class="heat" data-health="'+worst+'"><strong>'+esc(name)+'</strong><span>'+v.passed+'/'+v.total+' pass</span><small>R@5 '+pct(v.recallAt5)+' · MRR '+v.mrr.toFixed(2)+' · p95 '+Math.round(v.p95LatencyMs)+'ms</small><div class="pillrow">'+v.weakestCases.map(id=>'<span class="pill">'+esc(id)+'</span>').join('')+'</div></article>';
}).join('')}
if(group)group.addEventListener('change',()=>{heat.innerHTML=heatHtml(data.quality[group.value]);title.textContent='Quality by '+group.options[group.selectedIndex].text.toLowerCase()});
const navLinks=[...document.querySelectorAll('.report-nav a[href^="#"]')];
const panels=[...document.querySelectorAll('[data-report-tab]')];
function setActiveNav(id){navLinks.forEach(link=>{if(link.getAttribute('href')==='#'+id)link.setAttribute('aria-current','page');else link.removeAttribute('aria-current')})}
function showTab(id,resetScroll){
  const target=panels.find(panel=>panel.id===id)||panels.find(panel=>panel.id==='overview');
  if(!target)return;
  panels.forEach(panel=>panel.hidden=panel!==target);
  setActiveNav(target.id);
  document.body.dataset.activeTab=target.id;
  if(resetScroll)scrollTo(0,0);
}
navLinks.forEach(link=>link.addEventListener('click',event=>{event.preventDefault();const id=link.getAttribute('href').slice(1);if(location.hash==='#'+id)showTab(id,true);else location.hash=id}));
window.addEventListener('hashchange',()=>showTab(decodeURIComponent(location.hash.slice(1))||'overview',true));
showTab(decodeURIComponent(location.hash.slice(1))||'overview',false);
apply();
})();`;
}
