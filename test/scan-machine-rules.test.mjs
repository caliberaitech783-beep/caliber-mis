import test from 'node:test';
import assert from 'node:assert/strict';
import {identifyCardMachine,cardMachineKey,matchCardMachine,normalizeScanEquipmentRows,scanEquipmentMatchIssues,scannedEquipmentName,compactScanEquipmentReferences} from '../scan-machine-rules.mjs';
import {linkedScanEquipment} from '../scan-fleet-door.mjs';
import {extractCard} from '../scan-extraction.mjs';
import {manualScanIssues} from '../src/scan-manual-fields.mjs';

const site='Jayant OC';
const machine=(id,door,kind='equipment',location=site)=>({id,door,kind,site:location});
const master=row=>({id:Number(row.id),master_name:'Equipment master',record_data:{door:row.door,category:row.kind,site:row.site}});

test('Trip Card headers accept single letters and full vehicle names and preserve written numbers',()=>{
 for(const [inputs,code,label]of [[['v','Volvo'],'V','Volvo'],[['E','eicher'],'E','Eicher'],[['s','Scania'],'S','Scania'],[['H','Haulpak','Haulpak Dumper'],'H','Haulpak Dumper']])for(const input of inputs){
  const result=identifyCardMachine(input+' / 025','vehicle');assert.equal(result.code,code);assert.equal(result.label,label);assert.equal(result.number,'025');assert.equal(result.original,input+' / 025');
 }
 assert.equal(identifyCardMachine('Hydra 25','vehicle'),null);
 assert.equal(identifyCardMachine('VPC 25','vehicle'),null);
});

test('body and Job Card equipment accept single/multiple letters and full type names',()=>{
 for(const [inputs,code]of [[['V','vpc','V P C','V.P.C.','Volvo'],'VPC'],[['T','TPC','Eicher'],'TPC'],[['S','SPC','Scania'],'SPC'],[['L','LPC','Haulpak'],'LPC'],[['D','Dozer'],'D'],[['G','Grader'],'G'],[['PL','Pay Loader','PayLoader','Pay-Loader'],'PL'],[['H','Hydra'],'H']])for(const input of inputs){
  assert.equal(identifyCardMachine(input+'/019','equipment').code,code,input);
  assert.equal(identifyCardMachine(input+'/019','equipment').number,'019',input);
 }
 assert.equal(identifyCardMachine('H12','vehicle').label,'Haulpak Dumper');
 assert.equal(identifyCardMachine('H12','equipment').label,'Hydra');
 assert.equal(identifyCardMachine('19','equipment'),null);
 assert.equal(identifyCardMachine('V O19','equipment'),null);
 assert.equal(identifyCardMachine('V I9','equipment'),null);
 assert.equal(identifyCardMachine('VPC','equipment').hasNumber,false);
 assert.equal(identifyCardMachine('vpc No. 019','equipment').canonical,'VPC019');
 assert.equal(identifyCardMachine('Volvo Number: 025','vehicle').canonical,'V025');
});

test('aliases link only one master record of the correct type and site; never infer a missing number or prefix',()=>{
 const rows=[machine('1','VPC19-07181'),machine('2','V19','vehicle'),machine('3','Volvo 19','equipment','Sasti OC'),machine('4','H12'),machine('5','Haulpak Dumper 12','vehicle')];
 assert.equal(matchCardMachine(rows,'v / 019',site,'equipment').match.id,'1');
 assert.equal(matchCardMachine(rows,'VPC19-07181',site,'equipment').match.id,'1');
 assert.equal(linkedScanEquipment(rows,'Volvo / 019',site,'vehicle').id,'2');
 assert.equal(linkedScanEquipment(rows,'H12',site,'equipment').id,'4');
 assert.equal(linkedScanEquipment(rows,'H12',site,'vehicle').id,'5');
 assert.equal(matchCardMachine(rows,'V19','Sasti OC','equipment').match.id,'3');
 assert.equal(matchCardMachine([...rows,machine('6','Vpc 019')],'V19',site,'equipment').status,'ambiguous');
 assert.equal(matchCardMachine(rows,'V',site,'equipment').status,'missing-number');
 assert.equal(matchCardMachine(rows,'19',site,'equipment').status,'missing-prefix');
 assert.equal(matchCardMachine(rows,'V99',site,'equipment').status,'not-found');
 assert.equal(cardMachineKey('VPC019-07181','equipment'),'VPC19');
 assert.equal(cardMachineKey('B075 - serial','equipment'),'B75');
 assert.equal(matchCardMachine([{...machine('7','D5'),name:'Hydra 12'}],'H12',site,'equipment').match,null);
});

