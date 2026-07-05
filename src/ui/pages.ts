import type { ClientQuestion } from "../quiz/schema";

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export const HONEYPOT_FIELD_NAME = "contact_url";

const questionMeta: Record<ClientQuestion["type"], { label: string; hint: string }> = {
  consequence_mcq: {
    label: "Consequence check",
    hint: "Choose the outcome that follows from the PR.",
  },
  blast_radius_multi: {
    label: "Blast radius",
    hint: "Select every affected area.",
  },
  false_claim: {
    label: "False claim",
    hint: "Pick the statement that misrepresents the change.",
  },
};

const choiceLabels = ["A", "B", "C", "D"] as const;

const STYLE = `
:root{
  color-scheme:light dark;
  --bg:#f6f7f8;
  --bg:oklch(0.972 0.004 245);
  --canvas:#ffffff;
  --canvas:oklch(1 0 0);
  --panel:#fbfcfd;
  --panel:oklch(0.99 0.003 245);
  --panel-2:#f1f4f6;
  --panel-2:oklch(0.955 0.007 245);
  --bar:#11161d;
  --bar:oklch(0.19 0.022 245);
  --bar-2:#171e27;
  --bar-2:oklch(0.235 0.026 245);
  --ink:#141820;
  --ink:oklch(0.22 0.02 245);
  --ink-dim:#4f5968;
  --ink-dim:oklch(0.45 0.025 245);
  --ink-faint:#6d7786;
  --ink-faint:oklch(0.53 0.022 245);
  --ink-on-dark:#f4f7fa;
  --ink-on-dark:oklch(0.965 0.006 245);
  --ink-dark-dim:#b8c2cf;
  --ink-dark-dim:oklch(0.79 0.024 245);
  --line:#dfe4ea;
  --line:oklch(0.9 0.009 245);
  --line-strong:#c6ced8;
  --line-strong:oklch(0.82 0.015 245);
  --brand:#ff5f3f;
  --brand:oklch(0.69 0.2 35);
  --brand-soft:#ffe1d9;
  --brand-soft:oklch(0.91 0.055 35);
  --brand-ink:#361004;
  --brand-ink:oklch(0.21 0.067 35);
  --accent:#b43a20;
  --accent:oklch(0.48 0.155 35);
  --ok:#21a66a;
  --ok:oklch(0.63 0.16 157);
  --ok-soft:#ddf7ea;
  --ok-soft:oklch(0.94 0.046 157);
  --warn:#b56d00;
  --warn:oklch(0.58 0.13 68);
  --warn-soft:#fff1d3;
  --warn-soft:oklch(0.94 0.06 78);
  --crit:#d93636;
  --crit:oklch(0.58 0.2 25);
  --crit-soft:#ffe0df;
  --crit-soft:oklch(0.92 0.06 24);
  --info:#4169a8;
  --info:oklch(0.52 0.105 255);
  --info-soft:#e4ecfb;
  --info-soft:oklch(0.93 0.035 255);
  --focus:#ff8a70;
  --focus:oklch(0.78 0.14 35);
  --radius:16px;
  --radius-sm:10px;
  --ease:cubic-bezier(.22,1,.36,1);
  --sans:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;
  --mono:ui-monospace,"SF Mono","JetBrains Mono",Menlo,Consolas,monospace;
}
@media (prefers-color-scheme:dark){
  :root{
    --bg:#0e1116;
    --bg:oklch(0.16 0.018 245);
    --canvas:#151a22;
    --canvas:oklch(0.22 0.022 245);
    --panel:#181f28;
    --panel:oklch(0.25 0.025 245);
    --panel-2:#202936;
    --panel-2:oklch(0.31 0.028 245);
    --ink:#f2f5f8;
    --ink:oklch(0.955 0.006 245);
    --ink-dim:#c2cbd6;
    --ink-dim:oklch(0.81 0.02 245);
    --ink-faint:#8f9bad;
    --ink-faint:oklch(0.66 0.025 245);
    --line:#303b49;
    --line:oklch(0.37 0.026 245);
    --line-strong:#4a5869;
    --line-strong:oklch(0.48 0.03 245);
    --brand-soft:#3a211d;
    --brand-soft:oklch(0.29 0.055 35);
    --accent:#ff9a84;
    --accent:oklch(0.79 0.125 35);
    --ok-soft:#19362a;
    --warn-soft:#3a2f18;
    --crit-soft:#3a2022;
    --info-soft:#1d2b42;
  }
}
*{box-sizing:border-box}
html,body{margin:0}
body{
  min-height:100vh;
  margin:0;
  padding:24px;
  background:var(--bg);
  color:var(--ink);
  font:400 1rem/1.55 var(--sans);
  font-kerning:normal;
}
button,input{font:inherit}
.wrap{width:100%; max-width:1180px; margin:auto}
.app{
  min-height:700px;
  overflow:hidden;
  border:1px solid var(--line);
  border-radius:var(--radius);
  background:var(--canvas);
}
.commandbar{
  min-height:72px;
  display:flex;
  align-items:center;
  justify-content:space-between;
  gap:18px;
  padding:14px 20px;
  background:linear-gradient(180deg,var(--bar-2),var(--bar));
  color:var(--ink-on-dark);
}
.brand-lockup,.command-context,.command-meta{
  display:flex;
  align-items:center;
  min-width:0;
}
.brand-lockup{gap:12px}
.mark{
  width:36px;
  height:36px;
  flex:none;
  display:grid;
  place-items:center;
  border-radius:10px;
  background:var(--brand);
  color:var(--brand-ink);
  font-weight:850;
  line-height:1;
}
.brand-name{
  font-size:1.08rem;
  font-weight:780;
  letter-spacing:0;
}
.command-context{
  flex:1;
  gap:14px;
  color:var(--ink-dark-dim);
}
.command-sep{
  width:1px;
  height:28px;
  background:color-mix(in oklch,var(--ink-on-dark) 16%,transparent);
}
.command-title{
  color:var(--ink-on-dark);
  font-weight:650;
  white-space:nowrap;
}
.command-ref{
  min-width:0;
  overflow:hidden;
  color:var(--ink-dark-dim);
  font:650 .9rem/1.2 var(--mono);
  text-overflow:ellipsis;
  white-space:nowrap;
}
.command-meta{
  gap:12px;
  color:var(--ink-dark-dim);
  font-size:.94rem;
}
.command-pill{
  display:inline-flex;
  align-items:center;
  gap:8px;
  min-height:34px;
  padding:0 11px;
  border:1px solid color-mix(in oklch,var(--ink-on-dark) 18%,transparent);
  border-radius:999px;
  color:var(--ink-on-dark);
  background:color-mix(in oklch,var(--ink-on-dark) 4%,transparent);
  white-space:nowrap;
}
.seal{
  width:18px;
  height:18px;
  flex:none;
  border:1.5px solid currentColor;
  border-radius:6px 6px 8px 8px;
  display:inline-grid;
  place-items:center;
  font-size:.74rem;
  line-height:1;
}
.console{
  display:grid;
  grid-template-columns:minmax(0,1fr) 360px;
  min-height:628px;
}
.workspace{
  min-width:0;
  display:flex;
  flex-direction:column;
  padding:42px 44px 0;
}
.context-panel{
  display:flex;
  flex-direction:column;
  gap:18px;
  padding:34px 28px;
  border-left:1px solid var(--line);
  background:var(--panel);
}
.prelude{
  max-width:760px;
  margin:auto 0;
  padding-bottom:44px;
}
.kicker-row{
  display:flex;
  align-items:center;
  flex-wrap:wrap;
  gap:10px;
  margin-bottom:20px;
}
.pill{
  display:inline-flex;
  align-items:center;
  min-height:30px;
  padding:0 11px;
  border-radius:999px;
  background:var(--brand-soft);
  color:var(--accent);
  font-weight:750;
}
.ref{
  overflow-wrap:anywhere;
  color:var(--ink-dim);
  font:650 .9rem/1.3 var(--mono);
}
h1,h2,h3,p{margin:0}
h1{
  max-width:13em;
  font-size:2.45rem;
  line-height:1.08;
  font-weight:790;
  letter-spacing:0;
  text-wrap:balance;
}
.lead{
  max-width:65ch;
  margin-top:18px;
  color:var(--ink-dim);
  font-size:1.04rem;
  text-wrap:pretty;
}
.lead b{color:var(--ink); font-weight:730}
.rail{
  display:grid;
  grid-template-columns:repeat(var(--steps),1fr);
  gap:0;
  position:relative;
  margin:0 0 30px;
  padding:0;
  list-style:none;
}
.rail::before,.rail::after{
  content:"";
  position:absolute;
  left:14px;
  right:14px;
  top:14px;
  height:3px;
  border-radius:999px;
}
.rail::before{background:var(--line)}
.rail::after{
  right:auto;
  width:calc(100% - 28px);
  background:var(--brand);
  transform:scaleX(var(--rail-scale));
  transform-origin:left center;
  transition:transform .25s linear;
}
.rail li{
  position:relative;
  display:flex;
  flex-direction:column;
  align-items:center;
  gap:8px;
  color:var(--ink-faint);
  font-size:.84rem;
  font-weight:650;
}
.rail b{
  z-index:1;
  width:30px;
  height:30px;
  display:grid;
  place-items:center;
  border:1px solid var(--line-strong);
  border-radius:999px;
  background:var(--canvas);
  color:var(--ink-faint);
  font:800 .8rem/1 var(--mono);
}
.rail li.done b{
  border-color:color-mix(in oklch,var(--ok) 55%,var(--line));
  background:var(--ok-soft);
  color:var(--ok);
}
.rail li.active{color:var(--ink)}
.rail li.active b{
  border-color:var(--brand);
  background:var(--brand);
  color:var(--brand-ink);
}
.question-top{
  display:flex;
  align-items:center;
  justify-content:space-between;
  gap:18px;
  margin-bottom:18px;
}
.step{
  color:var(--ink-dim);
  font-weight:750;
}
.step em{
  color:var(--accent);
  font-style:normal;
}
.timer{
  flex:none;
  min-width:86px;
  display:inline-flex;
  justify-content:center;
  align-items:baseline;
  gap:3px;
  padding:9px 13px;
  border:1px solid var(--line-strong);
  border-radius:999px;
  background:var(--panel);
  color:var(--ink);
  font:800 1rem/1 var(--mono);
  font-variant-numeric:tabular-nums;
  transition:color .2s var(--ease),border-color .2s var(--ease),background .2s var(--ease);
}
.timer .u{color:var(--ink-faint); font-size:.76rem}
.timer.warn{
  border-color:color-mix(in oklch,var(--warn) 55%,var(--line));
  background:var(--warn-soft);
  color:var(--warn);
}
.timer.crit{
  border-color:var(--crit);
  background:var(--crit);
  color:white;
}
.timer.crit .u{color:color-mix(in oklch,white 76%,var(--crit))}
.question-type{
  margin-bottom:12px;
  color:var(--accent);
  font-weight:770;
}
.qh{
  max-width:28em;
  color:var(--ink);
  font-size:1.75rem;
  line-height:1.2;
  font-weight:780;
  letter-spacing:0;
  text-wrap:balance;
}
.hint{
  max-width:68ch;
  margin-top:13px;
  color:var(--ink-dim);
  font-size:.98rem;
  text-wrap:pretty;
}
.answer-form{
  display:flex;
  flex:1;
  flex-direction:column;
  position:relative;
  margin-top:30px;
}
.opts{
  display:grid;
  gap:12px;
  margin:0;
  padding:0 0 26px;
  border:0;
}
.sr-only{
  position:absolute;
  width:1px;
  height:1px;
  overflow:hidden;
  clip:rect(0,0,0,0);
  white-space:nowrap;
}
.honeypot-field{
  position:absolute;
  left:-10000px;
  top:auto;
  width:1px;
  height:1px;
  overflow:hidden;
  opacity:0;
  pointer-events:none;
}
.honeypot-field input{
  width:1px;
  height:1px;
}
.opt{
  position:relative;
  display:grid;
  grid-template-columns:38px minmax(0,1fr);
  gap:15px;
  align-items:center;
  min-height:64px;
  padding:13px 16px;
  border:1px solid var(--line);
  border-radius:var(--radius-sm);
  background:var(--canvas);
  color:var(--ink);
  cursor:pointer;
  transition:border-color .16s var(--ease),background .16s var(--ease),transform .1s var(--ease);
}
@media (hover:hover){
  .opt:hover{
    border-color:color-mix(in oklch,var(--brand) 55%,var(--line-strong));
    background:color-mix(in oklch,var(--brand-soft) 45%,var(--canvas));
  }
}
.opt:active{transform:translateY(1px)}
.opt input{
  position:absolute;
  opacity:0;
  width:0;
  height:0;
}
.choice-letter{
  width:34px;
  height:34px;
  display:grid;
  place-items:center;
  border:1px solid var(--line-strong);
  border-radius:9px;
  color:var(--ink-dim);
  background:var(--panel);
  font:800 .86rem/1 var(--mono);
}
.opt input[type=radio]~.choice-letter{border-radius:999px}
.opt:has(input:checked){
  border-color:var(--brand);
  background:color-mix(in oklch,var(--brand-soft) 64%,var(--canvas));
}
.opt:has(input:checked) .choice-letter{
  border-color:var(--brand);
  background:var(--brand);
  color:var(--brand-ink);
}
.opt .t{
  min-width:0;
  overflow-wrap:anywhere;
  font-size:1rem;
}
.actionbar{
  position:sticky;
  bottom:0;
  display:flex;
  align-items:center;
  justify-content:space-between;
  gap:18px;
  margin:0 -44px;
  padding:18px 44px;
  border-top:1px solid var(--line);
  background:color-mix(in oklch,var(--canvas) 96%,transparent);
}
.choice-status{
  min-width:0;
  color:var(--ink-faint);
  font-size:.92rem;
}
.action-group{
  display:flex;
  align-items:center;
  gap:12px;
}
.btn,.btn-secondary{
  min-height:48px;
  border-radius:var(--radius-sm);
  cursor:pointer;
  font-weight:760;
  transition:transform .12s var(--ease),filter .18s var(--ease),background .18s var(--ease),border-color .18s var(--ease),opacity .18s var(--ease);
}
.btn{
  min-width:190px;
  border:0;
  padding:0 20px;
  background:var(--brand);
  color:var(--brand-ink);
  box-shadow:0 6px 8px -7px color-mix(in oklch,var(--brand) 80%,black);
}
.btn-secondary{
  border:1px solid var(--line-strong);
  padding:0 16px;
  background:var(--canvas);
  color:var(--ink);
}
@media (hover:hover){
  .btn:hover{filter:brightness(1.04)}
  .btn-secondary:hover{border-color:var(--ink-faint); background:var(--panel-2)}
}
.btn:active,.btn-secondary:active{transform:translateY(1px)}
.btn:disabled{
  cursor:not-allowed;
  opacity:.48;
  filter:saturate(.75);
}
.btn:focus-visible,.btn-secondary:focus-visible,.opt:has(input:focus-visible){
  outline:3px solid var(--focus);
  outline-offset:3px;
}
.start-actions{
  display:flex;
  flex-wrap:wrap;
  position:relative;
  gap:12px;
  margin-top:30px;
}
.turnstile-box{
  position:relative;
  min-height:76px;
  min-width:min(100%,320px);
  display:flex;
  align-items:center;
  justify-content:center;
  padding:10px;
  border:1px solid var(--line);
  border-radius:var(--radius-sm);
  background:var(--panel);
}
.cf-turnstile{
  position:relative;
  z-index:1;
  min-height:0;
}
.turnstile-fallback{
  position:absolute;
  inset:0;
  display:grid;
  place-items:center;
  padding:12px;
  color:var(--ink-faint);
  font-size:.9rem;
  text-align:center;
}
.turnstile-box:has(.cf-turnstile iframe) .turnstile-fallback{display:none}
.context-tabs{
  display:flex;
  align-items:center;
  gap:18px;
  border-bottom:1px solid var(--line);
}
.context-tab{
  padding:0 0 10px;
  border-bottom:2px solid transparent;
  color:var(--ink-dim);
  font-weight:680;
}
.context-tab.active{
  border-color:var(--brand);
  color:var(--ink);
}
.context-section{
  display:grid;
  gap:12px;
}
.context-section h2,.context-section h3{
  color:var(--ink);
  font-size:1rem;
  font-weight:780;
}
.info-list{
  display:grid;
  gap:10px;
}
.info-item{
  display:grid;
  grid-template-columns:28px minmax(0,1fr);
  gap:10px;
  align-items:start;
  color:var(--ink-dim);
  font-size:.94rem;
}
.info-icon{
  width:28px;
  height:28px;
  display:grid;
  place-items:center;
  border:1px solid var(--line);
  border-radius:9px;
  background:var(--canvas);
  color:var(--accent);
  font:800 .78rem/1 var(--mono);
}
.info-item b{
  display:block;
  color:var(--ink);
  font-weight:730;
}
.state-card,.metric{
  border:1px solid var(--line);
  border-radius:var(--radius-sm);
  background:var(--canvas);
}
.state-card{
  display:grid;
  gap:12px;
  padding:15px;
}
.state-card p{
  color:var(--ink-dim);
  font-size:.94rem;
  text-wrap:pretty;
}
.status-strip{
  display:flex;
  align-items:center;
  gap:12px;
  min-height:54px;
  padding:12px 14px;
  border:1px solid var(--line);
  border-radius:var(--radius-sm);
  background:var(--canvas);
  color:var(--ink);
}
.status-strip.ok{border-color:color-mix(in oklch,var(--ok) 45%,var(--line)); background:var(--ok-soft)}
.status-strip.warn{border-color:color-mix(in oklch,var(--warn) 45%,var(--line)); background:var(--warn-soft)}
.status-strip.crit{border-color:color-mix(in oklch,var(--crit) 45%,var(--line)); background:var(--crit-soft)}
.status-strip.info{border-color:color-mix(in oklch,var(--info) 45%,var(--line)); background:var(--info-soft)}
.status-dot{
  width:28px;
  height:28px;
  flex:none;
  display:grid;
  place-items:center;
  border-radius:999px;
  background:var(--canvas);
  color:currentColor;
  font-weight:850;
}
.status-strip.ok .status-dot{color:var(--ok)}
.status-strip.warn .status-dot{color:var(--warn)}
.status-strip.crit .status-dot{color:var(--crit)}
.status-strip.info .status-dot{color:var(--info)}
.status-copy{
  min-width:0;
  display:grid;
  gap:2px;
}
.status-copy b{font-weight:760}
.status-copy span{color:var(--ink-dim); font-size:.88rem}
.metric{
  display:grid;
  gap:4px;
  padding:14px;
}
.metric .k{
  color:var(--ink-faint);
  font-size:.82rem;
}
.metric .v{
  color:var(--ink);
  font-weight:780;
}
.result-layout,.status-layout{
  display:grid;
  grid-template-columns:minmax(0,1fr) 340px;
  min-height:628px;
}
.result-main,.status-main{
  display:grid;
  align-content:center;
  padding:56px 54px;
}
.result-panel,.status-panel{
  max-width:620px;
}
.badge{
  width:72px;
  height:72px;
  margin-bottom:22px;
  display:grid;
  place-items:center;
  border-radius:16px;
  font-size:2rem;
  font-weight:850;
}
.badge.ok{
  border:1px solid color-mix(in oklch,var(--ok) 58%,var(--line));
  background:var(--ok-soft);
  color:var(--ok);
}
.badge.no,.badge.warn{
  border:1px solid color-mix(in oklch,var(--warn) 58%,var(--line));
  background:var(--warn-soft);
  color:var(--warn);
}
.badge.crit{
  border:1px solid color-mix(in oklch,var(--crit) 58%,var(--line));
  background:var(--crit-soft);
  color:var(--crit);
}
.badge.info{
  border:1px solid color-mix(in oklch,var(--info) 58%,var(--line));
  background:var(--info-soft);
  color:var(--info);
}
.result-label,.status-label{
  margin-bottom:10px;
  color:var(--accent);
  font-weight:760;
}
.score{
  margin:22px 0 16px;
  color:var(--ink);
  font:850 3rem/1 var(--sans);
  font-variant-numeric:tabular-nums;
}
.score .of{
  color:var(--ink-faint);
  font-size:1.35rem;
  font-weight:720;
}
.result-copy,.status-copy-large{
  max-width:62ch;
  color:var(--ink-dim);
  font-size:1.02rem;
  text-wrap:pretty;
}
.result-side,.status-side{
  display:flex;
  flex-direction:column;
  gap:16px;
  padding:34px 28px;
  border-left:1px solid var(--line);
  background:var(--panel);
}
@keyframes settle{from{opacity:.001; transform:translateY(6px)} to{opacity:1; transform:none}}
.app{animation:settle .22s var(--ease) both}
@media (prefers-reduced-motion:reduce){
  *,*::before,*::after{
    animation-duration:.001ms!important;
    animation-iteration-count:1!important;
    scroll-behavior:auto!important;
    transition:none!important;
  }
}
@media (max-width:940px){
  body{padding:14px}
  .commandbar{
    align-items:flex-start;
    flex-direction:column;
    gap:12px;
  }
  .command-context{
    width:100%;
    flex-wrap:wrap;
  }
  .command-meta{flex-wrap:wrap}
  .console,.result-layout,.status-layout{grid-template-columns:1fr; min-height:0}
  .workspace{padding:32px 24px 0}
  .context-panel,.result-side,.status-side{
    border-left:0;
    border-top:1px solid var(--line);
    padding:24px;
  }
  .actionbar{
    margin:0 -24px;
    padding:16px 24px;
  }
  h1{font-size:2.05rem}
  .qh{font-size:1.45rem}
}
@media (max-width:560px){
  .brand-name{font-size:1rem}
  .command-sep{display:none}
  .command-pill{min-height:30px}
  .workspace{padding:26px 18px 0}
  .prelude{padding-bottom:28px}
  .rail li span{display:none}
  .rail{margin-bottom:24px}
  .question-top{
    align-items:flex-start;
    flex-direction:column;
  }
  .timer{min-width:80px}
  h1{font-size:1.78rem}
  .qh{font-size:1.28rem}
  .opt{
    grid-template-columns:32px minmax(0,1fr);
    padding:12px;
  }
  .choice-letter{
    width:30px;
    height:30px;
  }
  .actionbar{
    align-items:stretch;
    flex-direction:column;
    margin:0 -18px;
    padding:14px 18px;
  }
  .action-group{
    display:grid;
    grid-template-columns:1fr;
  }
  .btn,.btn-secondary{width:100%; min-width:0}
  .result-main,.status-main{padding:38px 24px}
}
`;

