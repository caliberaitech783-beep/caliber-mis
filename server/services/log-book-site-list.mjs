import {createLogBookSiteCache} from '../../shared/log-book-access.mjs';
import {withoutRowSecurityRequest} from './row-security.mjs';

// One list of the sites that hold cards, for the whole server.
//
// Many routes ask "which of the sites with cards may this login see": the manual VLB / ELB save,
// the register under the form, the scan entry read, the reports. Each used to answer it with its
// own `SELECT DISTINCT site FROM mis_log_books`, which under row security checks every saved card
// against the login's sites. On 23 Nov 2026 (about 90,000 cards) that one read took 20 to 30 s for
// a site login, and the manual VLB save ran it inside its transaction while it held the site, date
// and shift lock: every operator of that shift waited behind it, 3 to 4 minutes a card.
//
// The list is now read once a minute, as the server (not as a login), and every caller filters that
// one list by its own scope. All routes given the same pool share the same list.
const lists=new WeakMap();
export function sharedLogBookSites(pool){
 const keyed=pool!==null&&(typeof pool==='object'||typeof pool==='function');
 let list=keyed?lists.get(pool):null;
 if(!list){
  list=createLogBookSiteCache({pool:pool||null,trusted:withoutRowSecurityRequest});
  if(keyed)lists.set(pool,list);
 }
 return list;
}
