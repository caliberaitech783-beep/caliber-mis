// The violet Back button of a screen that opens step by step. It goes back one
// step, and while it is on screen the round back arrow in the top bar takes the
// same step (see step-back-registry.mjs).
import React from 'react';
import {ArrowLeft} from 'lucide-react';
import {useIsInnermostStep,useStepBackTarget} from './step-back-registry.mjs';
import './step-back.css';

export {useStepBack,useStepBackTarget} from './step-back-registry.mjs';

// onlyWhenInnermost: an outer Back (such as Back to reports) hides while the
// screen inside it shows its own Back, so only one Back is on screen.
export function StepBackButton({onBack,label='Back',className='',disabled=false,onlyWhenInnermost=false}){
  const step=useStepBackTarget(onBack);
  const innermost=useIsInnermostStep(step);
  if(onlyWhenInnermost&&onBack&&!innermost)return null;
  return <button type="button" className={('step-back-button '+className).trim()} disabled={disabled} onClick={()=>step.current?.()} title="Go back one step"><ArrowLeft aria-hidden="true"/><span>{label}</span></button>;
}
