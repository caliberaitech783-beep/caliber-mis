// The columns of the register of site moves, on the screen and in its Excel (src/employee-site-moves.jsx).
export const dmy=value=>{const m=String(value||'').match(/^(\d{4})-(\d{2})-(\d{2})$/);return m?`${m[3]}-${m[2]}-${m[1]}`:String(value||'')};
export const when=value=>value?new Date(value).toLocaleString('en-IN',{timeZone:'Asia/Kolkata',day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'}):'';
export const SITE_MOVE_HEADINGS=['Employee ID','Name','Designation','From site','To site','From date','Asked by','OTP given by','Approved on','Vehicle / machine','Card NO'];
export const siteMoveCells=move=>[move.employeeId,move.name,move.designation,move.from,move.to,dmy(move.fromDate),move.requestedBy,(move.approvedBy||[]).join(', '),when(move.approvedAt),move.card?.door||'',move.card?.cardNo||''];
export const siteMoveSheets=moves=>[{name:'Site moves',title:'Site moves approved by OTP',columns:SITE_MOVE_HEADINGS.map(label=>({label})),rows:moves.map(siteMoveCells)}];
