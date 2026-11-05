import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const read=file=>readFileSync(new URL('../'+file,import.meta.url),'utf8');

test('Fleet reconciliation is a standalone page directly below Dashboard',()=>{
 const dashboard=read('src/mis-dashboard.jsx'),sidebar=read('src/erp-sidebar.jsx'),main=read('src/main.jsx');
 assert.doesNotMatch(dashboard,/FleetReconciliation/,'Dashboard no longer embeds the fleet report');
 assert.match(sidebar,/select\('Dashboard'\)[\s\S]*select\('Fleet reconciliation'\)/,'the standalone tab follows Dashboard');
 assert.match(main,/renderedActive==='Fleet reconciliation' \? \(<FleetReconciliation session=\{session\}\/>\)/,'the tab renders the existing report component');
});
