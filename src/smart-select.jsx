import React from 'react';
import SearchableSelect from './searchable-select.jsx';
const text=node=>typeof node==='string'||typeof node==='number'?String(node):Array.isArray(node)?node.map(text).join(''):React.isValidElement(node)?text(node.props.children):'';
export default function SmartSelect({children,searchable,...props}){
 const options=[];
 const collect=(items,group='',groupDisabled=false)=>React.Children.forEach(items,node=>{
  if(!React.isValidElement(node))return;
  if(node.type==='option')options.push({value:String(node.props.value??text(node.props.children)),label:text(node.props.children),description:group,disabled:groupDisabled||Boolean(node.props.disabled)});
  else if(node.type==='optgroup')collect(node.props.children,node.props.label,groupDisabled||Boolean(node.props.disabled));
  else if(node.type===React.Fragment)collect(node.props.children,group,groupDisabled);
 });
 collect(children);
 if(props.multiple||props.size>1||searchable===false)return <select {...props}>{children}</select>;
 const placeholder=options.find(o=>o.value==='')?.label||'Search and select';
 return <SearchableSelect className={props.className} style={props.style} inputProps={{...Object.fromEntries(Object.entries(props).filter(([key])=>key.startsWith('data-'))),id:props.id,title:props.title,form:props.form,tabIndex:props.tabIndex,'data-trip-equipment':props['data-trip-equipment'],'data-enter-empty-trip':props['data-enter-empty-trip']}} name={props.name} value={props.value} defaultValue={props.defaultValue??options.find(option=>!option.disabled)?.value??''} required={props.required} disabled={props.disabled} ariaLabel={props['aria-label']} ariaInvalid={props['aria-invalid']} options={props.required?options.filter(o=>o.value!==''):options} placeholder={placeholder+' — type to search'} onChange={value=>props.onChange?.({target:{value,name:props.name},currentTarget:{value,name:props.name}})}/>;
}
