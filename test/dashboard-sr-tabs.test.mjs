import {TableSmartPrint} from './helpers/smart-print-stub.mjs';
import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
import React from 'react';import {renderToStaticMarkup} from 'react-dom/server';import {transformWithOxc} from 'vite';
import * as recentRules from '../shared/recent-activity.mjs';

// The dashboard by Sr No (owner, 14 Nov 2026): the cards stay on top, each panel below them has a serial number, and only
// the Sr No chosen in the strip is on screen, so opening the dashboard no longer starts every report's reading at once.
const read=file=>fs.readFileSync(new URL('../src/'+file,import.meta.url),'utf8').replace(/\r\n/g,'\n');
const compile=async file=>(await transformWithOxc(read(file).replace(/^import .*;\n/gm,'').replaceAll('export default function','function').replaceAll('export function','function').replaceAll('export const','const'),file,{jsx:{runtime:'classic'}})).code;

const cards={updatedAt:'2026-11-14T12:00:00Z',kinds:['vehicle','equipment'],totals:{vehicle:120,equipment:40,activeSites:2,recoveryDrafts:1},bySite:[{site:'Sasti OC',vehicle:80,equipment:30},{site:'Jayant OC',vehicle:40,equipment:10}]};
// The dashboard drawn once with its states set by hand: the Sr No on screen, the Sr Nos opened so far and the hours of the site comparison.
async function dashboard({sr=1,opened=[1],siteHours=0,data=cards,ReportSection=()=>null}={}){
 const calls={recent:null};
 const dates={from:'2026-11-01',to:'2026-11-14'};
 // In the order of the screen's useState calls: printing, print error, dates applied, dates typed, cards, error, loading, refresh, pop-up, site hours, Sr No, Sr Nos opened.
 const states=['','',{...dates,location:'',shift:''},dates,data,'',false,0,null,siteHours,sr,opened];
 let cursor=0;
 const stub=name=>props=>React.createElement('div',{'data-stub':name,'data-report':props.reportId||'','data-paused':String(props.paused??'')});
 const icon=()=>null;
 const environment={React,Suspense:React.Suspense,lazy:()=>stub('operations'),useEffect:()=>{},useRef:()=>({current:null}),useState:()=>[states[cursor++],()=>{}],
  BookOpen:icon,Building2:icon,ShieldCheck:icon,ArrowUpRight:icon,X:icon,Download:icon,Printer:icon,
  openSmartPrint:()=>{},TableSmartPrint,scanImageExtensionForType:()=>'.jpg',OPERATIONAL_START:'2026-11-01',sitesLowToHigh:rows=>rows||[],
  BatchStatusReport:stub('batch'),ManpowerReports:stub('manpower'),RecentActivityPanel:stub('recent'),
  useRecentActivity:options=>{calls.recent=options;return {recent:null,error:''};},windowLabel:hours=>`Last ${hours} hours`,RECENT_WINDOWS:[6,12,24],recentSiteRows:()=>[]};
 const api=new Function(...Object.keys(environment),await compile('log-book-dashboard.jsx')+';return {LogBookDashboard,DASHBOARD_PANELS,ALL_PANELS,panelShown,nextPanelToOpen,PANEL_OPEN_WAIT_MS}')(...Object.values(environment));
 const html=renderToStaticMarkup(api.LogBookDashboard({session:{token:'t'},ReportSection}));
 assert.equal(cursor,states.length,'every state of the screen was set by the test');
 const plain=text=>text.replace(/<[^>]+>/g,' ').replace(/&amp;/g,'&').replace(/\s+/g,' ').trim();
 return {html,calls,api,
  // The tabs of the strip, left to right: [name on the tab, chosen or not].
  tabs:[...html.matchAll(/<button type="button" role="tab" id="lb-sr-tab-[^"]+" aria-selected="(true|false)"[^>]*>(.*?)<\/button>/g)].map(tab=>[plain(tab[2]),tab[1]==='true']),
  // A report's place on the page: 'shown', 'hidden' (kept with its figures behind another tab) or 'absent' (never opened, so never read).
  panel:number=>{const found=html.match(new RegExp('<div class="lb-sr" role="tabpanel" id="lb-sr-'+number+'" aria-labelledby="lb-sr-tab-'+number+'"( hidden="")?>'));return !found?'absent':found[1]?'hidden':'shown';},
  has:(name,report='')=>html.includes('data-stub="'+name+'" data-report="'+report+'"'),
  paused:()=>html.match(/data-stub="batch" data-report="" data-paused="(true|false)"/)?.[1]};
}

test('the panels are numbered Sr 1 to Sr 6 in the order they stood on the dashboard, with All at the end',async()=>{
 const view=await dashboard();
 assert.deepEqual(view.api.DASHBOARD_PANELS.map(panel=>[panel.sr,panel.name]),[[1,'Completed in 6, 12 and 24 hours'],[2,'Trip Timing & Gap'],[3,'Site comparison'],[4,'Batch Status & Turnaround'],[5,'OT & Multiple Duties'],[6,'Loading Equipment-wise']]);
 assert.deepEqual(view.tabs,[['Sr 1 Completed in 6, 12 and 24 hours',true],['Sr 2 Trip Timing & Gap',false],['Sr 3 Site comparison',false],['Sr 4 Batch Status & Turnaround',false],['Sr 5 OT & Multiple Duties',false],['Sr 6 Loading Equipment-wise',false],['All Every Sr No',false]]);
 assert.match(view.html,/<nav class="lb-sr-tabs" role="tablist" aria-label="Dashboard reports by Sr No" data-print-hide="">/,'the strip itself is left off a print');
 assert.ok(view.html.indexOf('class="lb-kpis"')<view.html.indexOf('class="lb-sr-tabs"'),'the four cards stay above the strip');
 assert.ok(view.html.indexOf('class="lb-sr-tabs"')<view.html.indexOf('data-stub="recent"'),'the Sr No chosen is under the strip');
});

test('the dashboard opens on Sr 1 alone: no other report is on the page, so none of them reads from the server',async()=>{
 const view=await dashboard();
 assert.ok(view.has('recent'),'Completed in the last 6, 12 and 24 hours is shown');
 assert.equal(view.calls.recent.active,true,'and its figures are read');
 for(const number of [2,4,5,6])assert.equal(view.panel(number),'absent','Sr '+number+' is not on the page');
 for(const [name,report] of [['operations','timing'],['batch',''],['manpower','ot'],['operations','loading']])assert.ok(!view.has(name,report),name+' '+report+' is not started');
 assert.ok(!view.html.includes('<h3>Site comparison</h3>'));
 const screen=read('log-book-dashboard.jsx');
 assert.match(screen,/initialSr=1\}\)\{/,'Sr 1 unless a caller asks for another');
 assert.match(screen,/const \[sr,setSr\]=useState\(initialSr\),\[opened,setOpened\]=useState\(\(\)=>\[initialSr===ALL_PANELS\?DASHBOARD_PANELS\[0\]\.sr:initialSr\]\);/);
});

