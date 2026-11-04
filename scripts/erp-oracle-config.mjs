import {execFileSync} from 'node:child_process';
import {existsSync} from 'node:fs';
import path from 'node:path';
export function loadErpOracleConfig(){
 const file=path.join(process.env.LOCALAPPDATA||'','CaliberERP','oracle-erp-protected.json');
 if(!existsSync(file))return null;
 const script="$c=Get-Content -LiteralPath $env:NEXUS_ORACLE_SECRET_FILE -Raw | ConvertFrom-Json; $s=ConvertTo-SecureString $c.protectedPassword; $p=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($s); try { @{user=$c.user;password=[Runtime.InteropServices.Marshal]::PtrToStringBSTR($p);connectString=$c.connectString} | ConvertTo-Json -Compress } finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($p) }";
 try{return JSON.parse(execFileSync('pwsh.exe',['-NoProfile','-NonInteractive','-Command',"$ErrorActionPreference='Stop';"+script],{env:{...process.env,NEXUS_ORACLE_SECRET_FILE:file},encoding:'utf8',windowsHide:true,stdio:['ignore','pipe','pipe']}));}catch{throw new Error('The Windows-protected ERP connection could not be opened for this user.');}
}
