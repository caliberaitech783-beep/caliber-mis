const key=value=>String(value??'').trim().toUpperCase();

function cardOperators(data={}){
 return [
  {id:key(data.employeeId),code:key(data.caliberId)},
  {id:key(data.operatorSplit?.secondOperatorId),code:key(data.operatorSplit?.secondOperatorCaliberId)},
 ].filter(operator=>operator.id||operator.code);
}

export function shareCardOperator(left,right){
 const first=cardOperators(left),second=cardOperators(right);
 return !first.length||!second.length||first.some(a=>second.some(b=>
  (a.id&&a.id===b.id)||(a.code&&a.code===b.code)
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
