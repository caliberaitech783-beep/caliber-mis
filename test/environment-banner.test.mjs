import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync,statSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import React from 'react';
import {transformWithOxc} from 'vite';
import {normalizeEnvironmentLabel,environmentLabelFromEnv,environmentBannerParts,environmentBannerText,environmentTitlePrefix} from '../environment-label.mjs';

const root=path.dirname(fileURLToPath(new URL('../package.json',import.meta.url)));
const read=relative=>readFileSync(path.join(root,relative),'utf8').replace(/\r\n/g,'\n');
const BANNER_TEXT='TEST PLATFORM: not the live site. Cards saved here do not reach the live log book.';
const PAGE_TITLE='Caliber Pulse-II — MIS Workspace';

test('the label is empty unless MIS_ENVIRONMENT_LABEL is set; live names and stray characters never reach the page',()=>{
  assert.equal(environmentLabelFromEnv({}),'');
  assert.equal(environmentLabelFromEnv(undefined),'');
  assert.equal(environmentLabelFromEnv({MIS_ENVIRONMENT_LABEL:''}),'');
  assert.equal(environmentLabelFromEnv({MIS_ENVIRONMENT_LABEL:'   '}),'');
  assert.equal(environmentLabelFromEnv({MIS_ENVIRONMENT_LABEL:'TEST'}),'TEST');
  assert.equal(environmentLabelFromEnv({MIS_ENVIRONMENT_LABEL:' test '}),'TEST');
  for(const live of ['LIVE','live','Prod','PRODUCTION'])assert.equal(normalizeEnvironmentLabel(live),'',live+' counts as unset');
  assert.equal(normalizeEnvironmentLabel('te\u0000st\r\n<b>'),'TESTB');
  assert.equal(normalizeEnvironmentLabel('x'.repeat(40)).length,24);
  assert.equal(normalizeEnvironmentLabel(42),'42');
  assert.equal(environmentBannerText(''),'');
  assert.equal(environmentBannerParts(''),null);
  assert.equal(environmentBannerText('TEST'),BANNER_TEXT);
  assert.equal(environmentTitlePrefix('TEST'),'[TEST] ');
  assert.equal(environmentTitlePrefix(''),'');
});

