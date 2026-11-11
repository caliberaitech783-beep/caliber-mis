(()=>{
  const moduleError=/chunkloaderror|loading chunk|dynamically imported module|module script/i;
  const showFailure=()=>{
    const root=document.getElementById('root');
    if(!root)return;
    root.innerHTML='<main class="boot-status" role="alert"><div class="boot-card"><b>Caliber Pulse-II could not finish loading.</b><p>Your data is safe. Refresh to load the current application files.</p><button type="button">Refresh application</button></div></main>';
    root.querySelector('button').addEventListener('click',()=>window.location.reload());
  };
  window.addEventListener('error',event=>{
    if(moduleError.test(String(event.message||''))||event.target?.tagName==='SCRIPT')showFailure();
  },true);
  window.addEventListener('unhandledrejection',event=>{
    if(moduleError.test(String(event.reason?.message||event.reason||'')))showFailure();
  });
})();
