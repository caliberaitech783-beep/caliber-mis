import {manualScanIssues} from './src/scan-manual-fields.mjs';

export function canAutoSaveScanCard(card,kind,options=null){
 if(!card||!['review','approved'].includes(card.status)||!card.checks)return false;
 if(card.checks.errors?.length||card.checks.warnings?.length)return false;
 return !Object.keys(manualScanIssues(card.draft,kind,card.raw_fields,options)).length;
}
