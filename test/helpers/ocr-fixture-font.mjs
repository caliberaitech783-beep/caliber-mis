import {GlobalFonts} from '@napi-rs/canvas';
import {fileURLToPath} from 'node:url';

// Rasterize synthetic OCR inputs identically on Windows and Linux runners.
// Arial is not installed on the hosted Linux deployment runner.
const family='MIS OCR Fixture';
if(!GlobalFonts.registerFromPath(fileURLToPath(new URL('../../assets/fonts/NotoSansDevanagari.ttf',import.meta.url)),family))throw Error('Bundled OCR fixture font could not be loaded.');
export const ocrFixtureFont=size=>`${size}px "${family}"`;
