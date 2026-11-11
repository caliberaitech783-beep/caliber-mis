import {whatsappPurposeEnabled} from '../../shared/whatsapp-report-settings.mjs';

// Every automatic message the application sends, one line per rule. The Automation Centre page
// lists these in this order; the code (A01, A02 ...) is fixed once given, so new rules are added
// at the end. Each line says what starts the message, which channels it uses, who receives it,
// where it is switched on or off, and where its sent messages are counted from.
//
// on(context) answers 'on', 'off' or null (channel not used) for each channel.
// count: outbox = MIS Telegram outbox event prefixes; history = Pulse message history report types.

const state=value=>value?'on':'off';
const misBot=context=>context.misTelegram.enabled;
const pulseBot=(context,purpose)=>context.pulseTelegram.configured&&!context.pulseTelegram.paused&&context.pulseTelegramPurpose(purpose);
const whatsapp=(context,purpose)=>context.whatsappConfigured&&whatsappPurposeEnabled(context.whatsappSettings,purpose);
const REPORT_SETTINGS='Pulse > WhatsApp Integration > Report settings';
const TELEGRAM_PAGE='Telegram Integration page';
const requestAlert=(code,key,name,rule,purpose,event)=>({code,key,name,category:'Breakdown',rule,trigger:'At once, when it happens',
 people:'Site supervisors of the chosen roles, site Telegram group',format:'Short text: site, door number, what changed',controlledIn:REPORT_SETTINGS,
 telegram:context=>state(pulseBot(context,purpose)),whatsapp:context=>state(whatsapp(context,purpose)),popup:()=>'on',
 count:{history:['System notification'],shared:'Breakdown alerts A12 to A17 are counted together'},event});