test('a Sr No is put on the page when its tab is opened, and is hidden, not removed, when another is chosen',async()=>{
 let view=await dashboard({sr:4,opened:[1,4]});
 assert.deepEqual(view.tabs.filter(tab=>tab[1]).map(tab=>tab[0]),['Sr 4 Batch Status & Turnaround']);
 assert.equal(view.panel(4),'shown');assert.ok(view.has('batch'));assert.equal(view.paused(),'false','Working now reads while Sr 4 is on screen');
 assert.ok(!view.has('recent'),'Sr 1 has left the screen');
 assert.equal(view.calls.recent.active,false,'so the last 24 hours are not read again every two minutes');
 for(const number of [2,5,6])assert.equal(view.panel(number),'absent');

 view=await dashboard({sr:2,opened:[1,4,2]});
 assert.equal(view.panel(2),'shown');assert.ok(view.has('operations','timing'));
 assert.equal(view.panel(4),'hidden','Sr 4 keeps its figures behind the tab');assert.ok(view.has('batch'));
 assert.equal(view.paused(),'true','but its Working now reading every minute stops');
 assert.ok(!view.has('operations','loading'),'Sr 6 shares the reading of Sr 2 only once it is opened');

 view=await dashboard({sr:5,opened:[1,4,2,5]});
 assert.equal(view.panel(5),'shown');assert.ok(view.has('manpower','ot'));assert.equal(view.panel(2),'hidden');assert.equal(view.panel(4),'hidden');assert.equal(view.panel(6),'absent');
 view=await dashboard({sr:6,opened:[1,6]});
 assert.equal(view.panel(6),'shown');assert.ok(view.has('operations','loading'));assert.ok(!view.has('operations','timing'));
});

test('the site comparison is Sr 3 and reads the last 24 hours only when it is set to 6, 12 or 24 hours',async()=>{
 let view=await dashboard({sr:3,opened:[1,3]});
 assert.match(view.html,/<section class="lb-dashboard lb-sites" role="tabpanel" id="lb-sr-3" aria-label="Site comparison"/);
 assert.ok(view.html.includes('<h3>Site comparison</h3>'));
 assert.equal(view.calls.recent.active,false,'on the chosen dates it uses the figures of the cards');
 view=await dashboard({sr:3,opened:[1,3],siteHours:12});
 assert.equal(view.calls.recent.active,true);
 view=await dashboard({sr:2,opened:[1,3,2],siteHours:12});
 assert.ok(!view.html.includes('<h3>Site comparison</h3>'));
 assert.equal(view.calls.recent.active,false,'not while another Sr No is on screen');
});

