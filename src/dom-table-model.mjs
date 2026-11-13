// Reads a table as it is on screen into export columns and rows. It serves the tables that are drawn by hand
// (pop-up lists, grids with joined headings), which have no column definitions of their own to export from.
import {SERIAL_COLUMN_LABEL} from '../shared/serial-column.mjs';

const BOUNDARY='⁣';
const tidy=text=>String(text??'').replace(/ /g,' ').split(/\r?\n/).map(line=>line.replace(/\s+/g,' ').trim()).filter(Boolean).join('\n');

function controlText(control){
  const type=String(control.type||'').toLowerCase();
  if(type==='checkbox'||type==='radio')return control.checked?'Yes':'No';
  if(['hidden','button','submit','reset','file','image'].includes(type))return '';
  if(String(control.tagName).toUpperCase()==='SELECT')return control.selectedOptions?.[0]?.textContent??'';
  return control.value??'';
}

// Text of one node as a person reads it: hidden parts left out, a field's current value in place of the field,
// and two side-by-side pieces (a name and its small count) kept apart instead of run together.
function nodeText(node,view){
  if(node.nodeType===3)return node.nodeValue||'';
  if(node.nodeType!==1)return '';
  const tag=String(node.tagName).toUpperCase();
  if(tag==='SCRIPT'||tag==='STYLE'||tag==='SVG'||tag==='TABLE')return '';
  if(node.hidden||node.hasAttribute?.('data-print-hide')||node.getAttribute?.('aria-hidden')==='true')return '';
  if(tag==='BR')return '\n';
  if(tag==='INPUT'||tag==='SELECT'||tag==='TEXTAREA')return BOUNDARY+controlText(node)+BOUNDARY;
  const style=view?.getComputedStyle?.(node);
  if(style&&(style.display==='none'||style.visibility==='hidden'))return '';
  const inner=[...node.childNodes].map(child=>nodeText(child,view)).join('');
  const inline=style?/^(inline|inline-block|inline-flex|contents)$/.test(style.display):!/^(DIV|P|LI|UL|OL|H[1-6]|SECTION|ARTICLE)$/.test(tag);
  return inline?BOUNDARY+inner+BOUNDARY:'\n'+inner+'\n';
}

/** The text of a table cell as shown on screen. */
export function domCellText(cell){
  if(!cell)return '';
  if(!cell.childNodes)return tidy(cell.innerText??cell.textContent);
  const view=cell.ownerDocument?.defaultView;
  const raw=[...cell.childNodes].map(child=>nodeText(child,view)).join('');
  // A boundary becomes a space only where two pieces would otherwise touch; never before % , . ) or after ( ₹.
  return tidy(raw
    .replace(new RegExp(`${BOUNDARY}+`,'g'),BOUNDARY)
    .replace(new RegExp(`(^|[\\s(\\[₹])${BOUNDARY}`,'g'),'$1')
    .replace(new RegExp(`${BOUNDARY}(?=$|[\\s%,.;:)\\]])`,'g'),'')
    .replace(new RegExp(BOUNDARY,'g'),' '));
}

const span=(value,limit)=>Math.max(1,Math.min(limit,Number(value)||1));
// Lays rows of cells out on a grid, so joined cells (colSpan, rowSpan) take up the places they cover on screen.
function layout(rows){
  const grid=rows.map(()=>[]);
  rows.forEach((cells,r)=>{
    let c=0;
    for(const cell of cells){
      while(grid[r][c])c++;
      const wide=span(cell.colSpan,1000),tall=span(cell.rowSpan,rows.length-r);
      for(let down=0;down<tall;down++)for(let across=0;across<wide;across++)grid[r+down][c+across]={cell,top:down===0,left:across===0,wide};
      c+=wide;
    }
  });
  return grid;
}
const cellsOf=row=>[...(row.cells||[])];
const rowsOf=section=>section?[...(section.rows||[])]:[];
const isHeading=cell=>String(cell.tagName).toUpperCase()==='TH';

