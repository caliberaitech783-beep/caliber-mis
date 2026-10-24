// Lossless Unicode transport for legacy local PostgreSQL WIN1252 databases.
// API consumers receive decoded values; original scans and strings are preserved.
const tag='__caliberUtf8JsonV1';
export function encodeScanJson(value){const json=JSON.stringify(value);return /[^\x00-\x7f]/.test(json)?{[tag]:Buffer.from(json,'utf8').toString('base64'),...(value?.provider?{provider:value.provider}:{}),...(value?.model?{model:value.model}:{})}:value;}
export function decodeScanJson(value){if(value&&typeof value==='object'&&!Array.isArray(value)&&typeof value[tag]==='string'){const {[tag]:data,...extra}=value;return {...JSON.parse(Buffer.from(data,'base64').toString('utf8')),...Object.fromEntries(Object.entries(extra).filter(([k])=>!['provider','model'].includes(k)).map(([k,v])=>[k,decodeScanJson(v)]))};}if(Array.isArray(value))return value.map(decodeScanJson);if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,decodeScanJson(v)]));return value;}
const textTag='CALIBER_UTF8_TEXT_V1:';
export const encodeScanText=value=>/[^\x00-\x7f]/.test(value)||value.startsWith(textTag)?textTag+Buffer.from(value,'utf8').toString('base64'):value;
export const decodeScanText=value=>typeof value==='string'&&value.startsWith(textTag)?Buffer.from(value.slice(textTag.length),'base64').toString('utf8'):value;
export function decodeScanRow(row){if(row){row.raw_fields=decodeScanJson(row.raw_fields);row.draft=decodeScanJson(row.draft);row.ocr_text=decodeScanText(row.ocr_text);}return row;}
