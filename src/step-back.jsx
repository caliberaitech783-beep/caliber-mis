// The violet Back button of a screen that opens step by step. It goes back one
// step, and while it is on screen the round back arrow in the top bar takes the
// same step (see step-back-registry.mjs).
import React from 'react';
import {ArrowLeft} from 'lucide-react';
import {useStepBackTarget} from './step-back-registry.mjs';
import './step-back.css';

export {useStepBack,useStepBackTarget} from './step-back-registry.mjs';

export function StepBackButton({onBack,label='Back',className='',disabled=false}){
  const step=useStepBackTarget(onBack);
  return <button type="button" className={('step-back-button '+className).trim()} disabled={disabled} onClick={()=>step.current?.()} title="Go back one step"><ArrowLeft aria-hidden="true"/><span>{label}</span></button>;
}
