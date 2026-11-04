// Keep report printing independent of the application's print-only layouts.
export function printFleetReconciliation(content){
 const frame=document.createElement('iframe');
 frame.title='Fleet reconciliation print';
 frame.style.cssText='position:fixed;left:-10000px;top:0;width:1500px;height:900px;border:0';
 document.body.append(frame);
 const doc=frame.contentDocument;
 doc.title='Fleet reconciliation · VLB / ELB';
 const style=doc.createElement('style');
 style.textContent=`@page{size:A3 landscape;margin:10mm}*{box-sizing:border-box}body{margin:0;background:#fff;color:#111;font:10pt Arial,sans-serif}h2{font-size:16pt}p{margin:6pt 0}table{border-collapse:collapse;width:100%;table-layout:auto;font-size:8pt}caption{text-align:left;padding:8pt 0}th,td{border:1px solid #888;padding:4pt;text-align:left;vertical-align:top;overflow-wrap:anywhere}thead{display:table-header-group}tr{break-inside:avoid}td small{display:block;margin-top:3pt}.fleet-summary{display:flex;gap:12pt;margin:12pt 0}.fleet-summary article{flex:1;border:1px solid #aaa;padding:8pt}.fleet-summary h3{margin:0 0 5pt}button{display:none}`;
 doc.head.append(style);
 const copy=content.cloneNode(true);
 // Render controls as text so the printed report includes their current values.
 const originals=content.querySelectorAll('input,select');
 copy.querySelectorAll('input,select').forEach((node,index)=>{
  const original=originals[index];
  const value=original?.tagName==='SELECT'?original.selectedOptions[0]?.textContent:original?.value;
  node.replaceWith(doc.createTextNode(value||'—'));
 });
 copy.querySelectorAll('.fleet-filters,.fleet-toolbar,.fleet-table-actions,button,[role="alert"]').forEach(node=>node.remove());
 doc.body.append(copy);
 frame.contentWindow.addEventListener('afterprint',()=>frame.remove(),{once:true});
 frame.contentWindow.requestAnimationFrame(()=>{const table=doc.querySelector('table');if(table&&table.scrollWidth>1500)table.style.zoom=String(1500/table.scrollWidth);frame.contentWindow.focus();frame.contentWindow.print()});
}