export const AUTOMATIONS=[
 {code:'A01',key:'equipment-mismatch',name:'Equipment list mismatch',category:'Masters',editable:'equipment-mismatch',
  rule:'Equipment Deployment (Pulse-II) differs from the Pulse equipment list: a machine missing on one side, at a different site, or in a different group',
  trigger:context=>'Every '+context.mismatch.intervalHours+' hours, repeated until the lists match',
  people:context=>context.mismatch.logins.length?context.mismatch.logins.join(', '):'MIS managers (no login list set)',
  format:'Totals on both sides, count of each kind of difference, first 15 machines, link to the report',controlledIn:'This page',
  telegram:context=>state(context.mismatch.enabled&&context.mismatch.telegram&&misBot(context)),
  whatsapp:context=>state(context.mismatch.enabled&&context.mismatch.whatsapp&&context.whatsappConfigured),
  popup:context=>state(context.mismatch.enabled&&context.mismatch.popup),count:{outbox:['equipment-mismatch']}},
 {code:'A02',key:'vlb-batch-not-created',name:'VLB batch not created',category:'Log books',
  rule:context=>'No batch exists '+context.vlbAlerts.createdByHours+' hours after the shift ended',
  trigger:context=>'Checked every minute, reminder every '+context.vlbAlerts.reminderHours+' hours',
  people:'Site Project Managers, production head',format:'Site, date, shift, hours late',controlledIn:TELEGRAM_PAGE,
  telegram:context=>state(context.vlbAlertsRunning&&context.vlbAlerts.enabled&&misBot(context)),whatsapp:()=>null,popup:()=>null,count:{outbox:['vlb-alert/not_created']}},
 {code:'A03',key:'vlb-batch-not-closed',name:'VLB batch still open',category:'Log books',
  rule:context=>'Batch not closed '+context.vlbAlerts.closedByHours+' hours after the shift ended',
  trigger:context=>'Checked every minute, reminder every '+context.vlbAlerts.reminderHours+' hours',
  people:'Site Project Managers, production head',format:'Site, date, shift, batch name, stage, cards so far',controlledIn:TELEGRAM_PAGE,
  telegram:context=>state(context.vlbAlertsRunning&&context.vlbAlerts.enabled&&misBot(context)),whatsapp:()=>null,popup:()=>null,count:{outbox:['vlb-alert/not_closed']}},
 {code:'A04',key:'pulse-pending',name:'Pending in Pulse reminder',category:'Masters',
  rule:'Express transfers or new machines approved in Pulse-II are still not entered in Pulse',trigger:'Once a day at 09:00',
  people:context=>context.vlbAlerts.pulseAdminLogins.length?context.vlbAlerts.pulseAdminLogins.join(', '):'No Pulse administrator login set',
  format:'List of pending transfers and machines',controlledIn:TELEGRAM_PAGE,
  telegram:context=>state(context.vlbAlertsRunning&&context.vlbAlerts.pulseAdminLogins.length>0&&misBot(context)),whatsapp:()=>null,popup:()=>null,count:{outbox:['pulse-pending']}},
 {code:'A05',key:'alias-otp',name:'Equipment alias approval code',category:'Approvals',rule:'A written machine label needs approval before it is remembered',
  trigger:'At once, on request',people:'Alias approver, site Project Manager',format:'6-digit code with the label and machine',controlledIn:'Rule EQUIPMENT_ALIAS_OTP',
  telegram:context=>state(misBot(context)),whatsapp:context=>state(context.whatsappConfigured),popup:()=>null,count:{outbox:['alias-otp']}},
 {code:'A06',key:'alias-suspended',name:'Equipment alias suspended',category:'Masters',rule:'Pulse now has a real machine with the same number as a remembered label',
  trigger:'After each Pulse master sync',people:'Alias approver, MIS managers',format:'Label, machine, reason',controlledIn:'Always on',
  telegram:context=>state(misBot(context)),whatsapp:()=>null,popup:()=>null,count:{outbox:['alias-shadow']}},
 {code:'A07',key:'alias-weekly',name:'Equipment alias weekly summary',category:'Masters',rule:'Summary of remembered machine labels',
  trigger:'Monday 09:00',people:'Alias approver, MIS managers',format:'Counts and new labels of the week',controlledIn:'Runs with VLB batch alerts',
  telegram:context=>state(context.vlbAlertsRunning&&misBot(context)),whatsapp:()=>null,popup:()=>null,count:{outbox:['alias-weekly']}},
 {code:'A08',key:'transfer-otp',name:'Express transfer approval code',category:'Approvals',rule:'A machine is moved to another site from a batch',
  trigger:'At once, on request',people:'Source site Project Manager',format:'6-digit code with machine and both sites',controlledIn:'Always on',
  telegram:context=>state(misBot(context)),whatsapp:context=>state(context.whatsappConfigured),popup:()=>null,count:{outbox:['transfer-otp']}},
 {code:'A09',key:'equipment-otp',name:'New equipment approval code',category:'Approvals',rule:'A machine not in the master is added from a batch',
  trigger:'At once, on request',people:'Site Project Manager',format:'6-digit code with the machine details',controlledIn:'Always on',
  telegram:context=>state(misBot(context)),whatsapp:context=>state(context.whatsappConfigured),popup:()=>null,count:{outbox:['equipment-otp']}},
 {code:'A10',key:'vlb-approval-otp',name:'VLB reopen / unlock approval code',category:'Approvals',rule:'A closed batch is reopened or a locked card is unlocked',
  trigger:'At once, on request',people:'Site Project Manager',format:'6-digit code with batch name',controlledIn:'Always on',
  telegram:context=>state(misBot(context)),whatsapp:context=>state(context.whatsappConfigured),popup:()=>null,count:{outbox:['vlb-approval-otp']}},
 {code:'A11',key:'mis-ticket',name:'MIS ticket created / resolved',category:'Tickets',rule:'A support ticket is raised or resolved in Pulse-II',
  trigger:'At once',people:'MIS admin chat; the person who raised it, on resolution',format:'Ticket number, site, priority, message',controlledIn:TELEGRAM_PAGE,
  telegram:context=>state(misBot(context)),whatsapp:()=>null,popup:()=>'on',count:{outbox:['created','resolved']}},
 requestAlert('A12','request-opened','Breakdown opened','A breakdown request is raised','requestOpened'),
 requestAlert('A13','request-closed','Breakdown closed / on road','A breakdown is closed and the machine is back on road','requestClosed'),
 requestAlert('A14','request-verified','Breakdown MIS verified','MIS verifies a closed breakdown','requestVerified'),
 requestAlert('A15','request-idle','Machine marked idle','A machine is marked idle','requestIdle'),
 {...requestAlert('A16','request-reminders','Off road escalation / idle reminder','A machine stays off road or idle beyond the set hours','offRoadEscalation'),trigger:'Checked every minute'},
 {...requestAlert('A17','daily-update','Daily maintenance update','Maintenance writes the daily remark on an open breakdown','dailyUpdate')},
 {code:'A18',key:'crm-report',name:'Scheduled ticket report',category:'Reports',rule:'Open and resolved tickets, on the chosen days and times',
  trigger:context=>(context.whatsappSettings.crm?.times||[]).join(', ')||'Chosen times',people:'Admin, Manager, Super Admin (chosen roles)',format:'Summary text, PDF when long',controlledIn:REPORT_SETTINGS,
  telegram:context=>state(context.scheduledJobs&&pulseBot(context,'consolidatedTicketReport')),whatsapp:context=>state(context.scheduledJobs&&whatsapp(context,'consolidatedTicketReport')),popup:()=>null,count:{history:['Consolidated CRM report']}},
 {code:'A19',key:'hierarchy-report',name:'Scheduled fleet report bundle',category:'Reports',rule:'Fleet and breakdown reports by designation, on each schedule',
  trigger:'Per designation schedule',people:'Each designation on its schedule',format:'Report text with linked PDF',controlledIn:REPORT_SETTINGS,
  telegram:context=>state(context.scheduledJobs&&pulseBot(context,'consolidatedRequestReport')),whatsapp:context=>state(context.scheduledJobs&&whatsapp(context,'consolidatedRequestReport')),popup:()=>null,
  count:{history:['Consolidated fleet report','Consolidated request report','Director linked report bundle']}},
 {code:'A20',key:'password-otp',name:'Password reset code',category:'Approvals',rule:'A user asks to reset the password',trigger:'At once, on request',
  people:'The user only (private chat)',format:'One-time code',controlledIn:REPORT_SETTINGS,
  telegram:context=>state(context.pulseTelegram.configured),whatsapp:context=>state(whatsapp(context,'passwordResetOtp')),popup:()=>null,count:{history:['Password reset OTP']}},
 {code:'A21',key:'audit-export',name:'Audit Trail export',category:'Reports',rule:'Latest two days of the audit trail',trigger:'Every two days',
  people:'Audit recipients',format:'Excel file',controlledIn:'Audit Trail page',telegram:()=>null,whatsapp:context=>state(context.scheduledJobs&&context.whatsappConfigured),
  email:context=>state(context.scheduledJobs&&context.emailConfigured),popup:()=>null,count:{history:['Audit Trail export']}},
 {code:'A22',key:'oem-email',name:'OEM breakdown email',category:'Breakdown',rule:'Open breakdowns by manufacturer, escalation levels L1 to L4',trigger:'Daily after 17:00',
  people:'Manufacturer contacts by level',format:'Email with Excel and PDF',controlledIn:'OEM email page',telegram:()=>null,whatsapp:()=>null,
  email:context=>state(context.scheduledJobs&&context.emailConfigured),popup:()=>null,count:{oem:true}},
 {code:'A23',key:'deletion-otp',name:'Deletion approval code',category:'Approvals',rule:'A log book, batch or scanned card is to be deleted',trigger:'At once, on request',
  people:'The fixed deletion approver',format:'One-time code',controlledIn:'Deletion page',telegram:()=>null,whatsapp:context=>state(context.deletionWhatsApp),popup:()=>null,count:{}},
];

const resolve=(value,context)=>typeof value==='function'?value(context):value;
export function automationRows(context,counts={}){
 return AUTOMATIONS.map((item,index)=>{
  const channels={telegram:item.telegram(context),whatsapp:item.whatsapp(context),email:item.email?item.email(context):null,popup:item.popup(context)};
  const count=counts[item.key]||null;
  return {number:index+1,code:item.code,key:item.key,name:item.name,category:item.category,editable:item.editable||'',
   rule:resolve(item.rule,context),trigger:resolve(item.trigger,context),people:resolve(item.people,context),format:item.format,controlledIn:item.controlledIn,
   channels,active:Object.values(channels).includes('on'),
   sent:count?count.sent:null,sentTelegram:count?.telegram??null,sentWhatsApp:count?.whatsapp??null,sentEmail:count?.email??null,
   lastSentAt:count?.lastSentAt||null,countedFrom:count?.from||null,countNote:item.count.shared||(Object.keys(item.count).length?'':'Not counted: these codes leave no delivery record')};
 });
}
