// How long a remembered MIS sign-in lasts, and which logins are always remembered.
//
// A remembered sign-in keeps its cookies for REMEMBER_DAYS and renews them each time MIS
// opens, so it ends only after REMEMBER_DAYS without opening MIS (or on Sign out).
// Logins listed in ALWAYS_REMEMBER_LOGINS (default: the owner) are remembered on every
// sign-in, even when "Remember me" was not ticked or Pulse signed them in automatically.
// Everyone else keeps the old rule: only a ticked "Remember me" survives a browser restart,
// so shared site PCs never keep a sign-in.
export const REMEMBER_DAYS=40;
export const DEFAULT_ALWAYS_REMEMBER_LOGINS='mohitchadda';

const normalizeLogin=value=>String(value??'').trim().toLowerCase();

export function alwaysRememberedLogins(env=process.env){
 const value=env.ALWAYS_REMEMBER_LOGINS??DEFAULT_ALWAYS_REMEMBER_LOGINS;
 return new Set(String(value).split(/[,;\s]+/).map(normalizeLogin).filter(Boolean));
}

export function alwaysRemembered(login,env=process.env){
 const normalized=normalizeLogin(login);
 return Boolean(normalized)&&alwaysRememberedLogins(env).has(normalized);
}
