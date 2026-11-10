import {canonicalSiteName} from '../../shared/site-location.mjs';
export const DELETION_PHONE='919925565281';
export function deletionPhone(sites=[]){
 const matches=sites.map(site=>canonicalSiteName(site)===canonicalSiteName('Jayant OC'));
 if(matches.some(Boolean)&&!matches.every(Boolean))throw Object.assign(Error('Delete Jayant OC records separately from other sites.'),{status:400,statusCode:400});
 return matches.some(Boolean)?'919936297751':DELETION_PHONE;
}
export const deletionRecipient=phone=>'+91 '+phone.slice(2);
