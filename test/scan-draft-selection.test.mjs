import test from 'node:test';import assert from 'node:assert/strict';
import {scanDraftSelection} from '../scan-draft-selection.mjs';
test('returning from an empty colour group restores the same card even if its revision has not changed',()=>{
 const card={id:'card-a',revision:7},first=scanDraftSelection(card,null);assert.equal(first.restore,true);
 const empty=scanDraftSelection(null,first.key);assert.equal(empty.key,null);
 const returned=scanDraftSelection(card,empty.key);assert.equal(returned.restore,true);assert.equal(returned.key,first.key);
 assert.equal(scanDraftSelection(card,returned.key).restore,false);
 assert.equal(scanDraftSelection({...card,revision:8},returned.key,true).restore,false,'do not replace unsaved edits with polling data');
 assert.equal(scanDraftSelection({...card,revision:8},returned.key,false).restore,true);
 assert.equal(scanDraftSelection({id:'card-b',revision:7},returned.key).restore,true);
});
