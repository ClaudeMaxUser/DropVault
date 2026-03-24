import { formatBytes } from "../lib/format";

export default function IncomingItem({ fi, onSave }) {
  return (
    <div className="file-item">
      <div className="file-item-header">
        <div className="file-icon">
          <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
            <path
              d="M6.5 2v7M3.5 6l3 3 3-3"
              stroke="#7c6fff"
              strokeWidth="1"
              strokeLinecap="round"
            />
            <path d="M2 11h9" stroke="#7c6fff" strokeWidth="1" strokeLinecap="round" />
          </svg>
        </div>
        <span className="file-name">{fi.name}</span>
        <span className="file-size">{formatBytes(fi.size)}</span>
      </div>
      <div className="progress-bar">
        <div
          className="progress-fill"
          style={{ width: fi.pct + "%", background: fi.done ? "#34d399" : "#7c6fff" }}
        />
      </div>
      <div className="progress-label">
        <span>{fi.pct}%</span>
        <span style={{ color: fi.done ? "#34d399" : "#fbbf24" }}>
          {fi.done ? (fi.saved ? "saved ✓" : "ready to save") : "receiving..."}
        </span>
      </div>
      <div style={{ marginTop: 8, textAlign: "right" }}>
        {fi.done && !fi.saved && fi.url && (
          <button className="btn-primary" onClick={onSave}>save</button>
        )}
        {fi.saved && (
          <button className="btn" disabled>saved ✓</button>
        )}
      </div>
    </div>
  );
}