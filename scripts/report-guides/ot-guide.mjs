// Builds the staff guide for the OT & Multiple Duties report as one HTML file (printed to PDF by a headless browser).
// The illustrations are the real screen code rendered with made-up data, so they match what staff see.
// Usage: node ot-guide.mjs <repo root> <out dir> [hi]   (writes ot-en.html or ot-hi.html and app.css; build.mjs prints them to PDF)
import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import {pathToFileURL,fileURLToPath} from 'node:url';
const [root,outDir,lang='en']=process.argv.slice(2),hi=lang==='hi',hiText=hi?await import(pathToFileURL(path.join(path.dirname(fileURLToPath(import.meta.url)),'ot-guide-hi.mjs')).href):null,require=createRequire(path.join(root,'package.json'));
const React=require('react'),{renderToStaticMarkup}=require('react-dom/server'),h=React.createElement;
const {transformWithOxc}=await import(pathToFileURL(require.resolve('vite')).href);
const {canonicalSiteName}=await import(pathToFileURL(path.join(root,'shared/site-location.mjs')).href);
const {compactLogBookLabel}=await import(pathToFileURL(path.join(root,'shared/log-book-labels.mjs')).href);
const source=fs.readFileSync(path.join(root,'src/manpower-reports.jsx'),'utf8');
const {code}=await transformWithOxc(source.replace(/^import .*;\r?\n/gm,'').replaceAll('export default function','function'),'manpower-reports.jsx',{jsx:{runtime:'classic'}});

// Stand-in for the shared report table: same titles, columns and rows; simplified frame.
const ReportSection=({title,description,category,rows,columns,emptyMessage,rowClassName})=>h('section',{className:'g-report','data-cat':category},
 h('header',null,h('div',null,h('h2',null,title),h('p',null,description)),h('span',{className:'g-generate'},'Generate ▾')),
 h('div',{className:'g-tools'},h('span',{className:'g-search'},'Search this report'),h('span',null,rows.length+' record'+(rows.length===1?'':'s'))),
 rows.length?h('div',{className:'g-table'},h('table',null,
  h('thead',null,h('tr',null,h('th',null,'Sr. No.'),columns.map(c=>h('th',{key:c.key},c.label+' ⇅')))),
  h('tbody',null,rows.slice(0,6).map((r,i)=>h('tr',{key:i,className:rowClassName?.(r)},h('td',null,i+1),columns.map(c=>h('td',{key:c.key},c.render?c.render(r):String(c.value(r))))))))):h('p',{className:'g-empty'},emptyMessage));
function view(slots){
 let cursor=0;
 const env={compactLogBookLabel,canonicalSiteName,React,OPERATIONAL_START:'2026-11-01',useRef:()=>({current:null}),useEffect:()=>{},useMemo:fn=>fn(),useState:init=>{const i=cursor++;if(!(i in slots))slots[i]=typeof init==='function'?init():init;return [slots[i],()=>{}];}};
 const render=new Function(...Object.keys(env),code+';return ManpowerReports')(...Object.values(env));
 return renderToStaticMarkup(render({session:{token:'guide'},reportId:'ot',onSelect(){},ReportSection}));
}

