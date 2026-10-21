import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {transformWithOxc} from 'vite';

const source=readFileSync(new URL('../src/mis-workspace.jsx',import.meta.url),'utf8').replace(/^import .*;\r?\n/gm,'').replace('export default function','function');
const {code}=await transformWithOxc(source,'mis-workspace.jsx',{jsx:{runtime:'classic'}});
const Workspace=new Function('React',`${code};return MisWorkspace;`)(React);

test('MIS home is an empty workspace with branding and a working sign-out control',()=>{
  let signedOut=false;
  const tree=Workspace({onSignOut:()=>{signedOut=true;}});
  const html=renderToStaticMarkup(tree);
  assert.match(html,/<h1>Caliber MIS<\/h1>/);
  assert.match(html,/<main aria-label="MIS workspace"><\/main>/);
  assert.doesNotMatch(html,/Dashboard|breakdown|fleet|Reports|Masters|Tickets|<nav|<table/i);
  const header=React.Children.toArray(tree.props.children)[0];
  const button=React.Children.toArray(header.props.children).find(node=>node.type==='button');
  button.props.onClick();assert.equal(signedOut,true);
});

test('the live entry opens the full MIS app while retaining explicit shared Pulse login',()=>{
 const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
 const app=readFileSync(new URL('../src/main.jsx',import.meta.url),'utf8');
 assert.match(html,/src="\/src\/main.jsx"/);
 assert.match(app,/useMisSharedSignIn\(session,\{autoStart:false\}\)/);
 assert.match(app,/<MisSharedLogin error=\{sharedSignIn.error\}/);
 assert.match(app,/<LogBookModeChoice/);
 assert.match(app,/<BulkCardScanning/);
});
