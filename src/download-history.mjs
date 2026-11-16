// Download History (owner, 16 Nov 2026): "Add a Download History tab in the main header to display all previously
// downloaded files with date and time, along with an Open option to access files directly without downloading them again."
// Every file the app hands over (Excel, PDF, CSV) is kept in this browser on this PC, under the login that made it, so the
// header's Download History can list it with its date and time and open it again without building or downloading it again.
// The newest KEEP_FILES files are kept, up to KEEP_BYTES in all; older ones are let go first.

const DB_NAME='caliber-download-history',STORE='files',VERSION=1;
export const KEEP_FILES=60,KEEP_BYTES=250*1024*1024;
export const DOWNLOAD_HISTORY_EVENT='caliber-download-history';
let owner='';
/** The login whose files are listed and recorded. The header sets it once the user is signed in. */
export function setDownloadHistoryOwner(login){owner=String(login||'').trim().toLowerCase();}

export const fileKind=name=>{const ext=String(name||'').split('.').pop().toLowerCase();return ext==='xlsx'||ext==='xls'?'Excel':ext==='pdf'?'PDF':ext==='csv'?'CSV':ext?ext.toUpperCase():'File';};
const titleFromName=name=>String(name||'').replace(/\.[a-z0-9]+$/i,'').replace(/-\d{2}-\d{2}-\d{2,4}$/,'').replace(/[-_]+/g,' ').trim();

let opening=null;
function database(){
  if(typeof indexedDB==='undefined')return Promise.resolve(null);
  return opening||=new Promise(resolve=>{
    let request;
    try{request=indexedDB.open(DB_NAME,VERSION);}catch{resolve(null);return;}
    request.onupgradeneeded=()=>{const store=request.result.createObjectStore(STORE,{keyPath:'id'});store.createIndex('owner','owner');};
    request.onsuccess=()=>resolve(request.result);
    // A private window or blocked site data: the app works as before, with no history.
    request.onerror=()=>{opening=null;resolve(null);};
    request.onblocked=()=>{opening=null;resolve(null);};
  });
}
const done=request=>new Promise((resolve,reject)=>{request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});
async function store(mode){const db=await database();return db?db.transaction(STORE,mode).objectStore(STORE):null;}
const announce=()=>{try{globalThis.dispatchEvent?.(new Event(DOWNLOAD_HISTORY_EVENT));}catch{/* no window */}};

/** Every file of the signed-in login, newest first. */
export async function listDownloads(){
  try{
    const files=await store('readonly');if(!files)return [];
    const rows=await done(files.index('owner').getAll(owner));
    return rows.sort((a,b)=>String(b.savedAt).localeCompare(String(a.savedAt)));
  }catch{return [];}
}

async function prune(){
  const rows=await listDownloads();let bytes=0;
  const drop=rows.filter((row,index)=>{bytes+=row.size||0;return index>=KEEP_FILES||bytes>KEEP_BYTES;});
  if(!drop.length)return;
  const files=await store('readwrite');for(const row of drop)files?.delete(row.id);
}

/**
 * Keeps a copy of a file just handed over. Never throws and never holds the download up.
 * where: 'downloads' (the browser's Downloads folder) or 'folder' (a folder chosen in the Save As window).
 */
export function recordDownload(blob,name,{where='downloads',title=''}={}){
  if(!blob||typeof indexedDB==='undefined')return Promise.resolve(null);
  const savedAt=new Date().toISOString();
  const row={id:savedAt+'-'+Math.random().toString(36).slice(2,8),owner,name:String(name||'file'),title:String(title||titleFromName(name)),kind:fileKind(name),
    type:blob.type||'',size:blob.size||0,where,savedAt,blob};
  return (async()=>{
    try{const files=await store('readwrite');if(!files)return null;await done(files.put(row));await prune();announce();return row.id;}
    catch{return null;}
  })();
}
export async function removeDownload(id){try{const files=await store('readwrite');if(files)await done(files.delete(id));announce();}catch{/* nothing to remove */}}
export async function clearDownloads(){for(const row of await listDownloads())await removeDownload(row.id);}

/**
 * Hands a file to the browser's Downloads folder and keeps it in Download History.
 * The link is put in the page and its address kept for a minute: an address dropped at once (as before 16 Nov 2026) can
 * leave Chrome, or a download manager that fetches the file itself, with nothing to fetch.
 */
export function downloadBlob(blob,name,{title='',doc=globalThis.document,record=recordDownload}={}){
  const url=URL.createObjectURL(blob),link=doc.createElement('a');
  link.href=url;link.download=name;link.rel='noopener';link.style.display='none';
  doc.body.appendChild(link);link.click();link.remove();
  setTimeout(()=>URL.revokeObjectURL(url),60000);
  try{record?.(blob,name,{where:'downloads',title});}catch{/* the history never stops the file */}
}

