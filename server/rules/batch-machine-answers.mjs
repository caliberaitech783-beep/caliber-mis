// The answer by hand of a VLB or LMV machine that has no card in a batch and nothing in Pulse-1 (owner, 25 Nov 2026):
// an idle reason. (Answers saved as 'pulse' by an earlier version still count.) One answer per batch and machine. A card saved later
// for the machine wins over it (shared/batch-fleet-coverage.mjs); nothing here writes a card.
import {ANSWER_BOOKS,IDLE_REASONS,idleAnswerIssue,answerMachineIssue} from '../../shared/batch-fleet-coverage.mjs';

export const BATCH_MACHINE_ANSWER_SCHEMA=`
 CREATE TABLE IF NOT EXISTS mis_batch_machine_answers(
  batch_id UUID NOT NULL REFERENCES mis_vlb_batches(id) ON DELETE CASCADE,asset_id BIGINT NOT NULL,book TEXT NOT NULL CHECK(book IN ('vlb','lmv')),
  status TEXT NOT NULL,reason TEXT NOT NULL DEFAULT '',breakdown_hours NUMERIC,shift_hours NUMERIC,pulse JSONB,
  saved_by TEXT NOT NULL,saved_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),PRIMARY KEY(batch_id,asset_id));
`;

const fail=(message,status=400)=>{throw Object.assign(new Error(message),{status});};
const text=value=>String(value??'').trim();

export async function readBatchMachineAnswers(client,batch){
 const {rows}=await client.query(`SELECT asset_id::text AS "assetId",book,status,reason,breakdown_hours::float8 AS "breakdownHours",shift_hours::float8 AS "shiftHours",
  pulse,saved_by AS "savedBy",saved_at AS "savedAt" FROM mis_batch_machine_answers WHERE batch_id=$1`,[batch.id]);
 return rows;
}

async function checkMachine(client,batch,assetId,book){
 if(batch.closed_at)fail('Batch '+batch.name+' is closed. Reopen it before changing a machine answer.',409);
 if(!ANSWER_BOOKS.includes(book))fail('Only a VLB or LMV machine takes an answer here.',400);
 const asset=(await client.query("SELECT record_data FROM master_records WHERE master_name='Equipment master' AND id=$1",[assetId])).rows[0]?.record_data;
 const issue=answerMachineIssue(asset,{site:batch.site,book});
 if(issue)fail(issue,409);
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

export async function clearMachineAnswer(client,batch,assetId){
 if(batch.closed_at)fail('Batch '+batch.name+' is closed. Reopen it before changing a machine answer.',409);
 const {rowCount}=await client.query('DELETE FROM mis_batch_machine_answers WHERE batch_id=$1 AND asset_id=$2',[batch.id,assetId]);
 return {cleared:rowCount>0};
}

export {IDLE_REASONS};
