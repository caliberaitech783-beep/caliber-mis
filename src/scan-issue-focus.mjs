const fields={
 'wrong-door':new Set(['doorText','assetId']),
 'wrong-caliber':new Set(['employeeId']),
 'wrong-hmr':new Set(['openingHmr','closingHmr']),
 'wrong-kmr':new Set(['openingKmr','closingKmr','replacementKmr']),
 'mws-ted':new Set(['trips','scanMachineSummary','timeMode']),
};
export const isScanIssueFocus=group=>Object.hasOwn(fields,group);
export function scanIssueFieldVisible(group,key){
 if(!isScanIssueFocus(group))return true;
 return fields[group].has(key)||(group==='mws-ted'&&/^(?:trips|scanMachineSummary)\./.test(key));
}
const messages={
 'wrong-door':/door|linked (?:equipment|vehicle)|^(?!Trip\b).*equipment not assigned|^Not assigned|vehicle.*(?:missing|unreadable|not found)/i,
 'wrong-caliber':/caliber|employee|driver|operator/i,
 'wrong-hmr':/\bHMR\b|hour reading/i,
 'wrong-kmr':/\bKMR\b|kilomet/i,
 'mws-ted':/machine.?wise|machine summary|printed summary|detail trips|trip (?:details|row|\d)|loading|unloading|equipment.*(?:row|assignment)/i,
};
export function focusedScanMessages(values=[],group){
 return isScanIssueFocus(group)?values.filter(value=>messages[group].test(String(value))):values;
}
