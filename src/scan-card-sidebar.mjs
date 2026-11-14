// Rule (owner, 15 Nov 2026): while a VLB, LMV or ELB scan card is open for review,
// the left sidebar runs in auto-hide mode (closed, opens only while the pointer is at
// the left edge or inside it), so the card values and the original scan get the full width.
// Leaving the card returns the sidebar to the user's own setting.
export const SCAN_CARD_SIDEBAR_EVENT='caliber:scan-card-review';

export function announceScanCardReview(open,target=globalThis){
 try{
  if(typeof target?.dispatchEvent!=='function'||typeof CustomEvent!=='function')return;
  target.dispatchEvent(new CustomEvent(SCAN_CARD_SIDEBAR_EVENT,{detail:{open:Boolean(open)}}));
 }catch{}
}

// Effective auto-hide for the app shell: the user's setting, or forced on while a scan card is open.
export function sidebarAutoHide(userAutoHide,scanCardOpen){
 return Boolean(userAutoHide||scanCardOpen);
}
