// Screen tests that compile slices of src/main.jsx used to copy the sort helpers from there. They now live in
// src/sort-rows.mjs and src/sortable-table.jsx; this returns the same code (sortCollator, comparableValue, sortRows,
// useSortableRows) as plain source without imports or exports, ready to place beside the other slices.
// The compiled code expects isDurationColumn, compareDurationValues, useState and useMemo in scope, as before.
import { readFileSync } from 'node:fs';

const strip = (text) => text.replace(/^import .*;\r?\n/gm, '').replace(/^export \{[^}]*\} from .*;\r?\n/gm, '').replaceAll('export function', 'function').replaceAll('export const', 'const');

export function sortingSource() {
  const rows = readFileSync(new URL('../../src/sort-rows.mjs', import.meta.url), 'utf8');
  const table = readFileSync(new URL('../../src/sortable-table.jsx', import.meta.url), 'utf8');
  const hook = table.slice(table.indexOf('export function useSortableRows('), table.indexOf('export function SortableHeader('));
  return strip(rows) + '\n' + strip(hook) + '\n';
}
