// The steps the top-bar back arrow can take inside a screen. A screen registers
// its "back one step" while it has one (a report drill-down, a batch picked for
// entry, a review page, an opened record); the arrow takes the step registered
// last, the innermost one, and goes to the previous page when there is none.
// Plain module (no JSX) so screens that are loaded in Node tests can import it.
import {useEffect,useRef,useSyncExternalStore} from 'react';

const steps=[],listeners=new Set();
const changed=()=>listeners.forEach(listener=>listener());
const subscribe=listener=>{listeners.add(listener);return()=>listeners.delete(listener);};
const latest=()=>steps.at(-1)||null;

// The top bar reads this: null when no screen has a step to go back to.
export function useStepBack(){
  const step=useSyncExternalStore(subscribe,latest,()=>null);
  return step?()=>step.current?.():null;
}

// Registers onBack with the top-bar arrow while onBack is given; pass null when
// the screen has no step to go back to.
export function useStepBackTarget(onBack){
  const step=useRef(onBack);
  step.current=onBack;
  const active=Boolean(onBack);
  useEffect(()=>{
    if(!active)return undefined;
    steps.push(step);changed();
    return()=>{const at=steps.indexOf(step);if(at>=0)steps.splice(at,1);changed();};
  },[active]);
  return step;
}
