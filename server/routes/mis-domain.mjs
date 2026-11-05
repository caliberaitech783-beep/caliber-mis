const canonicalOrigin='https://pulse-ll.cmll.in';

export function registerMisDomainRedirect(app){
  app.use((req,res,next)=>{
    if(!['GET','HEAD'].includes(req.method)||String(req.hostname||'').toLowerCase()!=='pulseii.cmll.in')return next();
    if(['/api/health','/api/app-version'].includes(req.path))return next();
    const source=new URL(req.originalUrl,'https://pulseii.cmll.in');
    const target=new URL(canonicalOrigin);
    target.pathname=source.pathname;target.search=source.search;
    res.set({'Cache-Control':'no-store','Referrer-Policy':'no-referrer'});
    res.redirect(307,target.toString());
  });
}
