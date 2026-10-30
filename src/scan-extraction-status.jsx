import React,{useState,useEffect} from 'react';
const startKey=batchId=>'caliberScanExtractionStart:'+batchId;
const readStart=batchId=>{try{const value=Number(sessionStorage.getItem(startKey(batchId)));return Number.isFinite(value)&&value>0&&value<=Date.now()?value:0;}catch{return 0;}};
const writeStart=(batchId,value)=>{try{if(value)sessionStorage.setItem(startKey(batchId),String(value));else sessionStorage.removeItem(startKey(batchId));}catch{}};
export function formatExtractionTime(seconds){
 const total=Math.max(0,Number.isFinite(seconds)?Math.floor(seconds):0),minutes=Math.floor(total/60);
 return minutes?minutes+' min '+String(total%60).padStart(2,'0')+' sec':total+' sec';
}
export default function ScanExtractionStatus({batchId,pending,total,uploading}){
 const [started,setStarted]=useState(0),[now,setNow]=useState(()=>Date.now());
 useEffect(()=>{
  if(!batchId)return;
  if(pending>0){const value=readStart(batchId)||Date.now();writeStart(batchId,value);setStarted(value);setNow(Date.now());return;}
  if(!uploading){writeStart(batchId,0);setStarted(0);}
 },[batchId,pending>0,uploading]);
 useEffect(()=>{if(pending<=0)return;const timer=setInterval(()=>setNow(Date.now()),1000);return()=>clearInterval(timer)},[pending>0]);
 if(pending<=0)return null;
 return <div className="scan-extraction-status"><strong role="status">Extracting {pending}/{total} cards</strong><span>Elapsed: <strong role="timer" aria-label="Extraction elapsed time" aria-live="off">{formatExtractionTime(started?(now-started)/1000:0)}</strong></span></div>;
}
