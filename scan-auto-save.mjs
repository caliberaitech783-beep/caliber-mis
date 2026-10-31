import {scanFleetBlockingMessage} from './scan-fleet-assignment.mjs';
import {manualScanIssues} from './src/scan-manual-fields.mjs';

const OPTIONAL_WARNINGS=[/^No Work Order selected\./];
export const blockingScanWarnings=warnings=>(warnings||[]).filter(message=>!OPTIONAL_WARNINGS.some(pattern=>pattern.test(String(message))));

export function canAutoSaveScanCard(card,kind,options=null){
 if(!card||!['review','approved'].includes(card.status)||!card.checks||card.context_mismatch?.length||card.raw_fields?.fleetBlock||card.raw_fields?.fleetRejection)return false;
 if(card.raw_fields?.fleetReview&&scanFleetBlockingMessage(card))return false;
 if(card.checks.errors?.length||blockingScanWarnings(card.checks.warnings).length)return false;
 return !Object.keys(manualScanIssues(card.draft,kind,card.raw_fields,options)).length;
}

