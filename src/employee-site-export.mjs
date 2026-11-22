import {displaySiteName} from '../shared/region-scope.mjs';

export const NO_SITE_LABEL='No location';

// Employee Master "Site-wise download": one Excel sheet per site (named as the Location list shows it),
// after a first "All sites" summary sheet with the count of employees at each site.
export function employeeSiteGroups(records=[]){
  const groups=new Map();
  for(const record of records){
    const site=displaySiteName(record?.site)||NO_SITE_LABEL;
    if(!groups.has(site))groups.set(site,[]);
    groups.get(site).push(record);
  }
  return [...groups.entries()]
    .sort(([a],[b])=>a===NO_SITE_LABEL?1:b===NO_SITE_LABEL?-1:a.localeCompare(b,'en-IN'))
    .map(([site,rows])=>({site,rows}));
}

export function employeeSiteSheets(records=[],columns=[],title='Employee Master'){
  const groups=employeeSiteGroups(records);
  const summary={
    name:'All sites',
    title:`${title} · Employees by site`,
    columns:[{label:'Site',value:r=>r.site},{label:'Employees',value:r=>r.count}],
    rows:[...groups.map(g=>({site:g.site,count:g.rows.length})),{site:'Total',count:records.length}]
  };
  return [summary,...groups.map(g=>({name:g.site,title:`${title} · ${g.site} (${g.rows.length} employees)`,columns,rows:g.rows}))];
}
