// Sends a large JSON answer in pieces and lets other requests run between them.
// res.json() turns the whole answer into one string in one go: the Operations report for
// month-to-date is hundreds of MB, and on 16 Nov 2026 at 16:26 IST it froze the live server for
// 2.6 s (no one's screen got an answer meanwhile). Here every top-level list is written
// `chunk` items at a time, with a pause for other work (setImmediate) after each piece and a
// wait whenever the connection's buffer is full. The bytes are the same JSON that res.json()
// would send, so screens read it exactly as before.
const pause=()=>new Promise(resolve=>setImmediate(resolve));

export async function sendJsonInChunks(res,body,{chunk=250}={}){
 if(!res.get('Content-Type'))res.type('application/json; charset=utf-8');
 let closed=false;const onClose=()=>{closed=true;};
 res.on('close',onClose);
 const write=async text=>{
  if(closed)return;
  if(!res.write(text)&&!closed)await new Promise(resolve=>{const done=()=>{res.off('drain',done);res.off('close',done);resolve();};res.on('drain',done);res.on('close',done);});
 };
 try{
  await write('{');
  let first=true;
  for(const [key,value] of Object.entries(body||{})){
   if(closed)return;
   // JSON.stringify leaves out keys whose value is undefined or a function; so does this.
   if(value===undefined||typeof value==='function')continue;
   await write((first?'':',')+JSON.stringify(key)+':');first=false;
   if(!Array.isArray(value)){await write(JSON.stringify(value)??'null');continue;}
   await write('[');
   for(let start=0;start<value.length;start+=chunk){
    if(closed)return;
    const piece=value.slice(start,start+chunk).map(item=>JSON.stringify(item)??'null').join(',');
    await write((start?',':'')+piece);
    await pause();
   }
   await write(']');
  }
  await write('}');
 }finally{
  res.off('close',onClose);
  if(!closed)res.end();
 }
}
