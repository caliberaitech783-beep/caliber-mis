// Helpers of the "connect your Telegram" pop-up for attendance approvers (src/approver-telegram-notice.jsx).
export const laterKey = (login) => "approverTelegramLater:" + String(login || "").toLowerCase();
export const rolesText = (roles = []) => roles.map((role) => `${role.label} · ${role.sites.length > 3 ? role.sites.length + " sites" : role.sites.join(", ")}`);
