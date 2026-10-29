// Existing failed cards must never be requeued as a deployment side effect.
export async function recoverMalformedScanCards(){
 return {rows:[],skipped:true,reason:'Automatic retries are disabled. Specific existing cards require separate approval before retrying.'};
}
