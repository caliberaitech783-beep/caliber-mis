import {scanDeletionApproval} from '../src/scan-card-deletion-selection.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {transformWithOxc} from 'vite';

const source=readFileSync(new URL('../src/bulk-card-scanning.jsx',import.meta.url),'utf8');
const {code}=await transformWithOxc(source.slice(source.indexOf('function ScanCardDeletionDialog(')),'deletion-dialog.jsx',{jsx:{runtime:'classic'}});
const target={id:'card-exact',ordinal:7,revision:6,batch_id:'batch-exact',filename:'original.png',draft:{bookDate:'2026-11-01',location:'Dudhichua OB',doorText:'V486'}};
const nodes=(tree,predicate)=>{const result=[];const visit=node=>{if(Array.isArray(node))return node.forEach(visit);if(!React.isValidElement(node))return;if(predicate(node))result.push(node);visit(node.props.children)};visit(tree);return result};
function harness(kind='vehicle',overrides={}){
 const slots=[];let cursor=0,closed=0;const requests=[],deletions=[];
 const useState=initial=>{const index=cursor++;if(!(index in slots))slots[index]=initial;return [slots[index],value=>slots[index]=typeof value==='function'?value(slots[index]):value]};
 const Component=new Function('React','useState','useRef','useEffect','scanDeletionApproval',code+';return ScanCardDeletionDialog')(React,useState,value=>useState({current:value})[0],()=>{},scanDeletionApproval);
 const props={target,kind,batchName:'B06',onClose(){closed++},onRequest:async body=>{requests.push(body);return {requestId:'request-exact',recipient:'+91 9925565281',expiresInMinutes:10}},onDelete:async body=>deletions.push(body),...overrides};
 const render=()=>{cursor=0;return Component(props)},button=(tree,label)=>nodes(tree,n=>n.type==='button'&&n.props.children===label)[0];
 const prepare=()=>{let tree=render();nodes(tree,n=>n.type==='textarea')[0].props.onChange({target:{value:'Wrong scan'}});nodes(tree,n=>n.type==='input'&&n.props.type==='checkbox')[0].props.onChange({target:{checked:true}});return render()};
 return {render,button,prepare,requests,deletions,get closed(){return closed}};
}
for(const kind of ['vehicle','equipment'])test(kind+' deletion dialog binds explicit approval and OTP to the displayed exact card',async()=>{
 const app=harness(kind);let tree=app.render(),html=renderToStaticMarkup(tree);
 assert.match(html,kind==='vehicle'?/VLB · Trip card/:/ELB · Job card/);
 for(const value of ['card-exact','batch-exact','original.png','2026-11-01','Dudhichua OB','V486','No application restore'])assert.ok(html.includes(value));
 assert.equal(app.button(tree,'Approve and send WhatsApp OTP').props.disabled,true);
 await app.button(tree,'Approve and send WhatsApp OTP').props.onClick();assert.equal(app.requests.length,0);
 tree=app.prepare();await app.button(tree,'Approve and send WhatsApp OTP').props.onClick();
 assert.deepEqual(app.requests,[{reason:'Wrong scan',approval:'Approve deletion of card card-exact revision 6'}]);assert.equal(app.deletions.length,0);
 tree=app.render();assert.match(renderToStaticMarkup(tree),/\+91 9925565281/);assert.equal(app.button(tree,'Verify OTP and delete card').props.disabled,true);
 const otp=nodes(tree,n=>n.type==='input'&&n.props.autoComplete==='one-time-code')[0];otp.props.onChange({target:{value:'12a3456'}});
 tree=app.render();await app.button(tree,'Verify OTP and delete card').props.onClick();
 assert.deepEqual(app.deletions,[{requestId:'request-exact',otp:'123456',approval:'Approve deletion of card card-exact revision 6'}]);
});
test('cancel and Escape close without requesting OTP or deleting',()=>{
 const app=harness();let tree=app.render();app.button(tree,'Cancel').props.onClick();tree.props.onCancel({preventDefault(){}});
 nodes(tree,n=>n.props['aria-label']==='Close card deletion')[0].props.onClick();
 assert.equal(app.closed,3);assert.equal(app.requests.length,0);assert.equal(app.deletions.length,0);
});
test('failed OTP delivery stays in the approval step and never deletes',async()=>{
 const app=harness('vehicle',{onRequest:async()=>{throw Error('WhatsApp unavailable')}});let tree=app.prepare();await app.button(tree,'Approve and send WhatsApp OTP').props.onClick();tree=app.render();
 assert.match(renderToStaticMarkup(tree),/WhatsApp unavailable/);assert.ok(app.button(tree,'Approve and send WhatsApp OTP'));assert.equal(app.deletions.length,0);
});
test('in-flight OTP send blocks double submission and closing',async()=>{
 let finish,calls=0;const app=harness('equipment',{onRequest:()=>{calls++;return new Promise(resolve=>finish=resolve)}});const tree=app.prepare(),send=app.button(tree,'Approve and send WhatsApp OTP').props.onClick;
 const first=send();await send();app.button(tree,'Cancel').props.onClick();assert.equal(calls,1);assert.equal(app.closed,0);
 finish({requestId:'request-exact',recipient:'+91 9925565281'});await first;
});
test('a refused OTP leaves the dialog open for correction',async()=>{
 const app=harness('vehicle',{onDelete:async()=>{throw Error('Incorrect WhatsApp OTP.')}});let tree=app.prepare();await app.button(tree,'Approve and send WhatsApp OTP').props.onClick();tree=app.render();nodes(tree,n=>n.type==='input'&&n.props.autoComplete==='one-time-code')[0].props.onChange({target:{value:'000000'}});tree=app.render();await app.button(tree,'Verify OTP and delete card').props.onClick();
 assert.match(renderToStaticMarkup(app.render()),/Incorrect WhatsApp OTP/);assert.equal(app.closed,0);
});
test('single-card deletion uses the dialog instead of native prompts',()=>{
 const deletion=source.slice(source.indexOf(' const [deletionTarget'),source.indexOf(' const resolveFleet='));
 assert.doesNotMatch(deletion,/window\.(?:prompt|confirm)/);assert.match(deletion,/setBusy\(true\)/);assert.match(source,/<ScanCardDeletionDialog/);
});
for(const kind of ['vehicle','equipment'])test(kind+' group dialog previews every card and approves the exact list with one OTP',async()=>{
 const targets=[target,{...target,id:'second-card',ordinal:8,revision:2,filename:'second.png'}],app=harness(kind,{targets});let tree=app.render();const html=renderToStaticMarkup(tree);assert.match(html,/Delete 2 selected cards/);assert.ok(html.includes('card-exact')&&html.includes('second-card')&&html.includes('second.png'));assert.match(html,/Storage\/backups may retain original scans/);
 tree=app.prepare();await app.button(tree,'Approve and send WhatsApp OTP').props.onClick();assert.equal(app.requests.length,1);assert.equal(app.requests[0].approval,scanDeletionApproval(targets));tree=app.render();nodes(tree,n=>n.type==='input'&&n.props.autoComplete==='one-time-code')[0].props.onChange({target:{value:'123456'}});tree=app.render();await app.button(tree,'Verify OTP and delete 2 cards').props.onClick();assert.equal(app.deletions.length,1);assert.equal(app.deletions[0].approval,scanDeletionApproval(targets));
});
