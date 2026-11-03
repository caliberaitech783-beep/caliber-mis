import React,{useEffect,useRef,useState} from 'react';
import {normalizeEnvironmentLabel,environmentBannerParts,environmentTitlePrefix} from '../environment-label.mjs';
import './environment-banner.css';

const RETRY_MS=15_000,MAX_ATTEMPTS=20,HEIGHT_PROPERTY='--mis-environment-banner-height';

// Platform banner. Shown only when the server reports an environment label (the test
// platform sets MIS_ENVIRONMENT_LABEL=TEST); live reports an empty label, so nothing is
// rendered there. The label comes from /api/app-version alone, never from the hostname.
export default function EnvironmentBanner(){
  const [label,setLabel]=useState(''),bar=useRef(null);
  useEffect(()=>{
    let stopped=false,attempts=0,retry=0;
    const check=async()=>{
      if(stopped)return;
      attempts+=1;
      try{
        const response=await fetch('/api/app-version?t='+Date.now(),{cache:'no-store'});
        if(!response.ok)throw Error('HTTP '+response.status);
        const data=await response.json();
        if(!stopped)setLabel(normalizeEnvironmentLabel(data.environmentLabel));
      }catch{
        // The app restarts for a few minutes during a release; keep asking until it answers.
        if(!stopped&&attempts<MAX_ATTEMPTS)retry=window.setTimeout(check,RETRY_MS);
      }
    };
    void check();
    return()=>{stopped=true;window.clearTimeout(retry)};
  },[]);
  useEffect(()=>{
    if(!label)return undefined;
    const root=document.documentElement,prefix=environmentTitlePrefix(label);
    root.dataset.misEnvironment=label;
    const prefixTitle=()=>{if(!document.title.startsWith(prefix))document.title=prefix+document.title};
    prefixTitle();
    const titleElement=document.querySelector('title');
    const titleObserver=typeof MutationObserver==='function'&&titleElement?new MutationObserver(prefixTitle):null;
    titleObserver?.observe(titleElement,{childList:true,characterData:true,subtree:true});
    // The page and its pinned navigation are pushed down by the measured bar height (see environment-banner.css).
    const element=bar.current;
    const measure=()=>{if(element)root.style.setProperty(HEIGHT_PROPERTY,Math.ceil(element.getBoundingClientRect().height)+'px')};
    measure();
    const sizeObserver=typeof ResizeObserver==='function'&&element?new ResizeObserver(measure):null;
    sizeObserver?.observe(element);
    window.addEventListener('resize',measure);
    return()=>{
      titleObserver?.disconnect();sizeObserver?.disconnect();window.removeEventListener('resize',measure);
      delete root.dataset.misEnvironment;root.style.removeProperty(HEIGHT_PROPERTY);
      if(document.title.startsWith(prefix))document.title=document.title.slice(prefix.length);
    };
  },[label]);
  const parts=environmentBannerParts(label);
  if(!parts)return null;
  return <div ref={bar} className="mis-environment-banner" role="note" aria-label={`${label} platform notice`}>
    <strong>{parts.heading}</strong> {parts.detail}
  </div>;
}
