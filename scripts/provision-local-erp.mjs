// Explicit, one-time setup for the independent ERP database only.
import {readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {randomBytes} from 'node:crypto';
import pg from 'pg';
import {hashPassword} from '../password-auth.mjs';
const state=path.join(process.env.LOCALAPPDATA,'CaliberERP');
const config=JSON.parse(await readFile(path.join(state,'database.json'),'utf8'));
if(config.database!=='caliber_erp'||config.port!==55432)throw new Error('Expected independent ERP database.');
const client=new pg.Client({host:'127.0.0.1',port:config.port,user:config.user,password:config.password,database:config.database});
await client.connect();
try{
 const count=await client.query("SELECT COUNT(*)::int AS count FROM master_records WHERE master_name='Users & employees'");
 if(count.rows[0].count)throw new Error('Users already exist; provisioning will not replace existing accounts.');
 const password=randomBytes(18).toString('base64url');
 const user={login:'erp-admin',employee:'ERP Local Administrator',userType:'Super User',adminLevel:'Super Admin',phone:'',mail:'',passwordHash:hashPassword(password),mustChangePassword:false,site:'',location:''};
 await client.query("INSERT INTO master_records(master_name,record_data) VALUES('Users & employees',$1::jsonb)",[JSON.stringify(user)]);
 await writeFile(path.join(state,'local-login.txt'),`CALIBER ERP — local account only\n\nURL: http://127.0.0.1:4174/\nUser name: erp-admin\nPassword: ${password}\n\nThis is a new local administrator, not a copied Pulse account.\n`,{mode:0o600});
 console.log('Created ERP local administrator. Login details saved privately in CaliberERP/local-login.txt under Local AppData.');
}finally{await client.end();}
