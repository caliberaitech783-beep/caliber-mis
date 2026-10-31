import {resolveMobileAccess} from './mobile-access.mjs';
import {assignedUserRoles} from './account-role-access.mjs';
import {managerReportScope,reportScopeIncludesSite} from './region-scope.mjs';
import {batchLogin} from './vlb-batch-policy.mjs';
import {misPageAllowed} from './mis-application-access.mjs';

export async function vlbBatchActor(client,session){
 const login=batchLogin(session?.login||session?.name);
 const {rows}=await client.query("SELECT record_data FROM master_records WHERE master_name='Users & employees' AND lower(trim(record_data->>'login'))=$1 ORDER BY id DESC LIMIT 1",[login]);
 const user=rows[0]?.record_data||{},profile=resolveMobileAccess({user});
 const current=!user.sourceMissing&&!['inactive','disabled','deleted'].includes(String(user.status||'').trim().toLowerCase());
 const pm=current&&profile.sessionRole==='super'&&profile.permissions?.adminLevel==='Manager'&&(profile.permissions.managerRoles||[]).includes('Project Manager');
 const mis=assignedUserRoles(user).includes('MIS User')||profile.assignedRole==='MIS User'||(!pm&&session?.permissions?.separateMisCredentials&&misPageAllowed(session,'Create VLB Batch'));
 return {login,pm,mis,pmScope:pm?managerReportScope(user):{sites:[]}};
}
export const batchPmAtSite=(context,site)=>context.pm&&reportScopeIncludesSite(context.pmScope,site);