// ---- Made-up data: real site names, sample drivers ----
const sites=['Dhoptala OC (2nd)','Dudhichua East OC','Dudhichua OC','Gauri Pauni OC (2nd)','Jayant OC','Majri OC','Sasti OC'],SITE='Dhoptala OC (2nd)',DAY='2026-12-14';
const filters={from:DAY,to:DAY,site:'',shift:'',batch:'',employee:'',asset:''},query=new URLSearchParams(filters).toString();
const reasons={red:'RED — Back-to-back OT',orange:'ORANGE — Shift 1 and Shift 3 with a shift gap',review:'REVIEW — Multiple duties; schedule or shift pattern needs confirmation'};
const shiftsOf={red:DAY+' S1; '+DAY+' S2',orange:DAY+' S1; '+DAY+' S3',review:DAY+' S2; '+DAY+' S3'};
const ot=[];let n=0;
const add=(site,severity,books,category,count,equipment='Tipper / Volvo')=>{for(let i=0;i<count;i++){n++;const id=String(n).padStart(2,'0');ot.push({id:'e'+n,severity,reason:reasons[severity],logBooks:books,logBook:books.join(' + '),employeeKey:'S'+id,siteKey:canonicalSiteName(site),employeeId:'CMPL900'+id,caliberCode:'CMLL900'+id,employeeName:'SAMPLE DRIVER '+id,category,equipment,site,dates:DAY,shifts:shiftsOf[severity],shiftHours:severity==='red'?'S1: 7.5; S2: 7':'S1: 7; S3: 6.5',combinedHours:severity==='red'?14.5:13.5,schedule:severity==='red'?'05:00 → 13:00; 13:00 → 21:00':'05:00 → 13:00; 21:00 → 05:00',gaps:severity==='red'?'0 h':'8 h',batches:'CMLL/'+DAY+'/DHOPTALA/S1',books:'CAL/VLB/141226/S1/00'+id,remarks:''});}};
add(SITE,'red',['VLB'],'VOLVO DRIVER',6);add(SITE,'orange',['VLB'],'VOLVO DRIVER',3);add(SITE,'red',['VLB'],'TIPPER DRIVER',2,'Tipper / Eicher');add(SITE,'orange',['VLB'],'TIPPER DRIVER',1,'Tipper / Eicher');
add(SITE,'red',['ELB'],'PC OPERATOR',1,'Excavator / Volvo');add(SITE,'orange',['ELB'],'PC OPERATOR',1,'Excavator / Volvo');add(SITE,'red',['VLB','LMV'],'VOLVO DRIVER',1,'Tipper / Volvo; Camper / Mahindra');add(SITE,'review',['LMV'],'LMV DRIVER',1,'Camper / Mahindra');
add('Jayant OC','red',['VLB'],'VOLVO DRIVER',4);add('Jayant OC','orange',['ELB'],'DOZER OPERATOR',1,'Dozer / Komatsu');add('Jayant OC','red',['LMV'],'LMV DRIVER',1,'Shift van / Tata');
add('Sasti OC','red',['VLB'],'VOLVO DRIVER',3);add('Sasti OC','orange',['VLB'],'TIPPER DRIVER',2);add('Majri OC','red',['ELB'],'PC OPERATOR',2,'Excavator / Tata Hitachi');add('Dudhichua OC','orange',['VLB'],'VOLVO DRIVER',2);add('Gauri Pauni OC (2nd)','review',['VLB','ELB'],'GRADER OPERATOR',1,'Grader / Caterpillar');
const tally=list=>Object.fromEntries(['red','orange','review'].map(s=>[s,list.filter(e=>e.severity===s).length]));
const otSites=sites.map(site=>{const events=ot.filter(e=>e.site===site);return {site,siteKey:canonicalSiteName(site),...tally(events),books:Object.fromEntries(['VLB','ELB','LMV'].map(b=>[b,tally(events.filter(e=>e.logBooks.includes(b)))]))};});
const exceptions=[{id:'x1',date:DAY,site:SITE,siteKey:canonicalSiteName(SITE),shift:'S2',door:'V1042',employeeId:'',employeeName:'SAMPLE DRIVER 31',book:'CAL/VLB/141226/S2/0031',logBook:'VLB',batches:'CMLL/'+DAY+'/DHOPTALA/S2',reason:'Employee ID is missing or cannot be resolved to an employee master.'},
 {id:'x2',date:DAY,site:SITE,siteKey:canonicalSiteName(SITE),shift:'S1',door:'C-58',employeeId:'CMPL90032',employeeName:'SAMPLE DRIVER 32',book:'CAL/LMV/14-12-26/007',logBook:'LMV',batches:'Saved LMV (no site batch)',reason:'Effective site shift schedule is missing or ambiguous; timing requires review.'}];
