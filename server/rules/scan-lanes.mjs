import {canonicalSiteName} from '../../shared/site-location.mjs';

// Scan lanes: every site reads its cards in its own queue, so one site's large
// upload never waits in front of another site's cards. A lane is named by the
// canonical site of the scan batch (expected_context.location); batches with no
// site yet share the OTHER lane.
export const OTHER_LANE='';

export function scanLaneOf(location){return canonicalSiteName(location||'');}

// GEMINI_API_KEY_<slug> and engine names use this form: "Sasti OC" -> SASTI_OB,
// "Dhoptala OC (2nd)" -> DHOPTALA_OB_2ND.
export function siteKeySlug(site){const lane=scanLaneOf(site);return lane?lane.toUpperCase().replace(/[^A-Z0-9]+/g,'_').replace(/^_+|_+$/g,''):'';}

// MIS_SCAN_LANES=sites switches on one queue per site inside this process.
// Unset or anything else keeps the single shared queue used before.
export function scanLanesEnabled(env=process.env){return String(env.MIS_SCAN_LANES||'').trim().toLowerCase()==='sites';}

// MIS_SCAN_ENGINES=external hands reading to the separate scan engine app.
// Pulse-II then reads only the sites whose engine is not running.
export function scanEnginesExternal(env=process.env){return String(env.MIS_SCAN_ENGINES||'').trim().toLowerCase()==='external';}

export function laneConcurrency(env=process.env,fallback=5,max=10){
 const value=Number(env.MIS_SCAN_LANE_CONCURRENCY);
 return Number.isInteger(value)&&value>=1&&value<=max?value:fallback;
}

// Semicolon or comma separated site list, as typed in Azure:
// "Sasti OC;Majri OC;Dhoptala OC (2nd)". Returns canonical lane names.
export function parseSiteList(value){return [...new Set(String(value||'').split(/[;,\n]/).map(scanLaneOf).filter(Boolean))];}

// Which lanes does an engine cover? A site engine covers exactly its site.
// The "other" engine covers every lane except the listed site engines.
export function engineCovers(engine,lane){
 if(!engine)return false;
 if(engine.site_lane!==null&&engine.site_lane!==undefined&&engine.site_lane!=='*')return engine.site_lane===lane;
 return !(engine.excluded_lanes||[]).includes(lane);
}

// Group queued batches into lanes. rows: [{batch_id, location}].
export function groupBatchesByLane(rows){
 const lanes=new Map();
 for(const row of rows){const lane=scanLaneOf(row.location);if(!lanes.has(lane))lanes.set(lane,[]);lanes.get(lane).push(String(row.batch_id));}
 return lanes;
}
