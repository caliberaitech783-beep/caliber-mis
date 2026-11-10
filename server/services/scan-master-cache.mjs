// Card reading and the scan-entry read match every card against the master lists. The Employee master
// alone is about 20,000 records / 44 MB (11 Nov 2026), and it was read from the database for every
// card: the transfer held a connection for seconds and unpacking it froze the server, which filled the
// 10-connection pool for everyone.
//
// The lists are now read once per master-data revision. Every insert, update or delete on
// master_records bumps data_revisions('master-data') through a trigger, so one tiny query tells whether
// the copy in memory is still current. Use this only with a connection that is not inside a transaction
// that writes masters: the revision is read before the lists, so a change made while they load just
// makes the next read reload.
export const MASTER_SQL="SELECT id,master_name,record_data FROM master_records WHERE master_name=ANY($1::text[]) ORDER BY id";
const REVISION_SQL="SELECT revision FROM data_revisions WHERE revision_key='master-data'";

export function createMasterCache(){
 const entries=new Map();
 let hits=0,loads=0;
 async function readMasters(client,names){
  let revision=null;
  try{revision=(await client.query(REVISION_SQL)).rows[0]?.revision??null;}catch{revision=null;}
  // Without a revision there is nothing to check a copy against, so read directly (older databases, tests).
  if(revision===null)return client.query(MASTER_SQL,[names]);
  const key=JSON.stringify([...names].sort()),stamp=String(revision);
  let entry=entries.get(key);
  if(entry?.revision===stamp)hits++;
  else{
   loads++;
   const rows=client.query(MASTER_SQL,[names]).then(result=>result.rows);
   entry={revision:stamp,rows};entries.set(key,entry);
   rows.catch(()=>{if(entries.get(key)===entry)entries.delete(key);});
  }
  // Callers may replace a row's record_data (aliases, LMV categories); each gets its own row objects.
  return {rows:(await entry.rows).map(row=>({...row}))};
 }
 readMasters.stats=()=>({hits,loads,cached:entries.size});
 return readMasters;
}

export const readScanMasters=createMasterCache();
