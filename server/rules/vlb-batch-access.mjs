import {resolveMobileAccess} from '../../shared/mobile-access.mjs';
import {assignedUserRoles} from '../../shared/account-role-access.mjs';
import {managerReportScope,reportScopeIncludesSite} from '../../shared/region-scope.mjs';
import {batchLogin} from './vlb-batch-policy.mjs';
import {misPageAllowed} from '../../shared/mis-application-access.mjs';

export async function vlbBatchActor(client,session){
 const login=batchLogin(session?.login||session?.name);
 const {rows}=await client.query("SELECT record_data FROM master_records WHERE master_name='Users & employees' AND lower(trim(record_data->>'login'))=$1 ORDER BY id DESC LIMIT 1",[login]);
 const user=rows[0]?.record_data||{},profile=resolveMobileAccess({user});
 const current=!user.sourceMissing&&!['inactive','disabled','deleted'].includes(String(user.status||'').trim().toLowerCase());
 const pm=current&&profile.sessionRole==='super'&&profile.permissions?.adminLevel==='Manager'&&(profile.permissions.managerRoles||[]).includes('Project Manager');
 // A Project Manager whose MIS sign-in includes the log-book pages is an MIS user as well
 // (owner, 19 Nov 2026): the PM role no longer hides Edit on open batches.
 const mis=assignedUserRoles(user).includes('MIS User')||profile.assignedRole==='MIS User'||(session?.permissions?.separateMisCredentials&&misPageAllowed(session,'Create VLB Batch'));
 return {login,pm,mis,pmScope:pm?managerReportScope(user):{sites:[]}};
}
export const batchPmAtSite=(context,site)=>context.pm&&reportScopeIncludesSite(context.pmScope,site);
