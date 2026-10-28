import {sendMetaWhatsAppTemplate} from './meta-whatsapp.mjs';
import {DELETION_PHONE} from './log-book-deletion.mjs';

export const DELETION_WHATSAPP_KEY='mis_deletion_whatsapp';
export async function sendDeletionOtp({pool,to,otp,requestId,count,test=false},{sendTemplate=sendMetaWhatsAppTemplate}={}){
 if(to!==DELETION_PHONE||!/^\d{6}$/.test(String(otp))||typeof requestId!=='string'||!requestId||!Number.isSafeInteger(count)||count<(test?0:1))throw Error('Invalid deletion OTP request.');
 const config=(await pool.query('SELECT setting_value FROM app_settings WHERE setting_key=$1',[DELETION_WHATSAPP_KEY])).rows[0]?.setting_value;
 if(!config?.enabled||config.purpose!=='logBookDeletionOtp'||config.recipient!==DELETION_PHONE)throw Error('Deletion-only WhatsApp connection is not configured.');
 // This environment is passed only to this send. General MIS WhatsApp settings stay unchanged.
 const env={WHATSAPP_PROVIDER:config.provider||'meta',FAST2SMS_WHATSAPP_API_KEY:config.providerApiKey||'',META_WHATSAPP_PHONE_NUMBER_ID:config.phoneNumberId||'',META_WHATSAPP_ACCESS_TOKEN:config.accessToken||'',META_WHATSAPP_BUSINESS_ACCOUNT_ID:config.businessAccountId||'',META_GRAPH_VERSION:config.graphVersion||'v25.0',META_WHATSAPP_DELIVERY_PAUSED:'false'};
 // The existing approved AUTHENTICATION template displays a generic security code.
 // This creates no password reset and grants no deletion approval by itself.
 return sendTemplate({to,templateKey:'passwordResetOtp',purpose:'logBookDeletionOtp',parameters:[String(otp)]},{env});
}
