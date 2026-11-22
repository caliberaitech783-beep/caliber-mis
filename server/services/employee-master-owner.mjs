// Who maintains Employee Master. Until HR's master is applied it is a copy of the ERP; from then on HR's
// Excel, imported in Pulse-II, is the master and the ERP copy must not write to it (shared/hr-employee-master.mjs).
import {EMPLOYEE_MASTER_OWNER_KEY,HR_MASTER_OWNER} from '../../shared/hr-employee-master.mjs';

const OWNER_SQL='SELECT setting_value FROM app_settings WHERE setting_key=$1';
export const OWNER_SAVE_SQL='INSERT INTO app_settings(setting_key,setting_value,updated_at) VALUES($1,$2::jsonb,NOW()) ON CONFLICT(setting_key) DO UPDATE SET setting_value=EXCLUDED.setting_value,updated_at=NOW()';

// The saved note ({owner, since, lastImportAt, by, fileName, lines}) when HR's master is the owner, else null.
// A database without the settings table has never had HR's master applied.
export async function employeeMasterOwner(db){
 try{
  const value=(await db.query(OWNER_SQL,[EMPLOYEE_MASTER_OWNER_KEY])).rows[0]?.setting_value;
  return value?.owner===HR_MASTER_OWNER?value:null;
 }catch{return null;}
}
