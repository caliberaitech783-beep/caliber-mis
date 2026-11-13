import React, { useSyncExternalStore } from "react";
import { DAILY_UPDATES_ORDERS, DEFAULT_DAILY_UPDATES_ORDER, dailyUpdateAuthor, dailyUpdateReason, dailyUpdateStamp, dailyUpdatesCountLabel, latestDailyUpdate, readDailyUpdatesOrder, sortDailyUpdates, storeDailyUpdatesOrder } from "./daily-updates-order.mjs";
import { formatDisplayDateTime } from "../shared/date-time-format.mjs";
import TableSmartPrint from "./table-smart-print.jsx";

// The order is one app-wide preference: switching it in any open list switches every list at once.
const listeners = new Set();
const storage = () => (typeof localStorage === "undefined" ? null : localStorage);
const subscribe = (listener) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
const currentOrder = () => readDailyUpdatesOrder(storage());
const serverOrder = () => DEFAULT_DAILY_UPDATES_ORDER;

export function setDailyUpdatesOrder(order) {
  storeDailyUpdatesOrder(storage(), order);
  listeners.forEach((listener) => listener());
}

export function useDailyUpdatesOrder() {
  return useSyncExternalStore(subscribe, currentOrder, serverOrder);
}

// The panel shows about this many updates before it scrolls (max-height in daily-updates.css).
const UPDATES_BEFORE_SCROLL = 3;

// The order chips and the numbered, scrolling list. One panel serves table cells, the daily-update
// journal, the time breakdown and Info Pulse; it renders nothing when there are no updates.
// printTitle: a pop-up that shows the journal on its own passes its title and gets the Smart Print menu.
// Table cells and panels inside a larger printable pop-up leave it out, so no menu sits in every row.
export function DailyUpdatesPanel({ remarks = [], category = "", formatDateTime = formatDisplayDateTime, missingLabel = "—", authorLabel = null, className = "", printTitle = "" }) {
  const order = useDailyUpdatesOrder();
  const updates = sortDailyUpdates(remarks, order);
  if (!updates.length) return null;
  const countLabel = dailyUpdatesCountLabel(updates.length);
  // Smart Print of the list: one line per update, the same fields in the order the card shows them.
  const printColumns = [
    { key: "ordinal", label: "Update no.", value: (item) => item.ordinal },
    { key: "createdAt", label: "Date and time", value: (item) => (dailyUpdateStamp(item) ? formatDateTime(item.createdAt) : "Date not recorded") },
    { key: "author", label: "Updated by", value: (item) => (authorLabel ? authorLabel(item) : dailyUpdateAuthor(item)) || missingLabel },
    { key: "remark", label: "Update", value: (item) => String(item.remark ?? "").trim() || missingLabel },
    ...(category ? [{ key: "category", label: "Category", value: () => category }] : []),
    { key: "delayedReason", label: "Delayed reason", value: (item) => dailyUpdateReason(item) || missingLabel },
  ];
  return <div className={`daily-remarks-panel${className ? ` ${className}` : ""}`} data-order={order}>
    <div className="daily-remarks-order" role="group" aria-label="Order of daily updates">
      <span>Show</span>
      {DAILY_UPDATES_ORDERS.map((option) => <button type="button" key={option.value} aria-pressed={order === option.value} title={option.description} onClick={() => setDailyUpdatesOrder(option.value)}>{option.label}</button>)}
    </div>
    {printTitle && <TableSmartPrint row title={printTitle} rows={updates} columns={printColumns} />}
    <ol className="daily-remarks-list" aria-label={`${countLabel}, ${order === "oldest" ? "oldest" : "newest"} first`}>
      {updates.map((item) => <li key={`${item.ordinal}-${item.createdAt}`}><article>
        <header><i aria-label={`Update ${item.ordinal} of ${updates.length}`}>#{item.ordinal}</i><b>{dailyUpdateStamp(item) ? formatDateTime(item.createdAt) : "Date not recorded"}</b><span>{(authorLabel ? authorLabel(item) : dailyUpdateAuthor(item)) || missingLabel}</span></header>
        <p>{String(item.remark ?? "").trim() || missingLabel}</p>
        <small>{category ? `${category} · ` : ""}Delayed reason: {dailyUpdateReason(item) || missingLabel}</small>
      </article></li>)}
    </ol>
    {updates.length > UPDATES_BEFORE_SCROLL && <footer className="daily-remarks-more">Scroll inside the list to see all {updates.length} updates</footer>}
  </div>;
}

// Table cells: a collapsed count with the latest update time that opens into the panel.
export default function DailyUpdatesList({ remarks = [], category = "", formatDateTime = formatDisplayDateTime }) {
  const latest = latestDailyUpdate(remarks);
  if (!latest) return "—";
  const count = (Array.isArray(remarks) ? remarks : []).filter(Boolean).length;
  return <details className="daily-remarks">
    <summary><b>{dailyUpdatesCountLabel(count)}</b><small>Latest {formatDateTime(latest.createdAt)}</small></summary>
    <DailyUpdatesPanel remarks={remarks} category={category} formatDateTime={formatDateTime} />
  </details>;
}
