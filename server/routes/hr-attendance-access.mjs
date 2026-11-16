import {canonicalSiteName} from '../../shared/site-location.mjs';

const pulseValidation = 'https://pulse.cmll.in/api/integrations/hr/validate';

export function hrAttendanceScope(profile) {
  const permissions = profile?.permissions;
  if (permissions?.application !== 'HR' ||
      ![permissions.hrDesktopAccess, permissions.hrMobileAccess].some(menus => Array.isArray(menus) && menus.includes('Employee Master'))) {
    return null;
  }
  const assignment = permissions.site;
  if (assignment == null || assignment === '') {
    return {sites: /site|location/i.test(String(permissions.adminLevel || '')) ? [] : null};
  }
  const values = Array.isArray(assignment) ? assignment : [assignment];
  if (!values.every(value => typeof value === 'string')) return null;
  const sites = values.flatMap(value => value.split('|')).map(value => value.trim().toLowerCase()).filter(Boolean);
  if (sites.some(value => ['*', 'all', 'all sites', 'all locations'].includes(value))) return {sites: null};
  return {sites: [...new Set(sites.map(canonicalSiteName).filter(Boolean))].sort()};
}

export const requireHrAttendance = (fetcher = fetch) => async (req, res, next) => {
  res.set('Cache-Control', 'private, no-store');
  req.audit = false;
  const grant = req.headers.authorization?.match(/^Bearer ([A-Za-z0-9_-]{43})$/)?.[1];
  if (!grant) return res.status(401).json({error: 'A Pulse HR grant is required.'});
  let profile;
  try {
    const response = await fetcher(pulseValidation, {
      method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({grant}),
      redirect: 'error', signal: AbortSignal.timeout(10_000)
    });
    if (response.status === 401 || response.status === 403) return res.status(401).json({error: 'Your Pulse HR session has expired.'});
    if (!response.ok) throw new Error('Pulse HR validation unavailable');
    ({profile} = await response.json());
  } catch {
    return res.status(503).json({error: 'Pulse HR validation is temporarily unavailable.'});
  }
  const scope = hrAttendanceScope(profile);
  if (!scope) return res.status(403).json({error: 'Employee Master access is required.'});
  req.logBookScope = scope;
  return next();
};
