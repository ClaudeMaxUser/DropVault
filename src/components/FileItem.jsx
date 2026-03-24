import { formatBytes, formatSpeed } from "../lib/format";

export default function FileItem({ file, id, prog, onRemove }) {
  const pct = prog?.pct || 0;
  const done = prog?.done || false;
  const spd = prog?.spd || 0;

  return (
    <div className="file-item">
      <div className="file-item-header">
        <div className="file-icon">
          <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
            <path d="M2 1h7l3 3v8H2V1Z" stroke="#7c6fff" strokeWidth="0.9" />
            <path d="M9 1v3h3" stroke="#7c6fff" strokeWidth="0.9" />
          </svg>
        </div>
        <span className="file-name">{file.name}</span>
        <span className="file-size">{formatBytes(file.size)}</span>
        <button className="file-remove" onClick={() => onRemove(id)}>×</button>
      </div>
      <div className="progress-bar">
        <div
          className="progress-fill"
          style={{ width: pct + "%", background: done ? "#34d399" : "#7c6fff" }}
        />
      </div>
      <div className="progress-label">
        <span>{pct ? pct + "%" : "queued"}</span>
        <span>{spd && !done ? formatSpeed(spd) : done ? "done ✓" : ""}</span>
      </div>
    </div>
  );
}