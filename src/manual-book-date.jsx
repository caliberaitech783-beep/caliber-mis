import React,{useEffect,useRef,useState} from 'react';

const display=value=>/^\d{4}-\d{2}-\d{2}$/.test(value||'')?value.split('-').reverse().join('-'):'';
export default function ManualBookDate({value,onChange}){
 const [draft,setDraft]=useState(()=>display(value));
 const emitted=useRef(value),input=useRef(null);
 useEffect(()=>{if(value!==emitted.current){emitted.current=value;setDraft(display(value));input.current?.setCustomValidity('');}},[value]);
 const change=event=>{
   const text=event.target.value;
   setDraft(text);
   const match=/^(\d{2})-(\d{2})-(\d{4})$/.exec(text);
   const iso=match?`${match[3]}-${match[2]}-${match[1]}`:'';
   const date=new Date(iso+'T00:00:00Z');
   const valid=Boolean(iso)&&Number.isFinite(date.getTime())&&date.toISOString().slice(0,10)===iso;
   event.target.setCustomValidity(text&&!valid?'Enter a valid date in DD-MM-YYYY format.':'');
   emitted.current=valid?iso:'';
   onChange(emitted.current);
 };
 return <input ref={input} type="text" required aria-label="Book date" placeholder="DD-MM-YYYY" maxLength={10} value={draft} onChange={change}/>;
}
