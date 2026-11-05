// CSRF material is deliberately readable; the authentication cookie is HttpOnly.
// Call this only for same-origin API requests.
export function browserSessionRequestInit(init={},cookie=globalThis.document?.cookie||''){
 const headers=new Headers(init?.headers);
 const id=/^Bearer\s+browser-session\.([A-Za-z0-9_-]{16})$/i.exec(headers.get('Authorization')||'')?.[1];
 const name='__Host-mis_csrf'+(id?'_'+id:'');
 const csrf=String(cookie).split(';').map(value=>value.trim()).find(value=>value.startsWith(name+'='))?.slice(name.length+1);
 if(csrf)headers.set('X-CSRF-Token',csrf);
 return {...init,headers};
}
export const isBrowserSessionToken=value=>typeof value==='string'&&(value==='browser-session'||/^browser-session\.[A-Za-z0-9_-]{16}$/.test(value));
