import {canonicalSiteName} from '../../shared/site-location.mjs';
export const DELETION_PHONE='919925565281';
const siteRecipients=new Map([
 ['jayant ob','919936297751'],
 ['dudhichua east ob','919113496780'],
 ['dudhichua ob','916394694715'],
 ['dudhichau ob','916394694715'],
]);
export function deletionPhone(sites=[]){
 const recipients=new Set(sites.map(site=>siteRecipients.get(canonicalSiteName(site))||DELETION_PHONE));
 if(recipients.size>1)throw Object.assign(Error('Delete records from sites with different OTP recipients separately.'),{status:400,statusCode:400});
 return recipients.values().next().value||DELETION_PHONE;
}
export const deletionRecipient=phone=>'+91 '+phone.slice(2);
