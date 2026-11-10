// Report table columns: a long heading is written on two lines so the column
// fits its figures, and the user can drag a column edge to set a width of
// their own. The chosen widths are kept on this device for each account and
// each report table; a double-click on the edge returns the column to its fit.
import {useState} from 'react';
import {tableLayoutAccount,tableLayoutStorageKey} from './table-layouts.mjs';

export const MIN_COLUMN_WIDTH=56;
export const MAX_COLUMN_WIDTH=900;
const TWO_LINE_FROM=12;

// "DRIVERS WITH A DELAY" -> ["DRIVERS WITH","A DELAY"]: the break is the space
// that leaves the two lines closest in length. Short or one-word headings and
// headings that are not plain text stay as they are.
export function twoLineHeading(label){
  if(typeof label!=='string')return null;
  const text=label.trim().replace(/\s+/g,' ');
  if(text.length<TWO_LINE_FROM||!text.includes(' '))return null;
  let best=-1,bestLongest=Infinity;
  for(let i=text.indexOf(' ');i>=0;i=text.indexOf(' ',i+1)){
    const longest=Math.max(i,text.length-i-1);
    if(longest<=bestLongest){best=i;bestLongest=longest;}
  }
  return [text.slice(0,best),text.slice(best+1)];
}

export function clampColumnWidth(value){
  const width=Math.round(Number(value));
  if(!Number.isFinite(width))return null;
  return Math.min(MAX_COLUMN_WIDTH,Math.max(MIN_COLUMN_WIDTH,width));
}

// Only widths for columns the table still has are kept.
export function cleanColumnWidths(saved,columnKeys){
  const widths={};
  if(!saved||typeof saved!=='object'||Array.isArray(saved))return widths;
  for(const key of columnKeys){
    const width=Object.hasOwn(saved,key)?clampColumnWidth(saved[key]):null;
    if(width)widths[key]=width;
  }
  return widths;
}

export function readColumnWidths(storage,storageKey,columnKeys){
  try {return cleanColumnWidths(JSON.parse(storage.getItem(storageKey)||'{}'),columnKeys);} catch {return {};}
}

export function storeColumnWidths(storage,storageKey,widths){
  try {
    if(Object.keys(widths).length)storage.setItem(storageKey,JSON.stringify(widths));
    else storage.removeItem(storageKey);
  } catch {}
}

export const columnWidthStyle=width=>width?{width,minWidth:width,maxWidth:width}:undefined;

export function useColumnWidths(table,columns){
  const columnKeys=columns.map(column=>column.key);
  let storageKey='';
  try {storageKey=tableLayoutStorageKey(tableLayoutAccount(),table,columns)+':widths';} catch {}
  const read=()=>storageKey&&typeof localStorage!=='undefined'?readColumnWidths(localStorage,storageKey,columnKeys):{};
  const [state,setState]=useState(()=>({storageKey,widths:read()}));
  const widths=state.storageKey===storageKey?state.widths:read();
  const save=next=>{
    if(storageKey&&typeof localStorage!=='undefined')storeColumnWidths(localStorage,storageKey,next);
    setState({storageKey,widths:next});
  };
  const setWidth=(key,value)=>{
    const next={...widths},width=value==null?null:clampColumnWidth(value);
    if(width)next[key]=width; else delete next[key];
    save(next);
  };
  return [widths,setWidth,()=>save({})];
}
