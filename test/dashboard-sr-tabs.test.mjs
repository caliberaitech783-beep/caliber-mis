import {TableSmartPrint} from './helpers/smart-print-stub.mjs';
import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
import React from 'react';import {renderToStaticMarkup} from 'react-dom/server';import {transformWithOxc} from 'vite';
import * as recentRules from '../shared/recent-activity.mjs';
import {misPageAllowed} from '../shared/mis-application-access.mjs';

// The dashboard by Sr No (owner, 14 Nov 2026): the cards stay on top, each panel below them has a serial number, and only
// the Sr No chosen in the strip is on screen, so opening the dashboard no longer starts every report's reading at once.
const read=file=>fs.readFileSync(new URL('../src/'+file,import.meta.url),'utf8').replace(/\r\n/g,'\n');
const compile=async file=>(await transformWithOxc(read(file).replace(/^import .*;\n/gm,'').replaceAll('export default function','function').replaceAll('export function','function').replaceAll('export const','const'),file,{jsx:{runtime:'classic'}})).code;

const cards={updatedAt:'2026-11-14T12:00:00Z',kinds:['vehicle','lmv','dlb','equipment'],totals:{vehicle:120,lmv:12,dlb:5,equipment:40,activeSites:2,recoveryDrafts:1},bySite:[{site:'Sasti OC',vehicle:80,lmv:8,dlb:3,equipment:30},{site:'Jayant OC',vehicle:40,lmv:4,dlb:2,equipment:10}]};
// The dashboard drawn once with its states set by hand: the Sr No on screen and the Sr Nos opened so far.
async function dashboard({sr=1,opened=[1],data=cards,ReportSection=()=>null,session={token:'t'},goto}={}){
 const calls={recent:null},drawn={};
 const dates={from:'2026-11-01',to:'2026-11-14'};
 // In the order of the screen's useState calls: printing, print error, dates applied, dates typed, cards, error, loading, refresh, pop-up, Sr No, Sr Nos opened.
 const states=['','',{...dates,location:'',shift:''},dates,data,'',false,0,null,sr,opened];
 let cursor=0;
 const stub=name=>props=>{drawn[name]=props;return React.createElement('div',{'data-stub':name,'data-report':props.reportId||'','data-paused':String(props.paused??'')});};
 const icon=()=>null;
 const environment={React,Suspense:React.Suspense,lazy:loader=>stub(String(loader).includes('caliber-recheck')?'recheck':'operations'),useEffect:()=>{},useRef:()=>({current:null}),useState:()=>[states[cursor++],()=>{}],
  BookOpen:icon,Building2:icon,ShieldCheck:icon,ArrowUpRight:icon,X:icon,Download:icon,Printer:icon,
  openSmartPrint:()=>{},TableSmartPrint,misPageAllowed,scanImageExtensionForType:()=>'.jpg',OPERATIONAL_START:'2026-11-01',sitesLowToHigh:rows=>rows||[],
  BatchStatusReport:stub('batch'),ManpowerReports:stub('manpower'),RecentActivityPanel:stub('recent'),
  useRecentActivity:options=>{calls.recent=options;return {recent:null,error:''};},windowLabel:hours=>`Last ${hours} hours`};
 const api=new Function(...Object.keys(environment),await compile('log-book-dashboard.jsx')+';return {LogBookDashboard,DASHBOARD_PANELS,ALL_PANELS,panelShown,nextPanelToOpen,PANEL_OPEN_WAIT_MS,recheckAllowed}')(...Object.values(environment));
 const html=renderToStaticMarkup(api.LogBookDashboard({session,ReportSection,goto}));
 assert.equal(cursor,states.length,'every state of the screen was set by the test');
 const plain=text=>text.replace(/<[^>]+>/g,' ').replace(/&amp;/g,'&').replace(/\s+/g,' ').trim();
 return {html,calls,drawn,api,
  // The tabs of the strip, left to right: [name on the tab, chosen or not].
  tabs:[...html.matchAll(/<button type="button" role="tab" id="lb-sr-tab-[^"]+" aria-selected="(true|false)"[^>]*>(.*?)<\/button>/g)].map(tab=>[plain(tab[2]),tab[1]==='true']),
  // A report's place on the page: 'shown', 'hidden' (kept with its figures behind another tab) or 'absent' (never opened, so never read).
  panel:number=>{const found=html.match(new RegExp('<div class="lb-sr" role="tabpanel" id="lb-sr-'+number+'" aria-labelledby="lb-sr-tab-'+number+'"( hidden="")?>'));return !found?'absent':found[1]?'hidden':'shown';},
  has:(name,report='')=>html.includes('data-stub="'+name+'" data-report="'+report+'"'),
  paused:()=>html.match(/data-stub="batch" data-report="" data-paused="(true|false)"/)?.[1]};
}

const SR1='Completed in 6, 12 and 24 hours · Batch Status & Turnaround';

test('the panels are Sr 1 to Sr 6 as the owner set them on 18 Nov 2026, with All at the end',async()=>{
 const view=await dashboard();
 assert.deepEqual(view.api.DASHBOARD_PANELS.map(panel=>[panel.sr,panel.name]),[[1,SR1],[2,'Trip Timing & Gap'],[3,'OT & Multiple Duties'],[4,'Loading Equipment-wise (Chart)'],[5,'Attendance Month-wise'],[6,'Attendance Shift-wise']]);
 assert.deepEqual(view.tabs,[['Sr 1 '+SR1,true],['Sr 2 Trip Timing & Gap',false],['Sr 3 OT & Multiple Duties',false],['Sr 4 Loading Equipment-wise (Chart)',false],['Sr 5 Attendance Month-wise',false],['Sr 6 Attendance Shift-wise',false],['All Every Sr No',false]]);
 assert.match(view.html,/<nav class="lb-sr-tabs" role="tablist" aria-label="Dashboard reports by Sr No" data-print-hide="">/,'the strip itself is left off a print');
 assert.ok(view.html.indexOf('class="lb-kpis"')<view.html.indexOf('class="lb-sr-tabs"'),'the five cards stay above the strip');
 assert.match(view.html,/Total ELB cards[\s\S]*Total LMV entries/,'the LMV total is immediately beside the ELB total');
 assert.match(view.html,/Total LMV entries[\s\S]*>12</,'the LMV card displays its separate saved-entry count');
 assert.match(view.html,/Total LMV entries[\s\S]*Total DLB entries[\s\S]*>5</,'the DLB total follows the existing log-book totals');
 assert.ok(view.html.indexOf('class="lb-sr-tabs"')<view.html.indexOf('data-stub="recent"'),'the Sr No chosen is under the strip');
 assert.ok(!view.html.includes('Site comparison'),'the site comparison is gone from the dashboard');
 assert.equal((view.html.match(/id="lb-sr-1"/g)||[]).length,1,'no two parts of Sr 1 share an id');
});

test('the dashboard opens on Sr 1: the last 24 hours with Batch Status & Turnaround under them, and no other report',async()=>{
 const view=await dashboard();
 assert.ok(view.has('recent'),'Completed in the last 6, 12 and 24 hours is shown');
 assert.equal(view.calls.recent.active,true,'and its figures are read');
 assert.equal(view.panel(1),'shown');assert.ok(view.has('batch'));assert.equal(view.paused(),'false','Working now reads while Sr 1 is on screen');
 assert.ok(view.html.indexOf('data-stub="recent"')<view.html.indexOf('data-stub="batch"'),'Batch Status sits under the last 24 hours');
 for(const number of [2,3,4,5,6])assert.equal(view.panel(number),'absent','Sr '+number+' is not on the page');
 for(const [name,report] of [['operations','timing'],['manpower','ot'],['operations','loading'],['manpower','attendance-month'],['manpower','attendance']])assert.ok(!view.has(name,report),name+' '+report+' is not started');
 const screen=read('log-book-dashboard.jsx');
 assert.match(screen,/initialSr=1\}\)\{/,'Sr 1 unless a caller asks for another');
 assert.match(screen,/const \[sr,setSr\]=useState\(initialSr\),\[opened,setOpened\]=useState\(\(\)=>\[initialSr===ALL_PANELS\?DASHBOARD_PANELS\[0\]\.sr:initialSr\]\);/);
});

