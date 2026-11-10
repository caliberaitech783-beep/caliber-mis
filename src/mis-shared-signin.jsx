import './mis-workspace.css';
import {useEffect,useState} from 'react';
let configuration;
// The sign-in mode is believed only when the server states it. A read that fails (the app restarts
// during every release) is retried and never taken as "off": "off" opens the old password form, and
// production refuses that form with "Use Pulse to sign in or reset your primary password."
const config=()=>configuration||=fetch('/api/mis-sso/config',{cache:'no-store'}).then(async r=>{
  const value=r.ok?await r.json():null;
  if(typeof value?.mode!=='string')throw Error('MIS sign-in mode is not available yet.');
  return value;
}).catch(error=>{configuration=null;throw error;});
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));

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
          if(attempt>=1)setStatus({mode:'checking',error:'MIS is restarting. Sign-in will continue automatically in a moment.'});
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
          const response=await fetch('/api/mis-credentials/session'+(handoff==='1'?'':'?handoff='+encodeURIComponent(handoff)),{cache:'no-store',headers:session?.token?{Authorization:`Bearer ${session.token}`}:{}});
          const result=await response.json();if(stopped)return;
          window.history.replaceState(null,'','/');
          if(!response.ok||!result.token)throw Error(result.error||'Pulse could not complete MIS sign-in. Please start again.');
          window.dispatchEvent(new CustomEvent('mis-shared-signin',{detail:result}));
        }else if(query.get('misSsoReady')==='1'){
          const response=await fetch('/api/mis-sso/session',{cache:'no-store',headers:session?.token?{Authorization:`Bearer ${session.token}`}:{}});
          const result=await response.json();if(stopped)return;
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
