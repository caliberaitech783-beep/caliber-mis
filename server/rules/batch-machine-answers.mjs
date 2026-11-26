// The answer by hand of a VLB, ELB or LMV machine that has no card in a batch and nothing in Pulse-1 (owner, 25 Nov 2026;
// ELB and several machines in one save, 26 Nov 2026): an idle reason, or a breakdown Pulse-1 has no entry for. (Answers
// saved as 'pulse' by an earlier version still count.) One answer per batch and machine. A card saved later for the
// machine wins over it (shared/batch-fleet-coverage.mjs); nothing here writes a card.
import {ANSWER_BOOKS,IDLE_REASONS,HAND_ANSWERS,idleAnswerIssue,answerMachineIssue} from '../../shared/batch-fleet-coverage.mjs';

export const BATCH_MACHINE_ANSWER_SCHEMA=`
 CREATE TABLE IF NOT EXISTS mis_batch_machine_answers(
  batch_id UUID NOT NULL REFERENCES mis_vlb_batches(id) ON DELETE CASCADE,asset_id BIGINT NOT NULL,book TEXT NOT NULL CHECK(book IN ('vlb','elb','lmv')),
  status TEXT NOT NULL,reason TEXT NOT NULL DEFAULT '',breakdown_hours NUMERIC,shift_hours NUMERIC,pulse JSONB,
  saved_by TEXT NOT NULL,saved_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),PRIMARY KEY(batch_id,asset_id));
 -- A table made before 26 Nov 2026 allowed only VLB and LMV: let ELB in too, once.
 DO $$BEGIN
  IF EXISTS(SELECT 1 FROM pg_constraint WHERE conname='mis_batch_machine_answers_book_check' AND pg_get_constraintdef(oid) NOT LIKE '%elb%') THEN
   ALTER TABLE mis_batch_machine_answers DROP CONSTRAINT mis_batch_machine_answers_book_check;
   ALTER TABLE mis_batch_machine_answers ADD CONSTRAINT mis_batch_machine_answers_book_check CHECK(book IN ('vlb','elb','lmv'));
  END IF;
 END$$;
`;
// At most this many machines in one save by hand.
export const MAX_BULK_ANSWERS=500;

const fail=(message,status=400)=>{throw Object.assign(new Error(message),{status});};
const text=value=>String(value??'').trim();

export async function readBatchMachineAnswers(client,batch){
 const {rows}=await client.query(`SELECT asset_id::text AS "assetId",book,status,reason,breakdown_hours::float8 AS "breakdownHours",shift_hours::float8 AS "shiftHours",
  pulse,saved_by AS "savedBy",saved_at AS "savedAt" FROM mis_batch_machine_answers WHERE batch_id=$1`,[batch.id]);
 return rows;
}

async function checkMachine(client,batch,assetId,book){
 if(batch.closed_at)fail('Batch '+batch.name+' is closed. Reopen it before changing a machine answer.',409);
 if(!ANSWER_BOOKS.includes(book))fail('Only a VLB, ELB or LMV machine takes an answer here.',400);
 const asset=(await client.query("SELECT record_data FROM master_records WHERE master_name='Equipment master' AND id=$1",[assetId])).rows[0]?.record_data;
 const issue=answerMachineIssue(asset,{site:batch.site,book});
 if(issue)fail(issue,409);
}

// The machine ids of a save for several machines: digits only, each once, at least one, at most MAX_BULK_ANSWERS.
export function bulkAssetIds(list){
 if(!Array.isArray(list)||!list.length)fail('Tick at least one machine.',400);
 const ids=[...new Set(list.map(text))];
 if(ids.some(id=>!/^\d+$/.test(id)))fail('Invalid machine.',400);
 if(ids.length>MAX_BULK_ANSWERS)fail('Save at most '+MAX_BULK_ANSWERS+' machines at once.',400);
 return ids;
}

