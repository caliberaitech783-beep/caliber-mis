import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const source=name=>readFileSync(new URL('../src/'+name,import.meta.url),'utf8');

test('every editable door and machine workflow uses a searchable selector',()=>{
 const scan=source('bulk-card-scanning.jsx');
 assert.match(scan,/\['doorText','Door number','door'\]/);
 assert.match(scan,/type==='door'\?\(options\?\.assets\|\|\[\]\)\.filter/);
 assert.match(scan,/<SmartSelect\s+searchable\s+required\s+disabled=\{!draft\.location\}[\s\S]*?Machine-wise summary equipment row/);
 assert.match(scan,/<SmartSelect\s+searchable[\s\S]*?data-trip-equipment=\{i\}/);

 const manual=source('log-book-form.jsx');
 assert.match(manual,/<DoorCombobox[\s\S]*?value=\{form\.assetId\}/);
 assert.match(manual,/<SmartSelect searchable aria-label=\{`Equipment name row/);

 assert.match(source('door-combobox.jsx'),/role="combobox"[\s\S]*?placeholder=.*Type S, V or a door number/);
 assert.match(source('equipment-combobox.jsx'),/role="combobox"[\s\S]*?Search and select equipment \/ vehicle/);
 assert.match(source('vehicle-transfer-workflow.jsx'),/<SearchableSelect label="Vehicle \/ equipment"/);
 assert.match(source('operations-reports.jsx'),/field\('asset','Vehicle \/ equipment'/);
});
