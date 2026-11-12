import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {TEMPLE_BELL_PARTIALS,TEMPLE_BELL_STRIKE_HZ,templeBellVoices,shouldChime,playTempleBell} from '../src/notification-chime.mjs';

const read=(path)=>readFileSync(new URL(path,import.meta.url),'utf8').replace(/\r\n/g,'\n');
const main=read('../src/main.jsx');
const icons=read('../src/motion-icons.jsx');
const motion=read('../src/motion-icons.css');
const profile=read('../src/user-profile.css');
const theme=read('../src/theme.css');

test('the pulse icon keeps its path and a stationary endpoint dot',()=>{
  assert.match(icons,/export const PULSE_PATH = "M2 12h4\.5l2\.5-9 6 18 2\.5-9H22";/,'path starts at the left edge');
  assert.match(icons,/<path className="pulse-icon-trace" d=\{PULSE_PATH\} \/>\s*<circle className="pulse-icon-dot" cx="22" cy="12" r="1\.9" fill="currentColor" stroke="none" \/>/);
  assert.doesNotMatch(icons,/<animate(?:Motion|Transform)?\b/,'the SVG contains no independent motion engine');
  assert.match(motion,/\.pulse-icon-trace \{ stroke-dasharray: 22 60; animation: pulse-icon-trace 1\.6s linear infinite; \}/);
  assert.match(motion,/@keyframes pulse-icon-trace \{ to \{ stroke-dashoffset: -82; \} \}/,'negative offset moves the dash forward along a left-to-right path');
  assert.match(motion,/\.pulse-icon-dot \{ display: none; \}/,'no moving dot under reduced motion');
});

test('temple bell: bronze partials with long decays, rung only when unread grows',()=>{
  assert.equal(TEMPLE_BELL_PARTIALS[0].ratio,1);
  assert.ok(TEMPLE_BELL_PARTIALS.every((p,i,all)=>i===0||p.ratio>all[i-1].ratio&&p.gain<all[i-1].gain&&p.decay<all[i-1].decay),'higher partials are quieter and shorter');
  assert.ok(TEMPLE_BELL_PARTIALS[0].decay>=3,'the fundamental rings for seconds like a temple bell');
  const voices=templeBellVoices();
  assert.equal(voices.length,TEMPLE_BELL_PARTIALS.length+1,'plus a slow beating partner for the fundamental');
  assert.equal(voices[0].frequency,TEMPLE_BELL_STRIKE_HZ);
  assert.equal(voices.at(-1).frequency,TEMPLE_BELL_STRIKE_HZ+1.5);
  assert.equal(shouldChime(null,3),false,'no chime on the first reading');
  assert.equal(shouldChime(2,3),true);
  assert.equal(shouldChime(3,3),false);
  assert.equal(shouldChime(5,2),false,'reading notifications never rings');
  assert.equal(playTempleBell(),false,'no audio in node, never throws');
});

test('the bell, sign out, search, avatar and theme switch are wired and styled everywhere they appear',()=>{
  assert.match(main,/import \{ PulseIcon, SearchScanIcon, BellRingIcon, DoorExitIcon \} from "\.\/motion-icons\.jsx";/);
  assert.match(main,/import \{ playNotificationSound, loadNotificationSound, saveNotificationSound, NOTIFICATION_SOUNDS \} from "\.\/notification-chime\.mjs";/);
  assert.match(main,/soundRef\.current = \{ play: \(\) => playNotificationSound\(bellSoundRef\.current\) \};/,'the incoming toast plays the chosen bell sound once per notification');
  assert.doesNotMatch(main,/createNotificationSound\(\)/,'the old two-note beep is gone');
  assert.match(main,/<button ref=\{triggerRef\} type="button" className=\{unread > 0 \? "ringing" : ""\} onClick=\{toggle\}[^>]*><BellRingIcon ringing=\{unread > 0\} \/>/);
  assert.equal((main.match(/aria-label="Sign out" className="sign-out-button">/g)||[]).length,2,'admin and operational headers');
  assert.equal((main.match(/<DoorExitIcon \/><span className="sign-out-label">Sign out<\/span>/g)||[]).length,2);
  assert.match(main,/aria-label="Focus page smart search" title="Smart search" className="smart-search-button"[\s\S]*?<SearchScanIcon \/>/);
  assert.match(motion,/\.bell-ring-icon\.ringing \.bell-clapper \{ animation: bell-clap 2\.6s ease-in-out infinite; \}/);
  assert.match(motion,/\.notification-center > button\.ringing i \{[^}]*animation: bell-badge 1\.1s ease-in-out infinite; \}/);
  assert.match(motion,/\.sign-out-button:hover \.door-panel, \.sign-out-button:focus-visible \.door-panel \{ transform: rotateY\(-70deg\); \}/);
  assert.match(motion,/\.search-scan-icon \.scan-sweep \{[^}]*animation: scan-radar 2\.4s linear infinite; \}/);
  assert.match(profile,/\.header-login-icon::before \{[^}]*conic-gradient\([^)]*\)[^}]*animation: avatar-ring 3\.5s linear infinite;/);
  assert.match(profile,/\.header-login-icon::after \{[^}]*background: #22c55e;/,'online dot');
  assert.match(theme,/\.theme-toggle-thumb::before \{[^}]*repeating-conic-gradient[^}]*animation: theme-rays 6s linear infinite;/,'sun rays');
  assert.match(theme,/\.theme-toggle\[aria-pressed="true"\] \.theme-toggle-thumb \{ left: 40px;[^}]*animation: theme-moon 3s ease-in-out infinite; \}/,'moon at night');
  assert.match(theme,/\.theme-toggle-track::before \{[^}]*animation: theme-cloud 5s linear infinite;/,'clouds by day');
  for(const css of [motion,profile,theme])assert.match(css,/@media \(prefers-reduced-motion: reduce\)/);
});