test('new scan trip and summary aliases resolve to the same master labels without changing original input or existing drafts',()=>{
 const rows=[machine('1','VPC19'),machine('2','Pay Loader 05')];
 const input={machineNotationRuleVersion:1,location:site,trips:[{equipmentName:'v / 019',tripCount:2},{equipmentName:'PL5',tripCount:1}],scanMachineSummary:[{equipmentName:'V P C19',tripCount:2},{equipmentName:'Pay Loader 05',tripCount:1}]};
 const result=normalizeScanEquipmentRows(input,rows);
 assert.deepEqual(result.trips.map(r=>r.equipmentName),['VPC19','Pay Loader 05']);
 assert.deepEqual(result.scanMachineSummary.map(r=>r.equipmentName),['VPC19','Pay Loader 05']);
 assert.equal(input.trips[0].equipmentName,'v / 019');assert.deepEqual(scanEquipmentMatchIssues(result,rows),{});
 const existing={location:site,trips:[{equipmentName:'V19'}]};assert.equal(normalizeScanEquipmentRows(existing,rows),existing);
 assert.equal(scannedEquipmentName('V99',rows,site),'V99');
 assert.match(scanEquipmentMatchIssues({...input,trips:[{equipmentName:'H'}]},rows)['trips.0.equipmentName'],/number is missing/);
 assert.match(scanEquipmentMatchIssues({...input,trips:[{equipmentName:'19'}]},rows)['trips.0.equipmentName'],/prefix is missing/);
 assert.match(scanEquipmentMatchIssues(input,[...rows,machine('3','V19')])['trips.0.equipmentName'],/multiple/);
});

test('text extraction applies header and body contexts independently and retains the literal header',()=>{
 const rows=[machine('1','Haulpak Dumper 07','vehicle'),machine('2','Hydra 07'),machine('3','VPC019'),machine('4','Dozer 05'),machine('5','Grader 02'),machine('6','Pay Loader 03')];
 const text=`SITE ${site}\nDOOR NO H/07\n1 Volvo 019 09:00 09:20\n2 Dozer 05 09:30 09:50\n3 Grader 02 10:00 10:20\n4 Pay Loader 03 10:30 10:50\nMACHINE WISE SUMMARY\n1 VPC019 1\n2 D05 1\n3 G02 1\n4 PL03 1`;
 const {draft,raw}=extractCard(text,'vehicle',rows.map(master));
 assert.equal(draft.assetId,'1');assert.equal(draft.doorText,'H/07');assert.equal(raw.door,'H/07');
 assert.equal(raw.machineNotation.header.label,'Haulpak Dumper');
 assert.deepEqual(draft.trips.map(row=>row.equipmentName),['VPC019','Dozer 05','Grader 02','Pay Loader 03']);
 assert.deepEqual(draft.scanMachineSummary.map(row=>row.equipmentName),['VPC019','Dozer 05','Grader 02','Pay Loader 03']);
 const job=extractCard(`SITE ${site}\nDOOR NO H/07`,'equipment',rows.map(master));assert.equal(job.draft.assetId,'2');assert.equal(job.raw.machineNotation.header.label,'Hydra');
 assert.equal(extractCard(`SITE ${site}\nDOOR NO V P C/019`,'equipment',rows.map(master)).draft.assetId,'3');
 assert.equal(compactScanEquipmentReferences('1 Pay Loader 003 09:00 09:20'),'1 PL003 09:00 09:20');
});

test('scan review blocks unmatched and ambiguous loading equipment while accepting aliases for matched trip summaries',()=>{
 const assets=[machine('1','VPC19')],draft={machineNotationRuleVersion:1,location:site,trips:[{equipmentName:'V19',tripCount:1}],scanMachineSummary:[{equipmentName:'Vpc019',tripCount:1}],timeMode:'without'};
 const options={assets,employees:[],shifts:[],workOrders:[]};
 const issues=manualScanIssues(draft,'vehicle',{},options);assert.equal(issues['trips.0.equipmentName'],undefined);assert.equal(issues.scanMachineSummary,undefined);
 const missing=manualScanIssues({...draft,trips:[{equipmentName:'V99',tripCount:1}]},'vehicle',{},options);assert.match(missing['trips.0.equipmentName'],/Check|match/);
});
