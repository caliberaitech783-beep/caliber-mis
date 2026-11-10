import './mis-workspace.css';
import {useEffect,useState} from 'react';
let configuration;
// The sign-in mode is believed only when the server states it. A read that fails (the app restarts
// during every release) is retried and never taken as "off": "off" opens the old password form, and
// production refuses that form (PULSE_SIGNIN_REQUIRED).
const config=()=>configuration||=fetch('/api/mis-sso/config',{cache:'no-store'}).then(async r=>{
  const value=r.ok?await r.json():null;
  if(typeof value?.mode!=='string')throw Error('MIS sign-in mode is not available yet.');
  return value;
}).catch(error=>{configuration=null;throw error;});
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
// Every release restarts the app for 30-60 seconds; Azure answers 502/503/504 (or the connection
// drops) until it is back. Those answers never reached MIS, so the one-time hand-over is still
// unused and the same request is safe to repeat. The ready cookie lives 60 s, so stop after ~50 s.
const RESTART_STATUSES=new Set([502,503,504]);
async function fetchThroughRestart(url,init,{onWaiting=()=>{},stopped=()=>false,delays=[1000,2000,4000,8000,8000,8000,8000,8000]}={}){
  for(let attempt=0;;attempt++){
    let response;
    try{response=await fetch(url,init);}catch(error){if(attempt>=delays.length)throw error;}
    if(response&&!RESTART_STATUSES.has(response.status))return response;
    if(attempt>=delays.length)return response;
    if(stopped())return null;
    onWaiting();
    await wait(delays[attempt]);
    if(stopped())return null;
  }
}
const readJson=async response=>{try{return await response.json();}catch{return {};}};
const RESTARTING='MIS is restarting. Sign-in will continue automatically in a moment.';

export function useMisSharedSignIn(session,{paused=false,autoStart=true}={}){
  const [status,setStatus]=useState({mode:'checking',error:''});
  useEffect(()=>{
    if(paused)return;
    let stopped=false;
    const start=async()=>{
      let mode;
      for(let attempt=0;;attempt++){
        try{({mode}=await config());break;}
        catch{
          if(stopped)return;
          if(attempt>=1)setStatus({mode:'checking',error:RESTARTING});
          await wait(Math.min(1000*2**attempt,8000));
        }
        if(stopped)return;
      }
      if(stopped)return;
      setStatus({mode,error:''});
      const query=new URLSearchParams(window.location.search);
      if(mode==='issuer'&&session?.token){
        const response=await fetch('/api/mis-sso/remember',{method:'POST',headers:{Authorization:`Bearer ${session.token}`}});
        if(stopped||!response.ok)return;
        if(query.get('misSignIn')==='1'){
          const state=query.get('state'),challenge=query.get('code_challenge');
          if(!/^[A-Za-z0-9_-]{43}$/.test(state||'')||!/^[A-Za-z0-9_-]{43}$/.test(challenge||''))throw Error('Invalid MIS sign-in request.');
          window.location.replace('/api/mis-sso/authorize?'+new URLSearchParams({state,code_challenge:challenge}));
        }
      }
      if(mode==='client'&&(!session?.token||query.has('misCredentialReady')||query.get('misSsoReady')==='1')){
        const handoff=query.get('misCredentialReady');
        if(handoff==='1'||/^[A-Za-z0-9_-]{43}$/.test(handoff||'')){
          const response=await fetchThroughRestart('/api/mis-credentials/session'+(handoff==='1'?'':'?handoff='+encodeURIComponent(handoff)),{cache:'no-store',headers:session?.token?{Authorization:`Bearer ${session.token}`}:{}},{stopped:()=>stopped,onWaiting:()=>setStatus({mode,error:RESTARTING})});
          if(stopped||!response)return;
          const result=await readJson(response);if(stopped)return;
          window.history.replaceState(null,'','/');
          if(!response.ok||!result.token)throw Error(result.error||'Pulse could not complete MIS sign-in. Please start again.');
          window.dispatchEvent(new CustomEvent('mis-shared-signin',{detail:result}));
        }else if(query.get('misSsoReady')==='1'){
          const response=await fetchThroughRestart('/api/mis-sso/session',{cache:'no-store',headers:session?.token?{Authorization:`Bearer ${session.token}`}:{}},{stopped:()=>stopped,onWaiting:()=>setStatus({mode,error:RESTARTING})});
          if(stopped||!response)return;
          const result=await readJson(response);if(stopped)return;
          window.history.replaceState(null,'','/');
          if(!response.ok||!result.token)throw Error('Pulse sign-in could not be completed. Please retry.');
          window.dispatchEvent(new CustomEvent('mis-shared-signin',{detail:result}));
        }else if(autoStart&&!session?.token)window.location.replace('/api/mis-credentials/start');
      }
    };
    void start().catch(error=>{if(!stopped)setStatus(current=>({...current,error:error.message||'Shared sign-in is temporarily unavailable. Please retry.'}));});
    return()=>{stopped=true;};
  },[session?.token,paused,autoStart]);
  return status;
}

export function MisSharedLogin({error,message='Continue to Pulse, select MIS, and enter your existing Pulse username and password there.'}){
 return <main className="boot-status"><section className="boot-card mis-credential-login"><h1>Caliber MIS</h1><p>{error||message}</p><a href="/api/mis-credentials/start">Sign in through Pulse</a><p>Your session will open automatically in MIS after sign-in.</p></section></main>;
}