const payload={summary:[],details:[],performance:[],shiftAttendance:[],ot,otSites,exceptions,totals:{assets:0,employees:0,duties:0,exceptions:0},notes:[],options:{sites},generatedAt:'2026-12-14T11:30:00Z'};
const siteKey=canonicalSiteName(SITE),ev=(id,date,severity)=>({id,date,dates:date,severity,reason:reasons[severity],shifts:date+(severity==='red'?' S1; '+date+' S2':' S1; '+date+' S3'),logBook:'VLB',equipment:'Tipper / Volvo',combinedHours:severity==='red'?14.5:13.5,books:'CAL/VLB/'+date.slice(8)+date.slice(5,7)+'26/S1/0012'});
const counts=events=>({month:{...tally(events.filter(e=>e.date>='2026-12-01')),total:events.filter(e=>e.date>='2026-12-01').length},year:{...tally(events),total:events.length}});
const history01=[ev('h1',DAY,'red'),ev('h2','2026-12-11','red'),ev('h3','2026-12-08','orange'),ev('h4','2026-12-05','red'),ev('h5','2026-12-02','red'),ev('h6','2026-11-27','red'),ev('h7','2026-11-21','orange'),ev('h8','2026-11-16','red'),ev('h9','2026-11-12','red'),ev('h10','2026-11-09','red'),ev('h11','2026-11-04','red')];
const worked=(november,december)=>({duties:{'2026-11':november,'2026-12':december}});
const yearData={year:'2026',month:'2026-12',yearFrom:'2026-11-01',yearTo:DAY,monthFrom:'2026-12-01',monthTo:DAY,drivers:[
 {employeeKey:'S01',siteKey,...counts(history01),events:history01,...worked(26,13)},
 ...[['S02',[DAY,'2026-12-03','2026-11-18']],['S03',[DAY,'2026-11-25']],['S04',[DAY]],['S05',[DAY,'2026-12-09','2026-12-01','2026-11-20','2026-11-06']],['S06',[DAY,'2026-12-10']],['S07',[DAY,'2026-11-30']],['S08',[DAY]],['S09',[DAY,'2026-12-04','2026-11-11']],['S15',[DAY,'2026-12-06']]].map(([key,dates])=>{const events=dates.map((d,i)=>ev(key+i,d,i%3===2?'orange':'red'));return {employeeKey:key,siteKey,...counts(events),events,...worked(24,12)};})]};
const none={key:'',data:null,error:''};
// State order of the screen: filters, data, error, busy, refresh, options, auto-hide, filters open, log book, month and year counts, opened driver, attendance choice, OT choice.
const state=({logBook='',tallyState=none,driverOpen='',otPick={siteKey:'',severity:''}}={})=>view([{...filters},{query,payload},'',false,0,{sites},false,false,logBook,tallyState,driverOpen,{siteKey:'',shift:'',equipment:'',flag:''},otPick]);
const loaded={key:siteKey+'|2026-12|0',data:yearData,error:''};
const views={
 start:state(),
 site:state({otPick:{siteKey,severity:''},tallyState:loaded}),
 red:state({otPick:{siteKey,severity:'red'},tallyState:loaded}),
 driver:state({otPick:{siteKey,severity:'red'},tallyState:loaded,driverOpen:'S01|'+siteKey})};

