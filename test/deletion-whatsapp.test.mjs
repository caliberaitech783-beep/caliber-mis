import test from 'node:test';
import assert from 'node:assert/strict';
import {sendDeletionOtp,DELETION_WHATSAPP_KEY} from '../deletion-whatsapp.mjs';
import {DELETION_PHONE} from '../log-book-deletion.mjs';
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
