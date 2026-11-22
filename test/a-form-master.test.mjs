// Owner, 23 Nov 2026: A Form Master links an A Form no., a CMLL id and a site. HR's Excel fills it.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {A_FORM_MASTER,aFormKeys,cardAFormKeys,readAFormSheet,planAFormMaster,sharedAFormNumbers,aFormLine} from '../shared/a-form-master.mjs';
import {misPageAllowed,misRequestAllowed} from '../shared/mis-application-access.mjs';
import {requestedMisPage,misPageUrl} from '../src/mis-navigation.mjs';

const HEAD=['Serial No','EMPLOYEE ID','A FORM','SITE / OFFICE'];
const sheet=(...lines)=>[HEAD,...lines.map((line,index)=>[index+1,...line])];
const FILE=sheet(['CMLL91001',467,'Dhoptala OB 2nd'],['CMLL91002','','Dhoptala OB 2nd'],['CMLL91003','463/478','Dhoptala OB 2nd'],['CMLL91004','D68','Jayant OB'],['CMLL 91005',1769,'Jayant OB'],['91006','0292','Dudhichua OB East']);

test('an A Form no. is compared without spaces, punctuation or leading zeros; one cell can hold two numbers',()=>{
 assert.deepEqual(aFormKeys(467),['467']);
 assert.deepEqual(aFormKeys(' 0467 '),['467']);
 assert.deepEqual(aFormKeys('463/478'),['463','478']);
 assert.deepEqual(aFormKeys('192 & 278'),['192','278']);
 assert.deepEqual(aFormKeys('D01'),['D1']);assert.deepEqual(aFormKeys('d-68'),['D68']);
 // A cell without a digit is not a number ("A" was typed for two people at Dhoptala).
 assert.deepEqual(aFormKeys('A'),[]);assert.deepEqual(aFormKeys(''),[]);assert.deepEqual(aFormKeys(null),[]);
 // The FORM A box of a card: "A63" is A Form no. 63, and stays readable as written too.
 assert.deepEqual(cardAFormKeys('A63'),['A63','63']);assert.deepEqual(cardAFormKeys('A-63'),['A63','63']);
 assert.deepEqual(cardAFormKeys('63'),['63']);assert.deepEqual(cardAFormKeys('D68'),['D68']);
});

test("HR's A Form Excel is read with its own headings and site names; a line without an A Form no. is kept",()=>{
 const read=readAFormSheet(FILE);
 assert.equal(read.lines,6);assert.equal(read.problems.length,0);
 assert.deepEqual(read.records.map(r=>[r.employeeId,r.aFormNo,r.siteName,r.keys.join('+')]),[
  ['CMLL91001','467','Dhoptala OC (2nd)','467'],['CMLL91002','','Dhoptala OC (2nd)',''],['CMLL91003','463/478','Dhoptala OC (2nd)','463+478'],
  ['CMLL91004','D68','Jayant OC','D68'],['CMLL91005','1769','Jayant OC','1769'],['CMLL91006','0292','Dudhichua East OC','292']]);
 // Title rows above the headings are skipped.
 assert.equal(readAFormSheet([['ALL SITE A FORM'],[],...FILE]).records.length,6);
 assert.throws(()=>readAFormSheet([['Serial No','NAME'],[1,'RAM']]),/EMPLOYEE ID, A FORM and SITE \/ OFFICE/);
});

test('a line that cannot be placed is left out and listed; the same CMLL id at two sites is two lines',()=>{
 const read=readAFormSheet(sheet(['LEFT',5,'Majri OB'],['CMLL100',6,'Head Office Nagpur'],['CMLL200',7,'Majri OB'],['CMLL200',8,'Majri OB'],['CMLL200',9,'Sasti OB']));
 assert.deepEqual(read.problems.map(p=>[p.line,p.employeeId,p.problem]),[[2,'LEFT','No usable Employee ID. Write the CMLL number.'],[3,'CMLL100','Site is not one of the Pulse-II sites.'],[5,'CMLL200','CMLL200 is on two lines for this site. The first line is kept.']]);
 assert.deepEqual(read.records.map(r=>[r.employeeId,r.aFormNo,r.siteName]),[['CMLL200','7','Majri OC'],['CMLL200','9','Sasti OC']]);
});

test('an A Form no. written against two people of one site is reported; the same number at two sites is normal',()=>{
 const {records}=readAFormSheet(sheet(['CMLL1',473,'Dhoptala OB 2nd'],['CMLL2',473,'Dhoptala OB 2nd'],['CMLL3',473,'Majri OB'],['CMLL4','A','Dhoptala OB 2nd'],['CMLL5','A','Dhoptala OB 2nd']));
 assert.deepEqual(sharedAFormNumbers(records),[{site:'Dhoptala OC (2nd)',aFormNo:'473',employeeIds:['CMLL1','CMLL2']}]);
});