// ---- Illustrations: a state of the screen and the parts of it to keep ----
const figures={
 open:{view:'start',keep:['.mp-heading','.mp-tabs'],caption:'The report page. OT & Multiple Duties is the last of the four Manpower & OT tabs.'},
 filters:{view:'start',keep:['.mp-filter-box'],caption:'The filters. The top line always shows the dates in use. Tick Auto-hide filters to tuck the selectors away.'},
 books:{view:'site',keep:['.mp-notice','.mp-book-pick'],caption:'The line that says what is counted, and the log book selector. All log books is chosen at the start.'},
 sites:{view:'start',keep:['.mp-att'],caption:'One line per site: red, orange and brown cases and the number of drivers. Every number can be pressed.'},
 drivers:{view:'red',keep:['[data-cat="manpower-ot-drivers"]'],caption:'The drivers list after a red number is pressed: one row per driver, with his OT count for the month and for the year.'},
 driver:{view:'driver',keep:['.mp-driver-history','[data-cat="manpower-ot-driver-history"]'],caption:'Press a driver’s name to open his history: duties and OT month by month, then every flagged duty, newest first.'},
 cases:{view:'red',keep:['[data-cat="manpower-ot"]'],caption:'Each case: one row per case, with the shifts worked and the saved cards behind it.'},
 review:{view:'site',keep:['.mp-review'],caption:'The line “saved cards need correction”, opened: saved cards that could not be counted properly.'}};
const figureCss=`html,body{margin:0;background:#f6f3fb;height:auto;overflow:hidden}body{font-family:Arial,Helvetica,sans-serif}
.mp-reports{padding:14px;gap:12px}
.g-report{border:1px solid #dfd6e9;border-radius:12px;background:#fff;padding:14px 16px;overflow:hidden}.g-report>header{display:flex;justify-content:space-between;gap:12px;align-items:flex-start}.g-report h2{margin:0 0 4px;font-size:17px}.g-report header p{margin:0;font-size:12px;color:#665e75}
.g-generate{padding:8px 14px;border:1px solid #c7b5dd;border-radius:9px;font-size:13px;font-weight:700;white-space:nowrap;background:#fff}
.g-tools{display:flex;align-items:center;gap:12px;margin:10px 0;font-size:12px;color:#665e75}.g-search{min-width:230px;padding:8px 12px;border:1px solid #d5cbe2;border-radius:9px;color:#8d859a;background:#fff}
.g-table{overflow:hidden;border:1px solid #e3ddec;border-radius:9px}.g-report table{border-collapse:collapse;font-size:12.5px;white-space:nowrap}.g-report th{padding:9px 14px;text-align:left;font-size:11px;letter-spacing:.05em;text-transform:uppercase;color:#59627a;background:#f1f4f9;border-bottom:1px solid #dfe3ec}.g-report td{padding:9px 14px;border-bottom:1px solid #eef0f4;vertical-align:middle}.g-report td:first-child,.g-report th:first-child{text-align:center}
.g-dialog{border:1px solid #cdbfe0;border-radius:14px;background:#fff;padding:16px 18px;box-shadow:0 10px 28px #3c226033;width:780px;justify-self:center;margin:6px 0}.g-dialog .mp-filters{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px;padding:0;border:0}.g-dialog>header{display:flex;justify-content:space-between;align-items:center;margin-bottom:12px}.g-dialog h2{margin:0;font-size:18px}.g-close{padding:6px 12px;border:1px solid #c7b5dd;border-radius:8px;font-size:13px}.g-dialog form>button{margin-top:12px;padding:10px 18px;border:0;border-radius:9px;background:#59338b;color:#fff;font-weight:700;font-size:14px}`;
const page=name=>'<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="app.css"><style>'+figureCss+'</style></head><body>'+views[figures[name].view]
 +'<script>const keep='+JSON.stringify(figures[name].keep)+';for(const el of [...document.querySelector(".mp-reports").children])if(!keep.some(s=>el.matches(s)))el.remove();for(const list of document.querySelectorAll("details.mp-review"))list.open=true;</'+'script></body></html>';

