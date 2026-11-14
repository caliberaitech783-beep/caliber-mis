import {sendMetaWhatsAppTemplate} from '../rules/meta-whatsapp.mjs';
import {DELETION_PHONE,deletionPhone} from '../rules/deletion-otp-routing.mjs';

export const DELETION_WHATSAPP_KEY='mis_deletion_whatsapp';
// The owner-only WhatsApp connection (recipient DELETION_PHONE). Its environment is
// passed only to one send; general MIS WhatsApp settings stay unchanged.
async function ownerWhatsAppEnv(pool){
 const config=(await pool.query('SELECT setting_value FROM app_settings WHERE setting_key=$1',[DELETION_WHATSAPP_KEY])).rows[0]?.setting_value;
 if(!config?.enabled||config.purpose!=='logBookDeletionOtp'||config.recipient!==DELETION_PHONE)throw Error('Deletion-only WhatsApp connection is not configured.');
 return {WHATSAPP_PROVIDER:config.provider||'meta',FAST2SMS_WHATSAPP_API_KEY:config.providerApiKey||'',META_WHATSAPP_PHONE_NUMBER_ID:config.phoneNumberId||'',META_WHATSAPP_ACCESS_TOKEN:config.accessToken||'',META_WHATSAPP_BUSINESS_ACCOUNT_ID:config.businessAccountId||'',META_GRAPH_VERSION:config.graphVersion||'v25.0',META_WHATSAPP_DELIVERY_PAUSED:'false'};
}
export async function sendDeletionOtp({pool,to,otp,requestId,count,sites=[],test=false},{sendTemplate=sendMetaWhatsAppTemplate}={}){
 if(to!==deletionPhone(sites)||!/^\d{6}$/.test(String(otp))||typeof requestId!=='string'||!requestId||!Number.isSafeInteger(count)||count<(test?0:1))throw Error('Invalid deletion OTP request.');
 const env=await ownerWhatsAppEnv(pool);
 // The existing approved AUTHENTICATION template displays a generic security code.
 // This creates no password reset and grants no deletion approval by itself.
 return sendTemplate({to,templateKey:'passwordResetOtp',purpose:'logBookDeletionOtp',parameters:[String(otp)]},{env});
}
// Urgent production release OTP: always to the owner's number (DELETION_PHONE), never
// to an address a caller supplies. Same approved template and delivery purpose.
export async function sendReleaseOtp({pool,otp},{sendTemplate=sendMetaWhatsAppTemplate}={}){
 if(!/^\d{6}$/.test(String(otp)))throw Error('Invalid release OTP.');
 const env=await ownerWhatsAppEnv(pool);
 return sendTemplate({to:DELETION_PHONE,templateKey:'passwordResetOtp',purpose:'logBookDeletionOtp',parameters:[String(otp)]},{env});
}
