// Made-up sample data for the report manuals, shaped like the JSON of GET /api/reports/operations
// (server/routes/log-book.mjs): {records, assets, shifts, batches, fleet, cards, scanConnected}.
// Nothing here is real: sites are used only as labels, people are SAMPLE DRIVER 01..08,
// doors are V9001.., TPC901.., and every reading, time and book number is invented.
//
// What the sample holds (16 saved log books, 13 and 14 December 2026):
//   Dhoptala OC (2nd)  Shift I + Shift II   V9001 (tipper), TPC901 (loader)
//   Jayant OC          Shift I              V9002, V9003 (tippers), VPC902 (loader)
//   Sasti OC           Day (12 hours)       TPC903 (equipment only, so 0 trips and 0 KM)
// Deliberate exceptions, so the exception reports are not empty:
//   1. No saved book for V9001, Shift II, 13 Dec (its scan card is still in review). The next
//      book of V9001 therefore opens 64 km and 6 hours above the last saved closing reading.
//   2. No saved book for TPC901, Shift II, 14 Dec.
//   3. V9002 on 14 Dec opens at KMR 45254 although the 13 Dec book closed at 45244 (meter gap).
//   4. VPC902 on 14 Dec carries 3 breakdown hours; V9002 waited (long trip gap, low running hours).
//   5. TPC903 on 14 Dec carries a manual breakdown entry; V9001 Shift II on 14 Dec has no breakdown figure.
//   6. V9003 on 14 Dec was saved without trip times; one scan card failed to read.
//   7. VPC904 (Jayant) was in breakdown for the whole of Shift I on 14 Dec and TPC905 (Dhoptala) was not in use,
//      so the Loading Equipment-wise Report has a machine in BD and a machine with no hours.

const DHOPTALA='Dhoptala OC (2nd)',JAYANT='Jayant OC',SASTI='Sasti OC';
const WORK_ORDERS={[DHOPTALA]:'WO/SAMPLE/DHP/001',[JAYANT]:'WO/SAMPLE/JYT/002',[SASTI]:null};

// Shift Master rows as the report endpoint returns them, plus the fields saved on each book.
const SHIFTS={
 dhoptala1:{id:9201,name:'Shift I',site:DHOPTALA,hours:8,start:'05:00',code:'S1'},
 dhoptala2:{id:9202,name:'Shift II',site:DHOPTALA,hours:8,start:'13:00',code:'S2'},
 jayant1:{id:9211,name:'Shift I',site:JAYANT,hours:8,start:'05:00',code:'S1'},
 sastiDay:{id:9221,name:'Day',site:SASTI,hours:12,start:'06:00',code:'D'},
};
// Equipment master rows.
const ASSETS={
 V9001:{id:9001,door:'V9001',site:DHOPTALA,kind:'vehicle',name:'SAMPLE TIPPER',registration:'SAMPLE-9001'},
 TPC901:{id:9101,door:'TPC901',site:DHOPTALA,kind:'equipment',name:'SAMPLE EXCAVATOR',registration:''},
 V9002:{id:9002,door:'V9002',site:JAYANT,kind:'vehicle',name:'SAMPLE TIPPER',registration:'SAMPLE-9002'},
 V9003:{id:9003,door:'V9003',site:JAYANT,kind:'vehicle',name:'SAMPLE TIPPER',registration:'SAMPLE-9003'},
 VPC902:{id:9102,door:'VPC902',site:JAYANT,kind:'equipment',name:'SAMPLE EXCAVATOR',registration:''},
 TPC903:{id:9103,door:'TPC903',site:SASTI,kind:'equipment',name:'SAMPLE EXCAVATOR',registration:''},
 VPC904:{id:9104,door:'VPC904',site:JAYANT,kind:'equipment',name:'SAMPLE EXCAVATOR',registration:''},
 TPC905:{id:9105,door:'TPC905',site:DHOPTALA,kind:'equipment',name:'SAMPLE EXCAVATOR',registration:''},
};
const person=n=>({id:9300+n,name:'SAMPLE DRIVER '+String(n).padStart(2,'0'),caliberId:'CMPL9'+String(n).padStart(4,'0')});
const PEOPLE=Object.fromEntries([1,2,3,4,5,6,7,8].map(n=>['d'+n,person(n)]));

