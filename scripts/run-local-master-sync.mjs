import {readFile} from 'node:fs/promises';
import path from 'node:path';
const loginText=await readFile(path.join(process.env.LOCALAPPDATA,'CaliberERP','local-login.txt'),'utf8');
const response=await fetch('http://127.0.0.1:4175/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'erp-admin',password:loginText.match(/^Password: (.+)$/m)[1]})});
const login=await response.json();if(!response.ok||!login.token)throw new Error('Local administrator login failed');
const headers={Authorization:`Bearer ${login.token}`};
const status=await fetch('http://127.0.0.1:4175/api/pulse-master-sync'+(process.argv.includes('--sync')?'/sync':''),{headers,method:process.argv.includes('--sync')?'POST':'GET'});
console.log(JSON.stringify(await status.json(),null,2));
