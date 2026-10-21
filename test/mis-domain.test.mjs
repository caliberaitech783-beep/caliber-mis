import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import {registerMisDomainRedirect} from '../mis-domain.mjs';

test('the previous MIS domain redirects browser and authentication callbacks to pulse-ll',async()=>{
  const app=express();app.set('trust proxy',true);registerMisDomainRedirect(app);app.use((_req,res)=>res.sendStatus(204));
  const server=await new Promise(resolve=>{const current=app.listen(0,'127.0.0.1',()=>resolve(current));});
  const base=`http://127.0.0.1:${server.address().port}`;
  try{
    for(const path of ['/','/api/mis-sso/start','/api/mis-sso/callback?state=synthetic-state&code=synthetic-code','//untrusted.example/path']){
      const response=await fetch(base+path,{headers:{'X-Forwarded-Host':'pulseii.cmll.in'},redirect:'manual'});
      assert.equal(response.status,307,path);
      const destination=new URL(response.headers.get('location'));
      assert.equal(destination.origin,'https://pulse-ll.cmll.in');
      if(path.includes('callback'))assert.equal(destination.search,'?state=synthetic-state&code=synthetic-code');
      assert.equal(response.headers.get('referrer-policy'),'no-referrer');
      assert.equal(response.headers.get('cache-control'),'no-store');
    }
    for(const host of ['pulse-ll.cmll.in','caliber-mis-783.azurewebsites.net','pulse.cmll.in']){
      assert.equal((await fetch(base+'/',{headers:{'X-Forwarded-Host':host},redirect:'manual'})).status,204);
    }
    for(const path of ['/api/health','/api/app-version']){
      assert.equal((await fetch(base+path,{headers:{'X-Forwarded-Host':'pulseii.cmll.in'},redirect:'manual'})).status,204);
    }
    assert.equal((await fetch(base+'/api/logout',{method:'POST',headers:{'X-Forwarded-Host':'pulseii.cmll.in'},redirect:'manual'})).status,204);
  }finally{await new Promise(resolve=>server.close(resolve));}
});
