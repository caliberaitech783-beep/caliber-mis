import React,{useEffect,useRef,useState} from 'react';
import {adaptiveRefreshInterval} from './mobile-performance.mjs';

export default function SiteUpdateNotice({currentVersion}){
  const [update,setUpdate]=useState(null),dismissed=useRef('');
  useEffect(()=>{
    if(!/^[0-9a-f]{7,64}$/i.test(currentVersion||''))return;
    let stopped=false,checking=false;
    const check=async()=>{
      if(stopped||checking)return;
      checking=true;
      try{
        const response=await fetch('/api/app-version?t='+Date.now(),{cache:'no-store'});
        if(!response.ok)return;
        const data=await response.json(),version=String(data.version||'').trim().toLowerCase();
        if(stopped||!/^[0-9a-f]{7,64}$/.test(version))return;
        if(version===currentVersion.toLowerCase())setUpdate(null);
        else if(version!==dismissed.current)setUpdate(version);
      }catch{}finally{checking=false}
    };
    void check();const timer=window.setInterval(check,adaptiveRefreshInterval(window,60_000));
    window.addEventListener('focus',check);window.addEventListener('pageshow',check);
    return()=>{stopped=true;window.clearInterval(timer);window.removeEventListener('focus',check);window.removeEventListener('pageshow',check)};
  },[currentVersion]);
  if(!update)return null;
  const refresh=()=>{
    const url=new URL(window.location.href);url.searchParams.set('updated',update);
    // Keep the current MIS page, batch/card selection and existing session.
    window.location.replace(url.pathname+url.search+url.hash);
  };
  return <div role="status" aria-live="polite" style={{position:'fixed',bottom:20,left:'50%',transform:'translateX(-50%)',zIndex:2147483647,width:'min(720px, calc(100% - 32px))',boxSizing:'border-box',display:'flex',alignItems:'center',flexWrap:'wrap',gap:12,padding:'16px 20px',background:'#10213f',color:'#fff',border:'1px solid #49617f',borderRadius:12,boxShadow:'0 8px 30px #0003'}}>
    <div style={{flex:'1 1 260px'}}><strong style={{display:'block',fontSize:14,marginBottom:5}}>Update available — refresh when ready</strong><span style={{fontSize:12,lineHeight:1.5,color:'#c4d2e9'}}>Save your current work, then choose Refresh now.</span></div>
    <button type="button" onClick={refresh} style={{padding:'9px 14px',borderRadius:7,border:'1px solid #c4d2e9',background:'#fff',color:'#10213f'}}>Refresh now</button>
    <button type="button" onClick={()=>{dismissed.current=update;setUpdate(null)}} style={{padding:'9px 14px',borderRadius:7,border:'1px solid #7b91b4',background:'transparent',color:'#fff'}}>Later</button>
  </div>;
}
