import {readFile} from 'node:fs/promises';
import path from 'node:path';
import pg from 'pg';
const state=path.join(process.env.LOCALAPPDATA,'CaliberERP');
const config=JSON.parse(await readFile(path.join(state,'database.json'),'utf8'));
const client=new pg.Client({host:'127.0.0.1',port:config.port,user:config.user,password:config.password,database:config.database});
await client.connect();
try{
 const result=await client.query("SELECT master_name,COUNT(*)::int AS records FROM master_records WHERE master_name IN ('Users & employees','Privilege master') GROUP BY master_name");
 const settings=await client.query('SELECT COUNT(*)::int AS count FROM app_settings');
 console.log(JSON.stringify({masters:result.rows,settings:settings.rows[0].count}));
}finally{await client.end();}