test('All puts every Sr No on the page, opened one after another',async()=>{
 const view=await dashboard({sr:'all',opened:[1,2,4,5,6]}),{nextPanelToOpen,panelShown,ALL_PANELS,PANEL_OPEN_WAIT_MS}=view.api;
 assert.equal(ALL_PANELS,'all');
 assert.deepEqual(view.tabs.filter(tab=>tab[1]).map(tab=>tab[0]),['All Every Sr No']);
 for(const number of [2,4,5,6])assert.equal(view.panel(number),'shown');
 assert.ok(view.has('recent')&&view.html.includes('<h3>Site comparison</h3>'));
 assert.equal(view.paused(),'false');assert.equal(view.calls.recent.active,true);
 const order=['data-stub="recent"','data-report="timing"','<h3>Site comparison</h3>','data-stub="batch"','data-stub="manpower"','data-report="loading"'].map(mark=>view.html.indexOf(mark));
 assert.deepEqual(order,[...order].sort((a,b)=>a-b),'in the order of their Sr Nos');
 // Just after All is chosen from Sr 1 only Sr 1 is open; the others follow one at a time.
 const justChosen=await dashboard({sr:'all',opened:[1]});
 for(const number of [2,4,5,6])assert.equal(justChosen.panel(number),'absent');
 const opened=[1];for(let next=nextPanelToOpen('all',opened);next!==null;next=nextPanelToOpen('all',opened))opened.push(next);
 assert.deepEqual(opened,[1,2,3,4,5,6]);
 assert.equal(nextPanelToOpen('all',[1,4]),2,'the lowest Sr No not yet open');
 assert.equal(nextPanelToOpen(2,[1,2]),null,'a single Sr No opens nothing else');
 assert.ok(panelShown('all',5)&&panelShown(5,5)&&!panelShown(4,5));
 assert.equal(PANEL_OPEN_WAIT_MS,15000);
 const screen=read('log-book-dashboard.jsx');
 assert.match(screen,/reading=\(\)=>\[\.\.\.\(printRoot\.current\?\.querySelectorAll\('\.lb-reports \[role=status\]'\)\|\|\[\]\)\]\.some\(line=>\/\^\(Loading\|Reading\)\\b\/\.test\(line\.textContent\.trim\(\)\)\)/,'the next Sr No waits while a report still says that it is reading; a table\'s "3 of 3 records" line does not hold it back');
 // Each report says so in these words while it reads.
 assert.ok(read('operations-reports.jsx').includes('{busy&&<p role="status">Loading complete report data…</p>}'));
 assert.ok(read('manpower-reports.jsx').includes('{busy&&<p role="status">Loading saved records and checking shift patterns…</p>}'));
 assert.match(screen,/if\(reading\(\)&&Date\.now\(\)-started<PANEL_OPEN_WAIT_MS\)return;clearInterval\(timer\);setOpened\(list=>list\.includes\(next\)\?list:\[\.\.\.list,next\]\);/);
});

