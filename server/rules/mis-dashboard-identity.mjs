// This marker is attached only after the server validates the linked Pulse
// grant. Local browser/session data cannot supply it to dashboard authorization.
export function sharedMisDashboardIdentity(session, localUser) {
  if (session?.sharedPulseIdentity !== true) return null;
  return {
    session,
    // MIS starts with its own empty employee master. Do not require copied
    // Pulse employee/password records to recognize an authenticated identity.
    // Site-scoped users without an MIS assignment retain an empty site scope.
    user: localUser || {login:session.login, employee:session.name},
  };
}
