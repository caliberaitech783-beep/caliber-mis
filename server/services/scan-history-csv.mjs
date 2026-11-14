import {decodeScanJson} from '../rules/scan-text-storage.mjs';

const columns = [
 'scan_created_at_utc','ocr_finished_at_utc','book_kind','site','card_id','batch_id',
 'ocr_duration_ms','processing_duration_ms','queue_duration_ms','outcome'
];

function csvCell(value){
 let text=String(value??'');
 if(/^[\s\uFEFF]*[=+\-@]|^[\t\r\n]/.test(text))text="'"+text;
 return '"'+text.replaceAll('"','""')+'"';
}

const timestamp=value=>value&&Number.isFinite(Date.parse(value))?new Date(value).toISOString():'';
const duration=value=>Number.isFinite(value)&&value>=0?value:'';

export function scanHistoryCsv(rows){
 const records=rows.map(row=>{
  const fields=decodeScanJson(row.raw_fields)||{};
  const timing=fields.scanTiming;
  return [
   timestamp(row.created_at),timestamp(timing?.finishedAt),row.book_kind,row.site,row.id,row.batch_id,
   duration(fields.gemini?.totalElapsedMs),duration(timing?.totalMs),duration(timing?.queuedMs),row.status
  ].map(csvCell).join(',');
 });
 return [columns.join(','),...records,''].join('\r\n');
}
