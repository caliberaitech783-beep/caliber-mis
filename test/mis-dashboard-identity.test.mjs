import test from 'node:test';
import assert from 'node:assert/strict';
import {sharedMisDashboardIdentity} from '../mis-dashboard-identity.mjs';
import {dashboardEquipmentScope,dashboardEquipmentScopeIsUsable} from '../dashboard-equipment-access.mjs';

test('a server-validated Pulse administrator opens an empty MIS database without copied users',()=>{
  const session={sharedPulseIdentity:true,login:'synthetic-admin',name:'Synthetic Admin',role:'super',permissions:{adminLevel:'Super Admin'}};
  const result=sharedMisDashboardIdentity(session,null);
  assert.equal(result.session,session);
  assert.deepEqual(result.user,{login:session.login,employee:session.name});
  assert.equal(dashboardEquipmentScope(result.session,result.user).restrictToScope,false);
  assert.equal(sharedMisDashboardIdentity({...session,sharedPulseIdentity:false},null),null);
});

test('shared MIS identities retain local site restrictions and never gain unassigned sites',()=>{
  for(const session of [
    {sharedPulseIdentity:true,role:'normal',assignedRole:'MIS User',login:'synthetic-mis'},
    {sharedPulseIdentity:true,role:'super',permissions:{adminLevel:'Manager'},login:'synthetic-manager'},
  ]){
    const empty=sharedMisDashboardIdentity(session,null);
    assert.equal(dashboardEquipmentScopeIsUsable(dashboardEquipmentScope(empty.session,empty.user)),false);
    const localUser={login:session.login,site:'Majri OC',managerSites:'Majri OC'};
    assert.equal(sharedMisDashboardIdentity(session,localUser).user,localUser);
  }
});