test('the file replaces the lines of the sites it names and leaves every other site as it is',()=>{
 const held=(id,aFormNo,number,site)=>({id:String(id),record_data:{aFormNo,employeeId:'CMLL'+number,site}});
 const existing=[held(1,'467',91001,'Dhoptala OC (2nd)'),held(2,'11',91002,'Dhoptala OC (2nd)'),held(3,'9',99999,'Dhoptala OC (2nd)'),held(4,'55',7000,'Majri OC')];
 const {records}=readAFormSheet(FILE);
 const employees=[{number:'91001',siteKey:records[0].siteKey,listed:true},{number:'91004',siteKey:records[0].siteKey,listed:true},{number:'91005',siteKey:records[3].siteKey,listed:false}];
 const plan=planAFormMaster(existing,records,{now:'2026-11-23T00:00:00.000Z',fileName:'A FORM NO.xlsx',employees});
 assert.deepEqual(plan.updates.map(u=>[u.id,u.data.aFormNo]),[['2','']],'CMLL91002 has no A Form no. in the file now');
 assert.deepEqual(plan.deleteIds,['3'],'not in the file any more, at a site the file names');
 assert.equal(plan.inserts.length,4);
 assert.deepEqual(plan.inserts[0],{aFormNo:'463/478',employeeId:'CMLL91003',site:'Dhoptala OC (2nd)',siteAsWritten:'Dhoptala OB 2nd',importedAt:'2026-11-23T00:00:00.000Z',importFile:'A FORM NO.xlsx'});
 assert.deepEqual(plan.summary.sites.map(s=>[s.site,s.lines,s.withForm,s.added,s.changed,s.removed,s.unchanged]),[['Dhoptala OC (2nd)',3,2,1,1,1,1],['Dudhichua East OC',1,1,1,0,0,0],['Jayant OC',2,2,2,0,0,0]]);
 assert.deepEqual([plan.summary.lines,plan.summary.withForm,plan.summary.added,plan.summary.changed,plan.summary.removed,plan.summary.unchanged],[6,5,4,1,1,1]);
 // Majri is not in the file: its line stays. Three people are not on the Employee Master list, one is at another site there.
 assert.ok(!plan.deleteIds.includes('4'));
 assert.deepEqual([plan.summary.otherSite,plan.summary.notInEmployeeMaster],[1,4]);
 // The same file again changes nothing.
 const again=planAFormMaster([...existing.filter(r=>r.id!=='3').map(r=>r.id==='2'?held(2,'',91002,'Dhoptala OC (2nd)'):r),...plan.inserts.map((data,i)=>({id:String(10+i),record_data:data}))],records);
 assert.deepEqual([again.inserts.length,again.updates.length,again.deleteIds.length,again.summary.unchanged],[0,0,0,6]);
});

test('one line typed on the page needs a CMLL id, one of our sites and an A Form no.',()=>{
 assert.deepEqual(aFormLine({aFormNo:' 467 ',employeeId:'cmll91001',site:'Dhoptala OB 2nd'}).data,{aFormNo:'467',employeeId:'CMLL91001',site:'Dhoptala OC (2nd)'});
 assert.throws(()=>aFormLine({aFormNo:'467',employeeId:'RAM',site:'Majri OC'}),/CMLL id/);
 assert.throws(()=>aFormLine({aFormNo:'467',employeeId:'CMLL1',site:'Nagpur'}),/Choose the site/);
 assert.throws(()=>aFormLine({aFormNo:'A',employeeId:'CMLL1',site:'Majri OC'}),/A Form no\./);
});

