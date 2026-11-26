// A batch's machine muster (owner, 25 Nov 2026).
// - The muster: the VLB, ELB and LMV machines the Equipment Master put at the site when the batch was made, kept with
//   the batch (mis_batch_machine_roster), so a change to the master during the shift does not change what has to be
//   answered. A batch made before this is frozen at its first read while it is open.
// - The answer by hand of a VLB or LMV machine that has no card and nothing in Pulse-1: an idle reason, for one machine or
//   many at once. (Answers saved as 'pulse' by an earlier version still count.) One answer per batch and machine. A card
//   saved later for the machine wins over it (shared/batch-fleet-coverage.mjs); nothing here writes a card.
import {ANSWER_BOOKS,IDLE_REASONS,idleAnswerIssue,answerMachineIssue} from '../../shared/batch-fleet-coverage.mjs';

export const BATCH_MACHINE_ANSWER_SCHEMA=`
 CREATE TABLE IF NOT EXISTS mis_batch_machine_answers(
  batch_id UUID NOT NULL REFERENCES mis_vlb_batches(id) ON DELETE CASCADE,asset_id BIGINT NOT NULL,book TEXT NOT NULL CHECK(book IN ('vlb','lmv')),
  status TEXT NOT NULL,reason TEXT NOT NULL DEFAULT '',breakdown_hours NUMERIC,shift_hours NUMERIC,pulse JSONB,
  saved_by TEXT NOT NULL,saved_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),PRIMARY KEY(batch_id,asset_id));
 CREATE TABLE IF NOT EXISTS mis_batch_machine_roster(
  batch_id UUID NOT NULL REFERENCES mis_vlb_batches(id) ON DELETE CASCADE,asset_id BIGINT NOT NULL,book TEXT NOT NULL CHECK(book IN ('vlb','elb','lmv')),
  door TEXT NOT NULL DEFAULT '',name TEXT NOT NULL DEFAULT '',frozen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),PRIMARY KEY(batch_id,asset_id));
`;
export const MAX_BULK_ANSWERS=500;
const BOOK_OF={vehicle:'vlb',equipment:'elb',lmv:'lmv'},KIND_OF={vlb:'vehicle',elb:'equipment',lmv:'lmv'};

const fail=(message,status=400)=>{throw Object.assign(new Error(message),{status});};
const text=value=>String(value??'').trim();

// The frozen muster as {vehicle,equipment,lmv} lists of {assetId,door,name}, or null when the batch has none yet.
export async function readBatchRoster(client,batch){
 const {rows}=await client.query('SELECT asset_id::text AS "assetId",book,door,name FROM mis_batch_machine_roster WHERE batch_id=$1 ORDER BY door,asset_id',[batch.id]);
 if(!rows.length)return null;
 const roster={vehicle:[],equipment:[],lmv:[]};
 for(const row of rows)roster[KIND_OF[row.book]]?.push({assetId:row.assetId,door:row.door,name:row.name});
 return roster;
}
// Keeps the site's machines of this moment with the batch; a machine already kept is left as it is.
export async function freezeBatchRoster(client,batch,roster){
 const lines=Object.entries(roster||{}).flatMap(([kind,list])=>(list||[]).map(machine=>({assetId:machine.assetId,book:BOOK_OF[kind],door:machine.door||'',name:machine.name||''}))).filter(line=>line.book&&/^\d+$/.test(String(line.assetId)));
 if(!lines.length)return 0;
 const {rowCount}=await client.query(`INSERT INTO mis_batch_machine_roster(batch_id,asset_id,book,door,name)
  SELECT $1,(r->>'assetId')::bigint,r->>'book',r->>'door',r->>'name' FROM jsonb_array_elements($2::jsonb) r ON CONFLICT(batch_id,asset_id) DO NOTHING`,[batch.id,JSON.stringify(lines)]);
 return rowCount;
}

export async function readBatchMachineAnswers(client,batch){
 const {rows}=await client.query(`SELECT asset_id::text AS "assetId",book,status,reason,breakdown_hours::float8 AS "breakdownHours",shift_hours::float8 AS "shiftHours",
  pulse,saved_by AS "savedBy",saved_at AS "savedAt" FROM mis_batch_machine_answers WHERE batch_id=$1`,[batch.id]);
 return rows;
}

