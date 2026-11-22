// The employee lists and A Form Master put together (shared/a-form-people.mjs), worked out once per change of
// the master lists, for the A Form Master page and the biometric upload.
// The lists come from the copy the scan already keeps in memory (scan-master-cache.mjs). SCAN_MASTER_NAMES is
// the one list of master names card matching reads, so the 44 MB Employee master is not held a second time.
// Only the small index built from it is held here.
// Use it with a connection that is not inside a transaction that writes masters, like the shared copy itself.
import {readScanMasters} from './scan-master-cache.mjs';
import {buildAFormPeople} from '../../shared/a-form-people.mjs';
import {A_FORM_MASTER} from '../../shared/a-form-master.mjs';

export const SCAN_MASTER_NAMES=['Equipment master','C-Dir Employee master','ERP Employee master','Employee master','Shift Master','Work Order master',A_FORM_MASTER];
const REVISION_SQL="SELECT revision FROM data_revisions WHERE revision_key='master-data'";

export function createAFormPeopleReader(names=SCAN_MASTER_NAMES,readMasters=readScanMasters){
 let held=null;
 return async function readAFormPeople(client){
  let revision=null;
  try{revision=(await client.query(REVISION_SQL)).rows[0]?.revision??null;}catch{revision=null;}
  const stamp=revision===null?null:String(revision);
  if(stamp!==null&&held?.stamp===stamp)return held.people;
  const people=buildAFormPeople((await readMasters(client,names)).rows);
  // Without a revision (older databases, tests) there is nothing to hold a copy against.
  held=stamp===null?null:{stamp,people};
  return people;
 };
}

export const readAFormPeople=createAFormPeopleReader();
