// CSRF material is deliberately readable; the authentication cookie is HttpOnly.
// Call this only for same-origin API requests.
export function browserSessionRequestInit(init={},cookie=globalThis.document?.cookie||''){
 const headers=new Headers(init?.headers);
 const csrf=String(cookie).split(';').map(value=>value.trim()).find(value=>value.startsWith('__Host-mis_csrf='))?.slice('__Host-mis_csrf='.length);
 if(csrf)headers.set('X-CSRF-Token',csrf);
 return {...init,headers};
}
