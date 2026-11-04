export function misDatabaseConfig(env = process.env) {
  if (!env.DATABASE_URL) throw new Error('MIS requires its own DATABASE_URL.');
  const url = new URL(env.DATABASE_URL);
  // Explicit owner-approved reuse of the existing Key Vault administrator
  // connection. Its source database is never used by this application.
  if (env.MIS_DATABASE_CONNECTION_MODE === 'shared-admin') {
    if (url.hostname !== 'coalmine-fleet-pg-783.postgres.database.azure.com') {
      throw new Error('Shared MIS administration requires the approved Azure database server.');
    }
    url.pathname = '/caliber_mis';
    url.search = '';
  }
  const localScanner=env.MIS_LOCAL_SCANNER_DATABASE==='true'&&['localhost','127.0.0.1'].includes(url.hostname)&&decodeURIComponent(url.pathname.slice(1))==='caliber_erp';
  if(localScanner)return {connectionString:url.toString(),ssl:false};
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || decodeURIComponent(url.pathname.slice(1)) !== 'caliber_mis') {
    throw new Error('MIS must connect only to the caliber_mis database.');
  }
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (!local && !url.hostname.endsWith('.postgres.database.azure.com')) {
    throw new Error('Production MIS requires an Azure PostgreSQL endpoint.');
  }
  // pg URL SSL parameters can override the explicit certificate policy.
  for (const key of ['sslmode', 'sslcert', 'sslkey', 'sslrootcert']) url.searchParams.delete(key);
  return {connectionString: url.toString(), ssl: local ? false : {rejectUnauthorized: true}};
}
