import React,{useEffect,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {useMisSharedSignIn,MisSharedLogin} from './mis-shared-signin.jsx';
import MisWorkspace from './mis-workspace.jsx';
import './mis-workspace.css';

const sessionKey='nerveCenterSession';
function clearSession(){sessionStorage.removeItem(sessionKey);localStorage.removeItem(sessionKey);}

function MisApp(){
  const [session,setSession]=useState(null);
  const [signedOut,setSignedOut]=useState(false);
  const signIn=useMisSharedSignIn(session,{paused:signedOut,autoStart:true});
  useEffect(()=>{
    clearSession();
    const receive=event=>{
      if(!event.detail?.token)return;
      setSignedOut(false);setSession(event.detail);
    };
    window.addEventListener('mis-shared-signin',receive);
    return()=>window.removeEventListener('mis-shared-signin',receive);
  },[]);
  useEffect(()=>{
    if(!session?.token)return;
    const controller=new AbortController();
    const check=async()=>{
      try{
        const response=await fetch('/api/session-heartbeat',{method:'POST',headers:{Authorization:`Bearer ${session.token}`},signal:controller.signal});
        if(!controller.signal.aborted&&response.status===401){clearSession();setSession(null);}
      }catch{}
    };
    void check();const timer=window.setInterval(check,60000);
    return()=>{controller.abort();window.clearInterval(timer);};
  },[session?.token]);
  const signOut=()=>{
    if(session?.token)void fetch('/api/logout',{method:'POST',headers:{Authorization:`Bearer ${session.token}`}}).catch(()=>{});
    clearSession();setSignedOut(true);setSession(null);
  };
  if(!session?.token)return <MisSharedLogin error={signIn.error} message={signedOut?'You have signed out of MIS.':'Sign in with your Pulse username and password.'}/>;
  return <MisWorkspace onSignOut={signOut}/>;
}

createRoot(document.getElementById('root')).render(<MisApp/>);