// ---- Guide text ----
const fig=(name,number)=>'<figure><div class="frame" data-fig="'+name+'"></div><figcaption><b>'+(hi?hiText.pictureWord:'Picture')+' '+number+'.</b> '+(hi?hiText.captions[name]:figures[name].caption)+' <i>'+(hi?hiText.sampleWord:'Sample data.')+'</i></figcaption></figure>';
const flag=(level,text)=>'<span class="flag '+level+'">'+text+'</span>';
let number=0;const next=name=>fig(name,++number);
const body=`
<header class="cover">
 <p class="kicker">CALIBER MINING AND LOGISTICS LIMITED · PULSE-II</p>
 <h1>OT &amp; Multiple Duties report</h1>
 <p class="sub">How to check and review it, step by step</p>
 <p class="meta">For site in-charges, MIS staff and reviewers · Matches the system as of 10 November 2026 · The pictures use sample data, not real drivers</p>
</header>

<section>
<h2>1. What this report tells you</h2>
<p>The report finds drivers and operators who worked more than one shift, from the log books already saved in Pulse-II: Vehicle Log Book (VLB), Equipment Log Book (ELB) and LMV Log Book. Each such finding is called a <b>case</b> and gets one of three colours.</p>
<table class="plain">
 <tr><th>Colour</th><th>What it means</th></tr>
 <tr><td>${flag('red','Red')}</td><td>Two shifts back to back on the same day, all three shifts in one day, or Shift 3 followed by the next day’s Shift 1.</td></tr>
 <tr><td>${flag('orange','Orange')}</td><td>Shift 1 and Shift 3 on the same day, with a shift of rest in between.</td></tr>
 <tr><td>${flag('review','Brown')}</td><td>More than one duty, but the shift timing or pattern could not be confirmed from the Shift Master. Someone has to look at it. In the lists its reason starts with the word REVIEW.</td></tr>
</table>
<p class="note"><b>Keep in mind.</b> The report reads saved cards only. A card still waiting in scanning, or a deleted card, is not counted. Shift times come from the Shift Master, not from attendance. HMR hours are machine hours, not payable OT hours.</p>
</section>

<section>
<h2>2. Open the report and choose the dates</h2>
<ol>
 <li>In the left menu open <b>Reports → Manpower &amp; OT → OT &amp; Multiple Duties</b>.</li>
 <li>The report opens on today’s date. In the filters at the top set <b>From</b> and <b>To</b> for the days you want. Press <b>Today</b> to come back to today’s date.</li>
 <li>You can choose up to 31 days at a time, starting from 1 November 2026.</li>
 <li>To see one site only, choose it in <b>Site</b>. Its drivers then open straight away.</li>
 <li>Press <b>Refresh reports</b> to read the latest saved cards.</li>
</ol>
${next('open')}
${next('filters')}
<p class="note"><b>More room on screen.</b> Tick <b>Auto-hide filters</b> to fold the selectors into one line; they open when you point at the line. In the left menu, <b>Auto-hide menu</b> does the same for the menu. If the page looks old after an update, press <b>Ctrl + F5</b> once.</p>
</section>

<section>
<h2>3. Choose the log book</h2>
<p>Under the filters, one line says what is counted and how many cases and drivers were found in your dates. Below it is the log book selector.</p>
${next('books')}
<ul>
 <li><b>All log books</b> counts the cases on VLB, ELB and LMV together. Press <b>VLB</b>, <b>ELB</b> or <b>LMV</b> to see only the cases that include that log book. Every number on the page follows the selector.</li>
 <li>A case done on two log books, for example a tipper in Shift 1 and an LMV in Shift 2, is counted under both. So VLB + ELB + LMV can be more than All log books. This is correct.</li>
</ul>
</section>

<section>
<h2>4. Read the site table</h2>
<p>The table has one line for every site assigned to your login, and an <b>All sites</b> line at the bottom.</p>
${next('sites')}
<table class="plain">
 <tr><th>Column</th><th>What it shows</th></tr>
 <tr><td>Red, Orange, Brown</td><td>The number of cases of that colour at the site, in the dates you chose.</td></tr>
 <tr><td>Drivers</td><td>How many different drivers at the site have a case of any colour.</td></tr>
</table>
<ul>
 <li><b>Press a red, orange or brown number</b> to list the drivers of that site with that colour. <b>Press the number under Drivers</b> to list all of them.</li>
 <li>Press the same number again to close the list.</li>
 <li>A line with all zeros means the site was checked and nothing was found.</li>
 <li>A number on the <b>All sites</b> line lists the drivers of every site together. That list has a Site column.</li>
</ul>
</section>

<section>
<h2>5. The drivers list and the OT counts</h2>
<p>After you press a number, the drivers list opens below the table, one row per driver.</p>
${next('drivers')}
<table class="plain">
 <tr><th>Column</th><th>What it shows</th></tr>
 <tr><td>OT in the month</td><td>Right after the name. How many cases the driver has in the calendar month of your To date, at this site.</td></tr>
 <tr><td>OT in the year</td><td>The same count for the calendar year. Records start on 1 November 2026, so 2026 covers November and December.</td></tr>
 <tr><td>Driver category</td><td>The driver’s current designation in the Employee master. “Category not in Employee master” means none is saved; get the Employee master corrected.</td></tr>
 <tr><td>Red, Orange, Brown</td><td>The driver’s cases of each colour inside the dates you chose.</td></tr>
 <tr><td>Cases in selected dates</td><td>The total of the three.</td></tr>
 <tr><td>Log book, duty dates, shifts, equipment</td><td>Where and when those duties were done.</td></tr>
</table>
<p class="note"><b>One OT is one case</b>, whether red, orange or brown. While the counts are being read the cells say “Checking…”. They never show 0 before the answer has come. In a list opened from the All sites line the cells say “Press the name”: the counts are read for one site at a time, when you press a driver’s name.</p>
</section>

<section>
<h2>6. One driver’s history</h2>
<p><b>Press the driver’s name.</b> His history for the year opens below the list.</p>
${next('driver')}
<ul>
 <li>The first table goes month by month: <b>Duties</b> (saved VLB and ELB cards, one per shift), then Red, Orange, Brown and <b>OT times</b>, with the year total in the last row.</li>
 <li>The second table lists every case of the year, newest first, with the shifts worked and the saved card numbers.</li>
 <li>Press the name again, or <b>Close history</b>, to close it.</li>
</ul>
</section>

<section>
<h2>7. Each case</h2>
<p>Below the drivers list, the table <b>each case</b> lists every case in full, for the site and colour you opened.</p>
${next('cases')}
<table class="plain">
 <tr><th>Column</th><th>How to use it</th></tr>
 <tr><td>OT flag / reason</td><td>The colour and the exact reason.</td></tr>
 <tr><td>Log book</td><td>VLB, ELB, LMV, or two of them joined, such as VLB + LMV.</td></tr>
 <tr><td>Shifts worked, scheduled start / end, gap</td><td>Which shifts, the Shift Master timings, and the rest between the duties.</td></tr>
 <tr><td>Saved cards, source batches</td><td>The card numbers and batches the case came from. Use these to open and check the original entry.</td></tr>
 <tr><td>Remarks / review</td><td>Anything doubtful in the cards, such as a missing meter reading.</td></tr>
</table>
</section>

<section>
<h2>8. Cards that need correction</h2>
<p>Near the bottom of the page one line reads <b>“… saved cards need correction (list for the MIS team)”</b>. Press it to open <b>Manpower Data Review</b>: saved cards that could not be counted properly. Until they are corrected, the counts above may be short. The line is not shown when no card needs correction.</p>
${next('review')}
<table class="plain">
 <tr><th>What to correct, as shown</th><th>What to do</th></tr>
 <tr><td>Employee ID is missing or cannot be resolved</td><td>The card has no valid driver. Correct the Employee ID on the saved card.</td></tr>
 <tr><td>Equipment master match is missing</td><td>The door number on the card is not in the Equipment master. Correct the card or the master.</td></tr>
 <tr><td>Shift schedule is missing or ambiguous</td><td>The Shift Master has no clear timing for that site and shift. Get the Shift Master corrected.</td></tr>
 <tr><td>Possible repeated scan / card</td><td>The same card appears to be saved twice. Compare the two cards and remove the wrong one.</td></tr>
</table>
</section>

<section>
<h2>9. Download, print and search</h2>
<ul>
 <li>Every table has a <b>Generate</b> button: <b>Download as PDF</b>, <b>Download as Excel</b> or <b>Smart Print</b>. The file contains all rows of that table, not only the ones on screen.</li>
 <li>Type in <b>Search this report</b> to find a driver, door number or card inside a table.</li>
 <li>Press a column heading to sort by that column.</li>
</ul>
</section>

<section class="keep">
<h2>10. Daily review routine</h2>
<table class="plain steps">
 <tr><th>Step</th><th>Do this</th></tr>
 <tr><td>1</td><td>Open the report and set the dates to the day or days you are reviewing.</td></tr>
 <tr><td>2</td><td>Leave the selector on All log books. In the site table read the Red column first, then Orange, then Brown.</td></tr>
 <tr><td>3</td><td>Press the red number of each site that has one. The drivers list opens.</td></tr>
 <tr><td>4</td><td>For each driver, read OT in the month and OT in the year. Press the name of anyone who repeats and read his history.</td></tr>
 <tr><td>5</td><td>Before reporting a case, check it in the table “each case”: shifts worked and saved cards. A wrong driver ID or a wrong shift on a card creates a false OT. Get such cards corrected in the log book.</td></tr>
 <tr><td>6</td><td>Open the line “saved cards need correction” and get every listed card or master entry corrected.</td></tr>
 <tr><td>7</td><td>Use Generate to download the drivers list or the case table for your record or report.</td></tr>
</table>
<p class="note"><b>This guide shows how to find and verify the cases.</b> What action to take on a red or orange case is as instructed by management.</p>
</section>

<section class="keep">
<h2>11. Common questions</h2>
<table class="plain">
 <tr><th>Question</th><th>Answer</th></tr>
 <tr><td>A driver did OT but is not in the report.</td><td>Check that both cards are saved (not pending in scanning), carry the same Employee ID, and are at the same site. Open the line “saved cards need correction” and look for his cards.</td></tr>
 <tr><td>The numbers changed since the morning.</td><td>More cards were saved, corrected or deleted. Press <b>Refresh reports</b> for the latest position.</td></tr>
 <tr><td>VLB + ELB + LMV is more than All log books.</td><td>A case done on two log books is counted under both. All log books counts it once.</td></tr>
 <tr><td>OT in the year is the same as OT in the month.</td><td>That happens in the first month of records, or when all his OT of the year is in this month.</td></tr>
 <tr><td>The OT cells say “Press the name”.</td><td>You opened the All sites line. Press the driver’s name: the counts of his site are then read.</td></tr>
 <tr><td>A driver works at two sites.</td><td>Counts are for one site at a time. In the All sites list he has one row for each site.</td></tr>
 <tr><td>I do not see a site.</td><td>You see only the sites assigned to your login. Ask the administrator.</td></tr>
</table>
</section>`;
const guideCss=`@page{size:A4;margin:15mm 15mm 16mm}*{box-sizing:border-box}html{-webkit-print-color-adjust:exact;print-color-adjust:exact}
html{background:#fff}body{margin:0;background:#fff;font-family:Arial,Helvetica,sans-serif;font-size:10.6pt;line-height:1.45;color:#231a33}
.cover{padding:18px 22px;border-radius:12px;background:#59338b;color:#fff;margin-bottom:14px}.cover .kicker{margin:0 0 6px;font-size:8.5pt;letter-spacing:.12em;font-weight:700;opacity:.85}.cover h1{margin:0;font-size:24pt;line-height:1.15}.cover .sub{margin:4px 0 10px;font-size:13pt}.cover .meta{margin:0;font-size:8.8pt;opacity:.9}
h2{margin:16px 0 6px;font-size:13.5pt;color:#59338b;break-after:avoid}p{margin:0 0 7px}ol,ul{margin:0 0 8px;padding-left:20px}li{margin-bottom:3px}
section.keep{break-inside:avoid}
.note{padding:8px 11px;border-left:4px solid #59338b;background:#f3eefa;border-radius:0 8px 8px 0;font-size:9.8pt}
table.plain{width:100%;border-collapse:collapse;margin:4px 0 9px;font-size:9.8pt;break-inside:avoid}table.plain th{text-align:left;padding:6px 9px;background:#ece5f6;border:1px solid #d6cae6}table.plain td{padding:6px 9px;border:1px solid #ddd3ea;vertical-align:top}table.plain td:first-child{width:31%;font-weight:700}table.steps td:first-child{width:9%;text-align:center}
.flag{display:inline-block;padding:3px 9px;border-radius:6px;font-size:9pt;font-weight:800;border:1px solid currentColor}.flag.red{background:#ffe6e5;color:#a31f20}.flag.orange{background:#fff0d8;color:#984800}.flag.review{background:#e8d2bd;color:#5c3310}
figure{margin:8px 0 10px;break-inside:avoid}figure .frame{border:1px solid #cfc3e0;border-radius:8px;overflow:hidden;background:#f6f3fb}figure iframe{display:block;border:0;width:1120px;zoom:.605}figcaption{margin-top:4px;font-size:9pt;color:#4f4660}`;
fs.mkdirSync(outDir,{recursive:true});
const css=fs.readdirSync(path.join(root,'dist/app-assets')).filter(f=>/^index-.*\.css$/.test(f)).map(f=>({f,t:fs.statSync(path.join(root,'dist/app-assets',f)).mtimeMs})).sort((a,b)=>b.t-a.t)[0].f;
fs.writeFileSync(path.join(outDir,'app.css'),fs.readFileSync(path.join(root,'dist/app-assets',css),'utf8')+'\n'+fs.readFileSync(path.join(root,'src/manpower-reports.css'),'utf8'));
const pages=Object.fromEntries(Object.keys(figures).map(name=>[name,page(name)]));
const script=`const pages=JSON.parse(document.getElementById('pages').textContent);let pending=0;
for(const frame of document.querySelectorAll('.frame')){const iframe=document.createElement('iframe');pending++;
 iframe.addEventListener('load',()=>{const fit=()=>{const box=iframe.contentDocument.querySelector('.mp-reports');iframe.style.height=Math.ceil(box.getBoundingClientRect().height)+'px';};fit();setTimeout(fit,300);setTimeout(()=>{fit();if(!--pending)document.title='ready';},900);});
 iframe.srcdoc=pages[frame.dataset.fig];frame.appendChild(iframe);}`;
const page0=hi?'ot-hi.html':'ot-en.html',finalBody=hi?(number=0,hiText.body({next,flag})):body,langCss=hi?"body{font-family:'Nirmala UI',Mangal,Arial,sans-serif;font-size:10.8pt;line-height:1.62}.cover h1{font-size:22pt}h2{font-size:13pt}table.plain,.note{font-size:10pt}figcaption{font-size:9.4pt}":'';
fs.writeFileSync(path.join(outDir,page0),'<!doctype html><html lang="'+lang+'"><head><meta charset="utf-8"><title>'+(hi?hiText.title:'OT and Multiple Duties report: how to check and review')+'</title><style>'+guideCss+langCss+'</style></head><body>'+finalBody
 +'<script type="application/json" id="pages">'+JSON.stringify(pages).replace(/</g,'\\u003c')+'</'+'script><script>'+script+'</'+'script></body></html>');
console.log('figures',Object.keys(figures).length,'numbered',number,'css',css,'html bytes',fs.statSync(path.join(outDir,page0)).size,page0);