function layout(title: string, body: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="color-scheme" content="light dark">
<title>${esc(title)} — Clawptcha</title>
<style>${STYLE}</style></head>
<body><main class="wrap">${body}</main></body></html>`;
}

function commandBar(tag: string, prRef?: string, timerHtml = ""): string {
  return `<header class="commandbar">
  <div class="brand-lockup"><span class="mark" aria-hidden="true">C</span><span class="brand-name">Clawptcha</span></div>
  <div class="command-context">
    <span class="command-sep" aria-hidden="true"></span>
    <span class="command-title">${esc(tag)}</span>
    ${prRef ? `<span class="command-sep" aria-hidden="true"></span><span class="command-ref">${esc(prRef)}</span>` : ""}
  </div>
  <div class="command-meta">
    <span class="command-pill"><span class="seal" aria-hidden="true">✓</span>Summary telemetry only</span>
    ${timerHtml}
  </div>
</header>`;
}

function progressRail(index: number, total: number): string {
  const pct = total <= 1 ? 100 : Math.max(0, Math.min(100, (index / (total - 1)) * 100));
  const items = Array.from({ length: total }, (_, i) => {
    const state = i < index ? "done" : i === index ? "active" : "";
    const mark = i < index ? "✓" : String(i + 1);
    return `<li class="${state}"><b>${mark}</b><span>${i === index ? "Current" : `Question ${i + 1}`}</span></li>`;
  }).join("");
  return `<ol class="rail" style="--steps:${total};--rail-scale:${pct / 100}">${items}</ol>`;
}

function stageRail(stage: "verify" | "answer" | "attest"): string {
  const stages = [
    ["verify", "Verify"],
    ["answer", "Answer"],
    ["attest", "Attest"],
  ] as const;
  const activeIndex = stages.findIndex(([id]) => id === stage);
  const items = stages.map(([id, label], i) => {
    const state = i < activeIndex ? "done" : id === stage ? "active" : "";
    const mark = i < activeIndex ? "✓" : String(i + 1);
    return `<li class="${state}"><b>${mark}</b><span>${label}</span></li>`;
  }).join("");
  return `<ol class="rail" style="--steps:3;--rail-scale:${activeIndex / 2}">${items}</ol>`;
}

function contextPanel(prRef: string, variant: "start" | "question"): string {
  return `<aside class="context-panel" aria-label="Challenge context">
  <div class="context-tabs" aria-hidden="true">
    <span class="context-tab active">PR summary</span>
    <span class="context-tab">Policy</span>
  </div>
  <section class="context-section">
    <h2>${esc(prRef)}</h2>
    <div class="info-list">
      <div class="info-item"><span class="info-icon">4</span><span><b>Four questions</b>One at a time. No back navigation.</span></div>
      <div class="info-item"><span class="info-icon">90</span><span><b>Ninety seconds each</b>Expiration submits the current question as unanswered.</span></div>
      <div class="info-item"><span class="info-icon">A</span><span><b>Public attestation</b>Passing records that you understand the intent, behavior, and blast radius of this PR.</span></div>
    </div>
  </section>
  <section class="state-card">
    <h3>${variant === "start" ? "Privacy line" : "Answer what the PR does"}</h3>
    <p>${variant === "start"
      ? "Clawptcha reports summary timing, interaction statistics, and passive canary signals to maintainers. It never records keystrokes, answer text, webcam data, or invasive browser data."
      : "The quiz tests intent, effects, and affected areas rather than line-by-line recall. Correct answers stay server-side."}</p>
  </section>
  <div class="status-strip info">
    <span class="status-dot">i</span>
    <span class="status-copy"><b>Telemetry informs review</b><span>It never auto-fails an otherwise correct quiz.</span></span>
  </div>
</aside>`;
}

function statusTone(title: string): "ok" | "warn" | "crit" | "info" {
  const text = title.toLowerCase();
  if (text.includes("passed")) return "ok";
  if (text.includes("awaiting") || text.includes("canceled")) return "info";
  if (text.includes("wrong") || text.includes("oauth") || text.includes("sign-in")) return "warn";
  if (text.includes("not found") || text.includes("cannot") || text.includes("error") || text.includes("went wrong")) return "crit";
  return "warn";
}

function statusSymbol(tone: "ok" | "warn" | "crit" | "info"): string {
  if (tone === "ok") return "✓";
  if (tone === "crit") return "!";
  if (tone === "info") return "i";
  return "!";
}

function honeypotField(enabled: boolean): string {
  if (!enabled) return "";
  return `
          <div class="honeypot-field" aria-hidden="true">
            <label>Leave this field blank
              <input type="text" name="${HONEYPOT_FIELD_NAME}" tabindex="-1" autocomplete="off">
            </label>
          </div>`;
}

export function startPage(
  prRef: string, turnstileSiteKey: string, challengeId: string, honeypotEnabled = true
): string {
  return layout("Challenge", `
<div class="app">
  ${commandBar("Comprehension gate", prRef)}
  <div class="console">
    <section class="workspace" aria-labelledby="challenge-title">
      ${stageRail("verify")}
      <div class="prelude">
        <p class="kicker-row"><span class="pill">PR challenge</span><span class="ref">${esc(prRef)}</span></p>
        <h1 id="challenge-title">Show you understand this change before it merges.</h1>
        <p class="lead">Clawptcha asks PR-specific questions about <b>intent, behavior, and blast radius</b>. It does not prove you are human. It records that you stood behind the change.</p>
        <form class="start-actions" method="POST" action="/challenge/${esc(challengeId)}/start" id="startForm">
          ${honeypotField(honeypotEnabled)}
          <div class="turnstile-box"><div class="cf-turnstile" data-sitekey="${esc(turnstileSiteKey)}"></div><span class="turnstile-fallback">Turnstile check</span></div>
          <button class="btn" type="submit" id="startButton">Begin challenge</button>
        </form>
      </div>
    </section>
    ${contextPanel(prRef, "start")}
  </div>
</div>
<script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>
<script>
(function () {
  var form = document.getElementById("startForm");
  var button = document.getElementById("startButton");
  if (!form || !button) return;
  form.addEventListener("submit", function () {
    button.disabled = true;
    button.textContent = "Starting challenge...";
  });
})();
</script>`);
}

export function questionPage(
  challengeId: string, index: number, total: number, q: ClientQuestion, timeLimitMs: number,
  honeypotEnabled = true
): string {
  const inputType = q.multiSelect ? "checkbox" : "radio";
  const meta = questionMeta[q.type];
  const options = q.options
    .map(
      (opt, i) =>
        `<label class="opt"><input type="${inputType}" name="answer" value="${i}"><span class="choice-letter" aria-hidden="true">${choiceLabels[i] ?? i + 1}</span><span class="t">${esc(opt)}</span></label>`
    )
    .join("");
  const timer = `<span class="command-pill timer" id="timer" role="timer" aria-live="off"><span id="tnum">${Math.ceil(timeLimitMs / 1000)}</span><span class="u">s</span></span>`;
  return layout(`Question ${index + 1}`, `
<div class="app">
  ${commandBar("Comprehension gate", `Question ${index + 1} of ${total}`, timer)}
  <div class="console">
    <section class="workspace" aria-labelledby="question-title">
      ${progressRail(index, total)}
      <div class="question-top">
        <span class="step">Question <em>${index + 1}</em> of ${total}</span>
      </div>
      <p class="question-type">${esc(meta.label)}</p>
      <h1 class="qh" id="question-title">${esc(q.prompt)}</h1>
      <p class="hint">${esc(meta.hint)} Correct answers are never sent to the browser.</p>
      <form class="answer-form" method="POST" action="/challenge/${esc(challengeId)}/answer" id="f" data-answer-form>
        ${honeypotField(honeypotEnabled)}
        <fieldset class="opts">
          <legend class="sr-only">Answer choices</legend>
          ${options}
        </fieldset>
        <input type="hidden" name="qi" value="${index}">
        <input type="hidden" name="telemetry" id="telemetry">
        <div class="actionbar">
          <p class="choice-status" id="choiceStatus" aria-live="polite">Select an answer to continue.</p>
          <div class="action-group">
            <button class="btn-secondary" type="submit" name="skip" value="1" id="skipButton">Skip question</button>
            <button class="btn" type="submit" id="submitButton" data-submit disabled>Submit answer</button>
          </div>
        </div>
      </form>
    </section>
    ${contextPanel("Challenge context", "question")}
  </div>
</div>
<script>
(function () {
  var LIMIT = ${timeLimitMs};
  var deadline = Date.now() + LIMIT;
  var forceSubmit = false;
  var t = { start: Date.now(), changes: 0, dist: 0, samples: 0, focusLoss: 0,
            webdriver: !!navigator.webdriver, lx: null, ly: null };
  document.addEventListener("pointermove", function (e) {
    if (t.lx !== null) t.dist += Math.hypot(e.clientX - t.lx, e.clientY - t.ly);
    t.lx = e.clientX; t.ly = e.clientY; t.samples++;
  });
  var form = document.getElementById("f");
  var submit = document.getElementById("submitButton");
  var skip = document.getElementById("skipButton");
  var status = document.getElementById("choiceStatus");
  var inputs = Array.prototype.slice.call(document.querySelectorAll("input[name=answer]"));
  function checkedCount() {
    return inputs.filter(function (el) { return el.checked; }).length;
  }
  function updateChoiceStatus() {
    var count = checkedCount();
    if (submit) submit.disabled = count === 0;
    if (!status) return;
    if (count === 0) status.textContent = "Select an answer to continue.";
    else if (${q.multiSelect ? "true" : "false"}) status.textContent = count + " selected. Submit when your set is complete.";
    else status.textContent = "Answer selected. Submit when ready.";
  }
  inputs.forEach(function (el) {
    el.addEventListener("change", function () { t.changes++; updateChoiceStatus(); });
  });
  updateChoiceStatus();
  window.addEventListener("blur", function () { t.focusLoss++; });
  form.addEventListener("submit", function (event) {
    var submitter = event.submitter;
    if (!forceSubmit && submitter !== skip && checkedCount() === 0) {
      event.preventDefault();
      updateChoiceStatus();
      return;
    }
    document.getElementById("telemetry").value = JSON.stringify({
      elapsedMs: Date.now() - t.start, answerChanges: t.changes,
      pointerDistancePx: Math.round(t.dist), pointerSamples: t.samples,
      focusLossCount: t.focusLoss, webdriver: t.webdriver
    });
    if (submitter && submitter !== skip) submitter.textContent = "Submitting...";
    if (submit) submit.disabled = true;
    if (skip) skip.disabled = true;
  });
  var timer = document.getElementById("timer");
  var tnum = document.getElementById("tnum");
  (function tick() {
    var left = Math.max(0, deadline - Date.now());
    var secs = Math.ceil(left / 1000);
    tnum.textContent = secs;
    var warn = secs <= 30, crit = secs <= 10;
    timer.className = "command-pill timer" + (crit ? " crit" : warn ? " warn" : "");
    if (status && crit && checkedCount() === 0) status.textContent = "Time is almost up. Choose an answer or skip.";
    if (left <= 0) {
      forceSubmit = true;
      if (status) status.textContent = "Time expired. Submitting this question as unanswered.";
      form.requestSubmit(skip);
      return;
    }
    setTimeout(tick, 250);
  })();
})();
</script>`);
}

export function resultPage(passed: boolean, score: number, total: number, message: string): string {
  const tone = passed ? "ok" : "warn";
  return layout(passed ? "Passed" : "Not passed", `
<div class="app">
  ${commandBar(passed ? "Attestation ready" : "Needs retry")}
  <div class="result-layout">
    <section class="result-main" aria-labelledby="result-title">
      <div class="result-panel">
        <div class="badge ${tone}" aria-hidden="true">${passed ? "✓" : "!"}</div>
        <p class="result-label">${passed ? "Comprehension attested" : "Threshold not met"}</p>
        <h1 id="result-title">${passed ? "The check is green." : "This attempt did not pass."}</h1>
        <div class="score">${score}<span class="of">/${total}</span></div>
        <p class="result-copy">${esc(message)}</p>
      </div>
    </section>
    <aside class="result-side" aria-label="Result details">
      <div class="status-strip ${tone}">
        <span class="status-dot">${passed ? "✓" : "!"}</span>
        <span class="status-copy"><b>${passed ? "Passed" : "Needs retry"}</b><span>${score}/${total} correct</span></span>
      </div>
      <section class="state-card">
        <h2>${passed ? "What happens next" : "Retry policy"}</h2>
        <p>${passed
          ? "The PR receives an attestation that you understand this change. Maintainers still see summary risk signals."
          : "Retry timing is controlled by the repository policy. A retry receives a fresh quiz."}</p>
      </section>
      <div class="status-strip info">
        <span class="status-dot">i</span>
        <span class="status-copy"><b>Summary telemetry only</b><span>No keystrokes or answer text are recorded.</span></span>
      </div>
    </aside>
  </div>
</div>`);
}

export function errorPage(title: string, message: string): string {
  const tone = statusTone(title);
  const cleanTitle = title.replace(/^✅\\s*/, "");
  return layout(cleanTitle, `
<div class="app">
  ${commandBar("Challenge status")}
  <div class="status-layout">
    <section class="status-main" aria-labelledby="status-title">
      <div class="status-panel">
        <div class="badge ${tone}" aria-hidden="true">${statusSymbol(tone)}</div>
        <p class="status-label">${tone === "ok" ? "Complete" : tone === "info" ? "Waiting" : tone === "crit" ? "Blocked" : "Needs attention"}</p>
        <h1 id="status-title">${esc(cleanTitle)}</h1>
        <p class="status-copy-large">${esc(message)}</p>
      </div>
    </section>
    <aside class="status-side" aria-label="Status context">
      <div class="status-strip ${tone}">
        <span class="status-dot">${statusSymbol(tone)}</span>
        <span class="status-copy"><b>${esc(cleanTitle)}</b><span>Check the PR for the current gate state.</span></span>
      </div>
      <section class="state-card">
        <h2>Clawptcha's line</h2>
        <p>This challenge verifies comprehension of a PR. It does not prove humanness, and Clawptcha-side failures should not block a merge.</p>
      </section>
      <div class="status-strip info">
        <span class="status-dot">i</span>
        <span class="status-copy"><b>Privacy-respecting telemetry</b><span>Timing and interaction summaries only.</span></span>
      </div>
    </aside>
  </div>
</div>`);
}