const toMinutes=time=>{const [hours,minutes]=time.split(':').map(Number);return hours*60+minutes;};
const minutesBetween=(start,end)=>(toMinutes(end)-toMinutes(start)+1440)%1440;

// rows: [loadingTime, unloadingTime, tripCount]. With times, each row gets the same derived fields
// the server saves: elapsed minutes on the row and the gap from the previous row's unloading time.
function tripRows(equipmentName,timeMode,rows){
 const out=rows.map(([loadingTime,unloadingTime,tripCount=1])=>({
  equipmentName,originalEquipmentName:equipmentName,loadingTime,unloadingTime,tripCount,
  durationMinutes:timeMode==='with'&&loadingTime&&unloadingTime?minutesBetween(loadingTime,unloadingTime):null,
  handoverLinks:[],completedTrips:tripCount,tripStatus:'closed',
 }));
 out.forEach((row,index)=>{row.gapMinutes=timeMode==='with'&&index>0?minutesBetween(out[index-1].unloadingTime,row.loadingTime):null;});
 return out;
}

function book({id,bookNo,date,asset,shift,driver,kmr=null,hmr,loader='',timeMode='with',trips=[],remark='',breakdownHours=0,breakdownHoursSource='pulse',hoursWarning,scanCardId,status='',statusReason=''}){
 const vehicle=asset.kind==='vehicle',rows=vehicle?tripRows(loader,timeMode,trips):[];
 const count=test=>rows.reduce((sum,row)=>sum+(test(row)?row.tripCount:0),0);
 const totalTrips=count(()=>true),openingTrips=count(row=>row.loadingTime),endingTrips=count(row=>row.unloadingTime),workingHmr=hmr[1]-hmr[0];
 const data={
  bookDate:date,location:asset.site,assetId:asset.id,employeeId:driver.id,shiftId:shift.id,shiftHours:shift.hours,
  docType:vehicle?'VLB':'QLB',
  openingKmr:vehicle?kmr[0]:null,closingKmr:vehicle?kmr[1]:null,openingHmr:hmr[0],closingHmr:hmr[1],
  totalRunningKmr:vehicle?kmr[1]-kmr[0]:null,totalWorkingHmr:workingHmr,
  bookDateSource:scanCardId?'scan':'manual',...(scanCardId?{scanCardId}:{}),
  aFormNo:'',jobCardNo:'',remark,timeMode,trips:rows,
  totalRecords:rows.length,openingTrips,endingTrips,totalTrips,...(vehicle?{completedTrips:totalTrips}:{}),
  workOrderContract:WORK_ORDERS[asset.site],
  breakdownHours,breakdownHoursSource,...(hoursWarning?{hoursWarning}:{}),...(status?{shiftStatus:status,statusReason}:{}),
  availabilityHours:workingHmr,runningHours:workingHmr,idleHours:shift.hours-workingHmr,
  door:asset.door,assetName:asset.name,registration:asset.registration,
  employeeName:driver.name,caliberId:driver.caliberId,shiftName:shift.name,masterShiftStart:shift.start,bookShiftCode:shift.code,
 };
 return {id:String(id),book_no:bookNo,book_type:asset.kind,data};
}

const {d1,d2,d3,d4,d5,d6,d7,d8}=PEOPLE;
// A machine that did not run has no operator on its book.
const NOBODY={id:null,name:'',caliberId:''};
const SCAN_1='c0000000-0000-4000-8000-000000009601',SCAN_2='c0000000-0000-4000-8000-000000009602',SCAN_3='c0000000-0000-4000-8000-000000009603',SCAN_4='c0000000-0000-4000-8000-000000009604';

