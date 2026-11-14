import {matchCardMachine,cardMachineKey} from './scan-machine-rules.mjs';
import {canonicalSiteName} from './site-location.mjs';
import {validTripTime} from './vlb-trip-handover.mjs';

// One-click correction suggestions for a scanned card in review. Since 14 November 2026 every card
// is read by Gemini Flash-Lite. Checked against 786 saved Flash-Lite cards (12 Nov 2026), comparing
// the reading with what the operator saved:
// - a door whose S was read as 5 (5193 for S93): 9 suggestions, 9 right;
// - a fleet letter that no vehicle at the site uses (X/792, D/795, L/169 for V...): 3 of 3 right
//   (with letters the site does use, 2 of 5 were wrong: V/484 was V481, a digit misread);
// - meters are not suggested: moving the decimal point gave the saved value on 1 of 10 cards,
//   because the opening reading is often misread too;
// - times are never guessed (07:67 was 07:43): the review shows the valid times beside it.
// The operator still clicks the suggestion; nothing is changed by itself.

const text=value=>String(value??'').trim();
// The same label the review screen's door list uses as its value (door, else registration, else name).
const doorLabel=asset=>text(asset?.door||asset?.registration||asset?.name||asset?.doorNo);
const uniqueMatch=(assets,value,site,kind)=>{
 const {match,status}=matchCardMachine(assets,value,site,kind);
 return match&&['matched','separator'].includes(status)?match:null;
};
function siteVehicleLetters(assets,site,kind){
 const letters=new Set(),selected=canonicalSiteName(site);
 for(const row of assets){
  if(row.kind&&row.kind!==kind)continue;
  if(selected&&canonicalSiteName(row.currentLocation||row.site||row.location)!==selected)continue;
  const key=cardMachineKey(doorLabel(row),kind).match(/^([A-Z]+)\d+$/);
  if(key)letters.add(key[1]);
 }
 return [...letters];
}

// A door that does not match the site's Equipment Master: try the two misreads seen on real cards.
export function doorSuggestion(draft={},assets=[],kind='vehicle'){
 const written=text(draft.doorText);
 if(kind!=='vehicle'||!written||!assets.length)return null;
 const site=draft.location||'';
 if(uniqueMatch(assets,written,site,kind))return null;
 const upper=written.toUpperCase();
 // 1. S read as the digit 5 (5193, 5/87, 51101): the 5 is the fleet letter S.
 if(/^5/.test(upper)){
  const asset=uniqueMatch(assets,'S'+upper.slice(1),site,kind);
  if(asset)return {value:doorLabel(asset),assetId:String(asset.id),reason:'S read as 5'};
 }
 // 2. A fleet letter no vehicle at this site uses (X/792 for V792): the same number under exactly
 // one letter the site does use. A letter the site uses (V/484) means a digit was misread instead.
 // The written number keeps its separator rules (V/1625 = V625).
 const parts=upper.match(/^([A-Z]+)\s*[-/.]?\s*(\d+)/),siteLetters=siteVehicleLetters(assets,site,kind);
 if(parts&&!siteLetters.includes(parts[1])&&!siteLetters.includes(cardMachineKey(parts[1]+'1',kind).replace(/\d+$/,''))){
  const found=new Map();
  for(const letter of siteLetters){
   const asset=uniqueMatch(assets,letter+'/'+parts[2],site,kind)||uniqueMatch(assets,letter+parts[2],site,kind);
   if(asset)found.set(String(asset.id),asset);
  }
  if(found.size===1){const [asset]=found.values();return {value:doorLabel(asset),assetId:String(asset.id),reason:'fleet letter '+parts[1]+' not at this site'};}
 }
 return null;
}

const clockMinutes=value=>{const m=text(value).match(/^(\d{1,2}):(\d{2})$/);return m?Number(m[1])*60+Number(m[2]):null;};
// The valid times either side of an impossible trip time, so the operator knows where to look on
// the scan. Stated as what the card shows, not as a range the answer must lie in: on 16 real
// impossible times the saved time lay between its neighbours 13 times.
export function tripTimeWindow(trips=[],index,key){
 const row=trips[index];
 if(!row||!text(row[key])||validTripTime(row[key]))return null;
 const valid=value=>text(value)&&validTripTime(value)&&clockMinutes(value)!==null?text(value):'';
 let after='',before='';
 if(key==='loadingTime'){
  for(let i=index-1;i>=0&&!after;i--)after=valid(trips[i].unloadingTime)||valid(trips[i].loadingTime);
  before=valid(row.unloadingTime);
  for(let i=index+1;i<trips.length&&!before;i++)before=valid(trips[i].loadingTime)||valid(trips[i].unloadingTime);
 }else{
  after=valid(row.loadingTime);
  for(let i=index-1;i>=0&&!after;i--)after=valid(trips[i].unloadingTime)||valid(trips[i].loadingTime);
  for(let i=index+1;i<trips.length&&!before;i++)before=valid(trips[i].loadingTime)||valid(trips[i].unloadingTime);
 }
 if(!after&&!before)return null;
 return {after,before,message:text(row[key])+' is not a clock time. Valid times beside it on this card: '+(after&&before?after+' before, '+before+' after.':after?after+' before.':before+' after.')};
}

// doorText -> {value, assetId, reason}, and trips.N.loadingTime/unloadingTime -> {window}.
export function scanCorrectionSuggestions(draft={},kind='vehicle',assets=[]){
 const out={};
 const door=doorSuggestion(draft,assets,kind);if(door)out.doorText=door;
 if(kind==='vehicle'&&draft.timeMode!=='without')for(const [i] of (draft.trips||[]).entries())for(const key of ['loadingTime','unloadingTime']){const w=tripTimeWindow(draft.trips,i,key);if(w)out['trips.'+i+'.'+key]={window:w};}
 return out;
}
