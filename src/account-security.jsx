import React,{useEffect,useState} from 'react';
import './account-security.css';
import {isBrowserSessionToken} from './browser-session-transport.mjs';
export function useAccountSecurity(session,{enabled=Boolean(session?.browserSession||session?.permissions?.separateMisCredentials)}={}){
 const key=(session?.login||'')+'|'+(session?.token||'');
 const [state,setState]=useState({loading:false,required:false,verified:false,error:''});
 useEffect(()=>{
  if(!session?.token||!enabled){setState({loading:false,required:false,verified:true,error:''});return;}
  let stopped=false;
  setState({loading:true,required:true,verified:false,error:''});
  const load=async()=>{
   if(!isBrowserSessionToken(session.token)){
    // Remove the legacy credential before doing any asynchronous work. A failed
    // migration can be retried in this tab without leaving a token on disk.
    localStorage.removeItem('nerveCenterSession');sessionStorage.removeItem('nerveCenterSession');
    const migration=await fetch('/api/security/session/migrate',{method:'POST',headers:{Authorization:`Bearer ${session.token}`,'X-MIS-Session-Migrate':'1'}});
    const result=await migration.json();if(!migration.ok)throw Error(result.error||'Please sign in again.');
    sessionStorage.setItem('nerveCenterSession',JSON.stringify(result));window.location.reload();return;
   }
   localStorage.removeItem('nerveCenterSession');
   const response=await fetch('/api/security/account',{headers:{Authorization:`Bearer ${session.token}`},cache:'no-store'}),result=await response.json();
   if(!response.ok)throw Error(result.error||'Account verification is unavailable.');
   if(result.profile?.login&&(result.profile.login!==session.login||result.profile.token!==session.token)){sessionStorage.setItem('nerveCenterSession',JSON.stringify(result.profile));window.location.reload();return;}
   if(!stopped)setState({...result,checkedFor:key,loading:false,error:''});
  };
  void load().catch(error=>{if(!stopped)setState({checkedFor:key,loading:false,required:true,verified:false,error:error.message});});
  const requireMfa=()=>{if(!stopped)setState(current=>({...current,required:true,verified:false}));};
  window.addEventListener('mis-security-required',requireMfa);
  return()=>{stopped=true;window.removeEventListener('mis-security-required',requireMfa);};
 },[session?.token,session?.login,enabled]);
 return enabled&&session?.token&&state.checkedFor!==key?{...state,loading:true,required:true}:state;
}
export function AccountSecurityGate({state,token}){
 const [setup,setSetup]=useState(null),[code,setCode]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false),[codes,setCodes]=useState(null);
 const request=async(path,body)=>{const response=await fetch('/api/security/mfa/'+path,{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${token}`},body:JSON.stringify(body||{})});const result=await response.json();if(!response.ok)throw Error(result.error||'Verification failed.');return result;};
 const enroll=async()=>{setBusy(true);setError('');try{setSetup(await request('enroll'));}catch(error){setError(error.message);}finally{setBusy(false);}};
 const verify=async event=>{event.preventDefault();setBusy(true);setError('');try{const result=await request(setup?'confirm':'verify',{code});if(result.recoveryCodes)setCodes(result.recoveryCodes);else if(result.replaceAuthenticator){setSetup(await request('enroll',{replace:true}));setCode('');}else window.location.reload();}catch(error){setError(error.message);}finally{setBusy(false);}};
 const download=()=>{const url=URL.createObjectURL(new Blob(['Caliber MIS recovery codes\nKeep these private. Each code can be used once.\n\n'+codes.join('\n')],{type:'text/plain'}));const link=document.createElement('a');link.href=url;link.download='caliber-mis-recovery-codes.txt';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
 const signOut=async()=>{setBusy(true);try{const response=await fetch('/api/logout',{method:'POST',headers:{Authorization:`Bearer ${token}`}});if(!response.ok)throw Error('Sign out could not be completed. Retry.');sessionStorage.removeItem('nerveCenterSession');localStorage.removeItem('nerveCenterSession');window.location.assign('/api/mis-credentials/start');}catch(error){setError(error.message);setBusy(false);}};
 return <main className="boot-status"><section className="boot-card account-security" aria-label="Account verification">
  <h1>{codes?'Save your recovery codes':'Verify your MIS sign-in'}</h1>
  {state.loading?<p>Checking account security…</p>:codes?<><p>Store these codes somewhere private. Each code works once if your authenticator is unavailable.</p><pre>{codes.join('\n')}</pre><button onClick={download}>Download recovery codes</button><button onClick={()=>window.location.reload()}>I saved my codes — open MIS</button></>:<>
   {state.error?<><p role="alert">{state.error}</p><button onClick={()=>window.location.reload()}>Retry</button></>:<>
    {!state.enrolled&&!setup?<><p>Protect your MIS account with an authenticator app. Setup takes a minute. You will also receive recovery codes.</p><button disabled={busy} onClick={enroll}>Set up authenticator</button></>:<form onSubmit={verify}>
     {setup?<>{setup.replace&&<p>This replaces your lost authenticator and signs out your other MIS sessions.</p>}<p>In your authenticator app, add an account named <b>Caliber MIS</b>, choose a time-based code, and enter this setup key:</p><code className="account-security-secret">{setup.secret}</code><p>Enter the current six-digit code to confirm setup.</p></>:<p>Enter the current code from your authenticator, or use one unused recovery code.</p>}
     <label>Verification code<input autoFocus autoComplete="one-time-code" value={code} maxLength={30} onChange={event=>setCode(event.target.value)} required/></label><button disabled={busy||!code.trim()}>{busy?'Verifying…':'Verify and continue'}</button>
    </form>}
   </>}
   {error&&<p role="alert">{error}</p>}
   <button type="button" disabled={busy} onClick={signOut}>Sign out / use another account</button>
  </>}
 </section></main>;
}