const vehicleBooks=[
 // 13 December
 book({id:9501,bookNo:'VLB_S/13TH-DEC26/S1/001',date:'2026-12-13',asset:ASSETS.V9001,shift:SHIFTS.dhoptala1,driver:d1,kmr:[61240,61320],hmr:[8412,8418.5],loader:'TPC901',scanCardId:SCAN_1,
  trips:[['05:20','05:39'],['05:58','06:17'],['06:36','06:55'],['07:14','07:33'],['07:52','08:11'],['08:45','09:04'],['09:23','09:42'],['10:01','10:20'],['10:40','11:52',2]]}),
 book({id:9504,bookNo:'VLB_M/13TH-DEC26/S1/001',date:'2026-12-13',asset:ASSETS.V9002,shift:SHIFTS.jayant1,driver:d5,kmr:[45180,45244],hmr:[6120,6126.5],loader:'VPC902',
  trips:[['05:30','05:52'],['06:14','06:36'],['06:58','07:20'],['07:42','08:04'],['08:40','09:02'],['09:24','09:46'],['10:08','10:30'],['10:52','11:14']]}),
 book({id:9505,bookNo:'VLB_M/13TH-DEC26/S1/002',date:'2026-12-13',asset:ASSETS.V9003,shift:SHIFTS.jayant1,driver:d6,kmr:[28410,28474],hmr:[3980,3986],loader:'VPC902',
  trips:[['05:40','06:50',2],['07:10','08:20',2],['08:55','10:05',2],['10:25','11:35',2]]}),
 // 14 December
 book({id:9508,bookNo:'VLB_S/14TH-DEC26/S1/001',date:'2026-12-14',asset:ASSETS.V9001,shift:SHIFTS.dhoptala1,driver:d1,kmr:[61384,61456],hmr:[8424.5,8431],loader:'TPC901',scanCardId:SCAN_2,
  trips:[['05:15','05:34'],['05:53','06:12'],['06:31','06:50'],['07:10','07:29'],['07:48','08:07'],['08:40','08:59'],['09:18','09:37'],['09:57','10:16'],['10:35','10:54']]}),
 book({id:9509,bookNo:'VLB_M/14TH-DEC26/S2/001',date:'2026-12-14',asset:ASSETS.V9001,shift:SHIFTS.dhoptala2,driver:d2,kmr:[61456,61520],hmr:[8431,8437],loader:'TPC901',
  breakdownHours:null,breakdownHoursSource:null,hoursWarning:'Pulse breakdown connection unavailable.',
  trips:[['13:25','13:44'],['14:03','14:22'],['14:42','15:01'],['15:20','15:39'],['16:10','16:29'],['16:48','17:07'],['17:27','17:46'],['18:05','18:24']]}),
 book({id:9511,bookNo:'VLB_M/14TH-DEC26/S1/001',date:'2026-12-14',asset:ASSETS.V9002,shift:SHIFTS.jayant1,driver:d5,kmr:[45254,45302],hmr:[6126.5,6130.5],loader:'VPC902',
  remark:'Waited for loader VPC902 (under breakdown).',
  trips:[['05:25','05:47'],['06:09','06:31'],['06:53','07:15'],['07:37','07:59'],['11:40','12:02'],['12:24','12:46']]}),
 book({id:9512,bookNo:'VLB_M/14TH-DEC26/S1/002',date:'2026-12-14',asset:ASSETS.V9003,shift:SHIFTS.jayant1,driver:d6,kmr:[28474,28522],hmr:[3986,3990.5],loader:'VPC902',timeMode:'without',
  remark:'Trip times not written on the card.',trips:[['','',6]]}),
];

const equipmentBooks=[
 // 13 December
 book({id:9502,bookNo:'CAL/ELB/13-12-26/001',date:'2026-12-13',asset:ASSETS.TPC901,shift:SHIFTS.dhoptala1,driver:d3,hmr:[15230,15237]}),
 book({id:9503,bookNo:'CAL/ELB/13-12-26/002',date:'2026-12-13',asset:ASSETS.TPC901,shift:SHIFTS.dhoptala2,driver:d4,hmr:[15237,15243.5]}),
 book({id:9506,bookNo:'CAL/ELB/13-12-26/003',date:'2026-12-13',asset:ASSETS.VPC902,shift:SHIFTS.jayant1,driver:d7,hmr:[9870,9876.5]}),
 book({id:9507,bookNo:'CAL/ELB/13-12-26/004',date:'2026-12-13',asset:ASSETS.TPC903,shift:SHIFTS.sastiDay,driver:d8,hmr:[4410,4420]}),
 // 14 December
 book({id:9510,bookNo:'CAL/ELB/14-12-26/001',date:'2026-12-14',asset:ASSETS.TPC901,shift:SHIFTS.dhoptala1,driver:d3,hmr:[15243.5,15250.5]}),
 book({id:9513,bookNo:'CAL/ELB/14-12-26/002',date:'2026-12-14',asset:ASSETS.VPC902,shift:SHIFTS.jayant1,driver:d7,hmr:[9876.5,9881],
  breakdownHours:3,remark:'Hydraulic hose failure, machine stopped 08:30 to 11:30.'}),
 book({id:9514,bookNo:'CAL/ELB/14-12-26/003',date:'2026-12-14',asset:ASSETS.TPC903,shift:SHIFTS.sastiDay,driver:d8,hmr:[4420,4427.5],
  breakdownHours:1.5,breakdownHoursSource:'manual',hoursWarning:'Pulse breakdown hours unavailable.',remark:'Track adjustment, 1.5 hours.'}),
 // Two machines that did not run: one in breakdown for the whole shift, one not in use.
 book({id:9515,bookNo:'CAL/ELB/14-12-26/004',date:'2026-12-14',asset:ASSETS.VPC904,shift:SHIFTS.jayant1,driver:NOBODY,hmr:[7310,7310],
  breakdownHours:8,status:'breakdown',statusReason:'Engine overheating, machine stopped for the whole shift.'}),
 book({id:9516,bookNo:'CAL/ELB/14-12-26/005',date:'2026-12-14',asset:ASSETS.TPC905,shift:SHIFTS.dhoptala1,driver:NOBODY,hmr:[2640,2640],status:'not_in_use'}),
];

