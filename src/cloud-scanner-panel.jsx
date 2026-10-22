import React,{useEffect,useRef,useState} from 'react';
const LOCAL='http://127.0.0.1:4174';
export default function CloudScannerPanel({kind,token,onBatch,onComplete}){
 const [message,setMessage]=useState('Connect the scanner on this Windows PC to send scans into the online review queue.'),[error,setError]=useState('');
 const connection=useRef(null),callbacks=useRef({onBatch,onComplete});callbacks.current={onBatch,onComplete};
 useEffect(()=>{const receive=async e=>{
  const c=connection.current,d=e.data;if(!c||e.origin!==LOCAL||e.source!==c.popup||d?.nonce!==c.nonce)return;
  if(d.type==='scanner-progress')setMessage(String(d.message).slice(0,300));
  if(d.type==='scanner-page'){
   if(c.pending)return;c.pending=true;
   try{if(!/^[a-f0-9-]{36}$/i.test(d.cardId)||typeof d.base64!=='string'||d.base64.length>16000000)throw Error('Invalid scanner page.');
    const api=async(path,body)=>{const r=await fetch(path,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify(body)});const v=await r.json();if(!r.ok)throw Error(v.error||'Upload failed.');return v;};
    c.batch??=(await api('/api/scan-batches',{kind,name:'PC scanner · '+new Date().toLocaleString()})).id;
    await api('/api/scan-batches/'+c.batch+'/cards',{base64:d.base64,filename:String(d.filename||'Scanner page').slice(0,200),uploadKey:d.cardId,pageCount:1,expectedPages:1,...(d.paddleEvidence?{paddleEvidence:d.paddleEvidence}:{})});
    c.popup.postMessage({type:'scanner-ack',nonce:c.nonce,cardId:d.cardId},LOCAL);setMessage('Scan and extracted information uploaded as a draft. Check and correct it in online MIS.');
   }catch(err){setError(err.message);c.popup.postMessage({type:'scanner-ack',nonce:c.nonce,cardId:d.cardId,error:err.message},LOCAL)}finally{c.pending=false;}
  }
  if(d.type==='scanner-complete'&&c.batch){callbacks.current.onBatch(c.batch);callbacks.current.onComplete?.();setMessage('Scanned cards uploaded. Check and approve them before saving log books.');}
 };window.addEventListener('message',receive);return()=>window.removeEventListener('message',receive)},[kind,token]);
 const connect=async()=>{if(connection.current?.popup&&!connection.current.popup.closed){connection.current.popup.focus();return;}setError('');const nonce=crypto.randomUUID();const popup=window.open('about:blank','caliber-scanner-'+nonce,'popup,width=850,height=750');if(!popup){setError('Allow the scanner connector popup, then click Connect again.');return;}connection.current={nonce,popup};try{const response=await fetch('/api/scanner-connector/ticket',{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({nonce,kind})});const result=await response.json();if(!response.ok)throw Error(result.error||'Cannot authorize scanner connection.');popup.location.href=LOCAL+'/scanner-connector.html#'+new URLSearchParams({nonce,kind,origin:window.location.origin,ticket:result.ticket});}catch(e){popup.close();connection.current=null;setError(e.message);return;}setMessage('In the local connector window, select Brother ADS-3100 and click Scan and send to online MIS.');};
 return <section className="local-scanner-panel"><div className="scanner-options"><section><h2>Scanner connected to this PC</h2><p>The online server uses a local connector to reach your USB scanner.</p><button onClick={connect}>Connect PC scanner</button><p role="status">{message}</p>{error&&<p className="scan-error" role="alert">{error}</p>}<p>Keep the local MIS scanner service running on this computer. If the connector cannot open, start the local backend and UI, then reconnect.</p></section><section><h2>Already scanned PDF files</h2><p>Use the Upload files tab to choose PDFs or images from your PC. For free local PaddleOCR, click Connect PC scanner, then choose PDF/image files or read your Desktop scan folder in the connector.</p><p>Scans are sent to this online MIS account for OCR and review. No log books are saved until you approve and confirm them.</p></section></div></section>;
}
