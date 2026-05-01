export function renderReportCss(): string {
	return `/* moxel-atlas-eval-report-theme */
:root{
	color-scheme:dark;
	font-family:"Space Grotesk",Inter,system-ui,sans-serif;
	--bg-900:#030711;
	--bg-800:#060b1a;
	--panel:rgba(4,9,18,.46);
	--panel-strong:rgba(3,7,17,.68);
	--line:rgba(70,215,255,.24);
	--line-strong:rgba(70,215,255,.5);
	--text:#f5f8ff;
	--muted:rgba(195,210,240,.72);
	--cyan:#35f0ff;
	--mint:#6df2d6;
	--good:#6df2d6;
	--good-strong:#35f0ff;
	--warn:#ffd166;
	--warn-strong:#ffb347;
	--bad:#ff6b8a;
	--bad-strong:#ff3366;
	--shadow:0 22px 54px rgba(2,8,26,.62);
}
*,*::before,*::after{box-sizing:border-box}
html,body{min-height:100%;margin:0;background:var(--bg-900);color:var(--text)}
body{overflow-x:hidden;font:15px/1.55 "Space Grotesk",Inter,system-ui,sans-serif}
canvas#banded-field{position:fixed;inset:0;width:100vw;height:100vh;display:block;z-index:0;pointer-events:none;background:transparent;opacity:.34}
.noise{position:fixed;inset:-15%;z-index:1;pointer-events:none;background:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='240' height='240' viewBox='0 0 240 240'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='1.2' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='240' height='240' filter='url(%23n)' opacity='0.25'/%3E%3C/svg%3E");mix-blend-mode:screen;animation:grain 8s steps(60) infinite;opacity:.18}
@keyframes grain{to{transform:translate3d(-6%,-4%,0)}}
.moxel-eval-body::before{content:"";position:fixed;inset:0;z-index:1;pointer-events:none;background:radial-gradient(circle at 18% 12%,rgba(90,204,255,.08),transparent 55%),radial-gradient(circle at 74% 78%,rgba(115,244,214,.06),transparent 62%)}
.report-shell{position:relative;z-index:2;width:min(1180px,100% - 1.5rem);margin:0 auto;padding:5rem 0 2.5rem;font-variant-numeric:tabular-nums}
@media(min-width:641px){.report-shell{width:min(1180px,100% - 2.5rem);padding:5.6rem 0 3rem}}
.topbar{position:fixed;top:0;left:0;right:0;z-index:5;display:flex;flex-wrap:wrap;gap:.6rem .9rem;align-items:center;min-height:3.8rem;padding:.65rem clamp(.85rem,2vw,2rem);border-bottom:1px solid var(--line);background:rgba(3,7,17,.9);backdrop-filter:blur(18px);text-transform:uppercase;letter-spacing:.14em}
.wordmark{font-weight:900;letter-spacing:.12em;font-size:.78rem}
.topmeta{flex:1 1 0;min-width:0;color:var(--muted);font-size:.66rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.status-pill{flex:0 0 auto;border:1px solid var(--line-strong);border-radius:999px;padding:.32rem .7rem;font-size:.7rem;font-weight:900;letter-spacing:.12em;display:inline-flex;align-items:center;gap:.4rem}
.status-pill::before{content:"";display:inline-block;width:.5rem;height:.5rem;border-radius:999px;background:currentColor;box-shadow:0 0 8px currentColor}
.status-pill[data-health="good"]{border-color:var(--good);background:rgba(109,242,214,.08);color:var(--good)}
.status-pill[data-health="warn"]{border-color:var(--warn);background:rgba(255,209,102,.10);color:var(--warn)}
.status-pill[data-health="bad"]{border-color:var(--bad);background:rgba(255,107,138,.12);color:var(--bad)}
a{color:var(--cyan);text-decoration:none}a:hover{text-decoration:underline}.muted{color:var(--muted)}
.panel,.card,.case-card,.kpi,.verdict{border:1px solid var(--line);border-radius:1.1rem;background:var(--panel);box-shadow:var(--shadow);backdrop-filter:blur(14px) saturate(112%)}
.verdict{padding:clamp(.95rem,2.2vw,1.4rem);margin-top:.9rem;display:grid;gap:.5rem;border-left:3px solid var(--line-strong)}
.verdict[data-health="good"]{border-left-color:var(--good-strong)}
.verdict[data-health="warn"]{border-left-color:var(--warn-strong)}
.verdict[data-health="bad"]{border-left-color:var(--bad-strong)}
.verdict .eyebrow{color:var(--muted)}
.verdict h1{margin:.1rem 0;font-size:clamp(1.35rem,3.2vw,2rem);line-height:1.15;letter-spacing:-.02em;font-weight:800;text-wrap:balance}
.verdict .lede{margin:0;color:rgba(245,248,255,.88);font-size:clamp(.92rem,1.4vw,1.05rem);line-height:1.5}
.lede,.muted,.chart-caption,.case-summary{ text-wrap:pretty }
.finding-msg,.attention-list li{ text-wrap:pretty }
.eyebrow{color:var(--mint);font-size:.68rem;font-weight:900;letter-spacing:.18em;text-transform:uppercase}
.kpi-strip{display:grid;grid-template-columns:repeat(auto-fit,minmax(155px,1fr));gap:.7rem;margin-top:.8rem}
.kpi{padding:.8rem .9rem;display:flex;flex-direction:column;gap:.2rem;border-left:3px solid transparent;position:relative}
.kpi .kpi-label{display:flex;align-items:center;gap:.35rem;color:var(--muted);font-size:.65rem;font-weight:800;letter-spacing:.12em;text-transform:uppercase}
.kpi .kpi-value{font-size:clamp(1.3rem,2.4vw,1.7rem);line-height:1.05;font-weight:800;letter-spacing:-.01em;font-variant-numeric:tabular-nums}
.kpi .kpi-desc{color:var(--muted);font-size:.74rem}
.kpi .kpi-delta{display:inline-flex;align-items:center;gap:.25rem;font-size:.7rem;font-weight:700;margin-top:.1rem}
.kpi[data-health="good"]{border-left-color:var(--good)}
.kpi[data-health="warn"]{border-left-color:var(--warn)}
.kpi[data-health="bad"]{border-left-color:var(--bad)}
.kpi[data-health="good"] .kpi-value{color:var(--good)}
.kpi[data-health="warn"] .kpi-value{color:var(--warn)}
.kpi[data-health="bad"] .kpi-value{color:var(--bad)}
.kpi-delta[data-trend="up-good"],.kpi-delta[data-trend="down-good"]{color:var(--good)}
.kpi-delta[data-trend="up-bad"],.kpi-delta[data-trend="down-bad"]{color:var(--bad)}
.kpi-delta[data-trend="flat"]{color:var(--muted)}
.info-btn{width:1.1rem;height:1.1rem;min-width:1.1rem;padding:0;border-radius:999px;border:1px solid var(--line);background:rgba(0,3,10,.55);color:var(--muted);font-size:.65rem;font-weight:900;line-height:1;display:inline-flex;align-items:center;justify-content:center;cursor:pointer;position:relative}
.info-btn::after{content:"";position:absolute;inset:-12px;border-radius:999px;pointer-events:auto;background:transparent}
.info-btn:hover,.info-btn:focus{color:var(--cyan);border-color:var(--line-strong);outline:none;box-shadow:0 0 0 2px rgba(53,240,255,.2)}
.info-popover{position:absolute;z-index:30;width:min(320px,calc(100vw - 1.5rem));padding:.9rem 1rem;border:1px solid var(--line-strong);border-radius:.9rem;background:rgba(3,7,17,.96);box-shadow:var(--shadow);color:var(--text);font-size:.82rem;line-height:1.45}
.info-popover[hidden]{display:none}
.info-popover h3{margin:0 0 .3rem;font-size:.95rem;font-weight:800}
.info-popover p{margin:.25rem 0}
.info-popover .info-targets{color:var(--muted);font-size:.75rem;margin-top:.4rem;padding-top:.4rem;border-top:1px dashed var(--line)}
.info-popover .info-close{position:absolute;top:.35rem;right:.5rem;border:none;background:transparent;color:var(--muted);font-size:.9rem;cursor:pointer;padding:.15rem .35rem}
.chart-grid,.quality-grid,.controls{display:grid;gap:.9rem}
.chart-grid{grid-template-columns:repeat(auto-fit,minmax(360px,1fr));margin-top:1rem}
.panel{margin-top:1rem;padding:.95rem;border-left:3px solid transparent}
.panel[data-health="good"]{border-left-color:var(--good)}
.panel[data-health="warn"]{border-left-color:var(--warn)}
.panel[data-health="bad"]{border-left-color:var(--bad)}
.panel h2{margin:.1rem 0 .7rem;font-size:1.18rem;display:flex;align-items:center;gap:.4rem;flex-wrap:wrap;text-wrap:balance}
.panel h3{font-size:1rem;margin:.8rem 0 .4rem}
.callout{border-color:rgba(255,209,102,.34);background:linear-gradient(135deg,rgba(255,209,102,.10),rgba(53,240,255,.05))}
.callout[data-health="good"]{border-color:rgba(109,242,214,.30);background:linear-gradient(135deg,rgba(109,242,214,.10),rgba(53,240,255,.04))}
.callout[data-health="bad"]{border-color:rgba(255,107,138,.34);background:linear-gradient(135deg,rgba(255,107,138,.12),rgba(53,240,255,.04))}
.findings-list{margin:.4rem 0 .1rem;padding:0;list-style:none;display:grid;gap:.45rem}
.finding{display:grid;grid-template-columns:auto 1fr auto;gap:.5rem;align-items:baseline;padding:.5rem .7rem;border:1px solid var(--line);border-radius:.7rem;background:rgba(0,3,10,.28)}
.finding[data-health="good"]{border-color:rgba(109,242,214,.3)}
.finding[data-health="warn"]{border-color:rgba(255,209,102,.34)}
.finding[data-health="bad"]{border-color:rgba(255,107,138,.36)}
.finding-label{font-weight:800}
.finding-value{font-variant-numeric:tabular-nums;font-weight:800}
.finding-value[data-health="good"]{color:var(--good)}
.finding-value[data-health="warn"]{color:var(--warn)}
.finding-value[data-health="bad"]{color:var(--bad)}
.finding-msg{grid-column:1/-1;color:var(--muted);font-size:.82rem}
.chart-frame{border:1px solid rgba(70,215,255,.15);border-radius:.9rem;background:rgba(0,3,10,.18);box-shadow:inset 0 0 0 1px rgba(0,0,0,.24);overflow:hidden}
.chart-frame svg{width:100%;height:auto;display:block}
.chart-panel svg{width:100%;height:auto;display:block}
.chart-caption{margin:.6rem 0 0;color:var(--muted);font-size:.82rem}
.chart-legend{display:flex;flex-wrap:wrap;gap:.45rem;margin-top:.7rem}
.bars{display:grid;gap:.55rem}
.bar{display:grid;grid-template-columns:minmax(120px,150px) 1fr 62px;gap:.65rem;align-items:center}
.track{height:.55rem;border:1px solid var(--line);border-radius:999px;background:rgba(0,3,10,.48);overflow:hidden}
.fill{height:100%;border-radius:999px;background:var(--cyan)}
.fill[data-health="good"]{background:var(--good)}
.fill[data-health="warn"]{background:var(--warn)}
.fill[data-health="bad"]{background:var(--bad)}
.heatmap{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:.7rem}
.heat{border:1px solid var(--line);border-radius:.9rem;padding:.75rem;background:linear-gradient(135deg,rgba(53,240,255,var(--heat)),rgba(109,242,214,.05))}
.heat[data-health="good"]{border-color:rgba(109,242,214,.34);background:linear-gradient(135deg,rgba(109,242,214,var(--heat)),rgba(3,7,17,.3))}
.heat[data-health="warn"]{border-color:rgba(255,209,102,.34);background:linear-gradient(135deg,rgba(255,209,102,var(--heat)),rgba(3,7,17,.3))}
.heat[data-health="bad"]{border-color:rgba(255,107,138,.34);background:linear-gradient(135deg,rgba(255,107,138,var(--heat)),rgba(3,7,17,.3))}
.heat strong{display:block}
.pillrow{display:flex;flex-wrap:wrap;gap:.35rem}
.pill{display:inline-flex;gap:.25rem;border:1px solid var(--line);border-radius:999px;padding:.18rem .5rem;background:rgba(53,240,255,.05);color:rgba(245,248,255,.86);font-size:.72rem}
.tag{border:1px solid var(--line);border-radius:.55rem;padding:.18rem .42rem;color:var(--muted);font-size:.72rem;display:inline-flex;align-items:center;gap:.25rem}
.tag[data-health="good"]{border-color:rgba(109,242,214,.35);color:var(--good)}
.tag[data-health="warn"]{border-color:rgba(255,209,102,.35);color:var(--warn)}
.tag[data-health="bad"]{border-color:rgba(255,107,138,.4);color:var(--bad)}
.controls{grid-template-columns:1fr;align-items:end}
@media(min-width:641px){.controls{grid-template-columns:1.6fr repeat(3,1fr) .9fr auto}}
.control label{display:block;margin-bottom:.3rem;color:var(--muted);font-size:.68rem;font-weight:800;text-transform:uppercase;letter-spacing:.1em}
input,select,button{width:100%;border:1px solid var(--line);border-radius:.75rem;background:rgba(0,3,10,.55);color:var(--text);padding:.55rem .7rem;font:inherit}
button{cursor:pointer;transition-property:transform,box-shadow,border-color,filter,opacity;transition-duration:150ms;transition-timing-function:cubic-bezier(0.2,0,0,1)}
button:active{transform:scale(.96)}
button:hover,button:focus{border-color:var(--line-strong);box-shadow:0 0 0 3px rgba(53,240,255,.1)}
.case-list{display:grid;gap:.6rem;margin-top:1rem;max-height:72vh;overflow:auto;padding-right:.35rem;scrollbar-color:rgba(53,240,255,.35) rgba(3,7,17,.35)}
.case-card{padding:.8rem}
.case-head{display:grid;grid-template-columns:1fr auto;gap:.75rem;align-items:start}
.case-title{margin:0;font-size:.94rem}
.case-summary{margin:.5rem 0;color:rgba(245,248,255,.86);font-size:.88rem}
.scoreline{display:flex;flex-wrap:wrap;gap:.4rem;margin:.5rem 0}
.section-details>summary{list-style:none;cursor:pointer;padding:.25rem 0;display:flex;align-items:center;gap:.6rem;justify-content:space-between;flex-wrap:wrap}
.section-details>summary::-webkit-details-marker{display:none}
.section-details>summary::after{content:"+";font-weight:800;color:var(--cyan);border:1px solid var(--line);border-radius:999px;padding:.05rem .5rem}
.section-details[open]>summary::after{content:"−"}
details.section-details{margin-top:.55rem}
summary{cursor:pointer;color:var(--cyan);transition-property:transform,opacity;transition-duration:150ms;transition-timing-function:cubic-bezier(0.2,0,0,1)}
summary:active{transform:scale(.96)}
pre,code{font-family:SFMono-Regular,Cascadia Code,Roboto Mono,ui-monospace,monospace}
pre{overflow:auto;max-height:180px;border:1px solid var(--line);border-radius:.7rem;padding:.6rem;background:rgba(0,3,10,.52);white-space:pre-wrap;font-size:.78rem}
.cols{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:.7rem}
.attention-list{display:grid;gap:.4rem;margin:.5rem 0 0;padding:0;list-style:none}
.attention-list li{padding:.4rem .6rem;border:1px solid var(--line);border-radius:.65rem;background:rgba(0,3,10,.3);font-size:.82rem;display:flex;gap:.4rem;align-items:baseline}
.attention-list li[data-health="warn"]{border-color:rgba(255,209,102,.34)}
.attention-list li[data-health="bad"]{border-color:rgba(255,107,138,.36)}
.table-wrap{max-height:62vh;overflow:auto;border:1px solid var(--line);border-radius:.8rem}
table{width:100%;border-collapse:collapse;min-width:720px}
th,td{border-bottom:1px solid var(--line);padding:.5rem;text-align:left;vertical-align:top}
th{position:sticky;top:0;background:rgba(3,7,17,.94);color:var(--muted);font-size:.7rem;text-transform:uppercase;letter-spacing:.1em}
.fallback summary{list-style:none;cursor:pointer}
.fallback summary::-webkit-details-marker{display:none}
.fallback-summary{display:flex;justify-content:space-between;gap:1rem;align-items:center;flex-wrap:wrap}
.fallback:not([open]){padding:1rem}
.empty{display:none;color:var(--warn);padding:1rem}
@media(max-width:640px){
	.report-shell{padding-top:4.6rem}
	.chart-grid{grid-template-columns:1fr}
	.kpi-strip{grid-template-columns:repeat(2,1fr)}
	.bar{grid-template-columns:minmax(110px,1fr) 2fr 46px;gap:.4rem}
	.panel h2{font-size:1.06rem}
	.topbar{letter-spacing:.08em}
	.topmeta{flex-basis:100%;order:3}
}
@media(prefers-reduced-motion:reduce){*,.noise{animation:none!important;transition:none!important}}
`;
}
