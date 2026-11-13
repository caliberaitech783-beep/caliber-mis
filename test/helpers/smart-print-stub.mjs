// Screen tests compile a component without its imports and hand it the names it uses. This stands in for
// <TableSmartPrint/> there: a button that carries the print title, so a test can check the menu is on the screen.
import React from 'react';

export const TableSmartPrint=({title,columns,rows})=>React.createElement('button',{type:'button','data-smart-print':title,'data-smart-print-columns':columns?columns.map(column=>column.label).join('|'):undefined,'data-smart-print-rows':rows?rows.length:undefined},'Smart Print');
