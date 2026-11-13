// The Smart Print menu (Export PDF A3, Export Excel, Smart Print) for a table or list that is drawn by hand.
// The menu itself lives with the app's export code; the app registers it here once, so any screen can use it
// without having it handed down.
import React from 'react';
import {nearestPrintTable,readDomTable} from './dom-table-model.mjs';

let Menu=null;
export function registerSmartPrintMenu(component){Menu=component;}

/**
 * <TableSmartPrint title="…"/> prints the nearest table as it is on screen.
 * row: put the menu on its own right-aligned line (above a table that has no heading row to hold it).
 * table: a ref to the table when the nearest one is not the right one.
 * columns + rows: for a list that is not a table (cards, bars) — the same shape as every report export.
 */
export default function TableSmartPrint({title,table=null,columns=null,rows=null,row=false,className='secondary smart-print-table-menu',...rest}){
  if(!Menu)return null;
  const menu=columns
    ?<Menu title={title} columns={columns} rows={rows||[]} className={className} {...rest}/>
    :<Menu title={title} className={className} source={trigger=>readDomTable(table?.current||nearestPrintTable(trigger))} {...rest}/>;
  // data-print-hide keeps the button itself out of a whole-page print or PDF of the screen.
  return row?<div className="smart-print-row" data-print-hide="">{menu}</div>:menu;
}