test('a Sr No is put on the page when its tab is opened, and is hidden, not removed, when another is chosen',async()=>{
 let view=await dashboard({sr:2,opened:[1,2]});
 assert.deepEqual(view.tabs.filter(tab=>tab[1]).map(tab=>tab[0]),['Sr 2 Trip Timing & Gap']);
 assert.equal(view.panel(2),'shown');assert.ok(view.has('operations','timing'));
 assert.ok(!view.has('recent'),'the last 24 hours have left the screen');
 assert.equal(view.calls.recent.active,false,'so they are not read again every two minutes');
 assert.equal(view.panel(1),'hidden','Batch Status keeps its figures behind the tab');assert.equal(view.paused(),'true','but its Working now reading every minute stops');
 assert.ok(!view.has('operations','loading'),'Sr 4 shares the reading of Sr 2 only once it is opened');
 for(const number of [3,4,5,6])assert.equal(view.panel(number),'absent');

 view=await dashboard({sr:3,opened:[1,2,3]});
 assert.equal(view.panel(3),'shown');assert.ok(view.has('manpower','ot'));assert.equal(view.panel(2),'hidden');assert.equal(view.panel(4),'absent');
 view=await dashboard({sr:4,opened:[1,4]});
 assert.equal(view.panel(4),'shown');assert.ok(view.has('operations','loading'));assert.ok(!view.has('operations','timing'));
 view=await dashboard({sr:5,opened:[1,5]});
 assert.equal(view.panel(5),'shown');assert.ok(view.has('manpower','attendance-month'),'Sr 5 is Attendance Month-wise');assert.ok(!view.has('manpower','attendance'));
 view=await dashboard({sr:6,opened:[1,5,6]});
 assert.equal(view.panel(6),'shown');assert.ok(view.has('manpower','attendance'),'Sr 6 is Attendance Shift-wise (Shift Attendance)');assert.equal(view.panel(5),'hidden');
 const screen=read('log-book-dashboard.jsx');
 for(const report of ['attendance-month','attendance'])assert.ok(screen.includes('<ManpowerReports session={session} reportId="'+report+'" ReportSection={ReportSection} embedded initialFrom={monthToDate().from}/>'),report+' opens on the month so far, without the other tabs');
});

