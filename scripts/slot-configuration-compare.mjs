// Pure helpers for scripts/probe-slot-configuration.mjs. They decide what may be printed. The build log is public,
// so a setting is described by its name and kind only, never by its value, and a log line is masked before it is shown.

const KEY_VAULT = /^@Microsoft\.KeyVault\(/i;

// What a setting's value is, without the value itself.
export function settingKind(value) {
  const text = typeof value === 'string' ? value : value == null ? '' : JSON.stringify(value);
  return KEY_VAULT.test(text) ? 'key vault reference' : text === '' ? 'empty' : 'plain';
}

// A setting name is printed, so keep it to the characters a name is made of.
export const safeName = name => String(name ?? '').replace(/[^\w.:-]/g, '?').slice(0, 80);

const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

// Compares two lists of {name, value, slotSetting}. The result holds names, kinds and flags only.
export function compareSettings(production, staging) {
  const index = list => new Map((Array.isArray(list) ? list : []).map(item => [String(item.name), item]));
  const live = index(production), stage = index(staging);
  const onlyProduction = [], onlyStaging = [], different = [];
  for (const name of [...new Set([...live.keys(), ...stage.keys()])].sort()) {
    const a = live.get(name), b = stage.get(name);
    if (!b) onlyProduction.push({name: safeName(name), kind: settingKind(a.value), slotSetting: Boolean(a.slotSetting)});
    else if (!a) onlyStaging.push({name: safeName(name), kind: settingKind(b.value), slotSetting: Boolean(b.slotSetting)});
    else if (!same(a.value, b.value)) different.push({name: safeName(name), production: settingKind(a.value), staging: settingKind(b.value)});
  }
  const references = list => (Array.isArray(list) ? list : []).filter(item => settingKind(item.value) === 'key vault reference').length;
  return {
    production: live.size, staging: stage.size, onlyProduction, onlyStaging, different,
    keyVaultReferences: {production: references(production), staging: references(staging)},
  };
}

// One log line made safe to print: credentials, keys, long values, addresses and hosts are replaced, then it is cut.
export function maskLine(value, length = 260) {
  return String(value ?? '')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/:\/\/[^/\s:@]+:[^@\s]+@/g, '://<hidden>@')
    .replace(/\b(password|passwd|pwd|secret|token|api[-_]?key|access[-_]?key|account[-_]?key|authorization|bearer|sig|signature)\b(\s*[=:]\s*|\s+)("[^"]*"|'[^']*'|\S+)/gi, '$1$2<hidden>')
    .replace(/[A-Za-z0-9+/=_-]{32,}/g, '<long value>')
    .replace(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g, '<email>')
    .replace(/\b(?:[a-z0-9-]+\.)+(?:azure\.com|azure\.net|windows\.net)\b/gi, '<azure host>')
    .replace(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, '<ip>')
    .slice(0, length);
}

// The last lines of a log, masked.
export const tailLines = (text, count = 45, length = 260) =>
  String(text ?? '').split(/\r?\n/).filter(line => line.trim()).slice(-count).map(line => maskLine(line, length));
