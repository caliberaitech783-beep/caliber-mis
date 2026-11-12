import {canonicalSiteName} from '../../shared/site-location.mjs';
import {batchStage} from './vlb-two-stage.mjs';

const stageOrder=['vlb_open','lmv_open','elb_open'];
const stageNames=['VLB','LMV','ELB'];
const active=batch=>!batch.closed_at&&!batch.archived_at&&!batch.deleted_at;

// Rows arrive in creation order. The oldest unfinished batch at each stage
// tells later batches when they can start that stage.
export function batchStageWaits(rows){
 const sites=new Map(),waits=new Map();
 for(const batch of rows){
  if(!active(batch))continue;
  const site=canonicalSiteName(batch.site),stage=stageOrder.indexOf(batchStage(batch));
  const pending=sites.get(site)||[];
  if(pending[stage])waits.set(batch.id,(stage===2?'Close ':'Lock ')+stageNames[stage]+' in '+pending[stage].name+' first.');
  for(let index=stage;index<stageOrder.length;index++)pending[index]??=batch;
  sites.set(site,pending);
 }
 return waits;
}

export async function readBatchStageWait(client,batch){
 if(!active(batch)||batchStage(batch)==='vlb_open')return '';
 const {rows}=await client.query(`
  SELECT older.id,older.name,older.site,older.stage
  FROM mis_vlb_batches older JOIN mis_vlb_batches current ON current.id=$1
  WHERE (older.created_at,older.id)<(current.created_at,current.id)
    AND older.book_date>=$$2026-11-01$$ AND older.closed_at IS NULL
    AND older.archived_at IS NULL AND older.deleted_at IS NULL
  ORDER BY older.created_at,older.id`,[batch.id]);
 return batchStageWaits([...rows,batch]).get(batch.id)||'';
}