test('A Form Master is a page of the Masters menu and follows the Employee master right',()=>{
 const session=pages=>({permissions:{separateMisCredentials:true,misDesktopAccess:pages,misMobileAccess:[]}});
 assert.equal(misPageAllowed(session(['Employee master']),'A Form Master','desktop'),true);
 assert.equal(misPageAllowed(session(['Reports']),'A Form Master','desktop'),false);
 assert.equal(misRequestAllowed(session(['Employee master']),{path:'/api/employee-master/a-form',method:'GET'}),true);
 assert.equal(misRequestAllowed(session(['Reports']),{path:'/api/employee-master/a-form/apply',method:'POST'}),false);
 assert.equal(requestedMisPage('?page=a-form-master'),'A Form Master');
 assert.match(misPageUrl('https://pulse-ll.cmll.in/','A Form Master'),/\?page=a-form-master$/);
 const main=fs.readFileSync(new URL('../src/main.jsx',import.meta.url),'utf8');
 assert.match(main,/\['Users & employees','Employee master','A Form Master','Employee Current Location'/);
 assert.match(main,/renderedActive==='A Form Master' \? \(<AFormMaster session=\{session\}\/>\)/);
 assert.match(main,/if\(name==='A Form Master'\)return canOpenAdminPage\('Employee master'\);/);
});

test('the A Form Excel is previewed, applied, listed with the Employee Master name, and one line is corrected and removed',async t=>{
 const [{PGlite},{default:express},{createServer}]=await Promise.all([import('@electric-sql/pglite'),import('express'),import('node:http')]);
 const {registerAFormMaster}=await import('../server/routes/a-form-master.mjs');
 const db=new PGlite();t.after(()=>db.close());
 await db.exec('CREATE TABLE master_records(id BIGSERIAL PRIMARY KEY,master_name TEXT,record_data JSONB)');
 const employee=(number,name,site,designation)=>db.query("INSERT INTO master_records(master_name,record_data) VALUES('Employee master',$1)",[JSON.stringify({caliberId:'CMPL'+number,employeeId:'CMPL'+number,name,site,currentDesignationName:designation})]);
 await employee(91001,'RAM','Dhoptala OC (2nd)','VOLVO DRIVER');await employee(91003,'SHYAM','Dhoptala OC (2nd)','TIPPER DRIVER');await employee(91004,'ANIL','Majri OC','PC OPERATOR');
 const query=(sql,args)=>sql.includes('pg_advisory_xact_lock')?Promise.resolve({rows:[]}):db.query(sql,args);
 const pool={query,connect:async()=>({query,release(){}})};
 const app=express();app.use(express.json({limit:'5mb'}));
 const audits=[];
 app.use((req,res,next)=>{res.on('finish',()=>{if(req.audit)audits.push(req.audit.action);});next();});
 registerAFormMaster(app,{pool,requireSession:(q,s,n)=>{q.session={login:'tester'};n();},requireAdministrator:(q,s,n)=>n()});
 app.use((error,_req,res,_next)=>res.status(500).json({error:error.message}));
 const server=createServer(app);await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>{server.close(r);server.closeAllConnections();}));
 const call=async(path,body,method)=>{const r=await fetch('http://127.0.0.1:'+server.address().port+'/api/employee-master/a-form'+path,{method:method||(body?'POST':'GET'),headers:{'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});return {status:r.status,body:await r.json()};};
 const stored=async()=>(await db.query('SELECT record_data FROM master_records WHERE master_name=$1 ORDER BY id',[A_FORM_MASTER])).rows.map(r=>r.record_data);

 const preview=await call('/preview',{rows:FILE,fileName:'A FORM NO.xlsx'});
 assert.equal(preview.status,200);assert.equal(preview.body.summary.added,6);
 assert.deepEqual([preview.body.summary.otherSite,preview.body.summary.notInEmployeeMaster],[1,3],'CMLL91004 is at Majri in Employee Master; three are not on its list');
 assert.equal((await stored()).length,0,'the preview writes nothing');
 assert.equal((await call('/apply',{rows:FILE,fileName:'A FORM NO.xlsx',planKey:'stale'})).status,409);
 const applied=await call('/apply',{rows:FILE,fileName:'A FORM NO.xlsx',planKey:preview.body.planKey});
 assert.equal(applied.status,200);assert.equal(applied.body.summary.added,6);assert.equal((await stored()).length,6);

 const list=await call('?site='+encodeURIComponent('Dhoptala OC (2nd)'));
 assert.deepEqual(list.body.lines.map(l=>[l.aFormNo,l.employeeId,l.site,l.name,l.state]),[['467','CMLL91001','Dhoptala OC (2nd)','RAM','Linked'],['','CMLL91002','Dhoptala OC (2nd)','','Not in Employee Master'],['463/478','CMLL91003','Dhoptala OC (2nd)','SHYAM','Linked']]);
 assert.deepEqual(list.body.counts,{lines:6,withForm:5,linked:2,noForm:0,toCheck:4});
 assert.deepEqual((await call('?q=d68')).body.lines.map(l=>[l.employeeId,l.state]),[['CMLL91004','Employee Master holds Majri OC']]);
 assert.equal((await call('?only=check')).body.total,4);

 // The A Form no. of a line is corrected, a new line is typed, and a line is removed.
 assert.deepEqual((await call('/line',{aFormNo:'468',employeeId:'CMLL91001',site:'Dhoptala OB 2nd'})).body,{saved:true,changed:true});
 assert.deepEqual((await call('/line',{aFormNo:'12',employeeId:'CMLL91004',site:'Majri OC'})).body,{saved:true,changed:false});
 assert.equal((await call('/line',{aFormNo:'',employeeId:'CMLL1',site:'Majri OC'})).status,400);
 const majri=(await call('?site=Majri%20OC')).body.lines;
 assert.deepEqual(majri.map(l=>[l.aFormNo,l.employeeId,l.name,l.state]),[['12','CMLL91004','ANIL','Linked']]);
 assert.equal((await call('/line/'+majri[0].id,null,'DELETE')).body.removed,true);
 assert.equal((await call('/line/'+majri[0].id,null,'DELETE')).status,404);
 assert.equal((await stored()).find(r=>r.employeeId==='CMLL91001').aFormNo,'468');
 assert.deepEqual(audits,['Apply A Form Excel','Change A Form line','Add A Form line','Remove A Form line']);

 // The same file again: the corrected line goes back to the file's number, nothing else moves.
 const second=await call('/preview',{rows:FILE,fileName:'A FORM NO.xlsx'});
 assert.deepEqual([second.body.summary.added,second.body.summary.changed,second.body.summary.removed,second.body.summary.unchanged],[0,1,0,5]);
 // A file with no usable line is refused.
 assert.equal((await call('/preview',{rows:sheet(['LEFT',5,'Majri OB'])})).status,422);
});
