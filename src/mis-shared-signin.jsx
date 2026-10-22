import './mis-workspace.css';
import {useEffect,useState} from 'react';
let configuration;
const config=()=>configuration||=(fetch('/api/mis-sso/config',{cache:'no-store'}).then(r=>r.ok?r.json():{mode:'off'}).catch(()=>{configuration=null;return {mode:'off'};}));

export function useMisSharedSignIn(session,{paused=false,autoStart=true}={}){
  const [status,setStatus]=useState({mode:'off',error:''});
  useEffect(()=>{
    if(paused)return;
    let stopped=false;
    const start=async()=>{
      const {mode}=await config();if(stopped)return;
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
      if(mode==='client'&&!session?.token){
        if(query.get('misSsoReady')==='1'){
          const response=await fetch('/api/mis-sso/session',{cache:'no-store'});
          const result=await response.json();if(stopped)return;
          window.history.replaceState(null,'','/');
          if(!response.ok||!result.token)throw Error('Pulse sign-in could not be completed. Please retry.');
          window.dispatchEvent(new CustomEvent('mis-shared-signin',{detail:result}));
        }else if(autoStart)window.location.replace('/api/mis-sso/start');
      }
    };
    void start().catch(()=>{if(!stopped)setStatus(current=>({...current,error:'Shared sign-in is temporarily unavailable. Please retry.'}));});
    return()=>{stopped=true;};
  },[session?.token,paused,autoStart]);
  return status;
}

export function MisSharedLogin({error,message='Sign in with the separate MIS credentials assigned in Pulse.'}){
 const [username,setUsername]=useState(''),[password,setPassword]=useState(''),[working,setWorking]=useState(false),[failure,setFailure]=useState('');
 const submit=async event=>{event.preventDefault();setWorking(true);setFailure('');try{
  const response=await fetch('/api/mis-credentials/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username,password})});
  const result=await response.json();if(!response.ok||!result.token)throw Error(result.error||'Could not sign in to MIS.');
  setPassword('');window.dispatchEvent(new CustomEvent('mis-shared-signin',{detail:result}));
 }catch(e){setFailure(e.message);}finally{setWorking(false);}};
 return <main className="boot-status"><section className="boot-card mis-credential-login"><h1>Caliber MIS</h1><p>{message}</p><form onSubmit={submit}><label>MIS username<input autoComplete="username" value={username} onChange={e=>setUsername(e.target.value)} maxLength={120} required/></label><label>MIS password<input type="password" autoComplete="current-password" value={password} onChange={e=>setPassword(e.target.value)} maxLength={256} required/></label>{(failure||error)&&<p role="alert">{failure||error}</p>}<button type="submit" disabled={working||!username.trim()||!password}>{working?'Signing in…':'Sign in to MIS'}</button></form><p>Ask your Pulse administrator to enable MIS access or reset your MIS password.</p><a href="https://pulse.cmll.in">Back to Pulse</a></section></main>;
}
