import { compareDurationValues, isDurationColumn } from "./duration-sort.mjs";

// Row ordering shared by every sortable table (report tables and hand-drawn ones).
export const sortCollator = new Intl.Collator("en", { numeric: true, sensitivity: "base" });

export function comparableValue(value) {
  if (typeof value === "boolean") return value ? 1 : 0;
  if (typeof value === "number") return value;
  const text = String(value ?? "").trim();
  const indianDate = text.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})(?:\s+(.*))?$/);
  if (indianDate) {
    const [, day, month, year, time = "00:00:00"] = indianDate;
    const timestamp = Date.parse(`${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}T${time}`);
    if (!Number.isNaN(timestamp)) return timestamp;
  }
  return text;
}

export function sortRows(rows, sort, valueForKey = (row, key) => row[key], durationSorting = true) {
  if (!sort?.key) return rows;
  const durationColumn = typeof durationSorting === "function" ? durationSorting(sort.key) : durationSorting && isDurationColumn("", sort.key);
  return rows.map((row, index) => ({ row, index })).sort((left, right) => {
    const a = comparableValue(valueForKey(left.row, sort.key));
    const b = comparableValue(valueForKey(right.row, sort.key));
    if (durationColumn) return compareDurationValues(a, b, sort.direction) || left.index - right.index;
    let result;
    if (typeof a === "number" && typeof b === "number") result = a - b;
    else result = sortCollator.compare(String(a), String(b));
    if (!result) result = left.index - right.index;
    return sort.direction === "asc" ? result : -result;
  }).map(({ row }) => row);
}

const emptySortValue = (value) => value === null || value === undefined || (typeof value === "string" && (!value.trim() || value.trim() === "—"));

// Rows with no value (blank or "—") stay at the bottom in both directions,
// so a column like "Job card" does not open with a page of dashes.
export function sortRowsBlanksLast(rows, sort, valueForKey) {
  if (!sort?.key) return rows;
  const filled = [], empty = [];
  for (const row of rows) (emptySortValue(valueForKey(row, sort.key)) ? empty : filled).push(row);
  return [...sortRows(filled, sort, valueForKey, false), ...empty];
}
