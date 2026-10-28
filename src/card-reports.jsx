import React,{useEffect,useState} from 'react';
import './card-reports.css';

export function filterCardBatches(batches,kind,search){const term=search.trim().toLowerCase();return batches.filter(b=>(!kind||b.kind===kind)&&(!term||[b.name,b.created_at,new Date(b.created_at).toLocaleDateString('en-IN')].join(' ').toLowerCase().includes(term)));}

export function OriginalCard({card,token}){
 const [src,setSrc]=useState(''),[error,setError]=useState(''),[retry,setRetry]=useState(0);
 useEffect(()=>{const controller=new AbortController();let url;setSrc('');setError('');fetch('/api/scan-cards/'+card.id+'/image',{signal:controller.signal,cache:'no-store',headers:{Authorization:'Bearer '+token}}).then(r=>{if(!r.ok)throw Error('Could not load original card.');return r.blob()}).then(blob=>{if(controller.signal.aborted)return;url=URL.createObjectURL(blob);setSrc(url)}).catch(e=>{if(!controller.signal.aborted)setError(e.message)});return()=>{controller.abort();if(url)URL.revokeObjectURL(url)}},[card.id,token,retry]);
 return <article className="original-card"><h3>Card {card.ordinal}{card.book_no?' · '+card.book_no:''}</h3><p>{card.filename||'Scanned card'} · {card.page_count===2?'Front and back':'Single page'}</p>{src?<><a href={src} target="_blank" rel="noreferrer" title={'Open original card '+card.ordinal}><img src={src} alt={'Original scanned card '+card.ordinal}/></a><div className="original-card-actions"><a href={src} target="_blank" rel="noreferrer">View full size</a><a href={src} download={'original-card-'+card.ordinal}>Download original</a></div></>:error?<p role="alert">{error} <button onClick={()=>setRetry(n=>n+1)}>Retry</button></p>:<p role="status">Loading original scan…</p>}</article>;
}

export default function CardReportGallery({batch,cards,token,ReportSection}){
 const [page,setPage]=useState(0),size=12;
 const last=Math.max(0,Math.ceil(cards.length/size)-1),current=Math.min(page,last),shown=cards.slice(current*size,(current+1)*size);
 if(!batch)return null;
 return <section className="card-reports" aria-label="Original scanned card report"><h2>Card Report · {cards.length} original cards</h2><p>{batch.name} · Scanned {new Date(batch.created_at).toLocaleString('en-IN')}. Choose an earlier report batch above to see previous cards.</p>{!cards.length&&<p>No cards have arrived in this batch yet. Refresh after scanning.</p>}{ReportSection&&<ReportSection key={batch.id} title={'Card index · '+batch.name} category="card-index" description="Complete batch card index. View original scanned images below." columns={[{key:'ordinal',label:'Card',value:row=>row.ordinal},{key:'filename',label:'Source file',value:row=>row.filename},{key:'status',label:'Status',value:row=>row.status},{key:'book',label:'Book number',value:row=>row.book_no},{key:'pages',label:'Pages',value:row=>row.page_count??1}]} rows={cards}/>}<div className="original-card-grid">{shown.map(card=><OriginalCard key={card.id} card={card} token={token}/>)}</div>{cards.length>size&&<nav className="original-card-pagination" aria-label="Original card pages"><button disabled={current===0} onClick={()=>setPage(current-1)}>Previous cards</button><span>Cards {current*size+1}–{Math.min((current+1)*size,cards.length)} of {cards.length}</span><button disabled={current===last} onClick={()=>setPage(current+1)}>Next cards</button></nav>}</section>;
}
