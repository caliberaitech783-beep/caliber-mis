import React from 'react';
import SearchableSelect from './searchable-select.jsx';
const text=node=>typeof node==='string'||typeof node==='number'?String(node):Array.isArray(node)?node.map(text).join(''):React.isValidElement(node)?text(node.props.children):'';
export default function SmartSelect({children,searchable,...props}){
 const nodes=React.Children.toArray(children),options=nodes.filter(n=>React.isValidElement(n)&&n.type==='option').map(n=>({value:String(n.props.value??text(n.props.children)),label:text(n.props.children),disabled:n.props.disabled}));
 if(props.multiple||props.size>1||nodes.some(n=>React.isValidElement(n)&&n.type!=='option')||!(searchable??options.length>8))return <select {...props}>{children}</select>;
 const placeholder=options.find(o=>o.value==='')?.label||'Search and select';
 return <SearchableSelect inputProps={{'data-trip-equipment':props['data-trip-equipment'],'data-enter-empty-trip':props['data-enter-empty-trip']}} name={props.name} value={props.value} defaultValue={props.defaultValue} required={props.required} disabled={props.disabled} ariaLabel={props['aria-label']} ariaInvalid={props['aria-invalid']} options={props.required?options.filter(o=>o.value!==''):options} placeholder={placeholder+' — type to search'} onChange={value=>props.onChange?.({target:{value,name:props.name},currentTarget:{value,name:props.name}})}/>;
}
