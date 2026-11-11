// The directory is maintained in Caliber Pulse Masters (C-Dir masters). Inside Caliber Pulse the page
// swaps in that live data, loaded with the signed-in session, before it starts; the
// embedded copy above is kept only for when live data cannot be loaded (for example
// when this file is opened on its own).
window.cdirDirectoryReady = (async function(){
  try{
    let token = "";
    for(const store of [window.localStorage, window.sessionStorage]){
      try{ const saved = JSON.parse(store.getItem("nerveCenterSession") || "null"); if(saved && saved.token){ token = saved.token; break; } }catch(e){}
    }
    if(!token) return;
    const response = await fetch("/api/cdir/directory", {cache:"no-store", headers:{Authorization:"Bearer "+token}});
    if(!response.ok) return;
    const live = await response.json();
    if(live && live.matrix && Array.isArray(live.sites)) document.getElementById("directory-data").textContent = JSON.stringify(live);
  }catch(e){}
})();
(async function(){
  await window.cdirDirectoryReady;
  function escapeHtml(value){
    return String(value??'').replace(/[&<>"']/g,char=>({
      '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;',
    })[char]);
  }


  const DATA = JSON.parse(document.getElementById('directory-data').textContent);
  const VIEWER = DATA.viewer || {profile:'all-user',label:'All directory',mySitesEnabled:false,siteIds:[],sites:[]};
  let directoryScope = 'all';
  let selectedRegion = 'ALL';
  const viewerSiteIds = new Set(Array.isArray(VIEWER.siteIds) ? VIEWER.siteIds : []);
  // Keep each position stable, including repeated employee IDs and vacant slots.
  const recordKeys = new Set();
  Object.keys(DATA.matrix).forEach(mk=>{
    const sid = mk.split('|')[0];
    (DATA.matrix[mk]||[]).forEach((p, index)=>{
      if(!p._k) p._k = p.empId ? ('id:'+p.empId) : ('nm:'+sid+'|'+(p.name||'')+'|'+(p.designation||''));
      if(recordKeys.has(p._k)) p._k += '|slot:'+mk+':'+index;
      recordKeys.add(p._k);
    });
  });
  const sitesById = Object.fromEntries(DATA.sites.map(s=>[s.id,s]));
  const CATS = DATA.categories;
  // Always list category A first, then A1, A2, B, B1, B2, C, C1, C2; within a category by rank, then name
  function catIdx(c){ const i = CATS.indexOf(c); return i<0 ? 999 : i; }
  function catOrderCmp(a,b){
    return catIdx(a.cat)-catIdx(b.cat) || (b.rank||0)-(a.rank||0) || (a.name||'zzz').localeCompare(b.name||'zzz');
  }

  // ---------- contact-number redaction (display-only; does not affect editing) ----------
  let redactPhones = false;
  try{ redactPhones = localStorage.getItem('cdcaliber_redactPhones')==='1'; }catch(e){}
  function maskPhone(v){
    if(!v) return v;
    const s = String(v);
    if(s.length<=4) return '•'.repeat(s.length);
    return s.slice(0,2) + '•'.repeat(s.length-4) + s.slice(-2);
  }
  function displayPhone(v){ return (redactPhones && v) ? maskPhone(v) : v; }
  function setRedact(on){
    redactPhones = on;
    try{ localStorage.setItem('cdcaliber_redactPhones', on?'1':'0'); }catch(e){}
    const btn = document.getElementById('btnRedact');
    if(btn) btn.textContent = on ? '\u{1F512} SHOW CONTACT NUMBERS' : '\u{1F512} HIDE CONTACT NUMBERS';
    document.body.classList.toggle('redact-on', on);
    render();
  }
  (function initRedactUI(){
    const btn = document.getElementById('btnRedact');
    if(btn) btn.textContent = redactPhones ? '\u{1F512} SHOW CONTACT NUMBERS' : '\u{1F512} HIDE CONTACT NUMBERS';
    document.body.classList.toggle('redact-on', redactPhones);
  })();

  // ---------- sidebar (auto-hide) ----------
  let sessionEditorName = null;
  (function(){
    const sidebar = document.getElementById('sidebar');
    const hotzone = document.getElementById('sidebarHotzone');
    const scrim = document.getElementById('sidebarScrim');
    const toggleBtn = document.getElementById('sidebarToggle');
    const pinBtn = document.getElementById('sidebarPin');
    if(!sidebar) return;
    let pinned = false;
    let hideTimer = null;
    function openSidebar(){
      clearTimeout(hideTimer);
      sidebar.classList.add('open');
      if(scrim) scrim.classList.toggle('show', window.innerWidth <= 900);
    }
    function closeSidebar(force){
      if(pinned && !force) return;
      sidebar.classList.remove('open');
      if(scrim) scrim.classList.remove('show');
    }
    function scheduleClose(){
      if(pinned) return;
      clearTimeout(hideTimer);
      hideTimer = setTimeout(()=> closeSidebar(), 450);
    }
    toggleBtn && toggleBtn.addEventListener('click', ()=>{
      if(sidebar.classList.contains('open')) closeSidebar(true);
      else openSidebar();
    });
    pinBtn && pinBtn.addEventListener('click', ()=>{
      pinned = !pinned;
      pinBtn.classList.toggle('pinned', pinned);
      pinBtn.title = pinned ? 'Unpin menu (auto-hide)' : 'Keep menu open';
      if(pinned) openSidebar(); else scheduleClose();
    });
    hotzone && hotzone.addEventListener('mouseenter', openSidebar);
    sidebar.addEventListener('mouseenter', ()=> clearTimeout(hideTimer));
    sidebar.addEventListener('mouseleave', scheduleClose);
    scrim && scrim.addEventListener('click', ()=> closeSidebar(true));
    document.addEventListener('keydown', (e)=>{ if(e.key==='Escape') closeSidebar(true); });
    sidebar.querySelectorAll('.tbtn').forEach(b=>{
      b.addEventListener('click', ()=>{ if(!pinned) closeSidebar(true); });
    });
  })();

  // ---------- viewer sign-in (a per-browser display name used for shared-edit attribution; not account authentication) ----------
  const SIGNIN_KEY = 'caliberDirectorySignedInName';
  function getSignedInName(){
    try{ return localStorage.getItem(SIGNIN_KEY) || null; }catch(e){ return null; }
  }
  function setSignedInName(name){
    try{ localStorage.setItem(SIGNIN_KEY, name); }catch(e){}
  }
  function clearSignedInName(){
    try{ localStorage.removeItem(SIGNIN_KEY); }catch(e){}
  }
  function escSidebar(s){
    return String(s).replace(/[&<>"']/g, c=> ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  }
  function renderSignInUI(){
    const wrap = document.getElementById('signInWrap');
    if(!wrap) return;
    const name = getSignedInName();
    if(name){
      wrap.innerHTML = '<div class="signin-status"><span class="signin-dot"></span>Editor: <b>'+escSidebar(name)+'</b></div>'+
        '<button class="tbtn sidebar-btn" id="btnSignOut">CLEAR EDITOR NAME</button>';
      const so = document.getElementById('btnSignOut');
      so && so.addEventListener('click', ()=>{
        clearSignedInName();
        sessionEditorName = null;
        renderSignInUI();
      });
    } else {
      wrap.innerHTML = '<button class="tbtn tbtn-add sidebar-btn" id="btnSignIn">&#128100; SET EDITOR NAME</button>';
      const si = document.getElementById('btnSignIn');
      si && si.addEventListener('click', ()=>{
        const n = (prompt('Enter your name for the directory edit log (this does not change your app login):') || '').trim();
        if(n){
          setSignedInName(n);
          sessionEditorName = n;
          renderSignInUI();
        }
      });
    }
  }

  // ---------- shared live editing (only active when opened as a Claude Artifact with the db capability granted) ----------
  let sharedDb = null;
  let sharedDbUnsub = null;
  function getEditorName(){
    if(!sessionEditorName){
      sessionEditorName = getSignedInName() || (prompt('Your name, so shared edits are attributed correctly:') || 'Unknown').trim() || 'Unknown';
    }
    return sessionEditorName;
  }
  function setLiveBadge(on){
    const el = document.getElementById('liveEditBadge');
    if(el) el.style.display = on ? 'inline-flex' : 'none';
  }
  async function pushPatchToSharedDb(key, patch){
    if(!sharedDb) return;
    try{
      const ref = sharedDb.collection('edits').doc(dbSafeId(key));
      const snap = await ref.get();
      const existing = (snap.exists ? snap.data() : {}) || {};
      delete existing._key;
      const merged = Object.assign({}, existing, patch, {
        _key: key,
        _editedBy: getEditorName(),
        _editedAt: new Date().toISOString(),
      });
      await ref.set(merged);
    }catch(err){
      alert('Saved on your screen, but could not sync to the shared link (' + (err && err.code || 'error') + '). It will retry on your next edit.');
    }
  }
  async function pushImportLogToSharedDb(entry){
    if(!sharedDb) return;
    try{
      const ref = sharedDb.doc('meta/importLog');
      const snap = await ref.get();
      const existing = (snap.exists && Array.isArray(snap.data().entries)) ? snap.data().entries : [];
      const entries = existing.concat([entry]).slice(-50);
      await ref.set({entries});
    }catch(err){ /* non-critical; local log still shows this session's entry */ }
  }
  function applyRemoteEditDoc(body){
    if(!body || !body._key) return;
    const patch = Object.assign({}, body);
    delete patch._key; delete patch._editedBy; delete patch._editedAt;
    applyPatchToStore(body._key, patch);
  }
  let sharedDbUnsubNew = null;
  async function initSharedDb(){
    if(!(window.claude && typeof window.claude.use === 'function')) return;
    let db = null;
    try{ db = await window.claude.use('db'); }catch(e){ db = null; }
    if(!db) return;
    sharedDb = db;
    setLiveBadge(true);
    sharedDbUnsub = sharedDb.collection('edits').onSnapshot(snap=>{
      let changed = false;
      snap.docChanges().forEach(ch=>{
        if(ch.type==='removed') return;
        applyRemoteEditDoc(ch.doc.data());
        changed = true;
      });
      if(changed) render();
    }, err=>{ /* subscription errors are non-fatal; local editing still works */ });
    sharedDbUnsubNew = sharedDb.collection('newRecords').onSnapshot(snap=>{
      let changed = false;
      snap.docChanges().forEach(ch=>{
        if(ch.type==='removed') return;
        if(applyRemoteNewRecordDoc(ch.doc.id, ch.doc.data())) changed = true;
      });
      if(changed) render();
    }, err=>{ /* subscription errors are non-fatal; local editing still works */ });
    try{
      const logSnap = await sharedDb.doc('meta/importLog').get();
      if(logSnap.exists && Array.isArray(logSnap.data().entries)){
        importLog = logSnap.data().entries;
        updateEditsNote();
      }
    }catch(e){}
  }

  // ---------- live clock ----------
  (function tickClock(){
    const el = document.getElementById('topClock');
    function pad(n){ return String(n).padStart(2,'0'); }
    function update(){
      const d = new Date();
      const dateStr = pad(d.getDate())+'-'+pad(d.getMonth()+1)+'-'+String(d.getFullYear()).slice(-2);
      let hrs = d.getHours();
      const ampm = hrs>=12 ? 'PM' : 'AM';
      hrs = hrs % 12; if(hrs===0) hrs = 12;
      const timeStr = pad(hrs)+':'+pad(d.getMinutes())+':'+pad(d.getSeconds())+' '+ampm;
      el.textContent = dateStr + '  ' + timeStr + ' IST';
    }
    update();
    setInterval(update, 1000);
  })();

  function flagMark(site){
    if(site.flag==='jayant_combined') return ' <span class="flag">*</span>';
    if(site.flag==='not_in_roster') return ' <span class="flag">&dagger;</span>';
    return '';
  }

  // ---------- derived data ----------
  function siteRoster(site){
    // all people at this site across categories, tagged with cat
    let out = [];
    CATS.forEach(cat=>{
      (DATA.matrix[site.id+'|'+cat]||[]).forEach(p=> out.push(Object.assign({cat, siteId:site.id, siteLabel:site.label}, p)));
    });
    out.sort(catOrderCmp);
    return out;
  }

  function allRosterUnique(){
    // dedupe jayant combined
    let out = [];
    const seen = new Set();
    DATA.sites.forEach(s=>{
      if(s.flag==='jayant_combined'){
        if(seen.has(s.dataKey)) return;
        seen.add(s.dataKey);
      }
      CATS.forEach(cat=>{
        (DATA.matrix[s.id+'|'+cat]||[]).forEach(p=> out.push(Object.assign({cat, siteId:s.id, siteLabel:s.label}, p)));
      });
    });
    out.sort(catOrderCmp);
    return out;
  }
  let FULL_ROSTER = allRosterUnique();
  let ALL_ROSTER = FULL_ROSTER;
  function refreshAllRoster(){
    FULL_ROSTER = allRosterUnique();
    ALL_ROSTER = directoryScope==='mine' ? FULL_ROSTER.filter((person)=>viewerSiteIds.has(person.siteId)) : FULL_ROSTER;
  }
  let chartTimer = null;

  // ---------- edit data (in-memory this session; export/import as JSON to persist) ----------
  let overrides = {};       // editKey -> {field: value, ...}
  let editedKeys = new Set();
  let addedKeys = new Set();     // editKey of records added via "Add New Employee" this session
  let addedDocIds = new Set();   // shared-db newRecords doc ids already applied, to avoid double-add on echo/reconnect
  let importLog = [];       // {by, at, file, applied, missed} - carried forward via export/import for traceability
  function editKey(p){ if(p && p._k) return p._k; return p.empId ? ('id:'+p.empId) : ('nm:'+(p.siteId||'')+'|'+(p.name||'')+'|'+(p.designation||'')); }
  function dbSafeId(key){
    let s = String(key).replace(/[^A-Za-z0-9_\-.~:@+]/g, '_');
    if(s.length > 180) s = s.slice(0,180);
    return s || 'unknown';
  }
  function findStoredPerson(key){
    for(const arr of Object.values(DATA.matrix)){
      const found = arr.find(x=> editKey(x)===key);
      if(found) return found;
    }
    return null;
  }
  function findStoredBucket(key){
    for(const mk of Object.keys(DATA.matrix)){
      const arr = DATA.matrix[mk]||[];
      const i = arr.findIndex(x=> editKey(x)===key);
      if(i>=0) return {mk, arr, i};
    }
    return null;
  }
  function fmtDateDisplay(iso){
    if(!iso) return '';
    const d = new Date(iso+'T00:00:00');
    if(isNaN(d.getTime())) return '';
    const months=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    return String(d.getDate()).padStart(2,'0')+'-'+months[d.getMonth()]+'-'+String(d.getFullYear()).slice(-2);
  }
  function applyPatchToStore(key, patch){
    const b = findStoredBucket(key);
    if(!b) return false;
    const stored = b.arr[b.i];
    if(!patch || typeof patch!=='object' || Array.isArray(patch)) return false;
    if(patch.cat && !CATS.includes(patch.cat)) return false;
    if(patch.status && !['ACTIVE','VACANT','RESIGNED'].includes(patch.status)) return false;
    patch = Object.fromEntries(Object.entries(patch).filter(([field])=>
      ['name','designation','cat','department','status','contact','whatsapp','emergencyContact','email',
       'dobISO','dob','dobMonth','dobDay','dojISO','doj','gender','uan','aadharMasked','reportingTo','level','localStatus'].includes(field)));
    Object.assign(stored, patch);
    // category change: move the record into the new category bucket so matrix, filters and counts update
    const [sid, oldCat] = b.mk.split('|');
    const newCat = patch.cat;
    if(newCat && newCat !== oldCat && CATS.indexOf(newCat) >= 0){
      b.arr.splice(b.i, 1);
      const nk = sid+'|'+newCat;
      if(!DATA.matrix[nk]) DATA.matrix[nk] = [];
      DATA.matrix[nk].push(stored);
      if(DATA.categoryTotalsUnique){
        DATA.categoryTotalsUnique[oldCat] = Math.max(0,(DATA.categoryTotalsUnique[oldCat]||0) - 1);
        DATA.categoryTotalsUnique[newCat] = (DATA.categoryTotalsUnique[newCat]||0) + 1;
      }
      try{ renderTopPills(); }catch(e){}
    }
    overrides[key] = Object.assign({}, overrides[key]||{}, patch);
    editedKeys.add(key);
    recountDirectory();
    refreshAllRoster();
    updateEditsNote();
    return true;
  }

  function recountDirectory(){
    const categories = {};
    let sanctioned = 0, filled = 0, vacant = 0, resigned = 0;
    const departments = new Set();
    DATA.sites.forEach(site=>{
      const rows = CATS.flatMap(cat=>{
        const bucket = DATA.matrix[site.id+'|'+cat] || [];
        categories[cat] = (categories[cat]||0) + bucket.length;
        return bucket;
      });
      const stats = {sanctioned:rows.length, filled:0, vacant:0, resigned:0};
      rows.forEach(p=>{
        if(p.status==='VACANT') stats.vacant++;
        else if(p.status==='RESIGNED') stats.resigned++;
        else stats.filled++;
        if(p.department) departments.add(p.department);
      });
      DATA.siteTotals[site.id] = rows.length;
      DATA.siteStats[site.id] = stats;
      if(rows.length && site.flag==='not_in_roster') site.flag = null;
      sanctioned += stats.sanctioned; filled += stats.filled;
      vacant += stats.vacant; resigned += stats.resigned;
    });
    Object.assign(DATA.meta, {totalStaffSanctioned:sanctioned, totalFilled:filled,
      totalVacant:vacant, totalResigned:resigned, totalDepartments:departments.size,
      totalSitesOffices:DATA.sites.filter(site=>DATA.siteTotals[site.id]>0).length});
    DATA.categoryTotalsUnique = categories;
    refreshAllRoster();
    renderTopPills();
  }

  // ---------- add new employee (creates a brand-new record; distinct from editing an existing one) ----------
  function defaultRankFor(siteId, cat){
    const arr = DATA.matrix[siteId+'|'+cat] || [];
    if(arr.length){
      const counts = {};
      arr.forEach(p=>{ if(typeof p.rank==='number'){ counts[p.rank] = (counts[p.rank]||0)+1; } });
      let best=null, bestN=-1;
      Object.keys(counts).forEach(r=>{ if(counts[r]>bestN){ bestN=counts[r]; best=Number(r); } });
      if(best!==null) return best;
    }
    const all = [];
    DATA.sites.forEach(s=>{ (DATA.matrix[s.id+'|'+cat]||[]).forEach(p=>{ if(typeof p.rank==='number') all.push(p.rank); }); });
    if(all.length){ all.sort((a,b)=>a-b); return all[Math.floor(all.length/2)]; }
    return 30;
  }
  function bumpCountsForAdd(siteId, cat, status){
    DATA.siteTotals[siteId] = (DATA.siteTotals[siteId]||0) + 1;
    DATA.categoryTotalsUnique[cat] = (DATA.categoryTotalsUnique[cat]||0) + 1;
    DATA.meta.totalStaffSanctioned = (DATA.meta.totalStaffSanctioned||0) + 1;
    const st = DATA.siteStats[siteId] = DATA.siteStats[siteId] || {sanctioned:0, filled:0, vacant:0};
    st.sanctioned += 1;
    if(status==='VACANT'){
      DATA.meta.totalVacant = (DATA.meta.totalVacant||0) + 1;
      st.vacant += 1;
    } else {
      DATA.meta.totalFilled = (DATA.meta.totalFilled||0) + 1;
      st.filled += 1;
    }
  }
  function addNewRecordToStore(siteId, cat, record, sourceDocId){
    if(!sitesById[siteId] || !CATS.includes(cat)) return false;
    if(sourceDocId && addedDocIds.has(sourceDocId)) return false;
    const key = editKey(record);
    if(findStoredPerson(key)){
      if(sourceDocId) addedDocIds.add(sourceDocId);
      return false;
    }
    const arrKey = siteId+'|'+cat;
    if(!record._k) record._k = key;
    if(!DATA.matrix[arrKey]) DATA.matrix[arrKey] = [];
    DATA.matrix[arrKey].push(record);
    if(!DATA.sites.some(s=>s.id===siteId)) { /* unknown site id, ignore gracefully */ }
    if(sourceDocId) addedDocIds.add(sourceDocId);
    addedKeys.add(key);
    bumpCountsForAdd(siteId, cat, record.status);
    recountDirectory();
    refreshAllRoster();
    renderTopPills();
    updateEditsNote();
    return true;
  }
  async function pushNewRecordToSharedDb(siteId, cat, record, docId){
    if(!sharedDb) return;
    try{
      const ref = sharedDb.collection('newRecords').doc(docId);
      await ref.set(Object.assign({}, record, {
        _siteId: siteId, _cat: cat, _addedBy: getEditorName(), _addedAt: new Date().toISOString(),
      }));
    }catch(err){
      alert('Saved on your screen, but could not sync the new employee to the shared link (' + (err && err.code || 'error') + '). It will retry on your next add/edit.');
    }
  }
  function applyRemoteNewRecordDoc(docId, body){
    if(!body || !body._siteId || !body._cat) return false;
    const rec = Object.assign({}, body);
    delete rec._siteId; delete rec._cat; delete rec._addedBy; delete rec._addedAt;
    return addNewRecordToStore(body._siteId, body._cat, rec, docId);
  }
  function refreshNotifBadge(){
    const badge = document.getElementById('notifBadge'), bell = document.getElementById('notifBellBtn');
    if(!badge) return;
    const total = (+badge.dataset.base||0) + (window.__editsNotif?1:0);
    badge.textContent = total>99 ? '99+' : String(total);
    badge.style.display = total>0 ? 'flex' : 'none';
    if(bell) bell.classList.toggle('has-alerts', total>0);
    const pb = document.getElementById('notifPanelBody'), emp = pb && pb.querySelector('.notif-empty');
    if(emp) emp.style.display = window.__editsNotif ? 'none' : '';
  }
  function updateEditsNote(){
    const note = document.getElementById('editsNote');
    const discardBtn = document.getElementById('btnDiscardEdits');
    const nEdited = editedKeys.size;
    const nAdded = addedKeys.size;
    if(nEdited>0 || nAdded>0 || importLog.length>0){
      note.style.display='none';
      let html = '';
      if(nAdded>0){
        html += sharedDb
          ? `&#10133; <b>${nAdded}</b> new employee record${nAdded>1?'s':''} added via shared live editing &mdash; synced to everyone who opens this link.<br/>`
          : `&#10133; <b>${nAdded}</b> new employee record${nAdded>1?'s':''} added this session (in-browser memory only &mdash; export the roster to keep a copy).<br/>`;
      }
      if(nEdited>0){
        html += sharedDb
          ? `&#9998; <b>${nEdited}</b> record${nEdited>1?'s':''} corrected via shared live editing &mdash; synced to everyone who opens this link.`
          : `&#9998; <b>${nEdited}</b> record${nEdited>1?'s':''} edited this session (in-browser memory only &mdash; export to keep them, they are lost on refresh unless exported).`;
      }
      if(importLog.length>0){
        html += `<div class="import-log"><b>Import log:</b>` +
          importLog.slice().reverse().map(l=>
            `<div>&#8593; ${l.applied} applied${l.missed?`, ${l.missed} not found`:''} from &ldquo;${escSidebar(l.file)}&rdquo; by <b>${escSidebar(l.by)}</b> &mdash; ${escSidebar(l.at)}</div>`
          ).join('') + `</div>`;
      }
      note.innerHTML = '';
      const ne = document.getElementById('notifEdits');
      if(ne) ne.innerHTML = `<div class="notif-item"><div class="ni-label">&#9998; Directory updates</div><div class="ni-row">${html}</div></div>`;
      window.__editsNotif = 1; refreshNotifBadge();
      discardBtn.style.display = ((nEdited>0||nAdded>0) && !sharedDb) ? 'inline-flex' : 'none';
    } else {
      note.style.display='none';
      discardBtn.style.display='none';
      const ne = document.getElementById('notifEdits'); if(ne) ne.innerHTML = '';
      window.__editsNotif = 0; refreshNotifBadge();
    }
  }

  function categoryRosterAllSites(cat){
    return ALL_ROSTER.filter((person)=>person.cat===cat).sort(catOrderCmp);
  }

  // ---------- cascading Site -> Department -> Designation search ----------
  function rosterForFilterSite(siteId, region){
    if(!siteId) return !region||region==='ALL' ? ALL_ROSTER : ALL_ROSTER.filter((person)=>(sitesById[person.siteId]||{}).group===region);
    const site = sitesById[siteId];
    if(!site || site.flag==='not_in_roster') return [];
    if(directoryScope==='mine'&&!viewerSiteIds.has(siteId)) return [];
    return siteRoster(site).filter((person)=>directoryScope!=='mine'||viewerSiteIds.has(person.siteId));
  }
  function departmentsForFilter(siteId, region){
    const list = rosterForFilterSite(siteId,region);
    return Array.from(new Set(list.map(p=>p.department).filter(Boolean))).sort();
  }
  function designationsForFilter(siteId, dept, region){
    let list = rosterForFilterSite(siteId,region);
    if(dept) list = list.filter(p=>p.department===dept);
    return Array.from(new Set(list.map(p=>p.designation).filter(Boolean))).sort();
  }
  function peopleForFilter(siteId, dept, desig, name, region){
    let list = rosterForFilterSite(siteId,region);
    if(dept) list = list.filter(p=>p.department===dept);
    if(desig) list = list.filter(p=>p.designation===desig);
    if(name){
      const q = name.trim().toLowerCase();
      if(q) list = list.filter(p=> p.name && p.name.toLowerCase().includes(q));
    }
    return list;
  }

  function topOfficials(list, n){
    const out = [];
    const seenNames = new Set();
    for(const p of list){
      if(!p.name || seenNames.has(p.name)) continue;
      seenNames.add(p.name);
      out.push(p);
      if(out.length>=n) break;
    }
    return out;
  }

  function uniqueDeptCount(list){
    return new Set(list.map(p=>p.department).filter(Boolean)).size;
  }

  // ---------- today's birthdays & work anniversaries ----------
  const today = new Date();
  const todayM = today.getMonth()+1, todayD = today.getDate();
  const birthdayPeople = (function(){
    const seen = new Set();
    const out = [];
    ALL_ROSTER.forEach(p=>{
      if(p.name && p.dobMonth===todayM && p.dobDay===todayD && !seen.has(p.name)){
        seen.add(p.name);
        out.push(p);
      }
    });
    return out;
  })();
  const anniversaryPeople = (function(){
    const seen = new Set();
    const out = [];
    ALL_ROSTER.forEach(p=>{
      if(!p.name || !p.dojISO || seen.has(p.name)) return;
      const d = new Date(p.dojISO+'T00:00:00');
      if(isNaN(d.getTime())) return;
      if(d.getMonth()+1===todayM && d.getDate()===todayD){
        const yrs = today.getFullYear() - d.getFullYear();
        if(yrs>0){ seen.add(p.name); out.push(Object.assign({}, p, {anniversaryYears: yrs})); }
      }
    });
    return out;
  })();
  // ---------- header notification bell: click to reveal birthday/anniversary details ----------
  const dateStr = today.toLocaleDateString('en-GB', {day:'2-digit', month:'short'});
  const notifGroups = [];
  if(birthdayPeople.length){
    notifGroups.push({
      icon:'&#127874;', label:`${birthdayPeople.length} birthday${birthdayPeople.length>1?'s':''} today (${dateStr})`,
      people: birthdayPeople.map(p=>({person:p, meta:`${escapeHtml(p.designation)}${p.siteLabel?', '+escapeHtml(p.siteLabel):''}`}))
    });
  }
  if(anniversaryPeople.length){
    notifGroups.push({
      icon:'&#127881;', label:`${anniversaryPeople.length} work anniversar${anniversaryPeople.length>1?'ies':'y'} today (${dateStr})`,
      people: anniversaryPeople.map(p=>({person:p, meta:`${p.anniversaryYears} yr${p.anniversaryYears>1?'s':''} &middot; ${escapeHtml(p.designation)}${p.siteLabel?', '+escapeHtml(p.siteLabel):''}`}))
    });
  }
  const notifTotal = birthdayPeople.length + anniversaryPeople.length;
  const notifBellBtn = document.getElementById('notifBellBtn');
  const notifBadge = document.getElementById('notifBadge');
  const notifPanel = document.getElementById('notifPanel');
  const notifPanelBody = document.getElementById('notifPanelBody');
  const notifPanelClose = document.getElementById('notifPanelClose');
  const notifWrap = document.getElementById('notifWrap');

  notifBadge.dataset.base = String(notifTotal);

  notifPanelBody.innerHTML = notifGroups.length ? notifGroups.map((grp,gi)=>`
    <div class="notif-item">
      <div class="ni-label">${grp.icon} ${grp.label}</div>
      ${grp.people.map((pp,pi)=>`<div class="ni-row"><span class="ni-name" data-grp="${gi}" data-idx="${pi}">${escapeHtml(pp.person.name)}</span> <span class="ni-meta">(${pp.meta})</span></div>`).join('')}
    </div>`).join('') : `<div class="notif-empty">No birthdays or work anniversaries today.</div>`;
  refreshNotifBadge();

  notifPanelBody.querySelectorAll('.ni-name').forEach(el=>{
    el.addEventListener('click', ()=>{
      const pp = notifGroups[+el.dataset.grp].people[+el.dataset.idx];
      notifPanel.classList.remove('show');
      go({type:'person', person: pp.person});
    });
  });
  notifBellBtn.addEventListener('click', (e)=>{
    e.stopPropagation();
    notifPanel.classList.toggle('show');
  });
  notifPanelClose.addEventListener('click', ()=> notifPanel.classList.remove('show'));
  document.addEventListener('click', (e)=>{
    if(notifPanel.classList.contains('show') && !notifWrap.contains(e.target)) notifPanel.classList.remove('show');
  });

  // ---------- data notes / alerts ----------
  function refreshDataNotes(){
  const alerts = [];
  DATA.sites.forEach(s=>{
    if(s.flag==='not_in_roster') alerts.push({html:`<b>${escapeHtml(s.label)}</b> has no entries in the uploaded roster yet. Click to open it.`, go:{type:'site', site:s.id}});
  });
  alerts.push({html:`<b>${escapeHtml(DATA.meta.totalVacant)}</b> sanctioned positions are vacant company-wide (${escapeHtml(DATA.meta.totalFilled)} of ${escapeHtml(DATA.meta.totalStaffSanctioned)} filled). Click to list them.`, go:{type:'vacant'}});
  document.getElementById('alertCount').textContent = alerts.length;
  document.getElementById('alertDetail').innerHTML =
    alerts.map((a,i)=>`<div class="clickable" data-anote="${i}">&bull; ${a.html}</div>`).join('') +
    `<div class="snapshot-note">&bull; Roster snapshot generated: <b>${escapeHtml(DATA.meta.generated)}</b> &mdash; this is the whole-directory upload date; per-site update dates aren't tracked separately in the source file.</div>`;
  document.getElementById('alertDetail').querySelectorAll('[data-anote]').forEach(el=>{
    el.addEventListener('click', ()=>{
      const a = alerts[+el.dataset.anote];
      if(a && a.go){ go(a.go); document.getElementById('notesPanel').classList.remove('show'); }
    });
  });
  }
  refreshDataNotes();
  const notesPanel = document.getElementById('notesPanel'), notesWrap = document.getElementById('notesWrap');
  document.getElementById('notesBellBtn').addEventListener('click', (e)=>{
    e.stopPropagation();
    const np = document.getElementById('notifPanel'); if(np) np.classList.remove('show');
    notesPanel.classList.toggle('show');
  });
  document.getElementById('notesPanelClose').addEventListener('click', ()=> notesPanel.classList.remove('show'));
  document.addEventListener('click', (e)=>{
    if(notesPanel.classList.contains('show') && !notesWrap.contains(e.target)) notesPanel.classList.remove('show');
  });
  document.getElementById('notifBellBtn').addEventListener('click', ()=> notesPanel.classList.remove('show'));
  const _btnNotes = document.getElementById('btnNotes');
  if(_btnNotes) _btnNotes.addEventListener('click', (e)=>{
    e.stopPropagation(); notesPanel.classList.add('show'); window.scrollTo({top:0, behavior:'auto'});
  });

  // ---------- pills ----------
  const sitePillsEl = document.getElementById('sitePills');
  const catPillsEl = document.getElementById('catPills');
  const groupPillsEl = document.getElementById('groupPills');
  const regionPillsEl = document.getElementById('regionPills');
  const ALL_ID = '__ALL__';
  const DASH_ID = '__DASH__';

  // ---------- WCL / NCL office groupings ----------
  const GROUP_DEFS = {
    WCL: {label:'WCL', full:'WCL (Western Coalfields Ltd.) Sites', ids: DATA.sites.filter(s=>s.group==='WCL').map(s=>s.id)},
    NCL: {label:'NCL', full:'NCL (Northern Coalfields Ltd.) Sites', ids: DATA.sites.filter(s=>s.group==='NCL').map(s=>s.id)},
  };
  function activeSites(){ return DATA.sites.filter((site)=>directoryScope!=='mine'||viewerSiteIds.has(site.id)); }
  function sitesForRegion(region){ return activeSites().filter((site)=>region==='ALL'||site.group===region); }
  function rosterCountForSites(ids){ const selected=new Set(ids); return ALL_ROSTER.filter((person)=>selected.has(person.siteId)).length; }
  function groupCount(ids){ return rosterCountForSites(ids); }
  function regionCount(region){ return rosterCountForSites(sitesForRegion(region).map((site)=>site.id)); }

  // rebuilds the site/category/group pill rows from current DATA counts and rebinds their click
  // handlers; called at startup and again whenever a new employee record changes those counts.
  function renderTopPills(){
    const filteredSites=sitesForRegion(selectedRegion);
    const pillDefs = (directoryScope==='all' ? [{id:DASH_ID, label:'&#128202; Dashboard', count:null}] : [])
      .concat([{id:ALL_ID,label:directoryScope==='mine'?'My Sites':'All Sites',count:regionCount(selectedRegion)}])
      .concat(filteredSites.map(s=>({id:s.id, label:s.label, flag:s.flag, count: rosterCountForSites([s.id])})));
    regionPillsEl.innerHTML = '<span class="lbl">Region:</span>' + ['ALL','WCL','NCL'].map((region)=>
      `<button class="tag${selectedRegion===region?' active':''}" data-region="${region}">${region==='ALL'?'All':region} <span class="tag-count">(${regionCount(region)})</span></button>`).join('');
    sitePillsEl.innerHTML = pillDefs.map(p=>
      `<button class="pill" data-site="${escapeHtml(p.id)}">${escapeHtml(p.label)}${p.flag==='jayant_combined'?' <span class="flag">*</span>':''}${p.flag==='not_in_roster'?' <span class="flag">&dagger;</span>':''}${p.count!==null?` <span class="pill-count">(${p.count})</span>`:''}</button>`
    ).join('');

    catPillsEl.innerHTML = directoryScope==='mine' ? '' : '<span class="lbl">&#128269; Cross-drill by category:</span>' +
      CATS.map(c=>`<button class="tag" data-cat="${escapeHtml(c)}">${escapeHtml(c)} <span class="tag-count">(${escapeHtml(DATA.categoryTotalsUnique[c]||0)})</span></button>`).join('');

    groupPillsEl.innerHTML = directoryScope==='mine' ? '' : '<span class="lbl">&#127959;&#65039; Group by company:</span>' +
      Object.keys(GROUP_DEFS).map(g=>`<button class="tag" data-group="${g}">${GROUP_DEFS[g].label} <span class="tag-count">(${groupCount(GROUP_DEFS[g].ids)})</span></button>`).join('');

    regionPillsEl.querySelectorAll('.tag').forEach((button)=>{
      button.addEventListener('click',()=>{
        selectedRegion=button.dataset.region;
        renderTopPills();
        go({type:'siteDeptDesig',region:selectedRegion,site:'',dept:'',desig:'',name:''},{replace:current().type==='siteDeptDesig'});
      });
    });

    sitePillsEl.querySelectorAll('.pill').forEach(p=>{
      p.addEventListener('click', ()=>{
        if(p.dataset.site===DASH_ID) go({type:'dashboard'}, {replace: stack.length===1});
        else if(p.dataset.site===ALL_ID) go({type:'siteDeptDesig',region:selectedRegion,site:'',dept:'',desig:'',name:''},{replace:stack.length===1});
        else {
          selectedRegion=(sitesById[p.dataset.site]||{}).group||selectedRegion;
          go({type:'site', site:p.dataset.site}, {replace: stack.length===1});
        }
      });
    });
    catPillsEl.querySelectorAll('.tag').forEach(t=>{
      t.addEventListener('click', ()=> go({type:'category', cat:t.dataset.cat}));
    });
    groupPillsEl.querySelectorAll('.tag').forEach(t=>{
      t.addEventListener('click', ()=> go({type:'group', group:t.dataset.group}));
    });
    // re-apply the current active highlight (pills were just rebuilt from scratch)
    if(typeof render==='function' && typeof current==='function' && stack && stack.length){
      const v = current();
      sitePillsEl.querySelectorAll('.pill').forEach(p=> p.classList.toggle('active', (v.type==='site' && p.dataset.site===v.site) || (v.type==='dashboard' && p.dataset.site===DASH_ID) || (v.type==='siteDeptDesig'&&!v.site&&p.dataset.site===ALL_ID)));
      catPillsEl.querySelectorAll('.tag').forEach(t=> t.classList.toggle('active', v.type==='category' && t.dataset.cat===v.cat));
      groupPillsEl.querySelectorAll('.tag').forEach(t=> t.classList.toggle('active', v.type==='group' && t.dataset.group===v.group));
    }
  }

  // ---------- auto-hide dock for site / group / category pills ----------
  const navDock = document.getElementById('navDock');
  const navDockBar = document.getElementById('navDockBar');
  const navDockCur = document.getElementById('navDockCur');
  let navDockTimer = null;
  function setNavDock(open){
    clearTimeout(navDockTimer);
    navDock.classList.toggle('open', open);
    navDockBar.setAttribute('aria-expanded', open ? 'true' : 'false');
  }
  function updateNavDock(v){
    let lbl = null;
    if(v.type==='dashboard') lbl = 'Dashboard';
    else if(v.type==='site') lbl = v.site===ALL_ID ? 'All Sites' : ((DATA.sites.find(s=>s.id===v.site)||{}).label || v.site);
    else if(v.type==='group') lbl = (GROUP_DEFS[v.group]||{}).full || v.group;
    else if(v.type==='category') lbl = 'Category: ' + v.cat;
    else if(v.type==='siteDeptDesig') lbl = 'Region '+((v.region||'ALL')==='ALL'?'All':v.region)+' &rsaquo; '+(v.site ? ((DATA.sites.find(s=>s.id===v.site)||{}).label||v.site) : (directoryScope==='mine'?'My Sites':'All Sites')) + (v.dept?' &rsaquo; '+v.dept:'') + (v.desig?' &rsaquo; '+v.desig:'');
    if(!lbl) lbl = ({matrix:'Category matrix',chart:'Employee chart',vacant:'Vacancies',person:'Employee profile',personEdit:'Edit employee',newPerson:'Add employee'})[v.type] || 'Directory';
    navDockCur.textContent = lbl.replace(/&rsaquo;/g, '›');
  }
  // manual show/hide: only the bar button opens or closes the dock; the choice is remembered in this browser
  function navDockSaved(){ try{ return localStorage.getItem('navDockOpen'); }catch(e){ return null; } }
  function navDockRemember(open){ try{ localStorage.setItem('navDockOpen', open ? '1' : '0'); }catch(e){} }
  function refreshNavDockHint(){
    const h = document.getElementById('navDockHintTxt');
    if(h) h.textContent = navDock.classList.contains('open') ? 'Hide sites & filters' : 'Show sites & filters';
  }
  navDockBar.addEventListener('click', ()=>{
    const open = !navDock.classList.contains('open');
    setNavDock(open); navDockRemember(open); refreshNavDockHint();
  });
  setNavDock(navDockSaved() !== '0');
  refreshNavDockHint();

  // ---------- navigation state ----------
  // history stack of {type, ...}
  let stack = [{type:'dashboard'}];
  const backBtn = document.getElementById('backBtn');
  const contentEl = document.getElementById('content');
  let sortState = {key:null, dir:1};
  let teamEditOpen = false;   // toggles the add/remove editor under "Team Members" on a person view
  let pendingRemoveKey = null; // editKey awaiting inline "Remove? Yes/No" confirmation
  let teamAddPick = null;      // candidate object picked from the team-add search, awaiting "Add to Team"

  function current(){ return stack[stack.length-1]; }

  function go(view, opts){
    opts = opts || {};
    if(opts.replace) stack[stack.length-1] = view; else stack.push(view);
    sortState = {key:null, dir:1};
    teamEditOpen = false;
    pendingRemoveKey = null;
    teamAddPick = null;
    render();
  }
  function back(){
    if(stack.length>1) stack.pop();
    else if(directoryScope==='mine'&&current().type!=='siteDeptDesig') stack[0] = {type:'siteDeptDesig',region:'ALL',site:'',dept:'',desig:'',name:''};
    else if(directoryScope==='all'&&current().type!=='dashboard') stack[0] = {type:'dashboard'};
    sortState = {key:null, dir:1};
    teamEditOpen = false;
    pendingRemoveKey = null;
    teamAddPick = null;
    render();
  }
  backBtn.addEventListener('click', back);

  // ---------- All / My Site(s) role-aware directory scope ----------
  const scopeAllBtn=document.getElementById('scopeAll');
  const scopeMineBtn=document.getElementById('scopeMine');
  const profileBadge=document.getElementById('directoryProfileBadge');
  function refreshDirectoryProfile(){
    scopeAllBtn.classList.toggle('active',directoryScope==='all');
    scopeMineBtn.classList.toggle('active',directoryScope==='mine');
    scopeAllBtn.setAttribute('aria-selected',directoryScope==='all'?'true':'false');
    scopeMineBtn.setAttribute('aria-selected',directoryScope==='mine'?'true':'false');
    document.body.classList.toggle('scope-mine',directoryScope==='mine');
    const assigned=viewerSiteIds.size;
    profileBadge.dataset.profile=VIEWER.profile||'all-user';
    profileBadge.textContent=VIEWER.mySitesEnabled
      ? `${VIEWER.label} profile · ${directoryScope==='mine'?(assigned?assigned+' assigned site'+(assigned===1?'':'s'):'no matched site assignment'):'All directory'}`
      : 'All directory';
  }
  function setDirectoryScope(scope){
    if(scope==='mine'&&!VIEWER.mySitesEnabled)return;
    directoryScope=scope;
    selectedRegion='ALL';
    refreshAllRoster();
    refreshDirectoryProfile();
    stack=[scope==='mine'?{type:'siteDeptDesig',region:'ALL',site:'',dept:'',desig:'',name:''}:{type:'dashboard'}];
    renderTopPills();
    render();
  }
  if(VIEWER.mySitesEnabled){
    scopeMineBtn.style.display='';
    scopeMineBtn.textContent=viewerSiteIds.size===1?'My Site':'My Site(s)';
  }
  scopeAllBtn.addEventListener('click',()=>setDirectoryScope('all'));
  scopeMineBtn.addEventListener('click',()=>setDirectoryScope('mine'));
  refreshDirectoryProfile();

  // ---------- sorting ----------
  const SORT_ACCESSORS = {
    name: p => (p.name || '￿'),
    cat: p => String(catIdx(p.cat)).padStart(3,'0'),
    designation: p => (p.designation || ''),
    department: p => (p.department || ''),
    site: p => (p.siteLabel || ''),
    reportingTo: p => (p.reportingTo || ''),
    contact: p => (p.contact || ''),
    status: p => (p.status || ''),
  };
  function sortRows(list, key, dir){
    const acc = SORT_ACCESSORS[key];
    if(!acc) return list;
    return [...list].sort((a,b)=>{
      const va = acc(a), vb = acc(b);
      const cmp = String(va).localeCompare(String(vb), undefined, {numeric:true, sensitivity:'base'});
      return cmp * dir;
    });
  }
  function sortArrow(key){
    if(sortState.key !== key) return '';
    return sortState.dir===1 ? ' &#9650;' : ' &#9660;';
  }
  function attachSortHandlers(root, list, opts, rerender){
    root.querySelectorAll('table.roster thead th[data-sortkey]').forEach(th=>{
      th.addEventListener('click', ()=>{
        const key = th.dataset.sortkey;
        if(sortState.key === key) sortState.dir *= -1;
        else { sortState.key = key; sortState.dir = 1; }
        rerender();
      });
    });
  }

  function statusBadge(st){
    if(st==='VACANT') return '<span class="status-vacant">VACANT</span>';
    if(st==='RESIGNED') return '<span class="status-resigned">RESIGNED</span>';
    return '<span class="status-active">ACTIVE</span>';
  }
  function personRow(p, opts, srNo){
    opts = opts||{};
    const nameHtml = p.name
      ? `<span class="nm" data-person="1">${p.rank>=88?'<span class=\"star\">&#9733;</span> ':''}${escapeHtml(p.name)}${(p.dobMonth===todayM&&p.dobDay===todayD)?' &#127874;':''}</span>`
      : `<span class="nm vacant vacant-open" title="Open this vacant post">Vacant post</span> <button class="edit-btn row-edit-vacant" title="Edit / fill this vacant post">&#9998; EDIT</button>`;
    const statusHtml = statusBadge(p.status);
    const contactShown = displayPhone(p.contact);
    const contactHtml = p.contact ? `<a class="contact-link" href="tel:${escapeHtml(p.contact)}">&#9742; ${escapeHtml(contactShown)}</a>` : '&mdash;';
    return `<tr data-rowperson='${escapeHtml(JSON.stringify(p))}'>
      <td class="rk">${srNo}</td>
      <td>${nameHtml}</td>
      <td><span class="badge-cat">${escapeHtml(p.cat||'')}</span></td>
      <td>${escapeHtml(p.designation||'')}</td>
      <td>${escapeHtml(p.department||'')}</td>
      ${opts.showSite? `<td>${escapeHtml(p.siteLabel||'')}</td>` : ''}
      <td>${p.reportingTo?escapeHtml(p.reportingTo):'&mdash;'}</td>
      <td>${contactHtml}</td>
      <td>${statusHtml}</td>
    </tr>`;
  }

  function rosterTable(list, opts){
    opts = opts||{};
    if(!list.length) return `<div class="empty-state">No officials on record for this selection.</div>`;
    const sorted = sortState.key ? sortRows(list, sortState.key, sortState.dir) : list;
    const cols = [
      ['', 'Sr No', null],
      ['name', 'Name', null],
      ['cat', 'Cat', null],
      ['designation', 'Designation', null],
      ['department', 'Department', null],
      ...(opts.showSite ? [['site', 'Site / Office', null]] : []),
      ['reportingTo', 'Reports To', null],
      ['contact', 'Contact', null],
      ['status', 'Status', null],
    ];
    const thead = cols.map(([key,label])=>
      key ? `<th data-sortkey="${key}" class="sortable">${label}${sortArrow(key)}</th>` : `<th>${label}</th>`
    ).join('');
    return `<div class="roster-scroll"><table class="roster">
      <thead><tr>${thead}</tr></thead>
      <tbody>${sorted.map((p,i)=>personRow(p,opts,i+1)).join('')}</tbody>
    </table></div>`;
  }

  function cardHtml(p){
    if(!p || !p.name){
      return `<div class="card vacant"><div class="k">Vacant</div><div class="v">&mdash;</div></div>`;
    }
    return `<div class="card">
      <div class="k">${escapeHtml(p.designation)}</div>
      <div class="v" data-person='${escapeHtml(JSON.stringify(p))}'>${escapeHtml(p.name)}</div>
      <div class="p">${escapeHtml(p.siteLabel || p.department || '')}</div>
    </div>`;
  }

  function attachRowHandlers(root){
    root.querySelectorAll('.nm[data-person], [data-person]').forEach(()=>{});
    root.querySelectorAll('tr[data-rowperson]').forEach(tr=>{
      const nm = tr.querySelector('.nm[data-person]');
      if(!nm) return;
      nm.addEventListener('click', ()=>{
        const p = JSON.parse(tr.getAttribute('data-rowperson'));
        go({type:'person', person:p});
      });
    });
    root.querySelectorAll('tr[data-rowperson] .vacant-open').forEach(el=>{
      el.addEventListener('click', ()=>{
        const p = JSON.parse(el.closest('tr').getAttribute('data-rowperson'));
        go({type:'person', person:p});
      });
    });
    root.querySelectorAll('tr[data-rowperson] .row-edit-vacant').forEach(btn=>{
      btn.addEventListener('click', (e)=>{
        e.stopPropagation();
        const p = JSON.parse(btn.closest('tr').getAttribute('data-rowperson'));
        stack.push({type:'person', person:p});
        go({type:'personEdit', person:p});
      });
    });
    root.querySelectorAll('.card .v[data-person]').forEach(v=>{
      v.addEventListener('click', ()=>{
        const p = JSON.parse(v.getAttribute('data-person'));
        go({type:'person', person:p});
      });
    });
  }

  // ---------- renderers ----------
  function renderSiteView(siteId){
    if(directoryScope==='mine'&&siteId!==ALL_ID&&!viewerSiteIds.has(siteId)){
      contentEl.innerHTML='<div class="empty-state">This site is outside your assigned My Site(s) scope.</div>';
      return;
    }
    let title, roster, cards, coverage, exportRows;
    if(siteId===ALL_ID){
      title = 'CMLL &mdash; All Sites Overview';
      roster = ALL_ROSTER.filter(p=>p.cat==='A' || p.cat==='A1');
      cards = topOfficials(ALL_ROSTER, 3);
      const deptCount = DATA.meta.totalDepartments;
      coverage = `Coverage: <b>${escapeHtml(DATA.meta.totalStaffSanctioned)}</b> sanctioned positions &middot; <b>${escapeHtml(DATA.meta.totalFilled)}</b> filled / <b>${escapeHtml(DATA.meta.totalVacant)}</b> vacant &middot; <b>${escapeHtml(DATA.meta.totalSitesOffices)}</b> sites reporting &middot; <b>${deptCount}</b> departments &middot; roster snapshot ${escapeHtml(DATA.meta.generated)}`;
      exportRows = ALL_ROSTER;
      contentEl.innerHTML = `
        <div class="section-head"><h2>${title}</h2><button class="exp" id="expSite">&#8595; EXPORT</button></div>
        <div class="cards">${cards.map(cardHtml).join('')}</div>
        <div class="coverage">${coverage}</div>
        <div class="section-head" style="margin-top:6px;"><h2 style="font-size:18.5px;">Category A &amp; A1 Leadership &mdash; All Sites</h2></div>
        ${rosterTable(roster, {showSite:true})}
      `;
    } else {
      const site = sitesById[siteId];
      title = escapeHtml(site.label);
      if(site.flag==='not_in_roster'){
        contentEl.innerHTML = `
          <div class="section-head"><h2>${title}</h2><button class="exp" id="expAddHere">&#10133; ADD EMPLOYEE</button></div>
          <div class="empty-state">No entries in the uploaded roster yet for ${title}. Once staff are added to the Master Roster sheet, this page will populate automatically &mdash; or use "Add Employee" above to start the roster here.</div>`;
        document.getElementById('expAddHere').addEventListener('click', ()=> go({type:'newPerson', presetSiteId:siteId, presetCat:null}));
        attachRowHandlers(contentEl);
        return;
      }
      roster = siteRoster(site);
      cards = topOfficials(roster, Math.min(3, roster.length));
      coverage = `Coverage: <b>${roster.length}</b> officials on roster &middot; <b>${new Set(roster.map(p=>p.cat)).size}</b> categories present &middot; <b>${uniqueDeptCount(roster)}</b> departments &middot; roster snapshot ${escapeHtml(DATA.meta.generated)}`;
      exportRows = roster;
      let banner = '';
      contentEl.innerHTML = `
        <div class="section-head"><h2>${title}</h2><span style="display:flex;gap:8px;"><button class="exp" id="expAddHere">&#10133; ADD EMPLOYEE</button><button class="exp" id="expSite">&#8595; EXPORT</button></span></div>
        ${banner}
        <div class="cards">${cards.map(cardHtml).join('')}</div>
        <div class="coverage">${coverage}</div>
        ${rosterTable(roster, {})}
      `;
      document.getElementById('expAddHere').addEventListener('click', ()=> go({type:'newPerson', presetSiteId:siteId, presetCat:null}));
    }
    document.getElementById('expSite').addEventListener('click', ()=> exportCSV(exportRows, siteId===ALL_ID));
    attachRowHandlers(contentEl);
    attachSortHandlers(contentEl, roster, {}, render);
  }

  function renderCategoryView(cat){
    const list = categoryRosterAllSites(cat);
    const coverage = `Coverage: <b>${list.length}</b> officials in Category <b>${escapeHtml(cat)}</b> &middot; across <b>${new Set(list.map(p=>p.siteId)).size}</b> sites`;
    contentEl.innerHTML = `
      <div class="section-head"><h2>Category ${escapeHtml(cat)} &mdash; All Sites</h2><button class="exp" id="expCat">&#8595; EXPORT</button></div>
      <div class="coverage">${coverage}</div>
      ${rosterTable(list, {showSite:true})}
    `;
    document.getElementById('expCat').addEventListener('click', ()=> exportCSV(list, true));
    attachRowHandlers(contentEl);
    attachSortHandlers(contentEl, list, {showSite:true}, render);
  }

  function fld(v){
    if(v===undefined||v===null||v==='') return '<span class="dim">&mdash;</span>';
    return escapeHtml(v);
  }
  function yearsMonthsSince(isoDate){
    if(!isoDate) return '';
    const d = new Date(isoDate+'T00:00:00');
    if(isNaN(d.getTime())) return '';
    const now = new Date();
    let years = now.getFullYear() - d.getFullYear();
    let months = now.getMonth() - d.getMonth();
    if(now.getDate() < d.getDate()) months -= 1;
    if(months < 0){ years -= 1; months += 12; }
    if(years < 0) return '';
    return `${String(years).padStart(2,'0')}y / ${String(months).padStart(2,'0')}m`;
  }
  function experienceStr(dojISO){ return yearsMonthsSince(dojISO); }
  function ageStr(dobISO){ return yearsMonthsSince(dobISO); }
  function telLink(v){
    if(!v) return '<span class="dim">&mdash;</span>';
    return `<a class="contact-link" href="tel:${escapeHtml(v)}">&#9742; ${escapeHtml(displayPhone(v))}</a>`;
  }
  function teamMembersOf(p){
    if(!p.name) return [];
    const target = p.name.trim().toUpperCase();
    return ALL_ROSTER.filter(x=> x.reportingTo && x.reportingTo.trim().toUpperCase()===target && x.name!==p.name);
  }
  function teamAddCandidates(p){
    const target = p.name.trim().toUpperCase();
    return ALL_ROSTER
      .filter(x=> x.name && x.name!==p.name && !(x.reportingTo && x.reportingTo.trim().toUpperCase()===target))
      .sort((a,b)=> a.name.localeCompare(b.name));
  }
  function teamSectionHtml(p, team){
    const editBtnHtml = `<button class="edit-btn${teamEditOpen?' on':''}" id="btnEditTeam">${teamEditOpen? '✕ DONE' : '✎ EDIT'}</button>`;
    const head = `<div class="team-head">&#128101; Team Members (${team.length}) reporting to ${escapeHtml(p.name)} ${editBtnHtml}</div>`;
    if(!teamEditOpen){
      return `<div class="team-section">${head}${team.length ? rosterTable(team, {showSite:true}) : '<div class="empty-state">No team members on record. Click Edit to add one.</div>'}</div>`;
    }
    const rows = team.length ? team.map(m=>{
      const mKey = editKey(m).replace(/"/g,'&quot;');
      const actionCell = (pendingRemoveKey===editKey(m))
        ? `<span style="display:inline-flex;gap:6px;align-items:center;white-space:nowrap;">
             <span style="color:var(--accent1);font-family:var(--mono);font-size:12px;font-weight:700;">Remove?</span>
             <button class="btn-save" style="padding:5px 10px;font-size:12px;" data-confirm-remove="${escapeHtml(mKey)}">Yes</button>
             <button class="btn-cancel" style="padding:5px 10px;font-size:12px;" data-cancel-remove="1">No</button>
           </span>`
        : `<button class="btn-remove-member" data-key="${escapeHtml(mKey)}">&#10005; Remove</button>`;
      return `<tr>
        <td>${escapeHtml(m.name)}</td><td>${escapeHtml(m.designation||'')}</td><td>${escapeHtml(m.siteLabel||'')}</td>
        <td>${actionCell}</td>
      </tr>`;
    }).join('') : `<tr><td colspan="4" style="color:var(--ink-soft);">No team members yet &mdash; add one below.</td></tr>`;
    const pickChip = teamAddPick ? `
      <div class="team-pick-chip">
        <span class="tpc-name">${escapeHtml(teamAddPick.name)}</span>
        <span class="tpc-meta">${escapeHtml(teamAddPick.designation||'')}${teamAddPick.siteLabel?' &middot; '+escapeHtml(teamAddPick.siteLabel):''}</span>
        <button class="btn-save" id="btnAddTeamMember" style="padding:6px 14px;">&#10133; Add to Team</button>
        <button class="btn-cancel" id="btnClearTeamPick" style="padding:6px 14px;">&#10005; Clear</button>
      </div>` : '';
    return `<div class="team-section">${head}
      <div class="team-edit-hint">Remove a person to clear their "Reporting To" field, or search the directory below to add someone, or add a brand-new employee straight into this team.</div>
      <table class="roster team-edit">
        <thead><tr><th>Name</th><th>Designation</th><th>Site / Office</th><th>Action</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
      <div class="team-edit-add">
        <div class="team-search">
          <input id="teamAddSearchInput" type="text" placeholder="Type a name to search&hellip;" autocomplete="off"/>
          <div class="search-results" id="teamAddResults"></div>
        </div>
        <button class="tbtn" id="btnAddNewToTeam">&#10133; Add New Employee to Team</button>
      </div>
      ${pickChip}
    </div>`;
  }
  function renderPersonView(p){
    const statusHtml = statusBadge(p.status);
    const siteLabel = p.siteLabel || (p.siteId? sitesById[p.siteId].label : '');
    const isBday = p.dobMonth===todayM && p.dobDay===todayD;
    const wasEdited = editedKeys.has(editKey(p));
    const wasAdded = addedKeys.has(editKey(p));
    const team = teamMembersOf(p);
    const initials = p.name ? p.name.trim().split(/\s+/).slice(0,2).map(w=>w[0]).join('').toUpperCase() : '?';
    const waDigits = (p.whatsapp||'').replace(/\D/g,'');
    const waHref = waDigits ? (waDigits.length===10 ? '91'+waDigits : waDigits) : '';
    const quickActions = p.name ? `
      <div class="profile-quick">
        ${p.contact ? `<a class="qa-btn" href="tel:${escapeHtml(p.contact)}"><span class="qi">&#128222;</span> Call ${escapeHtml(displayPhone(p.contact))}</a>` : ''}
        ${waHref ? `<a class="qa-btn" href="https://wa.me/${waHref}" target="_blank" rel="noopener"><span class="qi">&#128172;</span> WhatsApp</a>` : ''}
        ${p.email ? `<a class="qa-btn" href="mailto:${escapeHtml(p.email)}"><span class="qi">&#9993;&#65039;</span> Email</a>` : ''}
      </div>` : '';
    contentEl.innerHTML = `
      <div class="profile">
        <div class="profile-top">
          <div>
            <div class="pname">${p.rank>=88?'<span class=\"star\">&#9733;</span> ':''}${escapeHtml(p.name || 'Vacant post')}${isBday?' <span title="Birthday today">&#127874;</span>':''}${wasAdded?'<span class="new-badge">&#10133; new</span>':''}${wasEdited?'<span class="edited-badge">&#9998; edited</span>':''}</div>
            <div class="pdesig">${escapeHtml(p.designation||'')}</div>
          </div>
          <button class="edit-btn" id="btnEditPerson">&#9998; EDIT</button>
        </div>
        <div class="profile-layout">
          <div class="profile-side">
            <div class="profile-avatar${p.status==='VACANT'?' vacant':''}">${escapeHtml(initials)}</div>
            <div class="profile-side-meta">
              <div class="k">Status</div>
              ${statusHtml}
            </div>
            ${quickActions}
          </div>
          <div class="profile-main">
            <dl>
              <dt>Site / Office</dt><dd>${fld(siteLabel)}</dd>
              <dt>Department</dt><dd>${fld(p.department)}</dd>
              <dt>Emp ID</dt><dd>${fld(p.empId)}</dd>
              <dt>Category</dt><dd><span class="badge-cat">${escapeHtml(p.cat||'')}</span></dd>

              <hr class="dsep"/>

              <dt>Contact No.</dt><dd>${telLink(p.contact)}</dd>
              <dt>WhatsApp No.</dt><dd>${telLink(p.whatsapp)}</dd>
              <dt>Emergency Contact</dt><dd>${telLink(p.emergencyContact)}</dd>
              <dt>Mail ID</dt><dd>${p.email? `<a class="contact-link" href="mailto:${escapeHtml(p.email)}">${escapeHtml(p.email)}</a>` : '<span class="dim">&mdash;</span>'}</dd>

              <hr class="dsep"/>

              <dt>Date of Birth</dt><dd>${fld(p.dob)}${p.dob && ageStr(p.dobISO) ? ` <span class="exp-tag" style="background:#eef1f8;color:var(--accent3);">${ageStr(p.dobISO)} age</span>` : ''}${isBday?' &#127874; <b>today!</b>':''}</dd>
              <dt>Date of Joining</dt><dd>${fld(p.doj)}${p.doj && experienceStr(p.dojISO) ? ` <span class="exp-tag">${experienceStr(p.dojISO)} experience</span>` : ''}</dd>
              <dt>Gender</dt><dd>${fld(p.gender)}</dd>
              <dt>UAN No.</dt><dd>${fld(p.uan)}</dd>
              <dt>Aadhar Card</dt><dd>${fld(p.aadharMasked)}</dd>
              <dt>Reporting To</dt><dd>${fld(p.reportingTo)}</dd>
              <dt>Level</dt><dd>${fld(p.level)}</dd>
              <dt>Local/Non-Local/Camp</dt><dd>${fld(p.localStatus)}</dd>
            </dl>
          </div>
        </div>
        ${p.name ? teamSectionHtml(p, team) : ''}
      </div>
    `;
    document.getElementById('btnEditPerson').addEventListener('click', ()=> go({type:'personEdit', person:p}));
    if(!p.name) return;
    document.getElementById('btnEditTeam').addEventListener('click', ()=>{
      teamEditOpen = !teamEditOpen; pendingRemoveKey = null; teamAddPick = null; render();
    });
    if(teamEditOpen){
      // -- remove, with an inline Yes/No instead of a blocked native confirm() --
      contentEl.querySelectorAll('.btn-remove-member').forEach(btn=>{
        btn.addEventListener('click', ()=>{ pendingRemoveKey = btn.dataset.key; render(); });
      });
      contentEl.querySelectorAll('[data-confirm-remove]').forEach(btn=>{
        btn.addEventListener('click', ()=>{
          const key = btn.dataset.confirmRemove;
          pendingRemoveKey = null;
          const patch = { reportingTo: '' };
          const ok = applyPatchToStore(key, patch);
          if(ok && sharedDb) pushPatchToSharedDb(key, patch);
          render();
        });
      });
      contentEl.querySelectorAll('[data-cancel-remove]').forEach(btn=>{
        btn.addEventListener('click', ()=>{ pendingRemoveKey = null; render(); });
      });
      // -- add: type-to-search instead of a long dropdown --
      const teamSearchInput = document.getElementById('teamAddSearchInput');
      const teamSearchResults = document.getElementById('teamAddResults');
      if(teamSearchInput){
        teamSearchInput.addEventListener('input', ()=>{
          const q = teamSearchInput.value.trim().toLowerCase();
          if(!q.length){ teamSearchResults.classList.remove('show'); return; }
          const matches = teamAddCandidates(p).filter(c=>
            (c.name && c.name.toLowerCase().includes(q)) ||
            (c.designation && c.designation.toLowerCase().includes(q)) ||
            (c.siteLabel && c.siteLabel.toLowerCase().includes(q))
          ).slice(0,20);
          teamSearchResults.innerHTML = matches.length ? matches.map((c,i)=>`
            <div class="sr-item" data-idx="${i}">
              <div class="sr-name">${escapeHtml(c.name)}</div>
              <div class="sr-meta">${escapeHtml(c.designation||'')}${c.siteLabel?' &middot; '+escapeHtml(c.siteLabel):''}</div>
            </div>`).join('') : `<div class="sr-empty">No matches.</div>`;
          teamSearchResults.querySelectorAll('.sr-item').forEach(el=>{
            el.addEventListener('click', ()=>{
              teamAddPick = matches[+el.dataset.idx];
              teamSearchInput.value = teamAddPick.name;
              teamSearchResults.classList.remove('show');
              render();
            });
          });
          teamSearchResults.classList.add('show');
        });
        teamSearchInput.addEventListener('focus', ()=>{ if(teamSearchInput.value.trim().length) teamSearchResults.classList.add('show'); });
        teamSearchInput.addEventListener('blur', ()=> setTimeout(()=> teamSearchResults.classList.remove('show'), 150));
      }
      const addBtn = document.getElementById('btnAddTeamMember');
      if(addBtn){
        addBtn.addEventListener('click', ()=>{
          if(!teamAddPick) return;
          const key = editKey(teamAddPick);
          const patch = { reportingTo: p.name };
          const ok = applyPatchToStore(key, patch);
          if(ok && sharedDb) pushPatchToSharedDb(key, patch);
          teamAddPick = null;
          render();
        });
      }
      const clearBtn = document.getElementById('btnClearTeamPick');
      if(clearBtn) clearBtn.addEventListener('click', ()=>{ teamAddPick = null; render(); });
      document.getElementById('btnAddNewToTeam').addEventListener('click', ()=>
        go({type:'newPerson', presetSiteId:p.siteId||null, presetCat:null, presetReportingTo:p.name}));
    } else if(team.length){
      attachRowHandlers(contentEl);
      attachSortHandlers(contentEl, team, {showSite:true}, render);
    }
  }

  function renderPersonEditForm(p){
    const GENDERS = ['', 'Male', 'Female', 'Other'];
    const genderOpts = GENDERS.map(g=>`<option value="${g}" ${String(p.gender||'').toLowerCase()===g.toLowerCase()?'selected':''}>${g||'(blank)'}</option>`).join('');
    const catOpts = CATS.map(c=>`<option value="${escapeHtml(c)}" ${p.cat===c?'selected':''}>${escapeHtml(c)}</option>`).join('');
    const statusOpts = ['ACTIVE','VACANT','RESIGNED'].map(s=>`<option value="${s}" ${p.status===s?'selected':''}>${s}</option>`).join('');
    const F = (id,label,val,type)=>`<dt>${label}</dt><dd><input id="${id}" type="${type||'text'}" value="${escapeHtml(val)}"/></dd>`;
    contentEl.innerHTML = `
      <div class="profile edit-form">
        <div class="pname">&#9998; Edit &mdash; ${escapeHtml(p.name || 'Vacant post')}</div>
        <div class="pdesig">Changes apply immediately in this browser session. Use "Export Edits (JSON)" in the toolbar to save them to a file.</div>
        <dl>
          ${F('f_name','Name', p.name)}
          ${F('f_designation','Designation', p.designation)}
          <dt>Category</dt><dd><select id="f_cat">${catOpts}</select></dd>
          ${F('f_department','Department', p.department)}
          <dt>Status</dt><dd><select id="f_status">${statusOpts}</select></dd>

          <hr class="dsep"/>

          ${F('f_contact','Contact No.', p.contact, 'tel')}
          ${F('f_whatsapp','WhatsApp No.', p.whatsapp, 'tel')}
          ${F('f_emergency','Emergency Contact', p.emergencyContact, 'tel')}
          ${F('f_email','Mail ID', p.email, 'email')}

          <hr class="dsep"/>

          ${F('f_dob','Date of Birth', p.dobISO, 'date')}
          ${F('f_doj','Date of Joining', p.dojISO, 'date')}
          <dt>Gender</dt><dd><select id="f_gender">${genderOpts}</select></dd>
          ${F('f_uan','UAN No.', p.uan)}
          ${F('f_aadhar','Aadhar Card', p.aadharMasked)}
          ${F('f_reporting','Reporting To', p.reportingTo)}
          ${F('f_level','Level', p.level)}
          ${F('f_local','Local/Non-Local/Camp', p.localStatus)}
        </dl>
        <div class="edit-actions">
          <button class="btn-save" id="btnSaveEdit">&#128190; Save</button>
          <button class="btn-cancel" id="btnCancelEdit">&#10005; Cancel</button>
        </div>
      </div>
    `;
    document.getElementById('btnCancelEdit').addEventListener('click', back);
    document.getElementById('btnSaveEdit').addEventListener('click', ()=>{
      const val = id => document.getElementById(id).value.trim();
      const dobISO = val('f_dob'), dojISO = val('f_doj');
      let dobMonth = p.dobMonth, dobDay = p.dobDay;
      if(dobISO){ const d = new Date(dobISO+'T00:00:00'); dobMonth = d.getMonth()+1; dobDay = d.getDate(); }
      const patch = {
        name: val('f_name') || null,
        designation: val('f_designation'),
        cat: document.getElementById('f_cat').value,
        department: val('f_department'),
        status: document.getElementById('f_status').value,
        contact: val('f_contact'),
        whatsapp: val('f_whatsapp'),
        emergencyContact: val('f_emergency'),
        email: val('f_email'),
        dobISO: dobISO,
        dob: fmtDateDisplay(dobISO),
        dobMonth: dobISO ? dobMonth : null,
        dobDay: dobISO ? dobDay : null,
        dojISO: dojISO,
        doj: fmtDateDisplay(dojISO),
        gender: document.getElementById('f_gender').value,
        uan: val('f_uan'),
        aadharMasked: val('f_aadhar'),
        reportingTo: val('f_reporting'),
        level: val('f_level'),
        localStatus: val('f_local'),
      };
      // filling a vacant post with a name: mark it ACTIVE unless the user chose otherwise explicitly
      if(!p.name && patch.name && patch.status==='VACANT' && p.status==='VACANT') patch.status = 'ACTIVE';
      const key = editKey(p);
      const ok = applyPatchToStore(key, patch);
      const updated = ok ? findStoredPerson(key) : Object.assign({}, p, patch);
      if(sharedDb) pushPatchToSharedDb(key, patch);
      // drop the edit-form entry and the pre-edit profile entry, replace with the freshly saved profile
      stack.pop();
      stack[stack.length-1] = {type:'person', person: Object.assign({}, p, updated)};
      sortState = {key:null, dir:1};
      render();
    });
  }

  function renderNewPersonForm(presetSiteId, presetCat, presetReportingTo){
    const GENDERS = ['', 'Male', 'Female', 'Other'];
    const genderOpts = GENDERS.map(g=>`<option value="${g}">${g||'(blank)'}</option>`).join('');
    const siteOpts = '<option value="">&mdash; select site/office &mdash;</option>' +
      DATA.sites.map(s=>`<option value="${escapeHtml(s.id)}" ${presetSiteId===s.id?'selected':''}>${escapeHtml(s.label)}</option>`).join('');
    const catOpts = '<option value="">&mdash; select category &mdash;</option>' +
      CATS.map(c=>`<option value="${escapeHtml(c)}" ${presetCat===c?'selected':''}>${escapeHtml(c)}</option>`).join('');
    const statusOpts = ['ACTIVE','VACANT','RESIGNED'].map(s=>`<option value="${s}" ${s==='ACTIVE'?'selected':''}>${s}</option>`).join('');
    const todayISO = new Date().toISOString().slice(0,10);
    const F = (id,label,val,type)=>`<dt>${label}</dt><dd><input id="${id}" type="${type||'text'}" value="${escapeHtml(val)}"/></dd>`;
    contentEl.innerHTML = `
      <div class="profile edit-form">
        <div class="pname">&#10133; Add New Employee</div>
        <div class="pdesig">${presetReportingTo ? `Adding a new team member reporting to <b>${escapeHtml(presetReportingTo)}</b>. ` : ''}Fills a new record into the directory. ${sharedDb ? 'It syncs live to everyone who opens this link.' : 'It applies in this browser session only &mdash; export the roster to keep a copy.'} Name, Site/Office and Category are required.</div>
        <dl>
          ${F('f_name','Name &#42;', '')}
          <dt>Site / Office &#42;</dt><dd><select id="f_site">${siteOpts}</select></dd>
          <dt>Category &#42;</dt><dd><select id="f_cat_new">${catOpts}</select></dd>
          ${F('f_designation','Designation', '')}
          ${F('f_department','Department', '')}
          <dt>Status</dt><dd><select id="f_status">${statusOpts}</select></dd>
          ${F('f_empid','Emp ID (leave blank to auto-generate)', '')}

          <hr class="dsep"/>

          ${F('f_contact','Contact No.', '', 'tel')}
          ${F('f_whatsapp','WhatsApp No.', '', 'tel')}
          ${F('f_emergency','Emergency Contact', '', 'tel')}
          ${F('f_email','Mail ID', '', 'email')}

          <hr class="dsep"/>

          ${F('f_dob','Date of Birth', '', 'date')}
          ${F('f_doj','Date of Joining', todayISO, 'date')}
          <dt>Gender</dt><dd><select id="f_gender">${genderOpts}</select></dd>
          ${F('f_uan','UAN No.', '')}
          ${F('f_aadhar','Aadhar Card', '')}
          ${F('f_reporting','Reporting To', presetReportingTo||'')}
          ${F('f_level','Level', '')}
          ${F('f_local','Local/Non-Local/Camp', '')}
        </dl>
        <div class="edit-actions">
          <button class="btn-save" id="btnSaveNew">&#128190; Save New Employee</button>
          <button class="btn-cancel" id="btnCancelNew">&#10005; Cancel</button>
        </div>
      </div>
    `;
    document.getElementById('btnCancelNew').addEventListener('click', back);
    document.getElementById('btnSaveNew').addEventListener('click', ()=>{
      const val = id => document.getElementById(id).value.trim();
      const siteId = document.getElementById('f_site').value;
      const cat = document.getElementById('f_cat_new').value;
      const name = val('f_name');
      if(!siteId || !cat){ alert('Please select both Site/Office and Category.'); return; }
      if(!name){ alert('Please enter the employee name.'); return; }
      const dobISO = val('f_dob'), dojISO = val('f_doj');
      let dobMonth = null, dobDay = null;
      if(dobISO){ const d = new Date(dobISO+'T00:00:00'); dobMonth = d.getMonth()+1; dobDay = d.getDate(); }
      const empId = val('f_empid') || ('NEW' + Date.now());
      const record = {
        empId, name,
        designation: val('f_designation'),
        department: val('f_department'),
        contact: val('f_contact'),
        whatsapp: val('f_whatsapp'),
        emergencyContact: val('f_emergency'),
        email: val('f_email'),
        dobISO: dobISO, dob: fmtDateDisplay(dobISO), dobMonth: dobISO?dobMonth:null, dobDay: dobISO?dobDay:null,
        dojISO: dojISO, doj: fmtDateDisplay(dojISO),
        uan: val('f_uan'),
        gender: document.getElementById('f_gender').value,
        status: document.getElementById('f_status').value,
        reportingTo: val('f_reporting'),
        level: val('f_level'),
        aadharMasked: val('f_aadhar'),
        localStatus: val('f_local'),
        rank: defaultRankFor(siteId, cat),
      };
      const docId = dbSafeId('new:' + Date.now() + '-' + Math.random().toString(36).slice(2,8));
      const ok = addNewRecordToStore(siteId, cat, record, docId);
      if(!ok){ alert('That employee ID already exists on this roster. Please use a different Emp ID.'); return; }
      if(sharedDb) pushNewRecordToSharedDb(siteId, cat, record, docId);
      const finalRec = Object.assign({cat, siteId, siteLabel: sitesById[siteId].label}, record);
      stack[stack.length-1] = {type:'person', person: finalRec};
      sortState = {key:null, dir:1};
      render();
    });
  }

  function renderMatrixView(){
    let thead = '<tr><th class="cat-col">Category</th>' + DATA.sites.map(s=>
      `<th data-msite="${escapeHtml(s.id)}">${escapeHtml(s.label)}${flagMark(s)}</th>`).join('') + '</tr>';
    let rows = '';
    CATS.forEach(cat=>{
      rows += `<tr><td class="cat-label" data-mcat="${escapeHtml(cat)}">${escapeHtml(cat)}</td>`;
      DATA.sites.forEach(s=>{
        const people = DATA.matrix[s.id+'|'+cat] || [];
        if(s.flag==='not_in_roster' || people.length===0){
          rows += `<td class="cell empty">&mdash;</td>`;
        } else {
          const top = people[0];
          const nameLabel = top.name ? escapeHtml(top.name) : '<span class="cell-vacant">Vacant</span>';
          const extra = people.length>1 ? `<span class="cell-badge">+${people.length-1}</span>` : '';
          rows += `<td class="cell" data-msite="${escapeHtml(s.id)}" data-mcat="${escapeHtml(cat)}">
            <div class="cell-name">${nameLabel}${extra}</div>
            <div class="cell-desig">${escapeHtml(top.designation)}</div>
          </td>`;
        }
      });
      rows += '</tr>';
    });
    rows += `<tr class="total-row"><td class="cat-label">TOTAL</td>` + DATA.sites.map(s=>
      `<td class="cell" data-msite="${escapeHtml(s.id)}">${escapeHtml(DATA.siteTotals[s.id]||0)} staff</td>`).join('') + '</tr>';

    contentEl.innerHTML = `
      <div class="section-head"><h2 style="font-size:20.5px;">Category &times; Site Matrix</h2></div>
      <div class="matrix-scroll"><table class="matrix"><thead>${thead}</thead><tbody>${rows}</tbody></table></div>
    `;
    contentEl.querySelectorAll('td.cell[data-msite][data-mcat]').forEach(td=>{
      td.addEventListener('click', ()=> go({type:'category', cat:td.dataset.mcat}));
    });
    contentEl.querySelectorAll('td.cell[data-msite]:not([data-mcat])').forEach(td=>{
      td.addEventListener('click', ()=> go({type:'site', site:td.dataset.msite}));
    });
    contentEl.querySelectorAll('td.cat-label[data-mcat]').forEach(td=>{
      td.addEventListener('click', ()=> go({type:'category', cat:td.dataset.mcat}));
    });
    contentEl.querySelectorAll('th[data-msite]').forEach(th=>{
      th.addEventListener('click', ()=> go({type:'site', site:th.dataset.msite}));
    });
  }

  // ---------- dashboard (default landing view) ----------
  const LEADERSHIP_TIERS = [
    {label:'Chairman &amp; Managing Director', test: d => /chairman/i.test(d)},
    {label:'Director', test: d => /^director$/i.test(d)},
    {label:'Vice President', test: d => /vice president|^vp\b/i.test(d)},
    {label:'Chief Financial Officer', test: d => /chief financial officer|^cfo\b/i.test(d)},
    {label:'Company Secretary', test: d => /company secretary|^cs\b/i.test(d)},
  ];
  function buildLeadershipRoster(){
    const out = [];
    LEADERSHIP_TIERS.forEach((tier, idx)=>{
      ALL_ROSTER.filter(p=> p.designation && tier.test(p.designation.trim()))
        .forEach(p=> out.push(Object.assign({_tier:idx}, p)));
    });
    return out.slice(0,10);
  }
  function renderProjectManagerLeaderboard(roster){
    const managers=[];
    const seen=new Set();
    roster.filter((person)=>person.status!=='VACANT'&&/\bproject manager\b/i.test(person.designation||'')).forEach((person)=>{
      const key=(person.name||person.empId||'')+'|'+person.siteId;
      if(seen.has(key))return;
      seen.add(key);
      const team=roster.filter((member)=>member.siteId===person.siteId);
      managers.push({person,filled:team.filter((member)=>member.status==='ACTIVE').length,vacant:team.filter((member)=>member.status==='VACANT').length,total:team.length});
    });
    managers.sort((a,b)=>b.filled-a.filled||a.vacant-b.vacant||(a.person.name||'').localeCompare(b.person.name||''));
    if(!managers.length)return `<section class="pm-leaderboard"><h2>Project Manager Site Coverage</h2><div class="empty-state">No Project Manager is assigned in this directory scope.</div></section>`;
    return `<section class="pm-leaderboard">
      <h2>Project Manager Site Coverage</h2>
      <div class="coverage">Directory coverage ranking by filled team positions. This is a staffing view, not a performance score.</div>
      <div class="table-wrap"><table class="roster"><thead><tr><th>Rank</th><th>Project Manager</th><th>Site</th><th>Filled team</th><th>Vacant</th><th>Sanctioned</th></tr></thead><tbody>
      ${managers.map((entry,index)=>`<tr><td><b>${index+1}</b></td><td><b>${escapeHtml(entry.person.name||'—')}</b></td><td>${escapeHtml(entry.person.siteLabel||'—')}</td><td>${entry.filled}</td><td>${entry.vacant}</td><td>${entry.total}</td></tr>`).join('')}
      </tbody></table></div>
    </section>`;
  }
  function renderDashboardView(){
    const leadership = buildLeadershipRoster();
    contentEl.innerHTML = `
      <div class="hero-band">
        <div class="hero-band-inner has-art">
          <div class="hero-art" role="img" aria-label="CMLL mining operations"></div>
          <div class="hero-title">Leadership Dashboard</div>
          <div class="hero-sub">&#128197; Roster last updated: ${escapeHtml(DATA.meta.generated)} &middot; Order: Chairman &amp; Managing Director &rarr; Director &rarr; Vice President &rarr; CFO &rarr; Company Secretary</div>
          <div class="hero-stats">
            <div class="hero-stat"><div class="hs-label">Sanctioned</div><div class="hs-value">${escapeHtml(DATA.meta.totalStaffSanctioned)}</div></div>
            <div class="hero-stat"><div class="hs-label">Filled</div><div class="hs-value">${escapeHtml(DATA.meta.totalFilled)}</div></div>
            <div class="hero-stat hs-vacant"><div class="hs-label">Vacant</div><div class="hs-value">${escapeHtml(DATA.meta.totalVacant)}</div></div>
            <div class="hero-stat"><div class="hs-label">Leadership Shown</div><div class="hs-value">${leadership.length}</div></div>
          </div>
        </div>
      </div>
      ${rosterTable(leadership, {showSite:true})}
      ${renderProjectManagerLeaderboard(FULL_ROSTER)}
    `;
    attachRowHandlers(contentEl);
    attachSortHandlers(contentEl, leadership, {showSite:true}, render);
  }

  // ---------- WCL / NCL group view ----------
  function renderGroupView(groupKey){
    const grp = GROUP_DEFS[groupKey];
    if(!grp){ contentEl.innerHTML = '<div class="empty-state">Unknown group.</div>'; return; }
    const idSet = new Set(grp.ids);
    let roster = ALL_ROSTER.filter((person)=>idSet.has(person.siteId));
    roster.sort(catOrderCmp);
    const totals = roster.reduce((acc,person)=>{
      acc.sanctioned++;
      if(person.status==='VACANT')acc.vacant++;else if(person.status==='ACTIVE')acc.filled++;
      return acc;
    },{sanctioned:0,filled:0,vacant:0});
    const missing = DATA.sites.filter(s=> idSet.has(s.id) && s.flag==='not_in_roster');
    const coverage = `Coverage: <b>${totals.sanctioned}</b> sanctioned positions across <b>${grp.ids.length}</b> sites &middot; <b>${totals.filled}</b> filled / <b>${totals.vacant}</b> vacant &middot; roster snapshot ${escapeHtml(DATA.meta.generated)}` +
      (missing.length ? ` &middot; <span style="color:var(--vacant);">${escapeHtml(missing.map(s=>s.label).join(', '))} not yet in roster</span>` : '');
    contentEl.innerHTML = `
      <div class="section-head"><h2>${grp.full}</h2><button class="exp" id="expGroup">&#8595; EXPORT</button></div>
      <div class="coverage">${coverage}</div>
      ${rosterTable(roster, {showSite:true})}
    `;
    document.getElementById('expGroup').addEventListener('click', ()=> exportCSV(roster, true));
    attachRowHandlers(contentEl);
    attachSortHandlers(contentEl, roster, {showSite:true}, render);
  }

  function renderVacantView(){
    const list = ALL_ROSTER.filter(p=> p.status==='VACANT');
    const coverage = `Coverage: <b>${list.length}</b> vacant sanctioned position${list.length===1?'':'s'} company-wide out of <b>${escapeHtml(DATA.meta.totalStaffSanctioned)}</b> sanctioned &middot; roster snapshot ${escapeHtml(DATA.meta.generated)}`;
    contentEl.innerHTML = `
      <div class="section-head"><h2 style="font-size:20.5px;">&#9888;&#65039; Vacancies &mdash; All Sites</h2><button class="exp" id="expVacant">&#8595; EXPORT</button></div>
      <div class="coverage">${coverage}</div>
      ${rosterTable(list, {showSite:true})}
    `;
    document.getElementById('expVacant').addEventListener('click', ()=> exportCSV(list, true));
    attachRowHandlers(contentEl);
    attachSortHandlers(contentEl, list, {showSite:true}, render);
  }

  // ---------- always-visible Region > Site > Department > Designation > Name strip ----------
  const gfRegion = document.getElementById('gfRegion'), gfSite = document.getElementById('gfSite'), gfDept = document.getElementById('gfDept'),
        gfDesig = document.getElementById('gfDesig'), gfName = document.getElementById('gfName'),
        filterStrip = document.getElementById('filterStrip');
  const escA = x=> String(x).replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;');
  function updateFilterStrip(v){
    filterStrip.style.display = '';
    const siteId = v.type==='site' ? (v.site===ALL_ID ? '' : v.site) : (v.site||'');
    const region = siteId ? ((sitesById[siteId]||{}).group||'ALL') : (v.region||selectedRegion||'ALL');
    const regionChanged=selectedRegion!==region&&['WCL','NCL'].includes(region);
    selectedRegion=['WCL','NCL'].includes(region)?region:'ALL';
    if(regionChanged)renderTopPills();
    const dept = v.type==='siteDeptDesig' ? (v.dept||'') : '';
    const desig = v.type==='siteDeptDesig' ? (v.desig||'') : '';
    gfRegion.value=selectedRegion;
    gfSite.innerHTML = `<option value="">${directoryScope==='mine'?'All My Sites':'All Sites'}</option>` + sitesForRegion(selectedRegion).filter(s=>s.flag!=='not_in_roster' || s.id===siteId)
      .map(s=>`<option value="${escA(s.id)}" ${siteId===s.id?'selected':''}>${escapeHtml(s.label)}</option>`).join('');
    gfDept.innerHTML = '<option value="">All Departments</option>' + departmentsForFilter(siteId,selectedRegion)
      .map(d=>`<option value="${escA(d)}" ${dept===d?'selected':''}>${escapeHtml(d)}</option>`).join('');
    gfDesig.innerHTML = '<option value="">All Designations</option>' + designationsForFilter(siteId,dept,selectedRegion)
      .map(d=>`<option value="${escA(d)}" ${desig===d?'selected':''}>${escapeHtml(d)}</option>`).join('');
    if(document.activeElement!==gfName) gfName.value = v.type==='siteDeptDesig' ? (v.name||'') : '';
  }
  function goFilter(region, site, dept, desig){
    selectedRegion=region||'ALL';
    renderTopPills();
    go({type:'siteDeptDesig',region:selectedRegion,site,dept,desig,name:gfName.value},{replace:current().type==='siteDeptDesig'});
  }
  gfRegion.addEventListener('change',()=>goFilter(gfRegion.value,'','',''));
  gfSite.addEventListener('change',()=>goFilter(gfRegion.value,gfSite.value,'',''));
  gfDept.addEventListener('change',()=>goFilter(gfRegion.value,gfSite.value,gfDept.value,''));
  gfDesig.addEventListener('change',()=>goFilter(gfRegion.value,gfSite.value,gfDept.value,gfDesig.value));
  gfName.addEventListener('input', ()=>{
    const v = current();
    if(v.type==='siteDeptDesig' && window.__fsRefresh){ v.name = gfName.value; window.__fsRefresh(); }
    else { goFilter(gfRegion.value,gfSite.value,gfDept.value,gfDesig.value); gfName.focus(); }
  });

  function renderSiteDeptDesigView(v){
    const region = v.region || 'ALL';
    const siteId = v.site || '';
    const dept = v.dept || '';
    const desig = v.desig || '';
    const name = v.name || '';
    const siteLabel = siteId ? (sitesById[siteId]||{label:''}).label : (directoryScope==='mine'?'My Sites':'All Sites');

    function resultsHtml(list){
      return `
        <div class="coverage">Coverage: <b>${list.length}</b> employee${list.length===1?'':'s'} matching &middot; Region ${region==='ALL'?'All':region} &middot; ${escapeHtml(siteLabel)}${dept?' &middot; '+escapeHtml(dept):''}${desig?' &middot; '+escapeHtml(desig):''}${name?' &middot; name contains &ldquo;'+escapeHtml(name)+'&rdquo;':''}</div>
        ${list.length ? rosterTable(list, {showSite: !siteId}) : '<div class="empty-state">No employees match this combination. Try clearing one of the filters.</div>'}
      `;
    }
    function currentList(){
      const nameEl = document.getElementById('gfName');
      return peopleForFilter(siteId,dept,desig,nameEl?nameEl.value:name,region);
    }
    function wireResultHandlers(list){
      const expBtn = document.getElementById('expFilterSearch');
      if(expBtn) expBtn.onclick = ()=> exportCSV(list, true);
      if(list.length){
        attachRowHandlers(contentEl);
        attachSortHandlers(contentEl, list, {showSite: !siteId}, refreshResults);
      }
    }
    function refreshResults(){
      const list = currentList();
      document.getElementById('fsResults').innerHTML = resultsHtml(list);
      wireResultHandlers(list);
    }

    const initialList = peopleForFilter(siteId,dept,desig,name,region);
    contentEl.innerHTML = `
      <div class="section-head"><h2 style="font-size:20.5px;">&#128269; Search &mdash; Region &#9656; Site &#9656; Department &#9656; Designation</h2><button class="exp" id="expFilterSearch">&#8595; EXPORT</button></div>
      ${directoryScope==='mine'&&VIEWER.profile==='project-manager'?renderProjectManagerLeaderboard(ALL_ROSTER):''}
      <div id="fsResults">${resultsHtml(initialList)}</div>
    `;
    window.__fsRefresh = refreshResults;
    wireResultHandlers(initialList);
  }

  function render(){
    const v = current();
    // pill highlight
    sitePillsEl.querySelectorAll('.pill').forEach(p=> p.classList.toggle('active', (v.type==='site' && p.dataset.site===v.site) || (v.type==='dashboard' && p.dataset.site===DASH_ID) || (v.type==='siteDeptDesig'&&!v.site&&p.dataset.site===ALL_ID)));
    catPillsEl.querySelectorAll('.tag').forEach(t=> t.classList.toggle('active', v.type==='category' && t.dataset.cat===v.cat));
    groupPillsEl.querySelectorAll('.tag').forEach(t=> t.classList.toggle('active', v.type==='group' && t.dataset.group===v.group));
    backBtn.classList.add('show');
    backBtn.classList.toggle('disabled',stack.length<=1);
    backBtn.disabled = stack.length<=1;
    refreshDataNotes();
    if(typeof updateNavDock==='function') updateNavDock(v);
    updateFilterStrip(v);
    window.__fsRefresh = null;

    if(v.type==='dashboard') renderDashboardView();
    else if(v.type==='site') renderSiteView(v.site);
    else if(v.type==='group') renderGroupView(v.group);
    else if(v.type==='category') renderCategoryView(v.cat);
    else if(v.type==='person') renderPersonView(v.person);
    else if(v.type==='personEdit') renderPersonEditForm(v.person);
    else if(v.type==='matrix') renderMatrixView();
    else if(v.type==='chart') renderChartView();
    else if(v.type==='vacant') renderVacantView();
    else if(v.type==='newPerson') renderNewPersonForm(v.presetSiteId, v.presetCat, v.presetReportingTo);
    else if(v.type==='siteDeptDesig') renderSiteDeptDesigView(v);
    if(DATA.meta.totalResigned && ['dashboard','chart','site','group'].includes(v.type)){
      const note = document.createElement('div');
      note.className = 'coverage';
      note.textContent = DATA.meta.totalResigned + ' resigned record(s) retained company-wide; excluded from filled and vacant counts.';
      contentEl.appendChild(note);
    }
  }
  document.getElementById('btnChart').addEventListener('click', ()=> go({type:'chart'}));
  document.getElementById('btnVacant').addEventListener('click', ()=> go({type:'vacant'}));
  document.getElementById('btnRedact').addEventListener('click', ()=> setRedact(!redactPhones));

  function renderChartView(){
    const MINING_IDS = DATA.sites.filter(s=> s.label.toUpperCase().includes('OC') || s.label.toUpperCase().includes('BLOCK')).map(s=>s.id);
    const OFFICE_IDS = DATA.sites.filter(s=> !MINING_IDS.includes(s.id)).map(s=>s.id);
    const allVals = DATA.sites.map(s=> (DATA.siteStats[s.id]||{filled:0}).filled);
    const maxVal = Math.max(1, ...allVals);

    function barCol(s){
      const st = DATA.siteStats[s.id] || {sanctioned:0, filled:0, vacant:0};
      const filledH = Math.round((st.filled/maxVal)*140);
      const vacantH = Math.round((st.vacant/maxVal)*140) || (st.vacant>0?4:0);
      const vacPct = st.sanctioned ? ((st.vacant/st.sanctioned)*100).toFixed(1) : '0.0';
      return `<div class="chart-col" data-csite="${escapeHtml(s.id)}" style="cursor:pointer;">
        <div class="chart-bars-pair">
          <div class="bar-stack"><div class="bar-val">${st.filled}</div><div class="bar bar-filled" style="height:${Math.max(filledH,2)}px;"></div></div>
          <div class="bar-stack"><div class="bar-val">${st.vacant||''}</div><div class="bar bar-vacant" style="height:${Math.max(vacantH,st.vacant>0?4:0)}px;"></div></div>
        </div>
        <div class="chart-col-label">${escapeHtml(s.label)}${flagMark(s)}</div>
        <div class="chart-col-stats">Vacant ${st.vacant}${st.resigned ? ' &middot; Resigned '+st.resigned : ''} &middot; Total ${st.sanctioned}<br/>Vacancy ${vacPct}%</div>
      </div>`;
    }

    function groupTotal(ids, dedupeJayant){
      const seen = new Set();
      let sanctioned=0, filled=0, vacant=0;
      ids.forEach(id=>{
        const site = sitesById[id];
        if(dedupeJayant && site.flag==='jayant_combined'){
          if(seen.has(site.dataKey)) return;
          seen.add(site.dataKey);
        }
        const st = DATA.siteStats[id] || {sanctioned:0, filled:0, vacant:0};
        sanctioned += st.sanctioned; filled += st.filled; vacant += st.vacant;
      });
      return {sanctioned, filled, vacant};
    }
    const miningTotal = groupTotal(MINING_IDS, true);
    const officeTotal = groupTotal(OFFICE_IDS, false);
    const grand = {
      sanctioned: miningTotal.sanctioned + officeTotal.sanctioned,
      filled: miningTotal.filled + officeTotal.filled,
      vacant: miningTotal.vacant + officeTotal.vacant,
    };

    contentEl.innerHTML = `
      <div class="hero-band">
        <div class="hero-band-inner">
          <div class="hero-title-row">
            <div class="hero-title">Total Employees</div>
            <span class="live-badge"><span class="live-dot"></span>LIVE</span>
          </div>
          <div class="hero-sub" id="chartUpdated"></div>
          <div class="hero-stats">
            <div class="hero-stat"><div class="hs-label">Sanctioned</div><div class="hs-value">${grand.sanctioned}</div></div>
            <div class="hero-stat"><div class="hs-label">Filled</div><div class="hs-value">${grand.filled}</div></div>
            <div class="hero-stat hs-vacant"><div class="hs-label">Vacant</div><div class="hs-value">${grand.vacant}</div></div>
          </div>
        </div>
      </div>
      <div class="chart-wrap">
        <div class="chart-toolbar-row">
          <div class="chart-legend">
            <span><span class="sw sw-filled"></span>Filled</span>
            <span><span class="sw sw-vacant"></span>Vacant</span>
          </div>
          <button class="tbtn" id="btnExportChart">&#8595; EXPORT &#9662;</button>
        </div>
        <div class="chart-groups">
          <div class="chart-group">
            <div class="chart-group-title">Corporate Offices</div>
            <div class="chart-bars">${OFFICE_IDS.map(id=>barCol(sitesById[id])).join('')}</div>
            <div class="chart-group-total">
              <div class="gt-name">CORPORATE OFFICES <span class="gt-fleet">${officeTotal.filled} employees</span></div>
              <div class="gt-stats">Sanctioned ${officeTotal.sanctioned} &middot; Vacant ${officeTotal.vacant} &middot; Vacancy ${officeTotal.sanctioned?((officeTotal.vacant/officeTotal.sanctioned)*100).toFixed(1):'0.0'}%</div>
            </div>
          </div>
          <div class="chart-group">
            <div class="chart-group-title">Mining Sites (OC / Blocks)</div>
            <div class="chart-bars">${MINING_IDS.map(id=>barCol(sitesById[id])).join('')}</div>
            <div class="chart-group-total">
              <div class="gt-name">MINING SITES <span class="gt-fleet">${miningTotal.filled} employees</span></div>
              <div class="gt-stats">Sanctioned ${miningTotal.sanctioned} &middot; Vacant ${miningTotal.vacant} &middot; Vacancy ${miningTotal.sanctioned?((miningTotal.vacant/miningTotal.sanctioned)*100).toFixed(1):'0.0'}%</div>
            </div>
          </div>
        </div>
      </div>
    `;
    contentEl.querySelectorAll('.chart-col[data-csite]').forEach(el=>{
      el.addEventListener('click', ()=> go({type:'site', site: el.dataset.csite}));
    });
    document.getElementById('btnExportChart').addEventListener('click', ()=>{
      const headers = ['Site','Sanctioned','Filled','Vacant','Resigned','Vacancy %'];
      const lines = [headers.map(csvEscape).join(',')];
      DATA.sites.forEach(s=>{
        const st = DATA.siteStats[s.id]||{sanctioned:0,filled:0,vacant:0};
        const pct = st.sanctioned ? ((st.vacant/st.sanctioned)*100).toFixed(1) : '0.0';
        lines.push([s.label, st.sanctioned, st.filled, st.vacant, st.resigned||0, pct].map(csvEscape).join(','));
      });
      download('cd-caliber-employee-chart.csv', lines.join('\n'));
    });

    // ---- live-updating "as of" clock for this view; self-clears once the view changes ----
    function pad2(n){ return String(n).padStart(2,'0'); }
    function tickChartClock(){
      const el = document.getElementById('chartUpdated');
      if(!el){ clearInterval(chartTimer); return; }
      const d = new Date();
      el.textContent = 'Live · updated ' + pad2(d.getHours())+':'+pad2(d.getMinutes())+':'+pad2(d.getSeconds()) + ' IST';
    }
    if(chartTimer) clearInterval(chartTimer);
    tickChartClock();
    chartTimer = setInterval(tickChartClock, 1000);
  }

  document.getElementById('btnMatrix').addEventListener('click', ()=> go({type:'matrix'}));
  document.getElementById('btnAddEmployee').addEventListener('click', ()=> go({type:'newPerson', presetSiteId:null, presetCat:null}));
  document.getElementById('btnFilterSearch').addEventListener('click', ()=> go({type:'siteDeptDesig',region:selectedRegion,site:'',dept:'',desig:'',name:''}));

  // ---------- file offering (works both as a plain local file and inside a published Claude artifact) ----------
  async function offerDownload(filename, blob){
    const notice=document.createElement('div');
    notice.setAttribute('role','status');notice.setAttribute('aria-live','polite');
    Object.assign(notice.style,{position:'fixed',bottom:'20px',right:'16px',maxWidth:'calc(100vw - 32px)',padding:'16px',borderRadius:'12px',background:'#522e90',color:'#fff',zIndex:'2147483647'});
    notice.textContent='Preparing download…';document.body.appendChild(notice);
    const done=(error)=>{notice.textContent=error?'Download failed. Please try again.':'Download started. Check your browser downloads.';notice.style.background=error?'#991b1b':'#166534';setTimeout(()=>notice.remove(),10000);};
    await new Promise(resolve=>setTimeout(resolve,50));
    try{
    let claudeApi = null;
    try{ claudeApi = (window.claude && typeof window.claude.use === 'function') ? window.claude : null; }catch(e){}
    if(claudeApi){
      let dl = null;
      try{ dl = await claudeApi.use('downloads'); }catch(e){ dl = null; }
      if(dl){
        try{ await dl.save({filename, data: blob}); done();return; }
        catch(err){ done(err);alert('Could not save the file (' + (err && err.code || 'error') + ').'); return; }
      }
    }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(()=>URL.revokeObjectURL(a.href),1000);done();
    }catch(error){done(error);}
  }
  // ---------- CSV export ----------
  function csvEscape(v){ v = (v===undefined||v===null)?'':String(v); return '"' + v.replace(/"/g,'""') + '"'; }
  function download(filename, text){
    offerDownload(filename, new Blob([text], {type:'text/csv;charset=utf-8;'}));
  }
  function exportCSV(list, showSite){
    const headers = ['Rank Score','Name','Category','Designation','Department', showSite?'Site':null, 'Reports To','Contact','Status'].filter(Boolean);
    const lines = [headers.map(csvEscape).join(',')];
    list.forEach(p=>{
      const row = [p.rank, p.name||'VACANT', p.cat||'', p.designation||'', p.department||''];
      if(showSite) row.push(p.siteLabel||(p.siteId?sitesById[p.siteId].label:''));
      row.push(p.reportingTo||'', displayPhone(p.contact)||'', p.status||'');
      lines.push(row.map(csvEscape).join(','));
    });
    download('cd-caliber-directory-export.csv', lines.join('\n'));
  }
  document.getElementById('btnExportAll').addEventListener('click', ()=> exportCSV(ALL_ROSTER, true));
  document.getElementById('btnExportView').addEventListener('click', ()=>{
    const v = current();
    if(v.type==='site') exportCSV(v.site===ALL_ID? ALL_ROSTER : siteRoster(sitesById[v.site]), v.site===ALL_ID);
    else if(v.type==='category') exportCSV(categoryRosterAllSites(v.cat), true);
    else if(v.type==='person') exportCSV([v.person], true);
    else if(v.type==='siteDeptDesig') exportCSV(peopleForFilter(v.site||'',v.dept||'',v.desig||'',v.name||'',v.region||'ALL'),true);
    else if(v.type==='vacant') exportCSV(ALL_ROSTER.filter(p=>p.status==='VACANT'),true);
    else if(v.type==='group') exportCSV(ALL_ROSTER.filter(p=>GROUP_DEFS[v.group].ids.includes(p.siteId)),true);
    else if(v.type==='dashboard') exportCSV(buildLeadershipRoster(),true);
    else exportCSV(ALL_ROSTER, true);
  });

  // ---------- edit-data export / import / discard ----------
  function downloadJSON(filename, obj){
    offerDownload(filename, new Blob([JSON.stringify(obj, null, 1)], {type:'application/json;charset=utf-8;'}));
  }
  document.getElementById('btnExportEdits').addEventListener('click', ()=>{
    if(!editedKeys.size && !importLog.length){ alert('No edits made yet this session.'); return; }
    downloadJSON('cd-caliber-directory-edits.json', Object.assign({_log: importLog}, overrides));
  });
  document.getElementById('btnImportEdits').addEventListener('click', ()=>{
    document.getElementById('fileImportEdits').click();
  });
  document.getElementById('fileImportEdits').addEventListener('change', (e)=>{
    const file = e.target.files[0];
    if(!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try{
        const incoming = JSON.parse(reader.result);
        const importerName = getEditorName();
        let applied = 0, missed = 0;
        Object.keys(incoming).forEach(key=>{
          if(key==='_log'){
            if(Array.isArray(incoming._log)) importLog = importLog.concat(incoming._log);
            return;
          }
          if(applyPatchToStore(key, incoming[key])){
            applied++;
            if(sharedDb) pushPatchToSharedDb(key, incoming[key]);
          } else missed++;
        });
        const now = new Date();
        const stamp = fmtDateDisplay(now.toISOString().slice(0,10)) + ' ' + String(now.getHours()).padStart(2,'0')+':'+String(now.getMinutes()).padStart(2,'0');
        const logEntry = {by: importerName, at: stamp, file: file.name, applied, missed};
        importLog.push(logEntry);
        if(sharedDb) pushImportLogToSharedDb(logEntry);
        updateEditsNote();
        render();
        alert(`Imported edits: ${applied} record(s) updated${missed?`, ${missed} key(s) not found in this roster`:''}.\nLogged under: ${importerName}`);
      }catch(err){
        alert('Could not read that file as edit JSON: ' + err.message);
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  });
  document.getElementById('btnDiscardEdits').addEventListener('click', ()=>{
    if(!editedKeys.size && !addedKeys.size) return;
    if(confirm(`Discard all ${editedKeys.size} unsaved edit(s) and ${addedKeys.size} added record(s) from this session? This reloads the page.`)){
      location.reload();
    }
  });

  // ---------- search ----------
  const searchBox = document.getElementById('searchBox');
  const searchResults = document.getElementById('searchResults');
  const escH = t => String(t==null?'':t).replace(/[&<>"]/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
  const hl = (t, terms) => {
    let out = escH(t);
    terms.forEach(w=>{ if(!w) return;
      const re = new RegExp('('+w.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+')','ig');
      out = out.replace(/(<[^>]*>)|([^<]+)/g, (m,tagp,txt)=> tagp ? tagp : txt.replace(re,'<mark>$1</mark>'));
    });
    return out;
  };
  let srMatches = [], srIdx = -1;
  function srPick(i){
    const p = srMatches[i]; if(!p) return;
    searchResults.classList.remove('show');
    searchBox.value=''; srIdx=-1;
    go({type:'person', person:p});
  }
  function srMark(){
    searchResults.querySelectorAll('.sr-item').forEach((el,i)=>{
      el.classList.toggle('kb', i===srIdx);
      if(i===srIdx) el.scrollIntoView({block:'nearest'});
    });
  }
  function runSearch(){
    const q = searchBox.value.trim().toLowerCase();
    srIdx = -1;
    if(q.length<2){ searchResults.classList.remove('show'); srMatches=[]; return; }
    const terms = q.split(/\s+/).filter(Boolean);
    const scored = [];
    ALL_ROSTER.forEach(p=>{
      const name = (p.name||'').toLowerCase();
      const hay = [p.name,p.designation,p.department,p.siteLabel,p.contact,p.email,p.cat&&('cat '+p.cat)]
                    .filter(Boolean).join(' | ').toLowerCase();
      if(!terms.every(w=>hay.includes(w))) return;
      let sc = 3;
      if(terms.every(w=>name.includes(w))){
        sc = 1;
        if(name.startsWith(terms[0])) sc = -1;
        else if(name.split(/\s+/).some(part=>part.startsWith(terms[0]))) sc = 0;
      } else if((p.designation||'').toLowerCase().includes(q)) sc = 2;
      scored.push({p,sc});
    });
    scored.sort((x,y)=> x.sc-y.sc || String(x.p.name||'~').localeCompare(String(y.p.name||'~')));
    const total = scored.length;
    srMatches = scored.slice(0,50).map(o=>o.p);
    if(!srMatches.length){
      searchResults.innerHTML = `<div class="sr-empty">No matches for "${escH(searchBox.value.trim())}".</div>`;
    } else {
      searchResults.innerHTML =
        `<div class="sr-count">${total} result${total>1?'s':''}${total>50?' &middot; showing first 50 &middot; type more to narrow':''} &middot; &uarr;&darr; + Enter</div>` +
        srMatches.map((p,i)=>`
        <div class="sr-item" data-idx="${i}">
          <div class="sr-name${p.name?'':' vac'}">${p.name ? hl(p.name,terms) : 'Vacant post'}</div>
          <div class="sr-meta">${hl([p.designation, p.department, p.siteLabel, p.cat?('Cat '+p.cat):''].filter(Boolean).join(' · '), terms)}</div>
        </div>`).join('');
      searchResults.querySelectorAll('.sr-item').forEach(el=>{
        el.addEventListener('click', ()=> srPick(+el.dataset.idx));
      });
    }
    searchResults.classList.add('show');
  }
  searchBox.addEventListener('input', runSearch);
  searchBox.addEventListener('focus', ()=>{ if(searchBox.value.trim().length>=2) runSearch(); });
  searchBox.addEventListener('keydown', (e)=>{
    if(e.key==='Escape'){ searchResults.classList.remove('show'); searchBox.blur(); return; }
    if(!searchResults.classList.contains('show') || !srMatches.length) return;
    if(e.key==='ArrowDown'){ e.preventDefault(); srIdx = Math.min(srIdx+1, srMatches.length-1); srMark(); }
    else if(e.key==='ArrowUp'){ e.preventDefault(); srIdx = Math.max(srIdx-1, 0); srMark(); }
    else if(e.key==='Enter'){ e.preventDefault(); srPick(srIdx<0?0:srIdx); }
  });
  document.addEventListener('click', (e)=>{
    if(!e.target.closest('.search')) searchResults.classList.remove('show');
  });

  renderTopPills();
  render();
  initSharedDb();
  renderSignInUI();
})();

;
/* ---- Tata Motors-style reveal: fades/slides sections in
   (a) on scroll — replaying every time you scroll back over them, and
   (b) the instant they appear from a click — any tab, pill, filter, or name/profile open ---- */
(function(){
  var REDUCE = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var REVEAL_SELECTORS = [
    '.hero-band', '.cards .card', '.chart-wrap', '.chart-group',
    '.profile', '.section-head', '.alert', '.bday-banner.show',
    'table.roster tbody tr', 'table.matrix', 'footer'
  ];
  var MAX_ROWS_PER_TABLE = 80; // avoid tagging every row in very long rosters

  if (REDUCE || !('IntersectionObserver' in window)) return;

  var io = new IntersectionObserver(function(entries){
    entries.forEach(function(entry){
      if (entry.isIntersecting) entry.target.classList.add('in-view');
      else entry.target.classList.remove('in-view'); // leaves view -> resets, so it plays again on next scroll-in
    });
  }, { threshold: 0.12, rootMargin: '0px 0px -8% 0px' });

  // Guaranteed one-off play-in for a just-inserted element (click/tab/name opens),
  // regardless of whether it happens to be in the viewport yet.
  function playInNow(el){
    el.classList.remove('in-view');
    void el.offsetWidth; // force reflow so the browser commits the "hidden" starting state
    requestAnimationFrame(function(){
      requestAnimationFrame(function(){ el.classList.add('in-view'); });
    });
  }

  function tag(el, isFresh){
    if (el.hasAttribute('data-reveal-bound')) return;
    el.setAttribute('data-reveal-bound', '1');
    el.classList.add('reveal');
    io.observe(el); // keeps it replaying on future scroll in/out
    if (isFresh) playInNow(el); // and play immediately now, e.g. right after a click swaps the view
  }

  function scan(root, isFresh){
    root = root || document;
    REVEAL_SELECTORS.forEach(function(sel){
      var nodes = root.querySelectorAll ? root.querySelectorAll(sel) : [];
      if (sel === 'table.roster tbody tr') {
        // guard against tagging hundreds of rows on big rosters
        var counts = new Map();
        nodes.forEach(function(tr){
          var tbl = tr.closest('table.roster');
          if (!tbl) return;
          var c = counts.get(tbl) || 0;
          if (c < MAX_ROWS_PER_TABLE) { tag(tr, isFresh); counts.set(tbl, c + 1); }
        });
      } else {
        nodes.forEach(function(el){ tag(el, isFresh); });
      }
    });
  }

  // Re-scan right after every DOM change (click-driven re-renders included), as soon as
  // possible — a microtask, so it runs before the browser paints the new content.
  var scheduled = false;
  var mo = new MutationObserver(function(){
    if (scheduled) return;
    scheduled = true;
    Promise.resolve().then(function(){ scheduled = false; scan(document, true); });
  });
  mo.observe(document.body, { childList: true, subtree: true });

  scan(document, true);
})();
