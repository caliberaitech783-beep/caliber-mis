import React, { useMemo, useState } from "react";
import { ArrowDown, ArrowUp, ArrowUpDown, ListFilter } from "lucide-react";
import { sortRows } from "./sort-rows.mjs";

export { sortCollator, comparableValue, sortRows, sortRowsBlanksLast } from "./sort-rows.mjs";

// Shared click-a-heading sorting, so sorting looks and works the same on
// report tables and on hand-drawn tables (batch screens, dialogs).
export function useSortableRows(rows, defaultSort = "", valueForKey = (row, key) => row[key], durationSorting = true) {
  const [sort, setSort] = useState(() => typeof defaultSort === "string" ? { key: defaultSort, direction: "asc" } : defaultSort);
  const sortedRows = useMemo(() => sortRows(rows, sort, valueForKey, durationSorting), [rows, sort, valueForKey, durationSorting]);
  const changeSort = (key, direction) => setSort((current) => ({
    key,
    direction: direction || (current.key === key && current.direction === "asc" ? "desc" : "asc"),
  }));
  return [sortedRows, sort, changeSort];
}

export function SortableHeader({ label, sortKey, sort, onSort, filterIcon = true, ...thProps }) {
  const active = sort.key === sortKey,
    Icon = active ? (sort.direction === "asc" ? ArrowUp : ArrowDown) : ArrowUpDown;
  return (
    <th {...thProps} aria-sort={active ? (sort.direction === "asc" ? "ascending" : "descending") : "none"}>
      <button className={`sort-header ${active ? "active" : ""}`} onClick={() => onSort(sortKey)} type="button" title={`Sort by ${label}`}>
        <span>{label}</span><Icon aria-hidden="true" />{filterIcon && <ListFilter className="header-filter-icon" aria-hidden="true" />}
      </button>
    </th>
  );
}
