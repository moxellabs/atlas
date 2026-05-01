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
function esc(s){return String(s).replace(/[&<>"]/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[ch]))}
function pct(n){return Math.round(n*100)+'%'}
function apply(){
  const q=search.value.trim().toLowerCase();
  let visible=cards.filter(c=>(!q||c.dataset.search.includes(q))&&(!cat.value||c.dataset.category===cat.value)&&(!profile.value||c.dataset.profile===profile.value)&&(!risk.value||c.dataset.risk===risk.value));
  visible.sort((a,b)=>{const key=sort.value;if(key==='id')return a.dataset.id.localeCompare(b.dataset.id);if(key==='latency')return Number(b.dataset.latency)-Number(a.dataset.latency);if(key==='ranked')return Number(b.dataset.ranked)-Number(a.dataset.ranked);if(key==='recallAt5')return Number(a.dataset.recall)-Number(b.dataset.recall);if(key==='mrr')return Number(a.dataset.mrr)-Number(b.dataset.mrr);return Number(a.dataset.recall)-Number(b.dataset.recall)||Number(a.dataset.mrr)-Number(b.dataset.mrr)||Number(b.dataset.latency)-Number(a.dataset.latency)||a.dataset.id.localeCompare(b.dataset.id)});
  cards.forEach(c=>c.hidden=true);
  visible.forEach(c=>{c.hidden=false;list.appendChild(c)});
  count.textContent=String(visible.length);
  empty.style.display=visible.length?'none':'block';
}
[search,cat,profile,risk,sort].forEach(el=>el&&el.addEventListener('input',apply));
const clear=document.getElementById('clear-filters');
if(clear)clear.addEventListener('click',()=>{search.value='';cat.value='';profile.value='';risk.value='';sort.value='weakest';apply()});
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
  const heatLevel=Math.max(.08,Math.min(.45,v.recallAt5*.35+v.mrr*.1));
  return '<article class="heat" data-health="'+worst+'" style="--heat:'+heatLevel+'"><strong>'+esc(name)+'</strong><span class="muted">'+v.passed+'/'+v.total+' pass · R@5 '+pct(v.recallAt5)+' · MRR '+v.mrr.toFixed(2)+' · p95 '+Math.round(v.p95LatencyMs)+'ms</span><div class="pillrow">'+v.weakestCases.map(id=>'<span class="pill">'+esc(id)+'</span>').join('')+'</div></article>';
}).join('')}
if(group)group.addEventListener('change',()=>{heat.innerHTML=heatHtml(data.quality[group.value]);title.textContent='Quality by '+group.options[group.selectedIndex].text.toLowerCase()});
apply();
})();`;
}

