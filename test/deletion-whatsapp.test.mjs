import test from 'node:test';
import assert from 'node:assert/strict';
import {sendDeletionOtp,DELETION_WHATSAPP_KEY} from '../server/services/deletion-whatsapp.mjs';
import {DELETION_PHONE} from '../server/rules/log-book-deletion.mjs';
test('dedicated Pulse sender is restricted to deletion OTPs and the approved recipient, with no global setting changes',async()=>{
 const config={enabled:true,purpose:'logBookDeletionOtp',recipient:DELETION_PHONE,provider:'fast2sms',providerApiKey:'test-secret',phoneNumberId:'test-phone'};
 const calls=[];const pool={query:async(sql,args)=>{assert.deepEqual(args,[DELETION_WHATSAPP_KEY]);return {rows:[{setting_value:config}]};}};
 const request={pool,to:DELETION_PHONE,otp:'123456',requestId:'test-request',count:2};
 const before={...process.env};const transport={sendTemplate:async(payload,options)=>{calls.push({payload,options});return {sent:true,messageId:'test-only'};}};
 const result=await sendDeletionOtp(request,transport);assert.equal(result.sent,true);assert.equal(calls[0].payload.purpose,'logBookDeletionOtp');assert.equal(calls[0].options.env.FAST2SMS_WHATSAPP_API_KEY,'test-secret');assert.equal(JSON.stringify({...process.env})===JSON.stringify(before),true);
 await assert.rejects(()=>sendDeletionOtp({...request,to:'919999999999'},transport),/Invalid/);
 await assert.rejects(()=>sendDeletionOtp({...request,count:0},transport),/Invalid/);
 config.purpose='manualReports';await assert.rejects(()=>sendDeletionOtp(request,transport),/not configured/);assert.equal(calls.length,1);
});

test('Jayant deletion uses the new number without changing the recipient for other sites',async()=>{
 const pool={query:async()=>({rows:[{setting_value:{enabled:true,purpose:'logBookDeletionOtp',recipient:DELETION_PHONE}}]})};
 const delivered=[];
 const transport={sendTemplate:async({to})=>delivered.push(to)};
 const request={pool,otp:'123456',requestId:'routing-test',count:1};
 const jayant='919936297751';
 await sendDeletionOtp({...request,to:jayant,sites:['Jayant OC','Jayant OB']},transport);
 await sendDeletionOtp({...request,to:DELETION_PHONE,sites:['Lalpeth OC']},transport);
 await assert.rejects(()=>sendDeletionOtp({...request,to:DELETION_PHONE,sites:['Jayant OC']},transport),/Invalid/);
 await assert.rejects(()=>sendDeletionOtp({...request,to:jayant,sites:['Sasti OC']},transport),/Invalid/);
 await assert.rejects(()=>sendDeletionOtp({...request,to:jayant,sites:['Jayant OC','Sasti OC']},transport),/separately/);
 assert.deepEqual(delivered,[jayant,DELETION_PHONE]);
});

test('Dudhichua East and Dudhichua each use their own deletion number',async()=>{
 const pool={query:async()=>({rows:[{setting_value:{enabled:true,purpose:'logBookDeletionOtp',recipient:DELETION_PHONE}}]})};
 const sent=[];
 const transport={sendTemplate:async({to})=>sent.push(to)};
 const request={pool,otp:'123456',requestId:'dudhichua-routing',count:1};
 const east='919113496780',west='916394694715';
 await sendDeletionOtp({...request,to:east,sites:['Dudhichua East OC','Dudhichua East OB']},transport);
 await sendDeletionOtp({...request,to:west,sites:['Dudhichau OC','Dudhichua OC','Dudhichua West']},transport);
 await assert.rejects(()=>sendDeletionOtp({...request,to:east,sites:['Dudhichua OC']},transport),/Invalid/);
 await assert.rejects(()=>sendDeletionOtp({...request,to:west,sites:['Dudhichua East OC']},transport),/Invalid/);
 await assert.rejects(()=>sendDeletionOtp({...request,to:DELETION_PHONE,sites:['Dudhichua OC']},transport),/Invalid/);
 await assert.rejects(()=>sendDeletionOtp({...request,to:east,sites:['Dudhichua East OC','Dudhichua OC']},transport),/separately/);
 assert.deepEqual(sent,[east,west]);
});

test('each WCL site sends deletion OTPs only to its assigned number',async()=>{
 const pool={query:async()=>({rows:[{setting_value:{enabled:true,purpose:'logBookDeletionOtp',recipient:DELETION_PHONE}}]})};
 const sent=[];
 const transport={sendTemplate:async({to})=>sent.push(to)};
 const request={pool,otp:'123456',requestId:'wcl-routing',count:1};
 const cases=[
  [['Sasti OC','Sasti OB'],'917379771776'],
  [['Majri OC','Majri OB'],'919801238859'],
  [['Gauri Pauni OC (2nd)','Gouri Pouni OB (2nd)'],'918535853563'],
  [['Dhoptala OC','Dhoptala OC (2nd)'],'919392864944'],
 ];
 for(const [sites,to] of cases){
  await sendDeletionOtp({...request,sites,to},transport);
  await assert.rejects(()=>sendDeletionOtp({...request,sites,to:DELETION_PHONE},transport),/Invalid/);
  for(const [other,otherPhone] of cases){
   if(otherPhone===to)continue;
   await assert.rejects(()=>sendDeletionOtp({...request,sites,to:otherPhone},transport),/Invalid/);
   await assert.rejects(()=>sendDeletionOtp({...request,sites:[...sites,...other],to},transport),/separately/);
  }
 }
 await sendDeletionOtp({...request,sites:['Lalpeth OC'],to:DELETION_PHONE},transport);
 assert.deepEqual(sent,[...cases.map(([,to])=>to),DELETION_PHONE]);
});
