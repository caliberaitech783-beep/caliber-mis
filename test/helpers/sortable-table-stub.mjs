// Screen tests compile a component without its imports and hand it the names it uses. This stands in for
// <SortableHeader/> there (a heading with a sort button carrying the same aria-sort) and passes the real row sorting.
import React from 'react';
export {sortRows,sortRowsBlanksLast} from '../../src/sort-rows.mjs';

export const SortableHeader=({label,sortKey,sort,onSort,filterIcon,...thProps})=>{
 const active=sort.key===sortKey;
 return React.createElement('th',{...thProps,'aria-sort':active?(sort.direction==='asc'?'ascending':'descending'):'none'},
  React.createElement('button',{type:'button',className:'sort-header'+(active?' active':''),'data-sort-key':sortKey,onClick:()=>onSort(sortKey)},label));
};