// A cell that holds only buttons or tick boxes (Open, Delete, a selection box) is a tool, not a figure.
function toolCell(cell,text){
  if(typeof cell.querySelectorAll!=='function')return false;
  const buttons=[...cell.querySelectorAll('button,[role="button"]')];
  if(buttons.length&&tidy(buttons.map(button=>button.innerText??button.textContent).join(' ')).replace(/\s+/g,'')===text.replace(/\s+/g,''))return true;
  const ticks=[...cell.querySelectorAll('input[type="checkbox"],input[type="radio"]')];
  return ticks.length>0&&/^(Yes|No)(\s(Yes|No))*$/.test(text.replace(/\n/g,' '));
}

/**
 * {columns,rows} of a table element, ready for the PDF, Excel and Smart Print builders.
 * Stacked headings become one label ("Shift 1 · Duties"); a value joined across rows is repeated on each row so
 * every Excel line is complete; columns that hold only buttons under an empty or "Action" heading are left out.
 */
export function readDomTable(table){
  if(!table)return null;
  const bodySections=[...(table.tBodies||[])];
  let headRows=rowsOf(table.tHead).map(cellsOf);
  let bodyRows=[...bodySections.flatMap(rowsOf),...rowsOf(table.tFoot)].map(cellsOf).filter(cells=>cells.length);
  if(!headRows.length){
    // No <thead>: the leading rows made only of heading cells are the headings.
    const lead=bodyRows.findIndex(cells=>!cells.every(isHeading));
    const count=lead<0?Math.min(1,bodyRows.length):lead;
    headRows=bodyRows.slice(0,count);bodyRows=bodyRows.slice(count);
  }
  const head=layout(headRows),body=layout(bodyRows);
  const width=Math.max(0,...head.map(row=>row.length),...body.map(row=>row.length));
  if(!width)return null;
  const labels=Array.from({length:width},(_,c)=>{
    const parts=[];
    head.forEach(row=>{const slot=row[c];if(!slot||!slot.top)return;const text=domCellText(slot.cell).replace(/\n/g,' ');if(text&&parts.at(-1)!==text)parts.push(text);});
    return parts.join(' · ');
  });
  // A single message across the whole table ("No records") is not a record.
  const messageOnly=body.length===1&&width>1&&body[0][0]?.wide>=width;
  const slots=messageOnly?[]:body;
  const texts=slots.map(row=>Array.from({length:width},(_,c)=>{const slot=row[c];return slot&&slot.left?domCellText(slot.cell):'';}));
  const keep=Array.from({length:width},(_,c)=>{
    const filled=slots.map((row,r)=>({slot:row[c],text:texts[r][c]})).filter(item=>item.text);
    const label=labels[c].trim();
    // A heading marked data-smart-print-skip (a "Download scan" column) never goes to paper.
    if(head.some(row=>row[c]?.cell.hasAttribute?.('data-smart-print-skip')))return false;
    if(!label&&!filled.length)return false;
    if((!label||/^actions?$/i.test(label))&&filled.every(item=>toolCell(item.slot.cell,item.text)))return false;
    return true;
  });
  const kept=keep.flatMap((yes,c)=>yes?[c]:[]);
  if(!kept.length)return null;
  const columns=kept.map((c,index)=>{
    const label=/^(#|s(r|l)?\.?\s*no\.?)$/i.test(labels[c].trim())&&index===0?SERIAL_COLUMN_LABEL:labels[c].trim()||`Column ${index+1}`;
    return {key:`c${index}`,label,value:row=>row[index]};
  });
  return {columns,rows:texts.map(row=>kept.map(c=>row[c]))};
}

/**
 * The table a Smart Print button belongs to: inside the nearest surrounding block that holds a table, the first
 * table after the button, or else the first one in that block.
 */
export function nearestPrintTable(start,selector='table'){
  for(let scope=start?.parentElement;scope;scope=scope.parentElement){
    const tables=[...scope.querySelectorAll(selector)].filter(table=>!table.closest('[data-smart-print-skip]'));
    if(tables.length)return tables.find(table=>start.compareDocumentPosition(table)&4)||tables[0];
    if(scope.hasAttribute?.('data-smart-print-scope'))break;
  }
  return null;
}
