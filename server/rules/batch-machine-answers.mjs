// The answer of a VLB or LMV machine that has no card in a batch (owner, 25 Nov 2026): its breakdown /
// maintenance read from Pulse-1, or an idle reason. One answer per batch and machine. A card saved later
// for the machine wins over it (shared/batch-fleet-coverage.mjs); nothing here writes a card.
import {ANSWER_BOOKS,IDLE_REASONS,idleAnswerIssue,pulseAnswerStatus,answerMachineIssue} from '../../shared/batch-fleet-coverage.mjs';

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

// pulse: what readBatchShiftBreakdowns returned for the machine. No breakdown in Pulse-1 saves nothing.
export async function savePulseAnswer(client,batch,assetId,book,pulse,actor){
 await checkMachine(client,batch,assetId,book);
 const status=pulseAnswerStatus(pulse?.breakdownHours,pulse?.shiftHours);
 if(!status)return {saved:false,assetId:String(assetId),breakdownHours:Number(pulse?.breakdownHours)||0,shiftHours:pulse?.shiftHours,
  message:'Pulse-1 shows no breakdown or maintenance for this machine in this shift. Add its card, or choose an idle reason.'};
 const breakdowns=(pulse.breakdowns||[]).slice(0,20).map(item=>({reference:text(item.reference),description:text(item.description).slice(0,300),hours:item.hours??item.breakdownHours??null}));
 const reason=breakdowns.map(item=>item.description||item.reference).filter(Boolean).join('; ').slice(0,500)||'Breakdown recorded in Pulse-1';
 const saved=await writeAnswer(client,batch,assetId,{book,status,reason,breakdownHours:Number(pulse.breakdownHours),shiftHours:Number(pulse.shiftHours),pulse:{breakdowns}},actor);
 return {saved:true,...saved,message:status==='pulse'?'Breakdown for the whole shift in Pulse-1: answered.':'Pulse-1 shows a part-shift breakdown ('+pulse.breakdownHours+' of '+pulse.shiftHours+' h), so the machine also worked: add its card.'};
}

export async function clearMachineAnswer(client,batch,assetId){
 if(batch.closed_at)fail('Batch '+batch.name+' is closed. Reopen it before changing a machine answer.',409);
 const {rowCount}=await client.query('DELETE FROM mis_batch_machine_answers WHERE batch_id=$1 AND asset_id=$2',[batch.id,assetId]);
 return {cleared:rowCount>0};
}

export {IDLE_REASONS};
