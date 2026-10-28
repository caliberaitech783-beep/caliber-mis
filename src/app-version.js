// Injected into every production bundle by build-site.mjs, without rewriting files.
export const APP_VERSION = typeof __CALIBER_APP_VERSION__ === 'string' ? __CALIBER_APP_VERSION__ : 'development';
