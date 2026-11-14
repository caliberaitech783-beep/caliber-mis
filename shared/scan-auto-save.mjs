import {scanFleetBlockingMessage} from './scan-fleet-assignment.mjs';
import {manualScanIssues} from '../src/scan-manual-fields.mjs';

// "Sheet 2/2 of this trip card: …" says where its trips go when saved; it is information, not a problem to fix.
const OPTIONAL_WARNINGS=[/^No Work Order selected\./,/^Batch values applied\./,/^Sheet \d+\/\d+ of this trip card: /];
export const blockingScanWarnings=warnings=>(warnings||[]).filter(message=>!OPTIONAL_WARNINGS.some(pattern=>pattern.test(String(message))));

export function canAutoSaveScanCard(card,kind,options=null,lmv=false){
 if(!card||!['review','approved'].includes(card.status)||!card.checks||card.context_mismatch?.length||card.raw_fields?.fleetBlock||card.raw_fields?.fleetRejection)return false;
 if(card.raw_fields?.fleetReview&&scanFleetBlockingMessage(card))return false;
 if(card.checks.errors?.length||blockingScanWarnings(card.checks.warnings).length)return false;
 return !Object.keys(manualScanIssues(card.draft,kind,card.raw_fields,options,lmv)).length;
}

