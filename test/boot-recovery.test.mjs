import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../public/mis-boot.js',import.meta.url),'utf8');
function boot({mounted=false,last=0,storageBlocked=false}={}){
 const handlers={},navigations=[],root={innerHTML:'',querySelector:()=>({addEventListener(){}})};
 const window={location:{href:'https://pulse-ll.cmll.in/?batch=123#card',origin:'https://pulse-ll.cmll.in',replace:url=>navigations.push(url)},sessionStorage:{getItem:()=>{if(storageBlocked)throw Error('blocked');return last;},setItem:()=>{}},addEventListener:(name,handler)=>handlers[name]=handler};
 vm.runInNewContext(source,{window,document:{getElementById:id=>id==='root'?root:mounted?null:{},querySelector:()=>null},URL,Date});
 return {handlers,navigations,root};
}
test('startup module failure reloads once and preserves the current entry URL',()=>{
 const b=boot();
 b.handlers.error({target:{tagName:'SCRIPT',type:'module',src:'/app-assets/main.js'}});
 b.handlers.unhandledrejection({reason:Error('Failed to fetch dynamically imported module')});
 assert.equal(b.navigations.length,1);
 const url=new URL(b.navigations[0]);
 assert.equal(url.searchParams.get('batch'),'123');
 assert.equal(url.hash,'#card');
 assert.ok(url.searchParams.has('asset-recovery'));
});
test('repeated startup failures and blocked storage show a usable refresh button',()=>{
 for(const options of [{last:Date.now()},{storageBlocked:true}]){
  const b=boot(options);
  b.handlers.error({message:'Importing a module script failed'});
  assert.equal(b.navigations.length,0);
  assert.match(b.root.innerHTML,/Refresh application/);
 }
});
test('mounted workspaces and unrelated scripts are not replaced by boot fallback',()=>{
 const b=boot({mounted:true});
 b.handlers.unhandledrejection({reason:Error('Failed to fetch dynamically imported module')});
 assert.equal(b.root.innerHTML,'');
 assert.equal(b.navigations.length,0);
 const startup=boot();
 startup.handlers.error({target:{tagName:'SCRIPT',type:'',src:'https://other.example/widget.js'}});
 assert.equal(startup.root.innerHTML,'');
 assert.equal(startup.navigations.length,0);
});