// The endpoint returns the vehicle books first (with trip handover links), then the equipment books.
const records=[...vehicleBooks,...equipmentBooks];

const assets=Object.values(ASSETS).map(({id,door,site,kind,name})=>({id:String(id),door,site,kind,group:kind==='equipment'?'Excavator':'Tipper',name}));
// The batch of every site, date and shift that has a book, with its stage; and the site machines of a batch with no saved ELB
// (exception 2: TPC901 loaded tippers in Shift II on 14 Dec but its ELB was not entered).
const batches=[...new Map(records.map(r=>[[r.data.location,r.data.bookDate,r.data.bookShiftCode].join('|'),{site:r.data.location,date:r.data.bookDate,shift:r.data.bookShiftCode,stage:r.data.bookDate==='2026-12-13'?'closed':r.data.bookShiftCode==='S2'?'vlb_open':'elb_open'}])).values()];
const fleet=[{site:DHOPTALA,date:'2026-12-14',shift:'S2',assetId:'9101',door:'TPC901',name:'SAMPLE EXCAVATOR',group:'Excavator'}];
const shifts=Object.values(SHIFTS).map(({id,name,site})=>({id:String(id),name,site}));

// Scan cards: what the reader extracted (draft), the card status and the saved book, if any.
const draftOf=({date,asset,shift,driver})=>({bookDate:date,location:asset.site,assetId:asset.id,door:asset.door,employeeId:driver.id,employeeName:driver.name,caliberId:driver.caliberId,shiftId:shift.id,shiftName:shift.name,shiftHours:shift.hours,workOrderContract:WORK_ORDERS[asset.site]});
const cards=[
 {id:SCAN_1,filename:'dhoptala-13dec-shift1-001.jpg',status:'posted',draft:draftOf({date:'2026-12-13',asset:ASSETS.V9001,shift:SHIFTS.dhoptala1,driver:d1}),error:null,logbook_id:'9501',book_no:'VLB_S/13TH-DEC26/S1/001',kind:'vehicle',scanned_date:'2026-12-13'},
 {id:SCAN_3,filename:'dhoptala-13dec-shift2-001.jpg',status:'review',draft:draftOf({date:'2026-12-13',asset:ASSETS.V9001,shift:SHIFTS.dhoptala2,driver:d2}),error:null,logbook_id:null,book_no:null,kind:'vehicle',scanned_date:'2026-12-14'},
 {id:SCAN_2,filename:'dhoptala-14dec-shift1-001.jpg',status:'posted',draft:draftOf({date:'2026-12-14',asset:ASSETS.V9001,shift:SHIFTS.dhoptala1,driver:d1}),error:null,logbook_id:'9508',book_no:'VLB_S/14TH-DEC26/S1/001',kind:'vehicle',scanned_date:'2026-12-14'},
 {id:SCAN_4,filename:'dhoptala-14dec-shift2-002.jpg',status:'error',draft:null,error:'Card photo is unreadable. Scan the card again.',logbook_id:null,book_no:null,kind:'vehicle',scanned_date:'2026-12-14'},
];

export const payload={records,assets,shifts,batches,fleet,cards,scanConnected:true};
export default payload;
