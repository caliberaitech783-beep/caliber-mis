// Rules that keep scan uploads from jamming the database pool.
//
// 15 November 2026 load test (8 sites, 3,000 trip cards uploaded together):
// Pulse-II's pool sat at 20/20 with 74-123 requests waiting, 7% of uploads got
// "reconnecting to the database" and entry pages took 12-14 s. Each upload took
// a pool connection first and only then waited for its entry's lock, so the
// browser's three parallel uploads per entry held three connections to do one
// at a time. Every upload also took a whole site/date/shift lock that only the
// visual duplicate check needs, and saved the picture to Blob storage while
// holding all of it.

// Uploads to one entry wait their turn here, in this process, before taking a
// pool connection. The database advisory lock stays in place for correctness
// across instances; this only stops idle waiters from holding connections.
export function createKeyedSerializer(){
 const tails=new Map();
 return {
  async run(key,fn){
   const previous=tails.get(key)||Promise.resolve();
   let done;const mine=new Promise(resolve=>{done=resolve;});
   const tail=previous.then(()=>mine);tails.set(key,tail);
   await previous;
   try{return await fn();}
   finally{done();if(tails.get(key)===tail)tails.delete(key);}
  },
  size(){return tails.size;},
 };
}

// The site/date/shift lock serialises every upload of a site for the visual
// duplicate check, which compares the new card with all live cards of that
// date, site and shift. With the check off (SCAN_DUPLICATE_FINGERPRINT not
// 'true', as in production) nothing reads those cards during the upload, the
// exact-byte check is guarded by the image-hash lock, and the lock is skipped.
export function uploadDuplicateLockKey(batch,settings){
 if(!settings?.enabled||!batch?.expected_context?.bookDate)return null;
 const context=batch.expected_context;
 return 'scan-duplicates:'+batch.kind+'|'+context.bookDate+'|'+String(context.location||'').trim().toLowerCase()+'|'+(context.cardShift||'');
}
