import React,{useEffect,useState} from 'react';
export default function EmployeeIdLookup({token,caliberId='',suggestedId='',onResolved,disabled=false}){
 const [value,setValue]=useState(caliberId||suggestedId),[busy,setBusy]=useState(false),[error,setError]=useState('');
 useEffect(()=>{setValue(caliberId||suggestedId);setError('')},[caliberId,suggestedId]);
 const lookup=async()=>{setBusy(true);setError('');try{const r=await fetch('/api/log-books/employee-lookup',{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({caliberId:value})});const body=await r.json();if(!r.ok)throw new Error(body.error||'Employee lookup failed.');await onResolved(body);setValue(body.caliberId);}catch(e){setError(e.message)}finally{setBusy(false)}};
 return <div className="employee-id-lookup"><div style={{display:'flex',gap:6}}><input aria-label="Caliber Employee ID lookup" value={value} disabled={disabled||busy} onChange={e=>{setValue(e.target.value);setError('')}} placeholder="Enter Employee ID / code" onKeyDown={e=>{if(e.key==='Enter'){e.preventDefault();if(value.trim()&&!busy)void lookup()}}}/><button type="button" disabled={disabled||busy||!value.trim()} onClick={lookup}>{busy?'Fetching…':'Fetch driver'}</button></div>{error&&<small role="alert" style={{color:'#a41935'}}>{error}</small>}</div>
}
