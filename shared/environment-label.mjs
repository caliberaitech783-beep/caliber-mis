// Platform banner label. Live leaves MIS_ENVIRONMENT_LABEL unset, so the label is empty
// and no banner is shown; the test platform sets it to TEST. The server reports the value
// read-only on /api/health and /api/app-version, and the page shows the banner from that
// answer alone: it never guesses from its own address. Nothing else reads the setting.
const MAX_LABEL_LENGTH=24;
// A label naming the live site would contradict the banner text, so it counts as unset.
const LIVE_LABELS=new Set(['LIVE','PROD','PRODUCTION']);

export function normalizeEnvironmentLabel(value){
  const label=String(value??'').replace(/[^A-Za-z0-9 _-]+/g,'').replace(/\s+/g,' ').trim().toUpperCase().slice(0,MAX_LABEL_LENGTH).trim();
  return LIVE_LABELS.has(label)?'':label;
}

export function environmentLabelFromEnv(env){
  return normalizeEnvironmentLabel(env?.MIS_ENVIRONMENT_LABEL);
}

export function environmentBannerParts(label){
  const normalized=normalizeEnvironmentLabel(label);
  if(!normalized)return null;
  return {heading:`${normalized} PLATFORM:`,detail:'not the live site. Cards saved here do not reach the live log book.'};
}

export function environmentBannerText(label){
  const parts=environmentBannerParts(label);
  return parts?`${parts.heading} ${parts.detail}`:'';
}

export function environmentTitlePrefix(label){
  const normalized=normalizeEnvironmentLabel(label);
  return normalized?`[${normalized}] `:'';
}
