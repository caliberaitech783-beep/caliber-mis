import React,{useState,useEffect} from 'react';
const startKey=batchId=>'caliberScanExtractionStart:'+batchId;
const endKey=batchId=>'caliberScanExtractionEnd:'+batchId;
const readTime=key=>{try{const value=Number(sessionStorage.getItem(key));return Number.isFinite(value)&&value>0&&value<=Date.now()?value:0;}catch{return 0;}};
const writeTime=(key,value)=>{try{if(value)sessionStorage.setItem(key,String(value));else sessionStorage.removeItem(key);}catch{}};
export function formatExtractionTime(seconds){
 const total=Math.max(0,Number.isFinite(seconds)?Math.floor(seconds):0),minutes=Math.floor(total/60);
 return minutes?minutes+' min '+String(total%60).padStart(2,'0')+' sec':total+' sec';
}
export default function ScanExtractionStatus({batchId,pending,total,uploading,failed=0}){
 const [timing,setTiming]=useState({batchId:null,started:0,ended:0}),[now,setNow]=useState(()=>Date.now());
 const count=Math.max(0,Math.floor(Number(total)||0)),remaining=Math.min(count,Math.max(0,Math.floor(Number(pending)||0))),completed=count-remaining;
 useEffect(()=>{
  if(!batchId)return;
  let started=readTime(startKey(batchId)),ended=readTime(endKey(batchId));
  if(remaining>0){if(!started||ended)started=Date.now();ended=0;writeTime(startKey(batchId),started);writeTime(endKey(batchId),0);}
  else if(!uploading&&started&&!ended){ended=Date.now();writeTime(endKey(batchId),ended);}
  setTiming({batchId,started,ended});setNow(Date.now());
 },[batchId,remaining>0,uploading]);
 useEffect(()=>{if(remaining<=0)return;const timer=setInterval(()=>setNow(Date.now()),1000);return()=>clearInterval(timer)},[remaining>0]);
 if(!batchId||!count)return null;
 const current=timing.batchId===batchId?timing:{started:0,ended:0},finished=remaining===0&&!uploading;
 return <div className="scan-extraction-status"><strong role="status">{finished?'Extraction finished':'Extracting'} · {completed}/{count} cards processed{failed>0?' · '+failed+' failed':''}</strong>{current.started>0&&<span>Elapsed: <strong role="timer" aria-label="Extraction elapsed time" aria-live="off">{formatExtractionTime(((current.ended||now)-current.started)/1000)}</strong></span>}</div>;
}