test('a print or PDF holds the cards and the Sr No on screen, and says so',async()=>{
 let view=await dashboard();
 assert.match(view.html,/title="The cards and Sr 1 \(Completed in 6, 12 and 24 hours\) as an A3 PDF file\. Choose All in the Sr No strip first for the complete dashboard"/);
 assert.match(view.html,/data-print-subtitle="Saved log book cards and shifts completed"/);
 view=await dashboard({sr:4,opened:[1,4]});
 assert.match(view.html,/title="The cards and Sr 4 \(Batch Status &amp; Turnaround\) as an A3 PDF file\./);
 assert.match(view.html,/data-print-subtitle="Saved log book cards"/,'the sheet of the cards does not promise the shifts when Sr 1 is not on it');
 view=await dashboard({sr:'all',opened:[1,2,3,4,5,6]});
 assert.match(view.html,/title="The cards and every Sr No as an A3 PDF file"/);
 const screen=read('log-book-dashboard.jsx'),css=read('log-book-dashboard.css');
 assert.match(screen,/data-print-pages="\.lb-dashboard, \.lb-reports > \.lb-sr:not\(\[hidden\]\) > \*"/,'a Sr No hidden behind another tab gets no sheet');
 assert.ok(screen.includes("For the complete dashboard, choose All in the Sr No strip first."),'Smart Print says how to print everything');
 assert.ok(css.includes('.lb-sr:not([hidden]){display:grid;gap:28px;grid-template-columns:minmax(0,1fr);min-width:0}'),'a Sr No shown is laid out as the reports area was');
 assert.ok(css.includes('.lb-sr[hidden]{display:none}'));
 assert.ok(css.includes('.lb-reports>.lb-sr>section{margin:0;min-width:0;max-width:100%;overflow-x:auto}'),'a wide report still scrolls inside its own box');
});

test('a screen without the report table offers only the panels it can draw',async()=>{
 const view=await dashboard({ReportSection:null});
 assert.deepEqual(view.tabs.map(tab=>tab[0]),['Sr 1 Completed in 6, 12 and 24 hours','Sr 3 Site comparison','All Every Sr No']);
});

// useRecentActivity run by hand: draw() is one drawing of the screen (the hook, then its effect) and returns the effect's clean-up.
async function recentHook(){
 let clock=1_000_000,effect=null,nextTimer=0;const fetched=[],timers=new Map(),kept={};
 const RealDate=Date;function FakeDate(...args){return new RealDate(...args);}FakeDate.now=()=>clock;
 const environment={React,useState:initial=>[initial,()=>{}],useRef:initial=>(kept.ref||={current:initial}),useEffect:run=>{effect=run;},
  Clock:()=>null,StepBackButton:()=>null,TableSmartPrint,...recentRules,Date:FakeDate,document:{hidden:false},AbortController,
  setInterval:(fn,ms)=>{timers.set(++nextTimer,{fn,ms});return nextTimer;},clearInterval:id=>timers.delete(id)};
 const useRecentActivity=new Function(...Object.keys(environment),await compile('log-book-recent-activity.jsx')+';return useRecentActivity')(...Object.values(environment));
 const fetcher=async url=>{fetched.push(url);return {ok:true,json:async()=>({windows:[6,12,24]})};};
 return {fetched,timers,advance:ms=>{clock+=ms;},settle:async()=>{for(let turn=0;turn<8;turn++)await Promise.resolve();},
  draw:options=>{useRecentActivity({session:{token:'t'},fetcher,...options});return effect();}};
}

test('the last 24 hours are read only while a panel that shows them is on screen',async()=>{
 const hook=await recentHook();
 let stop=hook.draw({active:false});
 assert.equal(stop,undefined);assert.equal(hook.fetched.length,0,'nothing is read for a panel that is not shown');assert.equal(hook.timers.size,0);
 stop=hook.draw({active:true});await hook.settle();
 assert.deepEqual(hook.fetched,['/api/dashboard/log-books/recent']);
 assert.deepEqual([...hook.timers.values()].map(timer=>timer.ms),[120000],'then every two minutes');
 [...hook.timers.values()][0].fn();await hook.settle();assert.equal(hook.fetched.length,2);
 stop();assert.equal(hook.timers.size,0,'the repeat reading stops when the panel leaves the screen');
 hook.advance(60_000);stop=hook.draw({active:true});await hook.settle();
 assert.equal(hook.fetched.length,2,'back within two minutes: the figures already read stay');
 stop();hook.advance(60_000);stop=hook.draw({active:true});await hook.settle();
 assert.equal(hook.fetched.length,3,'back after two minutes: read again');
 stop();stop=hook.draw({active:true,refresh:1});await hook.settle();
 assert.equal(hook.fetched.length,4,'Retry always reads again');
 stop();
 assert.match(read('log-book-recent-activity.jsx'),/export function useRecentActivity\(\{session,fetcher=fetch,refresh=0,active=true\}\)\{/,'screens that do not pass active read as before');
});

test('Working now of Batch Status stops while the dashboard shows another Sr No',()=>{
 const report=read('batch-status-report.jsx'),screen=read('log-book-dashboard.jsx');
 assert.match(report,/export default function BatchStatusReport\(\{session,ReportSection,embedded=false,paused=false\}\)\{/,'the Reports page never pauses it');
 assert.match(report,/if\(!reportShown\)\{setLive\(null\);setLiveError\(''\);return;\}\n\s+if\(paused\)return;\n\s+const c=new AbortController\(\);\n\s+const stop=startVisiblePoll\(/,'paused: no reading every minute, and the last figures stay');
 assert.match(report,/return\(\)=>\{c\.abort\(\);stop\(\);\};\n \},\[reportShown,session\.token,paused\]\);/,'it reads again when its tab comes back');
 assert.match(screen,/<BatchStatusReport session=\{session\} ReportSection=\{ReportSection\} embedded paused=\{!shown\(4\)\}\/>/);
});
