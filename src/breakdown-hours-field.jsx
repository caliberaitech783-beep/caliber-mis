import React from 'react';

export default function BreakdownHoursField({pulse,loading=false,error='',ready=false,manualValue='',savedValue,shiftHours,disabled=false,readOnly=false,invalid=false,onChange}){
 const pulseValue=pulse?.breakdownHours;
 const available=pulseValue!==null&&pulseValue!==undefined&&pulseValue!==''&&Number.isFinite(Number(pulseValue));
 const fallback=ready&&!loading&&!available&&Boolean(error||pulse);
 if(fallback&&!readOnly)return <><input aria-label="BD HRS" aria-invalid={invalid} type="number" min="0" max={shiftHours} step="0.001" value={manualValue??''} disabled={disabled} placeholder="Enter BD hours" onChange={event=>onChange(event.target.value)}/><small>Manual entry · Pulse unavailable</small></>;
 const value=available?pulseValue:readOnly?savedValue:undefined;
 return <><output aria-label="BD HRS">{value===null||value===undefined?'—':Number(value).toFixed(2)}</output><small>{available?'From Pulse':loading?'Fetching from Pulse…':readOnly&&value!=null?'Saved BD hours':ready?'Waiting for Pulse':'Select equipment, date and shift'}</small></>;
}
