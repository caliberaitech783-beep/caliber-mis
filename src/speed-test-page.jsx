import React, { useState } from "react";
import { Gauge, RefreshCw } from "lucide-react";
import "./diagnostics-page.css";
import "./speed-test-page.css";

export default function SpeedTestPage({ token }) {
  const [report, setReport] = useState(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState("");

  async function run() {
    setRunning(true);
    setReport(null);
    setError("");
    try {
      const response = await fetch("/api/diagnostics/speed-test", {
        cache: "no-store",
        headers: { Authorization: "Bearer " + token },
        signal: AbortSignal.timeout(30000),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || "Speed test could not run.");
      setReport(result);
    } catch (failure) {
      setError(failure.message || "Speed test could not run.");
    } finally {
      setRunning(false);
    }
  }

  return <section className="panel pagepanel generic diagnostics-page mis-speed-test">
    <header>
      <div><h1><Gauge aria-hidden="true" /> Speed Test</h1><p>Check batch, card scanning, and server performance.</p></div>
      <button type="button" className="primary" onClick={run} disabled={running}>
        <RefreshCw className={running ? "spin" : ""} aria-hidden="true" />{running ? "Testing…" : "Run speed test"}
      </button>
    </header>
    {error && <p className="diagnostics-error" role="alert">{error}</p>}
    {report && <>
      <div className={"speed-test-banner " + (report.verdict.good ? "good" : "slow")} role="status">
        <strong>{report.verdict.label}</strong>
        {report.verdict.reasons.length > 0 && <ul>{report.verdict.reasons.map(reason => <li key={reason}>{reason}</li>)}</ul>}
      </div>
      <h2>{report.title}</h2>
      <p>{report.period}</p>
      <div className="speed-test-report">
        {report.body.split("\n\n").map((section, index) => {
          const [heading, ...lines] = section.split("\n");
          return <section key={index}><h3>{heading}</h3>{lines.length > 0 && <p>{lines.join("\n")}</p>}</section>;
        })}
      </div>
    </>}
  </section>;
}
