(()=>{
  const moduleError=/chunkloaderror|loading chunk|dynamically imported module|module script/i;
  let stylesheetRetried=false;
  const retryStylesheet=link=>{
    if(stylesheetRetried||!link?.matches?.('link[data-pulse-stylesheet]'))return;
    stylesheetRetried=true;
    const url=new URL(link.href);
    url.searchParams.set('retry',String(Date.now()));
    const retry=link.cloneNode();
    retry.href=url.href;
    // Keep the original URL in the DOM for Vite's lazy-module preload lookup.
    link.after(retry);
  };
  window.addEventListener('load',()=>{
    const link=document.querySelector('link[data-pulse-stylesheet]');
    if(link&&!link.sheet?.cssRules.length)retryStylesheet(link);
  },{once:true});
  const showFailure=()=>{
    const root=document.getElementById('root');
    if(!root)return;
    root.innerHTML='<main class="boot-status" role="alert"><div class="boot-card"><b>Caliber Pulse-II could not finish loading.</b><p>Your data is safe. Refresh to load the current application files.</p><button type="button">Refresh application</button></div></main>';
    root.querySelector('button').addEventListener('click',()=>window.location.reload());
  };
  window.addEventListener('error',event=>{
    retryStylesheet(event.target);
    if(moduleError.test(String(event.message||''))||event.target?.tagName==='SCRIPT')showFailure();
  },true);
  window.addEventListener('unhandledrejection',event=>{
    if(moduleError.test(String(event.reason?.message||event.reason||'')))showFailure();
  });
})();
