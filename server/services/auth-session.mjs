export function createSessionStore(pool) {
  return {
    async create({token, role, name, login = "", userType = "", assignedRole = "", permissions = {}}) {
      await pool.query(
        `INSERT INTO auth_sessions (token, role, employee_name, login_name, user_type, assigned_role, permissions)
         VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)
         ON CONFLICT (token) DO UPDATE
         SET role = EXCLUDED.role, employee_name = EXCLUDED.employee_name, login_name = EXCLUDED.login_name,
             user_type = EXCLUDED.user_type, assigned_role = EXCLUDED.assigned_role, permissions = EXCLUDED.permissions,
             last_seen_at = NOW()`,
        [token, role, name, login, userType, assignedRole, JSON.stringify(permissions)]
      );
    },

    async get(token) {
      if (!token) return null;
      const {rows} = await pool.query(
        `SELECT role, employee_name AS name, login_name AS login, user_type AS "userType",
                assigned_role AS "assignedRole", permissions, created_at,
                session_public_id AS "sessionId"
         FROM auth_sessions
         WHERE token = $1`,
        [token]
      );
      // Tender tracking credentials never authorize a BDMS application request.
      if(rows[0]?.permissions?.application==='Tender')return null;
      return rows[0] || null;
    },

    async touch(token, {ipAddress = "", deviceId = "", userAgent = ""} = {}) {
      if (!token) return;
      await pool.query(
        `UPDATE auth_sessions
         SET last_seen_at = NOW(), ip_address = $2, device_id = $3, user_agent = $4
         WHERE token = $1
           AND (last_seen_at <= NOW() - INTERVAL '30 seconds'
             OR ip_address IS DISTINCT FROM $2
             OR device_id IS DISTINCT FROM $3
             OR user_agent IS DISTINCT FROM $4)`,
        [token, ipAddress, deviceId, userAgent]
      );
    },

    async pruneExpired() {
      return 0;
    },
  };
}
