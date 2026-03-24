import { useRef, useEffect } from "react";

const LOG_COLORS = {
  info: "#a99fff",
  ok: "#34d399",
  warn: "#fbbf24",
  err: "#f87171",
};

export default function LogView({ logs, onClear }) {
  const endRef = useRef(null);
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logs]);

  return (
    <div className="card">
      <div className="card-label">activity log</div>
      <div className="log">
        {logs.map((l, i) => (
          <div key={i} className="log-entry">
            <span className="log-time">{l.t}</span>
            <span style={{ color: LOG_COLORS[l.k] || "#556" }}>{l.m}</span>
          </div>
        ))}
        <div ref={endRef} />
      </div>
      <div style={{ marginTop: 10, textAlign: "right" }}>
        <button className="btn" onClick={onClear}>clear log</button>
      </div>
    </div>
  );
}