test('sign out sits beside the page name and gives way before the page name or the clock',()=>{
  const erp=read('../src/erp-layout.css');
  assert.match(main,/<b>\{navigationLabel\(active\)\}<\/b>\s*<span className="top-sign-out-slot"><button type="button" className="top-sign-out" onClick=\{logout\} aria-label="Sign out" title="Sign out"><DoorExitIcon \/><span>Sign out<\/span><\/button><\/span>\s*<\/div>\s*<HeaderClock \/>/,'in the breadcrumb, straight after the page name, in reach while the side menu is hidden');
  assert.match(motion,/\.crumb \.top-sign-out-slot \{ container: top-sign-out \/ inline-size; display: flex; flex: 0 999999 111px; min-width: 0; margin-left: -7px; overflow: hidden; \}/,'the slot takes the whole squeeze before the page name loses a pixel, and leaves no footprint when empty');
  assert.match(read('../src/style.css'),/\.crumb\{display:flex;align-items:center;gap:7px;/,'the -7px margin answers this gap');
  assert.match(motion,/\.crumb \.top-sign-out \{[^}]*flex: 0 0 auto;[^}]*width: 88px;[^}]*margin: 0 8px 0 15px;[^}]*white-space: nowrap;/,'15 + 88 + 8 = the 111px slot');
  assert.match(motion,/@container top-sign-out \(max-width: 110\.5px\) \{\s*\.crumb \.top-sign-out \{ width: 36px; padding: 0; \}\s*\.crumb \.top-sign-out > span \{ display: none; \}\s*\}/,'short of room: the door alone');
  assert.match(motion,/@container top-sign-out \(max-width: 58\.5px\) \{\s*\.crumb \.top-sign-out \{ display: none; \}\s*\}/,'no room for the door (15 + 36 + 8): nothing, never a clipped button');
  assert.match(motion,/:root\[data-theme="dark"\] \.top \.crumb \.top-sign-out \{[^}]*color: #ffb4bd;/,'night theme outranks the grey top bar buttons');
  assert.match(erp,/\.app\.erp-shell\{--erp-side-width:244px\}\s*\.app\.erp-shell\.sidebar-hidden\{--erp-side-width:0px\}/);
  assert.match(erp,/\.app\.erp-shell>aside\.erp-sidebar\{[^}]*width:244px!important/,'the variable is the menu\'s real width');
  assert.match(erp,/@media\(min-width:1101px\)\{\.app\.erp-shell \.top>\.crumb\{max-width:calc\(\(100vw - var\(--erp-side-width\)\)\/2 - 6\.25\*clamp\(16px,1\.4vw,23px\) - 144px\)\}\}/,'the breadcrumb stops where the centred clock begins');
  assert.match(erp,/\.app\.erp-shell \.top>\.header-clock\{position:absolute;left:50%;transform:translateX\(-50%\);[^}]*--header-clock-size:clamp\(16px,1\.4vw,23px\);/,'same clock size as the limit above, and the clock leaves its own row at 1100px');
  assert.match(erp,/\.app\.erp-shell\.sidebar-hidden \.top \.top-sign-out-slot\{min-width:59px\}/,'menu hidden: the door always stays');
  assert.match(erp,/@media\(max-width:760px\)\{\.app\.erp-shell \.top \.top-sign-out-slot\{display:none\}\}/,'phones use the Sign out in the menu drawer');
  assert.match(read('../src/erp-sidebar.jsx'),/<button onClick=\{logout\}><LogOut size=\{15\}\/>Sign out<\/button><\/footer>/,'that drawer still has it');
});