// A machine of the batch's frozen muster in this book may be answered, wherever the master puts it now; a batch with no
// frozen muster answers the machines the master puts at the site in this book.
async function machineIssues(client,batch,assetIds,book){
 if(batch.closed_at)fail('Batch '+batch.name+' is closed. Reopen it before changing a machine answer.',409);
 if(!ANSWER_BOOKS.includes(book))fail('Only a VLB or LMV machine takes an answer here.',400);
 const ids=[...new Set(assetIds.map(String))];
 if(ids.some(id=>!/^\d+$/.test(id)))fail('Invalid machine.',400);
 const kept=new Map((await client.query('SELECT asset_id::text AS id,book FROM mis_batch_machine_roster WHERE batch_id=$1 AND asset_id=ANY($2::bigint[])',[batch.id,ids])).rows.map(row=>[row.id,row.book]));
 const frozen=Number((await client.query('SELECT count(*)::int AS n FROM mis_batch_machine_roster WHERE batch_id=$1',[batch.id])).rows[0]?.n)>0;
 const assets=new Map((await client.query("SELECT id::text AS id,record_data FROM master_records WHERE master_name='Equipment master' AND id=ANY($1::bigint[])",[ids])).rows.map(row=>[row.id,row.record_data]));
 const issues=[];
 for(const id of ids){
  if(frozen){
   if(kept.get(id)===book)continue;
   const door=text(assets.get(id)?.door||assets.get(id)?.doorNo)||id;
   issues.push(door+': '+(kept.has(id)?'this machine is on the '+kept.get(id).toUpperCase()+' muster of this batch, not '+book.toUpperCase()+'.':'this machine is not on the muster of this batch.'));
   continue;
  }
  const issue=answerMachineIssue(assets.get(id),{site:batch.site,book});
  if(issue)issues.push((text(assets.get(id)?.door)||id)+': '+issue);
 }
 if(issues.length)fail(issues.slice(0,10).join(' ')+(issues.length>10?' and '+(issues.length-10)+' more.':''),409);
 return ids;
}

async function writeAnswers(client,batch,ids,answer,actor){
 const {rows}=await client.query(`INSERT INTO mis_batch_machine_answers(batch_id,asset_id,book,status,reason,saved_by)
  SELECT $1,id,$3,$4,$5,$6 FROM unnest($2::bigint[]) id
  ON CONFLICT(batch_id,asset_id) DO UPDATE SET book=EXCLUDED.book,status=EXCLUDED.status,reason=EXCLUDED.reason,breakdown_hours=NULL,
   shift_hours=NULL,pulse=NULL,saved_by=EXCLUDED.saved_by,saved_at=NOW()
  RETURNING asset_id::text AS "assetId",book,status,reason`,[batch.id,ids,answer.book,answer.status,answer.reason,actor]);
 return rows;
}

function readIdle(input){
 const answer={book:text(input.book),status:text(input.status),reason:text(input.reason)};
 const issue=idleAnswerIssue(answer);
 if(issue)fail(issue,400);
 return answer;
}

export async function saveIdleAnswer(client,batch,assetId,input={},actor){
 const answer=readIdle(input);
 const ids=await machineIssues(client,batch,[assetId],answer.book);
 return (await writeAnswers(client,batch,ids,answer,actor))[0];
}

// One idle reason for many machines of one book, all or none.
export async function saveIdleAnswers(client,batch,input={},actor){
 const answer=readIdle(input);
 const assetIds=Array.isArray(input.assetIds)?input.assetIds:[];
 if(!assetIds.length)fail('Choose the machines to save this reason for.',400);
 if(assetIds.length>MAX_BULK_ANSWERS)fail('Save at most '+MAX_BULK_ANSWERS+' machines at once.',400);
 const ids=await machineIssues(client,batch,assetIds,answer.book);
 const saved=await writeAnswers(client,batch,ids,answer,actor);
 return {saved:saved.length,book:answer.book,status:answer.status,reason:answer.reason,assetIds:saved.map(row=>row.assetId)};
}

export async function clearMachineAnswer(client,batch,assetId){
 if(batch.closed_at)fail('Batch '+batch.name+' is closed. Reopen it before changing a machine answer.',409);
 const {rowCount}=await client.query('DELETE FROM mis_batch_machine_answers WHERE batch_id=$1 AND asset_id=$2',[batch.id,assetId]);
 return {cleared:rowCount>0};
}

export {IDLE_REASONS};
