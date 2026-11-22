// A worker's site, by date, and the one way it changes.
//
// Owner, 22 Nov 2026: when a card for one site carries a driver of another site, the card waits for a person. On
// "Fetch from Pulse-II" an OTP is asked and, on the OTP, the driver's site changes permanently, for salary and
// everything else. After that the site must never go back to the old site by itself: only another deliberate,
// approved move can change it. "Make a hard code for it."
//
//  - The move takes effect from the date of the card that asked for it. Sites enter shifts days late, so a card of
//    an earlier date must still find the driver at the site he or she was at on that date. Each move is therefore
//    kept on the employee (siteMoves: from, to, fromDate) and the site is read for a date (employeeSiteOn).
//    Without this, an older card of the old site would be held, and "fixing" it would move the driver back.
//  - siteLockedAt marks a site that was set by an approved move. HR's import, the old Excel import and the ERP
//    copy never change such a site (shared/hr-employee-master.mjs, server/routes/employee-master.mjs).
//  - Every screen that could change a site by hand refuses (changesSite): Employee Master edit and Employee
//    Current Location. A worker with no site yet can still be given one there.
import {displaySiteSelection,displaySiteName} from './region-scope.mjs';
import {canonicalSiteName} from './site-location.mjs';
import {hrSiteName} from './hr-employee-master.mjs';

export const SITE_CHANGE_REFUSAL="A worker's site changes only by Fetch from Pulse-II with OTP on a card, or from HR's master Excel. The site was not changed.";
const text=value=>String(value??'').trim();
export const isBookDate=value=>/^\d{4}-\d{2}-\d{2}$/.test(String(value??''));
// The same order every site check reads the fields in (shared/log-book-access.mjs).
export const currentSite=record=>text(record?.site||record?.location||record?.currentLocation);
// One key for every spelling of a site ("MAJRI OB", "Majri OC"); a list of sites keeps every one of them.
export const siteKey=site=>displaySiteSelection(site).map(name=>canonicalSiteName(name)).filter(Boolean).sort().join('|')||text(site).toLowerCase();
export const sameSite=(a,b)=>siteKey(a)===siteKey(b);
export const siteLocked=record=>Boolean(record?.siteLockedAt);

// Approved moves in the order they take effect.
export function siteMoves(record){
 return (Array.isArray(record?.siteMoves)?record.siteMoves:[]).filter(move=>move&&isBookDate(move.fromDate)&&text(move.to))
  .slice().sort((a,b)=>a.fromDate<b.fromDate?-1:a.fromDate>b.fromDate?1:text(a.at).localeCompare(text(b.at)));
}
// The site the worker belonged to on a date. On or after the latest move, and for a worker who was never moved
// or when no date is given, that is the site held today.
export function employeeSiteOn(record,date){
 const moves=isBookDate(date)?siteMoves(record):[];
 if(!moves.length||date>=moves.at(-1).fromDate)return currentSite(record);
 let site=text(moves[0].from);
 for(const move of moves)if(move.fromDate<=date)site=text(move.to);
 return site;
}

// Works out an approved move without writing: the line for the employee's history and the fields to change.
// Returns null when the worker already belongs to that site on that date. The site held today changes only when
// this move is the latest one; a move for an earlier date fills in the history and leaves today's site alone.
export function planSiteMove(record,{to,fromDate,at=new Date().toISOString(),by='',approvedBy=[],card=null}={}){
 if(!isBookDate(fromDate))throw Object.assign(new Error('The card date is needed to move a worker to another site.'),{status:400});
 // Only to one of our operational sites: a card exists only there.
 const target=hrSiteName(to);
 if(!target)throw Object.assign(new Error('Choose the site of the card.'),{status:400});
 const from=employeeSiteOn(record,fromDate);
 if(sameSite(from,target))return null;
 const moves=siteMoves(record),latest=!moves.length||fromDate>=moves.at(-1).fromDate;
 const move={from:displaySiteName(from)||from,to:target,fromDate,at,by:text(by),approvedBy:[...approvedBy],...(card?{card}:{})};
 const patch={siteMoves:siteMoves({siteMoves:[...moves,move]}),siteLockedAt:at,siteLockedBy:text(by),...(latest?{site:target,currentLocation:target}:{})};
 return {move,patch,latest};
}

// Would saving `next` over `saved` change the worker's site? A worker with no site yet can be given one.
export function changesSite(saved,next){
 const before=currentSite(saved);
 return Boolean(before)&&!sameSite(before,currentSite(next));
}
