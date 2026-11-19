// Compiles src/approval-tracker.jsx for server-side rendering in tests (CSS import removed).
import {readFileSync} from 'node:fs';
import React from 'react';
import {transformWithOxc} from 'vite';
const source=readFileSync(new URL('../src/approval-tracker.jsx',import.meta.url),'utf8').replace(/^import .*;\r?\n/gm,'').replaceAll('export function','function');
const {code}=await transformWithOxc(source,'approval-tracker.jsx',{jsx:{runtime:'classic'}});
export const {ApprovalTracker,ApprovalRequestCard}=new Function('React',code+';return {ApprovalTracker,ApprovalRequestCard};')(React);
