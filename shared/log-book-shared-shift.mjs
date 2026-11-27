import {cardDutyShift} from './duty-shift.mjs';
import {isDummyEmployeeId} from './dummy-employee-ids.mjs';

const key=value=>String(value??'').trim().toUpperCase();

function cardOperators(data={}){
 return [
  {id:key(data.employeeId),code:key(data.caliberId)},
  {id:key(data.operatorSplit?.secondOperatorId),code:key(data.operatorSplit?.secondOperatorCaliberId)},
 ].filter(operator=>operator.id||operator.code);
}

// A dummy ID (shared/dummy-employee-ids.mjs) stands for many temporary drivers, so two cards
// that share only a dummy ID are different people. `sameDummy` keeps them one person, for
// the second sheet of one trip card.
export function shareCardOperator(left,right,{sameDummy=false}={}){
 const first=cardOperators(left),second=cardOperators(right);
 if(!first.length||!second.length)return true;
 const real=operator=>sameDummy||!isDummyEmployeeId(operator.code);
 return first.some(a=>real(a)&&second.some(b=>real(b)&&
  ((a.id&&a.id===b.id)||(a.code&&a.code===b.code))
 ));
}

export function cardWorkingHmr(data={}){
 const {totalWorkingHmr,openingHmr,closingHmr}=data;
 if(totalWorkingHmr!=null&&key(totalWorkingHmr)!==''){
  const hours=Number(totalWorkingHmr);
  return Number.isFinite(hours)&&hours>=0?hours:null;
 }
 if(key(openingHmr)===''||key(closingHmr)==='')return null;
 const opening=Number(openingHmr),closing=Number(closingHmr);
 return Number.isFinite(opening)&&Number.isFinite(closing)&&opening>=0&&closing>=opening
  ? Math.round((closing-opening)*1000)/1000 : null;
}

// Call only for ELBs already scoped to the same machine, site, date and shift.
// Two positive, non-overlapping meter segments of one named job retain their
// own records; sharing an operator does not make the worked hours duplicates.
export function elbCardsNeedDuplicateReview(left={},right={}){
 if(!shareCardOperator(left,right))return false;
 const job=key(left.jobCardNo),firstDuty=cardDutyShift(left),secondDuty=cardDutyShift(right);
 if(!firstDuty.code||firstDuty.conflict||secondDuty.conflict||firstDuty.code!==secondDuty.code)return true;
 if(!job||['-','—','NA','N/A','NONE','0'].includes(job)||job!==key(right.jobCardNo)||!cardOperators(left).length||!cardOperators(right).length||left.operatorSplit||right.operatorSplit)return true;
 const segment=data=>{
  if(key(data.openingHmr)===''||key(data.closingHmr)==='')return null;
  const start=Number(data.openingHmr),end=Number(data.closingHmr),hours=cardWorkingHmr(data);
  if(!Number.isFinite(start)||!Number.isFinite(end)||start<0||end<=start||hours===null||Math.abs(hours-(end-start))>0.000001)return null;
  return {start,end};
 };
 const a=segment(left),b=segment(right);
 if(!a||!b)return true;
 return !(a.end<=b.start||b.end<=a.start);
}