// ---- Reading a kept Excel file back, to show it in the app without Excel ----

const decoder=new TextDecoder();
async function inflate(bytes){
  if(typeof DecompressionStream==='undefined')throw new Error('This browser cannot open compressed Excel files.');
  const stream=new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}
/** The files inside a zip (an .xlsx is one), by name. */
export async function unzip(buffer){
  const bytes=new Uint8Array(buffer),view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  let end=bytes.length-22;while(end>=0&&view.getUint32(end,true)!==0x06054b50)end--;
  if(end<0)throw new Error('This is not an Excel file.');
  const count=view.getUint16(end+10,true);let at=view.getUint32(end+16,true);const files=new Map();
  for(let i=0;i<count;i++){
    if(view.getUint32(at,true)!==0x02014b50)break;
    const method=view.getUint16(at+10,true),size=view.getUint32(at+20,true),nameLength=view.getUint16(at+28,true),extra=view.getUint16(at+30,true),comment=view.getUint16(at+32,true),local=view.getUint32(at+42,true);
    const name=decoder.decode(bytes.subarray(at+46,at+46+nameLength));
    const start=local+30+view.getUint16(local+26,true)+view.getUint16(local+28,true),data=bytes.subarray(start,start+size);
    files.set(name,{method,data});at+=46+nameLength+extra+comment;
  }
  return {async text(name){const file=files.get(name);if(!file)return null;return decoder.decode(file.method===8?await inflate(file.data):file.data);}};
}
const columnIndex=reference=>{let n=0;for(const ch of String(reference).replace(/\d+$/,''))n=n*26+ch.charCodeAt(0)-64;return n-1;};
// Array.from, not spread: a node list from a parser outside the browser is not iterable.
const tags=(node,name)=>Array.from(node.getElementsByTagName(name));
const textOf=node=>tags(node,'t').map(t=>t.textContent).join('');
/** The sheets of an .xlsx as {name, rows: [[cell text]]}, at most `maxRows` rows each. */
export async function readXlsxSheets(blob,{maxRows=5000,parse=(xml)=>new DOMParser().parseFromString(xml,'application/xml')}={}){
  const zip=await unzip(await blob.arrayBuffer());
  const workbook=parse(await zip.text('xl/workbook.xml')||'<workbook/>');
  const rels=parse(await zip.text('xl/_rels/workbook.xml.rels')||'<Relationships/>');
  const target=new Map(tags(rels,'Relationship').map(r=>[r.getAttribute('Id'),r.getAttribute('Target')]));
  const sharedXml=await zip.text('xl/sharedStrings.xml');
  const shared=sharedXml?tags(parse(sharedXml),'si').map(textOf):[];
  const sheets=[];
  for(const sheet of tags(workbook,'sheet')){
    const id=sheet.getAttribute('r:id')||sheet.getAttributeNS?.('http://schemas.openxmlformats.org/officeDocument/2006/relationships','id');
    const path=String(target.get(id)||'').replace(/^\/?(xl\/)?/,'xl/');
    const xml=await zip.text(path);if(!xml)continue;
    const rows=[];let more=false;
    for(const row of Array.from(parse(xml).getElementsByTagName('row'))){
      if(rows.length>=maxRows){more=true;break;}
      const cells=[];
      for(const c of Array.from(row.getElementsByTagName('c'))){
        const type=c.getAttribute('t'),v=c.getElementsByTagName('v')[0]?.textContent??'';
        cells[columnIndex(c.getAttribute('r'))]=type==='inlineStr'?textOf(c):type==='s'?shared[Number(v)]??'':v;
      }
      rows.push(Array.from(cells,cell=>cell??''));
    }
    sheets.push({name:sheet.getAttribute('name')||'Sheet',rows,more});
  }
  return sheets;
}
/** A CSV file as rows of cells. */
export async function readCsvRows(blob){
  const text=await blob.text(),rows=[];let row=[],cell='',quoted=false;
  for(let i=0;i<text.length;i++){
    const ch=text[i];
    if(quoted){if(ch==='"'&&text[i+1]==='"'){cell+='"';i++;}else if(ch==='"')quoted=false;else cell+=ch;continue;}
    if(ch==='"')quoted=true;else if(ch===','){row.push(cell);cell='';}else if(ch==='\n'||ch==='\r'){if(ch==='\r'&&text[i+1]==='\n')i++;row.push(cell);rows.push(row);row=[];cell='';}else cell+=ch;
  }
  if(cell||row.length){row.push(cell);rows.push(row);}
  return rows;
}
