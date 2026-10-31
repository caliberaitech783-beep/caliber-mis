import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
test('blank-card rejection bypasses form validation and preserves draft and original scan',async()=>{
 const source=readFileSync(new URL('../bulk-card-scanning.mjs',import.meta.url),'utf8');
 const route=source.slice(source.indexOf("app.put('/api/scan-cards/:id'"));
 const start=route.indexOf("if(req.body.action==='reject'){");
 const end=route.indexOf("if(!req.body.draft",start);
 assert.ok(start>route.indexOf('req.body.revision!==card.revision'));
 assert.ok(start<route.indexOf('await checkScanCard'));
 const block=route.slice(start,end);
 const run=new Function('req','card','c','res','return (async()=>{'+block+'})();');
 for(const draft of [undefined,{}, {doorText:'',employeeId:'',trips:[]}]){
  const queries=[];let result;
  await run({body:{action:'reject',draft},session:{login:'reviewer'}},{id:'selected',revision:4},{query:async(sql,args)=>queries.push({sql,args})},{json:value=>{result=value}});
  assert.equal(result.status,'rejected');assert.equal(result.revision,5);
  assert.deepEqual(queries[0].args,['selected','reviewer']);
  assert.match(queries[0].sql,/WHERE id=\$1/);
  assert.doesNotMatch(queries[0].sql,/draft=|image=|raw_fields=/);
  assert.equal(queries[1].sql,'COMMIT');
 }
});