test('All puts every Sr No on the page, opened one after another',async()=>{
 const view=await dashboard({sr:'all',opened:[1,2,3,4,5,6]}),{nextPanelToOpen,panelShown,ALL_PANELS,PANEL_OPEN_WAIT_MS}=view.api;
 assert.equal(ALL_PANELS,'all');
 assert.deepEqual(view.tabs.filter(tab=>tab[1]).map(tab=>tab[0]),['All Every Sr No']);
 for(const number of [1,2,3,4,5,6])assert.equal(view.panel(number),'shown');
 assert.ok(view.has('recent'));
 assert.equal(view.paused(),'false');assert.equal(view.calls.recent.active,true);
 const order=['data-stub="recent"','data-stub="recheck"','data-stub="batch"','data-report="timing"','data-report="ot"','data-report="loading"','data-report="attendance-month"','data-report="attendance"'].map(mark=>view.html.indexOf(mark));
 assert.ok(order.every(at=>at>=0),'every report is on the page');
 assert.deepEqual(order,[...order].sort((a,b)=>a-b),'in the order of their Sr Nos');
 // Just after All is chosen from Sr 1 only Sr 1 is open; the others follow one at a time.
 const justChosen=await dashboard({sr:'all',opened:[1]});
 for(const number of [2,3,4,5,6])assert.equal(justChosen.panel(number),'absent');
 const opened=[1];for(let next=nextPanelToOpen('all',opened);next!==null;next=nextPanelToOpen('all',opened))opened.push(next);
 assert.deepEqual(opened,[1,2,3,4,5,6]);
 assert.equal(nextPanelToOpen('all',[1,4]),2,'the lowest Sr No not yet open');
 assert.equal(nextPanelToOpen(2,[1,2]),null,'a single Sr No opens nothing else');
 assert.ok(panelShown('all',5)&&panelShown(5,5)&&!panelShown(4,5));
 assert.equal(PANEL_OPEN_WAIT_MS,15000);
 const screen=read('log-book-dashboard.jsx');
 assert.match(screen,/reading=\(\)=>\[\.\.\.\(printRoot\.current\?\.querySelectorAll\('\.lb-reports \[role=status\]'\)\|\|\[\]\)\]\.some\(line=>\/\^\(Loading\|Reading\)\\b\/\.test\(line\.textContent\.trim\(\)\)\)/,'the next Sr No waits while a report still says that it is reading; a table\'s "3 of 3 records" line does not hold it back');
 // Each report says so in these words while it reads.
 // Since 16 Nov 2026 the operations reports show a clock; its line still starts "Loading complete report data…".
 // Since 18 Nov 2026 the step reports read through the step reading, whose clock line also starts "Loading".
 assert.ok(read('operations-reports.jsx').includes('{!stepped&&busy&&<LoadClock reading={loadReading} days={days} parts={parts}/>}'));
 assert.ok(read('operations-reports.jsx').includes('<p role="status" className="op-load-clock">Loading the report… {'));
 assert.ok(read('operations-reports.jsx').includes('<p role="status" className="op-load-clock">{loadClockText('));
 assert.match(read('report-load-clock.mjs'),/return 'Loading complete report data… '\+formatDuration\(elapsedMs\)/);
 assert.ok(read('manpower-reports.jsx').includes('{busy&&<p role="status">Loading saved records and checking shift patterns…</p>}'));
 assert.match(screen,/if\(reading\(\)&&Date\.now\(\)-started<PANEL_OPEN_WAIT_MS\)return;clearInterval\(timer\);setOpened\(list=>list\.includes\(next\)\?list:\[\.\.\.list,next\]\);/);
});

