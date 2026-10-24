import {geminiEnabled,configuredGeminiKey} from './gemini-card-reader.mjs';
import {localGeminiKey,MODEL} from './gemini-hybrid.mjs';
import {GROQ_VISION_MODEL} from './groq-card-ocr.mjs';
export function registerGroqScanSettings(app,{store,requireSession,requireAdministrator,fetchImpl=fetch,env=process.env,getGeminiKey=()=>configuredGeminiKey(env)}){
 const hybrid=geminiEnabled(env);
 const getConfig=async()=>{const saved=await store.read('groq-scanning');return saved||{apiKey:env.GROQ_API_KEY||'',model:env.GROQ_VISION_MODEL||GROQ_VISION_MODEL,enabled:Boolean(env.GROQ_API_KEY)};};
 const view=c=>({configured:Boolean(c.apiKey),enabled:Boolean(c.enabled&&c.apiKey),model:c.model||GROQ_VISION_MODEL});
 app.get('/api/scan-settings',requireSession,requireAdministrator,async(req,res)=>{req.audit=false;try{if(hybrid){let configured=false;try{configured=Boolean(await getGeminiKey())}catch{}return res.set('Cache-Control','no-store').json({provider:'gemini',model:MODEL,configured,enabled:true});}res.set('Cache-Control','no-store').json(view(await getConfig()))}catch{res.status(503).json({error:'Scan settings could not be loaded.'})}});
 app.post('/api/scan-settings',requireSession,requireAdministrator,async(req,res)=>{req.audit=false;try{
  if(hybrid)return res.status(409).json({error:'This installation uses Gemini API. Its key is managed privately on the server.'});
  const old=await getConfig(),apiKey=req.body.apiKey||old.apiKey,model=req.body.model||old.model||GROQ_VISION_MODEL,enabled=req.body.enabled===true;
  if(typeof model!=='string'||!/^[-\w./]{1,120}$/.test(model)||typeof apiKey!=='string'||apiKey.length>300)return res.status(400).json({error:'Enter a valid Groq key and model.'});
  if(enabled){if(!apiKey||/\s/.test(apiKey))return res.status(400).json({error:'Enter your Groq API key.'});let response;try{response=await fetchImpl('https://api.groq.com/openai/v1/models',{headers:{Authorization:'Bearer '+apiKey},signal:AbortSignal.timeout(15000)})}catch{return res.status(502).json({error:'Could not verify the Groq connection. Existing settings retained.'})}
   if(!response.ok)return res.status(400).json({error:'Groq rejected this key or connection. Existing settings retained.'});const data=await response.json();if(!data.data?.some(r=>r.id===model))return res.status(400).json({error:'This model is not available to your Groq account. Existing settings retained.'});
  }
  const config={apiKey,model,enabled};await store.write('groq-scanning',config);res.set('Cache-Control','no-store').json(view(config));
 }catch{res.status(503).json({error:'Scan settings could not be saved.'})}});
 return {getConfig};
}
