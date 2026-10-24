// Format equivalent clock notation for HTML time inputs; never infer AM/PM.
export function scanTimeInput(value){if(typeof value!=='string')return value??'';const m=value.match(/^(\d{1,2})[:.](\d{2})$/);if(!m||Number(m[1])>23||Number(m[2])>59)return value;return m[1].padStart(2,'0')+':'+m[2];}
export function scanTripTimeInputs(rows){return (rows||[]).map(row=>({...row,loadingTime:scanTimeInput(row.loadingTime),unloadingTime:scanTimeInput(row.unloadingTime)}));}
