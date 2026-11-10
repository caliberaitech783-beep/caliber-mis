export function assertProductionSecurityConfig(env=process.env){
 if(env.WEBSITE_SITE_NAME!=='caliber-mis-783')return;
 if(env.MIS_DATABASE_CONNECTION_MODE!=='isolated'||env.MIS_RLS_ENABLED!=='true')throw Error('Production MIS requires its isolated database credential, RLS. Configure the security settings before starting this release.');
 if(env.MIS_SSO_MODE&&env.MIS_SSO_MODE!=='client')throw Error('Production MIS must use the Pulse identity client.');
}
export function legacyPasswordRouteGuard(env=process.env){
 return (_req,res,next)=>(env.MIS_SSO_MODE||'client')==='client'
  // Only a page opened before a release still shows the old form (current pages go to Pulse on this
  // code), so the message tells that user the one step that works: reload, which opens Pulse sign-in.
  ?res.status(403).json({error:'MIS signs in through Pulse. Reload this page (Ctrl+F5) to continue to Pulse sign-in. To reset your password, use Pulse.',code:'PULSE_SIGNIN_REQUIRED'})
  :next();
}
