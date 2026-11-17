// Shared "Sr. No." column contract for on-screen tables and every exported attachment.
// Shared tables number their rows on screen and decorate their export models with this
// column; the PDF, Excel and print builders add it themselves only when it is missing,
// so no attachment ever carries the serial number twice.
export const SERIAL_COLUMN_KEY='__rowNumber';
export const SERIAL_COLUMN_LABEL='Sr. No.';

export const hasSerialColumn=(columns=[])=>columns.some(column=>column?.key===SERIAL_COLUMN_KEY||String(column?.label??'').trim()===SERIAL_COLUMN_LABEL);

/** Prepends the serial column to plain export data (label objects plus cell arrays) unless the table already supplied it. */
export function withSerialColumn(columns=[],rows=[]){
  if(hasSerialColumn(columns))return {columns,rows};
  if(columns[0]?.key==='requestShift'||columns[0]?.label==='Shift')return {columns:[columns[0],{key:SERIAL_COLUMN_KEY,label:SERIAL_COLUMN_LABEL},...columns.slice(1)],rows:rows.map((row,index)=>[row[0],String(index+1),...row.slice(1)])};
  return {columns:[{key:SERIAL_COLUMN_KEY,label:SERIAL_COLUMN_LABEL},...columns],rows:rows.map((row,index)=>[String(index+1),...row])};
}

/** The record-count line shown under a report title in Excel, matching the PDF heading and print subtitle. */
export const recordCountLine=(count,generatedAt)=>`${Number(count||0).toLocaleString('en-IN')} record${Number(count)===1?'':'s'} · Generated ${generatedAt}`;

// Owner, 17 Nov 2026: in every report the Sr. No. itself is coloured so the top of the list can be watched:
// Sr. No. 1 to 5 red, 6 to 10 orange, 11 onwards green. Only the number's cell is coloured; a total or subtotal
// line has no number and no colour. The colour follows the line's place in the list as it is sorted.
export const isSerialColumn=(column)=>column?.key===SERIAL_COLUMN_KEY||String(column?.label??'').trim()===SERIAL_COLUMN_LABEL;
export const SERIAL_TONE_COLOURS=Object.freeze({red:'#dc2626',orange:'#ea580c',green:'#16a34a'});
export function serialTone(value){
  const text=String(value??'').trim();
  if(!/^\d+$/.test(text))return '';
  const number=Number(text);
  return number<1?'':number<=5?'red':number<=10?'orange':'green';
}
// The cell styles (styles.xml cellXfs index) of the coloured Sr. No. in the report Excel builders.
export const SERIAL_XLSX_STYLES=Object.freeze({red:9,orange:10,green:11});
