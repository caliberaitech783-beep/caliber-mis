import React from 'react';
import SmartSelect from './smart-select.jsx';

export default function WorkOrderJobSelect({row,contracts,label,disabled,onChange}){
 const choices=contracts.flatMap(contract=>(contract.jobs||[]).map(jobType=>({
  key:JSON.stringify([contract.id,jobType]),jobType,workOrderId:contract.id,number:contract.number
 })));
 const selected=choices.find(choice=>choice.workOrderId===String(row.workOrderId)&&choice.jobType===row.jobType);
 const value=selected?.key||(row.jobType?'saved':'');
 return <SmartSelect searchable aria-label={label} disabled={disabled} value={value} onChange={event=>{
  const choice=choices.find(option=>option.key===event.target.value);
  onChange(choice?{jobType:choice.jobType,workOrderId:choice.workOrderId,masterJob:true}:{jobType:'',workOrderId:'',masterJob:undefined});
 }}>
  <option value="">{choices.length?'Select job from work order':'No master jobs available'}</option>
  {value==='saved'&&<option value="saved">{row.jobType}</option>}
  {choices.map(choice=><option key={choice.key} value={choice.key}>{choice.jobType} · {choice.number}</option>)}
 </SmartSelect>;
}