test('the server reports the label read-only on /api/app-version and /api/health and uses it nowhere else',()=>{
  const server=read('server.mjs');
  assert.match(server,/^import \{environmentLabelFromEnv\} from '\.\/environment-label\.mjs';$/m);
  assert.match(server,/^const environmentLabel=environmentLabelFromEnv\(process\.env\);$/m);
  assert.match(server,/res\.json\(\{version:currentAppVersion,commit:deploymentSha,environmentLabel\}\);/);
  assert.match(server,/status:'ok',database:'connected',databaseTime:result\.rows\[0\]\.database_time,commit:deploymentSha,scheduledJobsEnabled,environmentLabel,/);
  assert.match(server,/\{status:'degraded',database:'disconnected',error:databaseError,environmentLabel\}/);
  const uses=server.split('\n').filter(line=>/\benvironmentLabel\b/.test(line));
  assert.equal(uses.length,4,'read once, reported in three responses, nothing else:\n'+uses.join('\n'));
  // Only environment-label.mjs reads the setting, so no other runtime code can branch on it (comments may name it).
  const reads=/\benv\??\.MIS_ENVIRONMENT_LABEL|\[\s*['"]MIS_ENVIRONMENT_LABEL['"]\s*\]|getenv\(\s*['"]MIS_ENVIRONMENT_LABEL/;
  const readers=[];
  const visit=directory=>{
    for(const name of readdirSync(directory)){
      if(name.startsWith('.')||['node_modules','dist','test','docs','layout-checks','backups'].includes(name))continue;
      const full=path.join(directory,name);
      if(statSync(full).isDirectory())visit(full);
      else if(/\.(mjs|cjs|js|jsx|ts|tsx|py|sh|yml|yaml)$/.test(name)&&reads.test(readFileSync(full,'utf8')))readers.push(path.relative(root,full).replaceAll('\\','/'));
    }
  };
  visit(root);
  assert.deepEqual(readers.sort(),['environment-label.mjs']);
});

const componentSource=read('src/environment-banner.jsx').replace(/^import .*;\n/gm,'').replace('export default function','function');
const {code}=await transformWithOxc(componentSource,'environment-banner.jsx',{jsx:{runtime:'classic'}});
const textOf=node=>typeof node==='string'||typeof node==='number'?String(node):Array.isArray(node)?node.map(textOf).join(''):React.isValidElement(node)?textOf(node.props.children):'';

// Runs the component with hand-rolled hooks, a fake page and a scripted /api/app-version, like site-update-notice.test.mjs.
function mount({responses,hostname='caliber-mis-test-783.azurewebsites.net'}){
  const slots=[],effects=[],timers=[],listeners=[],fetchCalls=[];let cursor=0;
  const document={title:PAGE_TITLE,documentElement:{dataset:{},style:{properties:{},setProperty(name,value){this.properties[name]=value},removeProperty(name){delete this.properties[name]}}},querySelector:()=>null};
  const window={location:{hostname,href:'https://'+hostname+'/'},setTimeout:(fn,ms)=>{timers.push({fn,ms});return timers.length},clearTimeout(){},
    addEventListener:(name)=>listeners.push(name),removeEventListener:(name)=>{const index=listeners.indexOf(name);if(index>=0)listeners.splice(index,1)}};
  const scope={React,normalizeEnvironmentLabel,environmentBannerParts,environmentTitlePrefix,window,document,
    useState:initial=>{const index=cursor++;if(!(index in slots))slots[index]=initial;return[slots[index],value=>{slots[index]=value}]},
    useRef:value=>{const index=cursor++;if(!(index in slots))slots[index]={current:value};return slots[index]},
    useEffect:effect=>effects.push(effect),
    fetch:async(url,options)=>{fetchCalls.push({url:String(url),options});const next=responses.shift();if(next instanceof Error)throw next;return {ok:next.ok!==false,status:next.status||200,json:async()=>next.body||{}}}};
  const Component=new Function(...Object.keys(scope),code+';return EnvironmentBanner')(...Object.values(scope));
  const render=()=>{cursor=0;effects.length=0;return Component({})};
  const settle=()=>new Promise(resolve=>setImmediate(resolve));
  return {render,effects,timers,listeners,fetchCalls,document,window,settle};
}

test('nothing is rendered and the page is untouched when the server reports no label, whatever the address says',async()=>{
  for(const body of [{version:'abc',commit:'abc'},{version:'abc',commit:'abc',environmentLabel:''}]){
    const page=mount({responses:[{body}]});
    assert.equal(page.render(),null);
    page.effects.forEach(effect=>effect());
    await page.settle();
    assert.equal(page.render(),null);
    assert.equal(page.document.title,PAGE_TITLE);
    assert.equal(page.document.documentElement.dataset.misEnvironment,undefined);
    assert.deepEqual(page.document.documentElement.style.properties,{});
    assert.deepEqual(page.fetchCalls.map(call=>call.url.split('?')[0]),['/api/app-version']);
    assert.equal(page.fetchCalls[0].options.cache,'no-store');
    assert.equal(page.fetchCalls[0].options.headers,undefined,'the label is public: no session token is sent');
    assert.deepEqual(page.timers,[],'a good answer is not retried');
  }
});

test('a TEST label shows the bar, marks the page and prefixes the title; unmounting restores everything',async()=>{
  const page=mount({responses:[{body:{version:'abc',commit:'abc',environmentLabel:'TEST'}}]});
  assert.equal(page.render(),null);
  page.effects[0]();
  await page.settle();
  const tree=page.render();
  assert.equal(tree.type,'div');
  assert.equal(tree.props.className,'mis-environment-banner');
  assert.equal(tree.props.role,'note');
  assert.equal(textOf(tree),BANNER_TEXT);
  assert.equal(tree.props.children[0].type,'strong');
  assert.equal(textOf(tree.props.children[0]),'TEST PLATFORM:');
  const cleanup=page.effects[1]();
  assert.equal(page.document.title,'[TEST] '+PAGE_TITLE);
  assert.equal(page.document.documentElement.dataset.misEnvironment,'TEST');
  assert.deepEqual(page.listeners,['resize']);
  cleanup();
  assert.equal(page.document.title,PAGE_TITLE);
  assert.equal(page.document.documentElement.dataset.misEnvironment,undefined);
  assert.deepEqual(page.listeners,[]);
});

test('a server that is restarting is asked again every 15 seconds until it answers',async()=>{
  const page=mount({responses:[Error('connection refused'),{ok:false,status:503},{body:{version:'abc',environmentLabel:'test'}}]});
  page.render();page.effects[0]();
  await page.settle();
  assert.deepEqual(page.timers.map(timer=>timer.ms),[15000]);
  assert.equal(page.render(),null);
  await page.timers[0].fn();
  assert.deepEqual(page.timers.map(timer=>timer.ms),[15000,15000]);
  await page.timers[1].fn();
  assert.equal(textOf(page.render()),BANNER_TEXT,'the label is normalised on the page as well');
  assert.equal(page.fetchCalls.length,3);
});

test('both entries render the bar above the application, and the bar keeps clear of the navigation and the update notice',()=>{
  const main=read('src/main.jsx'),entry=read('src/mis-entry.jsx'),css=read('src/environment-banner.css'),notice=read('src/site-update-notice.jsx');
  assert.match(main,/^import EnvironmentBanner from '\.\/environment-banner\.jsx';$/m);
  assert.match(main,/<ApplicationErrorBoundary>\s*<EnvironmentBanner \/>\s*<SiteUpdateNotice currentVersion=\{APP_VERSION\} \/>\s*<App \/>/,'the bar is mounted beside the sign-in and signed-in screens alike');
  assert.match(entry,/^import EnvironmentBanner from '\.\/environment-banner\.jsx';$/m);
  assert.match(entry,/render\(<><EnvironmentBanner\/><MisApp\/><\/>\);/);
  // Fixed to the top edge; the update notice stays fixed to the bottom edge, so the two never overlap.
  assert.match(css,/^\.mis-environment-banner\{position:fixed;top:0;left:0;right:0;z-index:2147483646;/m);
  assert.match(notice,/position:'fixed',bottom:20,/);
  // The page and its pinned navigation move down by the measured bar height instead of sliding under it.
  assert.match(css,/html\[data-mis-environment\] body\{padding-top:var\(--mis-environment-banner-height\)\}/);
  for(const selector of ['.app>aside','.app.erp-shell>aside.erp-sidebar','.top','.app.erp-shell .top','.normal>header','.scan-review-compact'])
    assert.ok(css.includes(`html[data-mis-environment] ${selector}{top:`),selector+' is offset by the bar height');
  // Readable on a phone: bold 13px text that wraps instead of overflowing the viewport.
  assert.match(css,/font-size:13px;font-weight:700;line-height:1\.35;text-align:center;overflow-wrap:anywhere/);
  // Every rule is scoped to the bar or to html[data-mis-environment], so live, where neither exists, is untouched.
  for(const fragment of css.replace(/\/\*[\s\S]*?\*\//g,'').split('}')){
    const selectorList=fragment.replace(/^\s*@[^{]*\{/,'').split('{')[0].trim();
    if(!selectorList)continue;
    for(const selector of selectorList.split(','))assert.match(selector.trim(),/^(\.mis-environment-banner|html\[data-mis-environment\])/,'rule limited to the test platform: '+selector);
  }
});

test('the setting is documented empty for live and TEST for the test platform',()=>{
  assert.match(read('.env.example'),/^MIS_ENVIRONMENT_LABEL=$/m);
  const runbook=read('docs/test-platform-setup.md');
  assert.match(runbook,/\{"name":"MIS_ENVIRONMENT_LABEL","value":"TEST","slotSetting":false\}/);
  assert.match(runbook,/^\| `MIS_ENVIRONMENT_LABEL` \| `TEST` \| /m);
});
