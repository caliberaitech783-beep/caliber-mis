import test from 'node:test';import assert from 'node:assert/strict';import {validateAttachment}from'../server/rules/attachment-validation.mjs';import{auditSubmittedFields,auditSafeError}from'../server/rules/audit-trail.mjs';
test('contract attachments reject active content, executable names and mismatched signatures',()=>{
 assert.equal(validateAttachment('contract.pdf',Buffer.from('%PDF-1.7\n')),true);
 assert.equal(validateAttachment('summary.csv',Buffer.from('date,amount\n2026-11-04,100')),true);
 for(const[name,data]of [['contract.pdf','<script>alert(1)</script>'],['script.svg','<svg/>'],['file.exe','MZpayload'],['macro.xlsm','PK\x03\x04payload'],['photo.png','%PDF-1.7'],['readme.txt','<html>malicious</html>'],['sheet.csv','MZpayload']])assert.throws(()=>validateAttachment(name,Buffer.from(data)),error=>error.status===400);
});
test('MFA codes, recovery material, credentials and connection passwords are redacted from audit logs',()=>{
 const fields=auditSubmittedFields({code:'123456',recoveryCodes:['secret'],connectionString:'postgres://user:password@db/mis',note:'ordinary'});
 assert.ok(fields.slice(0,3).every(x=>x.after==='[protected]'));assert.equal(fields[3].after,'ordinary');
 assert.ok(!auditSafeError(new Error('Cannot connect postgres://user:secret-password@db/mis')).message.includes('secret-password'));
});
