// Pulse-II's PostgreSQL pool. Ten connections has been the size since the start and stays the
// default; MIS_DATABASE_POOL_MAX changes it per deployment without a code change. The scan engines
// hold their own connections (MIS_SCAN_ENGINE_DB_CONNECTIONS, 4 per engine) on the same PostgreSQL
// server, so compare the server's max_connections with every app's pool before raising this.
export const DEFAULT_DATABASE_POOL_MAX=10;
export function databasePoolSize(env=process.env){
 const n=Number(String(env.MIS_DATABASE_POOL_MAX??'').trim());
 return Number.isInteger(n)&&n>=1&&n<=100?n:DEFAULT_DATABASE_POOL_MAX;
}
