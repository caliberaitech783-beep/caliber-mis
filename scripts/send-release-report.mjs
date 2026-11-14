// Sends the owner the production release report at the end of every release job:
// done or failed, how it was started, the version before and after, and every change
// (pull request) on main between the version that was live and the one released.
// Pulse-II delivers it on Telegram (server/routes/release-report.mjs). The request is
// identified by this run's GitHub OIDC token. A failed report never fails the release.
import {execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';

const git=args=>execFileSync('git',args,{encoding:'utf8',maxBuffer:16*1024*1024}).trim();
const sha=value=>/^[0-9a-f]{40}$/.test(String(value||''))?String(value):'';

// One entry per first-parent commit on main: a squash merge "Title (#123)" or a merge
// commit "Merge pull request #123 from ..." whose PR title is the first body line.
export function parseChanges(log){
 return String(log||'').split('\u001e').map(entry=>entry.trim()).filter(Boolean).map(entry=>{
  const [subject='',...body]=entry.split('\u001f');
  const merge=/^Merge pull request #(\d+) from \S+/.exec(subject);
  if(merge)return {pr:merge[1],title:(body.join('\n').split('\n').map(l=>l.trim()).find(Boolean)||subject).slice(0,160)};
  const squash=/^(.*?)\s*\(#(\d+)\)\s*$/.exec(subject);
  if(squash)return {pr:squash[2],title:squash[1].slice(0,160)};
  return {pr:'',title:subject.slice(0,160)};
 });
}

export function changesBetween(previous,commit){
 if(!sha(previous)||!sha(commit)||previous===commit)return [];
 try{git(['cat-file','-e',`${previous}^{commit}`]);}
 catch{try{git(['fetch','--quiet','--depth=500','origin','main']);git(['cat-file','-e',`${previous}^{commit}`]);}catch{return [];}}
 try{git(['merge-base','--is-ancestor',previous,commit]);}catch{return [];}
 return parseChanges(git(['log','--first-parent','--format=%s%x1f%b%x1e',`${previous}..${commit}`]));
}

async function liveCommit(base){
 try{
  const response=await fetch(`${base}/api/health`,{signal:AbortSignal.timeout(20000)});
  return sha((await response.json()).commit);
 }catch{return '';}
}

async function main(){
 const base=process.env.RELEASE_REPORT_BASE_URL||'https://pulse-ll.cmll.in';
 const commit=sha(process.env.RELEASE_COMMIT),previous=sha(process.env.PREVIOUS_COMMIT);
 const status=process.env.RELEASE_STATUS==='success'?'success':'failed';
 const live=await liveCommit(base);
 const changes=changesBetween(previous,commit);
 console.log(`Release ${status}: ${commit.slice(0,7)} (before ${previous.slice(0,7)||'unknown'}, live now ${live.slice(0,7)||'unknown'}), ${changes.length} change(s).`);
 for(const c of changes)console.log(`  ${c.pr?'#'+c.pr+' ':''}${c.title}`);
 const {ACTIONS_ID_TOKEN_REQUEST_URL:url,ACTIONS_ID_TOKEN_REQUEST_TOKEN:requestToken}=process.env;
 if(!url){console.log('::warning::This run has no GitHub identity, so the release report was not sent.');return;}
 const minted=await fetch(`${url}&audience=pulse-ii-release`,{headers:{authorization:`bearer ${requestToken}`},signal:AbortSignal.timeout(20000)}).then(r=>r.json());
 if(!minted.value){console.log('::warning::GitHub did not issue an identity for the release report.');return;}
 console.log(`::add-mask::${minted.value}`);
 const response=await fetch(`${base}/api/release-report`,{method:'POST',signal:AbortSignal.timeout(30000),redirect:'error',
  headers:{authorization:`Bearer ${minted.value}`,'content-type':'application/json'},
  body:JSON.stringify({status,when:process.env.RELEASE_WHEN||'',commit,previous,live,changes})});
 const result=await response.json().catch(()=>({}));
 if(!response.ok){console.log(`::warning::Pulse-II did not send the release report (HTTP ${response.status}): ${result.error||''}`);return;}
 console.log(`Release report sent to the owner on Telegram (${result.told} chat${result.told===1?'':'s'}).`);
}

if(import.meta.url===pathToFileURL(process.argv[1]||'').href)await main();
