// What a pull request fixes, in at most two short points, for the Telegram merge + release approval
// (owner's request, 15 Nov 2026). Used by scripts/merge-and-release.sh when no brief was typed:
// the first two list items of the PR description's first section, otherwise its first two sentences.
//   node scripts/pr-brief.mjs < pr-body.md   prints one point per line.
import {pathToFileURL} from 'node:url';

const MAX=180;
const plain=text=>String(text||'')
 .replace(/!\[[^\]]*\]\([^)]*\)/g,'')
 .replace(/\[([^\]]+)\]\([^)]*\)/g,'$1')
 .replace(/\*\*|__|`/g,'')
 .replace(/\s+/g,' ').trim();
const cut=text=>text.length>MAX?`${text.slice(0,MAX-1).replace(/\s+\S*$/,'')}…`:text;

export function prBrief(body){
 const lines=String(body||'').replace(/<!--[\s\S]*?-->/g,'').replace(/```[\s\S]*?```/g,'').split(/\r?\n/);
 // The first section with text: lines up to the second heading.
 const section=[];
 for(const line of lines){
  if(/^\s*#{1,6}\s/.test(line)){if(section.some(l=>l.trim()))break;continue;}
  section.push(line);
 }
 const items=section.filter(l=>/^\s*(?:[-*+]|\d{1,2}[.)])\s+\S/.test(l)).map(l=>plain(l.replace(/^\s*(?:[-*+]|\d{1,2}[.)])\s+/,''))).filter(Boolean);
 if(items.length)return items.slice(0,2).map(cut);
 const paragraph=plain(section.join(' '));
 const sentences=paragraph.match(/[^.!?]+(?:[.!?]+(?=\s|$)|$)/g)||[];
 return sentences.map(s=>s.trim()).filter(Boolean).slice(0,2).map(cut);
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 let input='';
 process.stdin.on('data',d=>input+=d).on('end',()=>process.stdout.write(prBrief(input).join('\n')));
}