async function writeAnswer(client,batch,assetId,answer,actor){
 const {rows}=await client.query(`INSERT INTO mis_batch_machine_answers(batch_id,asset_id,book,status,reason,breakdown_hours,shift_hours,pulse,saved_by)
  VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9)
  ON CONFLICT(batch_id,asset_id) DO UPDATE SET book=EXCLUDED.book,status=EXCLUDED.status,reason=EXCLUDED.reason,breakdown_hours=EXCLUDED.breakdown_hours,
   shift_hours=EXCLUDED.shift_hours,pulse=EXCLUDED.pulse,saved_by=EXCLUDED.saved_by,saved_at=NOW()
  RETURNING asset_id::text AS "assetId",book,status,reason,breakdown_hours::float8 AS "breakdownHours",shift_hours::float8 AS "shiftHours"`,
  [batch.id,assetId,answer.book,answer.status,answer.reason||'',answer.breakdownHours??null,answer.shiftHours??null,answer.pulse?JSON.stringify(answer.pulse):null,actor]);
 return rows[0];
}

export async function saveIdleAnswer(client,batch,assetId,input={},actor){
 const book=text(input.book),status=text(input.status),reason=text(input.reason);
 await checkMachine(client,batch,assetId,book);
 const issue=idleAnswerIssue({book,status,reason});
 if(issue)fail(issue,400);
 return writeAnswer(client,batch,assetId,{book,status,reason},actor);
}

// One answer for every ticked machine of a book (owner, 26 Nov 2026). All are saved or none: a machine that is not of the
// site or book stops the save and is named.
export async function saveBulkAnswers(client,batch,input={},actor){
 const book=text(input.book),status=text(input.status),reason=text(input.reason),ids=bulkAssetIds(input.assetIds);
 if(batch.closed_at)fail('Batch '+batch.name+' is closed. Reopen it before changing a machine answer.',409);
 const issue=idleAnswerIssue({book,status,reason});
 if(issue)fail(issue,400);
 const {rows}=await client.query("SELECT id::text AS id,record_data FROM master_records WHERE master_name='Equipment master' AND id=ANY($1::bigint[])",[ids]);
 const found=new Map(rows.map(row=>[row.id,row.record_data]));
 const refused=ids.map(id=>({id,asset:found.get(id),issue:answerMachineIssue(found.get(id),{site:batch.site,book})})).filter(one=>one.issue);
 if(refused.length){
  const names=refused.slice(0,10).map(one=>(one.asset?.door||one.asset?.doorNo||one.id)+': '+one.issue).join(' ');
  fail('Nothing saved. '+refused.length+' ticked machine'+(refused.length===1?'':'s')+' cannot take this answer. '+names,409);
 }
 const saved=[];
 for(const id of ids)saved.push(await writeAnswer(client,batch,id,{book,status,reason},actor));
 return {saved:saved.length,book,status,reason,assetIds:ids};
}

// Clear the answers by hand of several machines at once.
export async function clearBulkAnswers(client,batch,input={}){
 const ids=bulkAssetIds(input.assetIds);
 if(batch.closed_at)fail('Batch '+batch.name+' is closed. Reopen it before changing a machine answer.',409);
 const {rows}=await client.query('DELETE FROM mis_batch_machine_answers WHERE batch_id=$1 AND asset_id=ANY($2::bigint[]) RETURNING asset_id::text AS "assetId"',[batch.id,ids]);
 return {cleared:rows.length,assetIds:rows.map(row=>row.assetId)};
}

export async function clearMachineAnswer(client,batch,assetId){
 if(batch.closed_at)fail('Batch '+batch.name+' is closed. Reopen it before changing a machine answer.',409);
 const {rowCount}=await client.query('DELETE FROM mis_batch_machine_answers WHERE batch_id=$1 AND asset_id=$2',[batch.id,assetId]);
 return {cleared:rowCount>0};
}

export {IDLE_REASONS,HAND_ANSWERS};
