// One step back inside a report that opens step by step (site, then date and
// shift, then drivers, and so on). A screen shows <StepBackButton onBack=…/>
// while it has a step to go back to. The same step is then also taken by the
// round back arrow in the top bar, which otherwise goes to the previous page.
import React,{useEffect,useRef,useSyncExternalStore} from 'react';
import {ArrowLeft} from 'lucide-react';
import './step-back.css';

const steps=[],listeners=new Set();
const changed=()=>listeners.forEach(listener=>listener());
const subscribe=listener=>{listeners.add(listener);return()=>listeners.delete(listener);};
const latest=()=>steps.at(-1)||null;

// The top bar reads this: null when no report has a step to go back to.
export function useStepBack(){
  const step=useSyncExternalStore(subscribe,latest,()=>null);
  return step?()=>step.current?.():null;
}

export function StepBackButton({onBack,label='Back',className=''}){
  const step=useRef(onBack);
  step.current=onBack;
  useEffect(()=>{
    steps.push(step);changed();
    return()=>{const at=steps.indexOf(step);if(at>=0)steps.splice(at,1);changed();};
  },[]);
  return <button type="button" className={('step-back-button '+className).trim()} onClick={()=>step.current?.()} title="Go back one step"><ArrowLeft aria-hidden="true"/><span>{label}</span></button>;
}
