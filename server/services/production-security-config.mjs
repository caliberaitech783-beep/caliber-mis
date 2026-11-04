export function assertProductionSecurityConfig(env=process.env){
 if(env.WEBSITE_SITE_NAME!=='caliber-mis-783')return;
 if(env.MIS_DATABASE_CONNECTION_MODE!=='isolated'||env.MIS_RLS_ENABLED!=='true'||env.MIS_REQUIRE_MFA!=='true')throw Error('Production MIS requires its isolated database credential, RLS and MFA. Configure the security settings before starting this release.');
 if(env.MIS_SSO_MODE&&env.MIS_SSO_MODE!=='client')throw Error('Production MIS must use the Pulse identity client.');
}