test('a print or PDF holds the cards and the Sr No on screen, and says so',async()=>{
 let view=await dashboard();
 assert.match(view.html,/title="The cards and Sr 1 \(Completed in 6, 12 and 24 hours · Batch Status &amp; Turnaround\) as an A3 PDF file\. Choose All in the Sr No strip first for the complete dashboard"/);
 assert.match(view.html,/data-print-subtitle="Saved log book cards and shifts completed"/);
 view=await dashboard({sr:4,opened:[1,4]});
 assert.match(view.html,/title="The cards and Sr 4 \(Loading Equipment-wise \(Chart\)\) as an A3 PDF file\./);
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

// Owner, 24 Nov 2026: "Photo number one. Please add this in serial number one dashboard. And it should be second in line
// ... Just below the photo, photo number two": Step 1 of the Caliber ID re-check stands second in Sr 1, under the last
// 6, 12 and 24 hours and above Batch Status & Turnaround.
test('the Caliber ID re-check is second in Sr 1: under the last 6, 12 and 24 hours, above Batch Status',async()=>{
 let opened='';
 let view=await dashboard({goto:name=>{opened=name;}});
 const at=mark=>view.html.indexOf(mark);
 assert.ok(view.has('recheck'),'it is on the page with Sr 1');
 assert.ok(at('data-stub="recent"')>=0&&at('data-stub="recent"')<at('data-stub="recheck"')&&at('data-stub="recheck"')<at('data-stub="batch"'),'the last 24 hours, then the re-check, then Batch Status');
 assert.ok(at('id="lb-sr-1"')<at('data-stub="recheck"'),'inside Sr 1, so it is hidden with it and printed with it');
 assert.equal(view.drawn.recheck.embedded,true,'the short form: Step 1 with its steps, no page heading or foot lists');
 view.drawn.recheck.onOpenPage();assert.equal(opened,'Caliber ID Re-check','its button opens the full page');
 view=await dashboard();assert.equal(view.drawn.recheck.onOpenPage,undefined,'a screen that cannot change page offers no such button');
 // It is not read for another Sr No: Sr 2 opened first leaves Sr 1 off the page.
 view=await dashboard({sr:2,opened:[2]});assert.ok(!view.has('recheck'));
 // Behind another tab it stays on the page with its figures, hidden with Sr 1.
 view=await dashboard({sr:2,opened:[1,2]});assert.ok(view.has('recheck'));assert.equal(view.panel(1),'hidden');
 // Without the report table it cannot be drawn.
 view=await dashboard({ReportSection:null});assert.ok(!view.has('recheck'));
 // A login with its own MIS pages sees it only when it may open the Caliber ID Re-check page (the server's own rule).
 const own=pages=>({token:'t',role:'super',permissions:{separateMisCredentials:true,misDesktopAccess:pages,misMobileAccess:[]}});
 view=await dashboard({session:own(['Dashboard','Reports'])});
 assert.ok(!view.has('recheck'),'no re-check for a login the server would refuse');assert.ok(view.has('batch'),'Batch Status stays');
 view=await dashboard({session:own(['Dashboard','Vehicle Log Book'])});assert.ok(view.has('recheck'));
 assert.equal(view.api.recheckAllowed({token:'t',permissions:{}}),true,'an administrator without separate MIS pages reads it');
 const screen=read('log-book-dashboard.jsx');
 assert.ok(screen.includes("const CaliberRecheck=lazy(()=>import('./caliber-recheck.jsx'));"),'it loads after the cards');
 assert.ok(screen.includes("export const recheckAllowed=session=>!session?.permissions?.separateMisCredentials||misPageAllowed(session,'Caliber ID Re-check');"));
 assert.ok(screen.includes("the last 6, 12 and 24 hours, the Caliber ID re-check, Batch Status & Turnaround"),'Smart Print names it in the complete dashboard');
 // The same screen as the page, kept short; a day read in the last few minutes is not asked for again.
 const page=read('caliber-recheck.jsx'),css=read('caliber-recheck.css');
 assert.ok(page.includes('export default function CaliberRecheck({session,ReportSection,embedded=false,onOpenPage}){'),'the page itself is not embedded');
 assert.ok(page.includes("useEffect(()=>{void recheck(undefined,true,false,embedded);return()=>{run.current++};},[]);"),'only the first reading on the dashboard takes kept days');
 assert.ok(page.includes("const kept=reuse?keptRecheckAnswer(session.token,dates[i]):null;"));
 assert.ok(page.includes("if(kept)oldest=Math.min(oldest,kept.at);else keepRecheckAnswer(session.token,answer);"),'every day read from the server replaces what was kept');
 assert.ok(page.includes("{embedded?'Reading the Caliber ID re-check: day ':'Re-checking day '}"),'All in the Sr No strip waits for a line that starts with Reading');
 assert.ok(page.includes("if(embedded&&e.status===403)setRefusedAccess(true);else setError(e.message);"),'a refused login sees no panel, not an error');
 assert.ok(page.includes("if(embedded&&refusedAccess)return null;"));
 assert.ok(page.includes('{!embedded&&<header className="cr-head">'),'no page heading or dates on the dashboard');
 assert.ok(page.includes('{!embedded&&<><div className="cr-summary" aria-label="Summary">'),'no summary, Excel or run there');
 assert.ok(page.includes('{!embedded&&<><details className="cr-record"'),'Corrections done and Cards confirmed right stay on the page');
 assert.ok(page.includes("'data-print-title':'Caliber ID Re-check'"),'its sheet of a dashboard print has a name');
 assert.ok(page.includes('<button type="button" disabled={busy} onClick={()=>void recheck()} title="Read every day again from the server">Refresh</button>'),'Refresh always asks the server');
 assert.ok(css.includes('.caliber-recheck.cr-embedded{padding:0 22px}'));
});

test('a screen without the report table offers only the panels it can draw',async()=>{
 const view=await dashboard({ReportSection:null});
 assert.deepEqual(view.tabs.map(tab=>tab[0]),['Sr 1 '+SR1,'All Every Sr No']);
 assert.equal(view.panel(1),'absent','without the report table Batch Status is not drawn');
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
 assert.match(screen,/<BatchStatusReport session=\{session\} ReportSection=\{ReportSection\} embedded paused=\{!shown\(1\)\}\/>/);
});
