import React, { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Send } from "lucide-react";
import { startVisiblePoll } from "./visible-poll.mjs";
import { TELEGRAM_INSTALL_LINKS, telegramDevice } from "./telegram-gate.jsx";
import { laterKey, rolesText } from "./approver-telegram.mjs";
import "./telegram-gate.css";

// Owner, 28 Nov 2026: 16 of the 18 attendance approvers had not connected the MIS Telegram bot, so the approval
// summaries never reached them ("Text + pop-up in MIS"). A login that approves attendance at any level and has not
// connected Telegram sees this box after sign-in. "Later" hides it until the next sign-in in this browser tab;
// it closes by itself once Telegram is connected and never shows to a login that approves nothing.

export default function ApproverTelegramNotice({ session }) {
  const token = session?.token, login = String(session?.login || session?.user?.login || "").toLowerCase();
  const [roles, setRoles] = useState(null), [me, setMe] = useState(null), [message, setMessage] = useState(""), [link, setLink] = useState("");
  const [later, setLater] = useState(() => { try { return sessionStorage.getItem(laterKey(login)) === "1"; } catch { return false; } });
  const call = async (path, method = "GET") => {
    const response = await fetch(path, { method, cache: "no-store", headers: { Authorization: "Bearer " + token } });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error || "Could not reach Pulse-II.");
    return body;
  };
  // Once per sign-in: does this login approve anything?
  useEffect(() => {
    if (!token || later) return undefined;
    let active = true;
    call("/api/attendance-approval/mine").then((body) => { if (active) setRoles(body.roles || []); }).catch(() => { if (active) setRoles([]); });
    return () => { active = false; };
  }, [token, later]);
  const approver = Boolean(roles?.length);
  // Only for an approver: is Telegram connected? Every few seconds while the box is open, so it closes after Start.
  useEffect(() => {
    if (!token || later || !approver) return undefined;
    let active = true;
    const check = () => call("/api/mis-telegram/me").then((body) => { if (active) setMe(body); }).catch(() => {});
    void check();
    const stop = startVisiblePoll(check, 4000);
    return () => { active = false; stop(); };
  }, [token, later, approver]);
  if (!approver || later || !me || me.linked || !me.enabled) return null;
  const connect = async () => {
    const tab = window.open("", "_blank");
    setMessage("");
    try {
      const result = await call("/api/mis-telegram/link", "POST");
      setLink(result.url);
      if (tab) tab.location.href = result.url; else window.location.href = result.url;
      setMessage("Telegram is opening. Press Start there. This box closes by itself once you are connected.");
    } catch (error) {
      tab?.close();
      setMessage(error.message);
    }
  };
  const close = () => { try { sessionStorage.setItem(laterKey(login), "1"); } catch { /* the box still closes */ } setLater(true); };
  const device = telegramDevice(typeof navigator === "undefined" ? "" : navigator.userAgent);
  const install = device === "android" ? TELEGRAM_INSTALL_LINKS.android : device === "iphone" ? TELEGRAM_INSTALL_LINKS.iphone : TELEGRAM_INSTALL_LINKS.web;
  return createPortal(<div className="telegram-gate-overlay approver-telegram-notice">
    <section className="telegram-gate" role="dialog" aria-modal="true" aria-labelledby="approver-telegram-title">
      <header><span><Send /></span><div><small>Attendance approval</small><h2 id="approver-telegram-title">Connect your Telegram for approvals</h2></div></header>
      <div className="telegram-gate-body">
        <p>You approve attendance in Pulse-II:</p>
        <ul className="approver-telegram-roles">{rolesText(roles).map((line) => <li key={line}><b>{line}</b></li>)}</ul>
        <p>Approval messages come on Telegram: one per site with every day waiting for you, and an Approve / Send back button for each day. Your login has not connected Telegram, so they do not reach you.</p>
        <ol>
          <li>Press <b>Connect my Telegram</b>. No Telegram on this device? <a href={install} target="_blank" rel="noreferrer">Get Telegram</a> first.
            <div className="telegram-gate-links"><button type="button" className="telegram-gate-connect" onClick={() => void connect()}><Send />Connect my Telegram</button></div>
          </li>
          <li>Telegram opens the CALIBER MIS bot: press <b>Start</b>. This box closes by itself.</li>
        </ol>
        {message && <p className="telegram-gate-message" role="status">{message}{link && <> <a href={link} target="_blank" rel="noreferrer">Open Telegram</a></>}</p>}
      </div>
      <footer><span>Until then, approve from Masters › Attendance approval.</span><button type="button" onClick={close}>Later</button></footer>
    </section>
  </div>, document.body);
}
