import React,{useState,useEffect} from 'react';
import {formatExtractionTime} from './scan-extraction-status.jsx';

// The whole-second clock updates only this small component, not every card validation.
export default function ScanUploadTimer({started}){
 const [uploadElapsed,setUploadElapsed]=useState(()=>Math.max(0,(performance.now()-started)/1000));
 useEffect(()=>{const update=()=>setUploadElapsed(Math.max(0,(performance.now()-started)/1000));update();const timer=setInterval(update,1000);return()=>clearInterval(timer)},[started]);
 return <div className="scan-upload-timer" role="timer">Uploading PDFs · Time taken: {formatExtractionTime(uploadElapsed)}</div>;
}
