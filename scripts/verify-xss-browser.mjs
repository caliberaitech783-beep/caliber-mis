import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import path from 'node:path';
import express from 'express';
import {securityHeaders} from '../server/middleware/http-security.mjs';

const require=createRequire(process.env.SECURITY_BROWSER_PREFIX
 ?path.resolve(process.env.SECURITY_BROWSER_PREFIX,'check.cjs'):import.meta.url);
const {chromium}=require(process.env.SECURITY_BROWSER_EXECUTABLE?'playwright-core':'playwright');
const payload='XSS fixture <img id=xss-probe src=x onerror="window.xssExecuted=true"> & O\'Brien';
const attribute='555" id="xss-attribute" onmouseover="window.xssExecuted=true';
const directoryHtml=await readFile('dist/cd/caliber-directory.html','utf8');
const directory=JSON.parse(directoryHtml.match(/<script id="directory-data" type="application\/json">([\s\S]*?)<\/script>/)[1]);
const roster=Object.values(directory.matrix).find(rows=>rows.some(person=>person.name));
const person=roster.find(row=>row.name);
Object.assign(person,{name:payload,department:payload,designation:payload,reportingTo:payload,contact:attribute,email:attribute});
const app=express();
app.use(securityHeaders);
app.get('/api/cdir/directory',(_req,res)=>res.json(directory));
app.get('/csp-check',(_req,res)=>res.type('html').send(
 '<script>window.inlineExecuted=true</script><button onclick="window.inlineHandler=true">Probe</button>'));
app.use(express.static('dist'));
const server=app.listen(0,'127.0.0.1');
await new Promise(resolve=>server.once('listening',resolve));
const base='http://127.0.0.1:'+server.address().port;
let browser;
try{
 browser=await chromium.launch({headless:true,executablePath:process.env.SECURITY_BROWSER_EXECUTABLE});
 const page=await browser.newPage({reducedMotion:'reduce'});
 page.setDefaultTimeout(8000);
 const errors=[];
 page.on('pageerror',error=>errors.push(error.message));
 await page.goto(base+'/csp-check');
 await page.getByRole('button',{name:'Probe'}).click();
 assert.deepEqual(await page.evaluate(()=>[window.inlineExecuted,window.inlineHandler]),[undefined,undefined]);
 console.log('CSP blocks inline scripts and event handlers');

 await page.goto(base+'/mis.html');
 await page.locator('#new').click();
 await page.locator('input[name=title]').fill(payload);
 await page.locator('input[name=date]').fill('2026-11-10');
 await page.locator('#form button.primary').click();
 await page.reload();
 assert.equal(await page.locator('#rows b').textContent(),payload);
 await page.getByRole('button',{name:'Edit',exact:true}).click();
 assert.equal(await page.locator('input[name=title]').inputValue(),payload);
 assert.equal(await page.locator('#xss-probe').count(),0);
 console.log('Legacy MIS saves, reloads and reopens literal report text');

 await page.evaluate(()=>sessionStorage.setItem('nerveCenterSession',JSON.stringify({token:'fixture'})));
 await page.goto(base+'/cd/caliber-directory.html');
 await page.locator('#searchBox').fill('XSS fixture');
 await page.locator('.sr-item').first().click();
 assert.ok((await page.locator('.pname').textContent()).includes(payload));
 assert.equal(await page.locator('#xss-probe,#xss-attribute').count(),0);
 await page.locator('#btnEditPerson').click();
 assert.equal(await page.locator('#f_name').inputValue(),payload);
 assert.equal(await page.locator('#f_contact').inputValue(),attribute);
 await page.locator('#f_designation').fill('Updated '+payload);
 await page.locator('#btnSaveEdit').click();
 assert.ok((await page.locator('.profile').textContent()).includes('Updated '+payload));
 assert.equal(await page.locator('#xss-probe,#xss-attribute').count(),0);
 assert.equal(await page.evaluate(()=>window.xssExecuted),undefined);
 console.log('Legacy directory searches, renders and edits saved fields as text');

 await page.goto(base+'/scanner-connector.html');
 await page.getByText('No scanner access has been enabled.',{exact:false}).waitFor();
 await page.evaluate(()=>sessionStorage.clear());
 await page.route('**/app-assets/index-*.js',route=>route.abort());
 await page.goto(base+'/',{waitUntil:'domcontentloaded'});
 await page.getByRole('button',{name:'Refresh application'}).waitFor();
 await page.unroute('**/app-assets/index-*.js');
 await page.getByRole('button',{name:'Refresh application'}).click();
 await page.locator('#root input').first().waitFor();
 assert.deepEqual(errors,[]);
 console.log('Scanner connector, bundle recovery and built MIS sign-in page work');
}finally{
 await browser?.close();
 server.closeAllConnections();
 await new Promise(resolve=>server.close(resolve));
}
