import {readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import pg from 'pg';
const config=JSON.parse(await readFile(path.join(process.env.LOCALAPPDATA,'CaliberERP','database.json'),'utf8'));
if(config.database!=='caliber_erp'||config.port!==55432)throw new Error('Expected isolated ERP database.');
const keys=JSON.parse(await readFile('.local/logbook-smoke-keys.json','utf8'));
if(!keys.marker.startsWith('Nexus form verification ')||keys.bookNumbers.length!==2)throw new Error('Invalid test-entry keys.');
const client=new pg.Client({host:'127.0.0.1',port:config.port,user:config.user,password:config.password,database:config.database});await client.connect();
try{
 await client.query('BEGIN');
 const rows=(await client.query('SELECT book_no,book_type,revision,data FROM mis_log_books WHERE book_no=ANY($1::text[]) AND data->>\'remark\'=$2 FOR UPDATE',[keys.bookNumbers,keys.marker])).rows;
 if(rows.length!==2)throw new Error('Expected exactly the two temporary verification entries.');
 const vehicle=rows.find(row=>row.book_type==='vehicle'),equipment=rows.find(row=>row.book_type==='equipment');
 if(vehicle?.revision!==2||vehicle.data.totalRunningKmr!==90||vehicle.data.trips[0]?.gapMinutes!==20||equipment?.data.totalWorkingHmr!==7)throw new Error('Browser persistence verification failed.');
 const result=await client.query('DELETE FROM mis_log_books WHERE book_no=ANY($1::text[]) AND data->>\'remark\'=$2',[keys.bookNumbers,keys.marker]);
 await client.query('COMMIT');
 const report={verifiedAt:new Date().toISOString(),vehicleSave:true,vehicleEdit:true,equipmentSave:true,overnightTripGapMinutes:20,temporaryEntriesRemoved:result.rowCount};
 await writeFile('.local/logbook-browser-verification.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}catch(error){await client.query('ROLLBACK');throw error;}finally{await client.end();}
