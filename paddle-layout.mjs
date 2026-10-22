// Recover table rows from OCR coordinates rather than flattened reading order.
import {machineLabel} from './trip-card-rules.mjs';
const median=a=>{const s=[...a].sort((a,b)=>a-b);return s.length?s[Math.floor(s.length/2)]:0};
const numeric=s=>/^\d+$/.test(String(s).trim().replace(/[.,]$/,''))?String(Number(String(s).trim().replace(/[.,]$/,''))):'';
const clock=s=>{const m=String(s).match(/^(\d{1,2})\s*[:.]\s*(\d{2})$/);return m&&Number(m[1])<24&&Number(m[2])<60?m[1].padStart(2,'0')+':'+m[2]:''};
const cell=(text='',value=text)=>({text,value,present:Boolean(String(text).replace(/[.·:\s]/g,'')),needsReview:true});
export function paddleLayout(result,{width,height,kind='vehicle'}={}){
 const page=result.pages?.[0];if(!page||!Array.isArray(page.rec_boxes)||page.rec_boxes.length!==page.rec_texts?.length)return {};
 width||=result.imageSize?.[0];height||=result.imageSize?.[1];if(!width||!height)return {};
 const boxes=page.rec_boxes.map((b,i)=>({text:String(page.rec_texts[i]||'').trim(),b,x:(b[0]+b[2])/2,y:(b[1]+b[3])/2,score:page.rec_scores?.[i]}));
 const summary=boxes.find(b=>/MACHINE[\s-]*WISE.*SUMMARY/i.test(b.text));
 const loads=boxes.filter(b=>/^Loading\s*Time(?:\s*\(.*\))?$/i.test(b.text)&&(!summary||b.y<summary.y)).sort((a,b)=>a.x-b.x);
 const unloads=boxes.filter(b=>/^Unl[oa0b]{1,3}ding\s*Time(?:\s*\(.*\))?$/i.test(b.text)&&(!summary||b.y<summary.y)).sort((a,b)=>a.x-b.x);
 const hints={handwrittenFields:{},handwritingCandidates:{},meterReadings:{},provider:'paddleocr',model:result.model||'PP-OCRv5 mobile',extractionWarning:'Check extracted fields and every trip row against the scan before approval.'};
 const candidate=(key,text,value)=>{if(!text)return;hints.handwritingCandidates[key]={text,value:value||'',needsReview:true};if(value)hints.handwrittenFields[key]=value};
 const regionText=(key,fallback)=>result.regions?.[key]?.text||fallback||'';
 const labelValue=(pattern,{maxX=width,minX=0}={})=>{const label=boxes.find(b=>pattern.test(b.text));if(!label)return '';return boxes.filter(b=>b!==label&&b.x>Math.max(label.b[2],minX)&&b.x<maxX&&Math.abs(b.y-label.y)<Math.max(30,height*.025)).sort((a,b)=>a.x-b.x).map(b=>b.text).join(' ')};
 const mainDate=labelValue(/^DATE$/i,{maxX:width*.5}),date=regionText('bookDate',mainDate);
 const dateKey=text=>{const m=text.trim().match(/^(\d{1,2})[-/.\s]+(\d{1,2})[-/.\s]+(\d{2}|\d{4})$/);if(!m)return '';const iso=`${m[3].length===2?'20'+m[3]:m[3]}-${m[2].padStart(2,'0')}-${m[1].padStart(2,'0')}`;return Number.isFinite(Date.parse(iso+'T00:00:00Z'))&&new Date(iso+'T00:00:00Z').toISOString().slice(0,10)===iso?iso:''};
 const conflict=Boolean(dateKey(mainDate)&&dateKey(date)&&dateKey(mainDate)!==dateKey(date));
 const selectedDate=conflict?'':dateKey(date)?date:dateKey(mainDate)?mainDate:'';
 candidate('bookDate',date,selectedDate?dateKey(selectedDate):'');if(conflict)hints.handwritingCandidates.bookDate.conflict=true;
 const door=regionText('door',labelValue(/^Door\s*No\.?$/i,{maxX:width*.29}));candidate('door',door,/^[A-Z0-9][A-Z0-9/-]{1,24}$/i.test(door.trim())?door.trim().toUpperCase():'');
 const employee=regionText('employeeCode',labelValue(/^(?:C\.?\s*ID|Caliber ID)$/i,{maxX:width*.64})).replace(/^CMPL\s*[-:]?\s*/i,'');candidate('employeeCode',employee,/^\d{3,12}$/.test(employee.trim())?employee.trim():'');hints.employeeCode=hints.handwrittenFields.employeeCode||'';
 const site=boxes.find(b=>/^site\s*:/i.test(b.text));if(site){const text=site.text.replace(/^site\s*:\s*/i,'');candidate('location',text,text)}
 const form=regionText('cardNo',labelValue(/^FORM\s*A$/i))||regionText('tripCardNo');if(/^\d{1,12}$/.test(form.trim()))hints.cardNumber=form.trim();
 for(const [label,keys]of [[/^HMR\b/i,['openingHmr','closingHmr']],[/^KMR\b/i,['openingKmr','closingKmr']]]){const marker=boxes.find(b=>label.test(b.text));if(!marker)continue;const values=boxes.filter(b=>b.x>width*.15&&b.x<width*.59&&Math.abs(b.y-marker.y)<height*.022&&/^\d+(?:[.,]\d+)?$/.test(b.text)).sort((a,b)=>a.x-b.x);if(values.length===2)for(let i=0;i<2;i++)hints.meterReadings[keys[i]]={value:values[i].text.replace(',','.'),source:'PaddleOCR reading table',needsReview:true};}
 for(const key of ['openingHmr','closingHmr','openingKmr','closingKmr']){const raw=regionText(key).trim();if(/^\d+(?:[.,]\d+)?$/.test(raw))hints.meterReadings[key]={value:raw.replace(',','.'),source:'PaddleOCR reading cell',needsReview:true};}
 if(kind!=='vehicle'||!summary||loads.length!==2||unloads.length!==2)return hints;
 const rows=[];let validHalves=0;
 for(let half=0;half<2;half++){
  const x0=half*width/2,x1=(half+1)*width/2,load=loads[half],unload=unloads[half];
  const headerBottom=Math.max(load.b[3],unload.b[3])+height*.018;
  const labels=boxes.filter(b=>b.x>x0&&b.x<x0+width*.065&&b.y>headerBottom&&b.y<summary.b[1]&&/^\d{1,2}$/.test(b.text));
  if(labels.length<3)continue;
  const numberBase=half?Math.min(...labels.map(b=>Number(b.text))):1;
  const slopes=[];for(const a of labels)for(const b of labels)if(Number(b.text)>Number(a.text))slopes.push((b.y-a.y)/(Number(b.text)-Number(a.text)));
  const step=median(slopes.filter(v=>v>height*.015&&v<height*.075));if(!step)continue;
  const start=median(labels.map(b=>b.y-(Number(b.text)-numberBase)*step));
  const count=half?Math.max(...labels.map(b=>Number(b.text)))-numberBase+1:Math.max(...labels.map(b=>Number(b.text)));
  if(count<8||count>15)continue;validHalves++;
  const heads=boxes.filter(b=>b.x>x0&&b.x<load.x&&b.y>load.y-height*.03&&b.y<headerBottom);
  const typeHeader=heads.find(b=>/^M$/i.test(b.text)),numberHeader=heads.find(b=>/^NO\.?$/i.test(b.text));
  const nameHeader=heads.find(b=>/EQUIPMENT/i.test(b.text));
  for(let index=0;index<count;index++){
   const y=start+index*step,at=boxes.filter(b=>b.x>x0&&b.x<x1&&Math.abs(b.y-y)<step*.40);
   const timeBoxes=at.filter(b=>b.b[2]>load.x-width*.075&&b.b[0]<x1-width*.01&&/\d/.test(b.text));
   if(!timeBoxes.some(b=>/\d/.test(b.text)))continue;
   let loading=cell(),unloading=cell();
   for(const b of timeBoxes){const matches=[...b.text.matchAll(/\d{1,2}\s*[:.]\s*\d{2}/g)].map(m=>m[0]);if(matches.length===2&&b.b[0]<load.x&&b.b[2]>unload.x){loading=cell(matches[0],clock(matches[0]));unloading=cell(matches[1],clock(matches[1]));}else if(matches.length===1){if(Math.abs(b.x-load.x)<Math.abs(b.x-unload.x))loading=cell(matches[0],clock(matches[0]));else unloading=cell(matches[0],clock(matches[0]));}}
   const near=(center,range)=>at.filter(b=>Math.abs(b.x-center)<range).sort((a,b)=>a.x-b.x).map(b=>b.text).join(' ');
   const type=typeHeader?near(typeHeader.x,width*.033):'';let no=numberHeader?near(numberHeader.x,width*.055):'';
   if(!no&&numberHeader)for(const b of timeBoxes){const first=b.text.search(/\d{1,2}\s*[:.]\s*\d{2}/);const prefix=first>0?numeric(b.text.slice(0,first)):'';if(prefix&&b.b[0]<numberHeader.x+width*.04&&b.b[2]>load.x){no=prefix;break;}}
   let equipmentName=nameHeader?near(nameHeader.x,width*.065):!type&&numeric(no)?numeric(no):'';
   equipmentName=equipmentName.trim().replace(/[.,]$/,'');if(equipmentName&&!/^[A-Z0-9/-]+$/i.test(equipmentName))equipmentName='';
   rows.push({rowNumber:numberBase+index,equipmentName:equipmentName?machineLabel(equipmentName):'',equipmentType:cell(type,/^[A-Z]$/i.test(type)?type.toUpperCase():''),equipmentNo:cell(no,numeric(no)),loading,unloading});
  }
 }
 if(validHalves!==2||!rows.length)return hints;
 // Summary uses different column widths from the detail table.
 const summaryRows=[];
 for(let half=0;half<2;half++){
  const x0=half*width/2,x1=(half+1)*width/2;
  const heads=boxes.filter(b=>b.x>x0&&b.x<x1&&b.y>summary.y&&b.y<summary.y+height*.055);
  const m=heads.find(b=>/^M$/i.test(b.text)),n=heads.find(b=>/^NO\.?$/i.test(b.text)),trips=heads.find(b=>/^Trips$/i.test(b.text)),name=heads.find(b=>/Equipment/i.test(b.text));
  if(!trips||(!n&&!name))continue;
  const values=boxes.filter(b=>b.x>x0&&b.x<x1&&b.y>trips.b[3]&&b.y<summary.y+height*.14);
  const counts=values.filter(b=>Math.abs(b.x-trips.x)<width*.065&&numeric(b.text));
  for(const c of counts){const at=values.filter(b=>Math.abs(b.y-c.y)<height*.018);const near=(center,range)=>at.filter(b=>Math.abs(b.x-center)<range).map(b=>b.text).join(' ');const t=m?near(m.x,width*.04):'',number=n?near(n.x,width*.09):'';const equipmentName=name?near(name.x,width*.07):!t&&numeric(number)?numeric(number):'';if(!number&&!equipmentName)continue;summaryRows.push({rowNumber:summaryRows.length+1,equipmentName:equipmentName?machineLabel(equipmentName):'',equipmentType:cell(t,/^[A-Z]$/i.test(t)?t.toUpperCase():''),equipmentNo:cell(number,numeric(number)),count:cell(c.text,numeric(c.text))});}
 }
 hints.tripGrid={template:'paddle-spatial-trip-card-v1',rows,summary:summaryRows};
 return hints;
}
