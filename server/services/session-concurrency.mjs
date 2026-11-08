// Concurrent sign-in policy. A login normally holds one live session per
// application: signing in from another device replaces the earlier session.
// Named logins may keep several sessions at once (the owner works from two or
// three devices). The allowance is matched on the authenticated login only;
// employee display names never widen it.
//
// SESSION_LIMIT_EXCEPTIONS lists overrides as "login=count,login=count".
// SINGLE_SESSION_PER_LOGIN=0 switches enforcement off entirely.
export const DEFAULT_SESSION_LIMIT=1;
export const DEFAULT_SESSION_LIMIT_EXCEPTIONS='mohitchadda=3';
const MAX_SESSION_LIMIT=10;

export function normalizeLogin(login=''){
  return String(login??'').trim().toLowerCase();
}

export function parseSessionLimitExceptions(value=DEFAULT_SESSION_LIMIT_EXCEPTIONS){
  const exceptions=new Map();
  for(const part of String(value??'').split(/[,;\n]/)){
    const [rawLogin,rawCount]=part.split(/[=:]/);
    const login=normalizeLogin(rawLogin);
    const count=Math.floor(Number(rawCount));
    if(!login||!Number.isFinite(count)||count<1)continue;
    exceptions.set(login,Math.min(MAX_SESSION_LIMIT,count));
  }
  return exceptions;
}

export function singleSessionEnforced(env=process.env){
  return !['0','false','off','no'].includes(String(env.SINGLE_SESSION_PER_LOGIN??'').trim().toLowerCase());
}

// Returns how many live sessions this login may hold, or 0 when the rule is
// switched off (no limit).
export function sessionLimitForLogin(login,{env=process.env,exceptions}={}){
  if(!singleSessionEnforced(env))return 0;
  const normalized=normalizeLogin(login);
  if(!normalized)return DEFAULT_SESSION_LIMIT;
  const table=exceptions instanceof Map?exceptions:parseSessionLimitExceptions(env.SESSION_LIMIT_EXCEPTIONS??DEFAULT_SESSION_LIMIT_EXCEPTIONS);
  return table.get(normalized)??DEFAULT_SESSION_LIMIT;
}
