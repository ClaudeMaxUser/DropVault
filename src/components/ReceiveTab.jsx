import { useState } from "react";
import IncomingItem from "./IncomingItem";

export default function ReceiveTab({
  myId,
  connectedTo,
  keyReady,
  incoming,
  savableCount,
  onSave,
  onSaveAll,
}) {
  const [copied, setCopied] = useState(false);

  function copyId() {
    navigator.clipboard.writeText(myId);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div>
      <div className="card">
        <div className="card-label">your peer id — share with sender</div>
        <div className="pid-box">
          <code className="pid">{myId || "generating..."}</code>
          <button className="btn" disabled={!myId} onClick={copyId}>
            {copied ? "copied ✓" : "copy"}
          </button>
        </div>
      </div>

      <div className="card">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div className="card-label">incoming transfers</div>
          {savableCount > 0 && (
            <button className="btn-primary" onClick={onSaveAll}>save all</button>
          )}
        </div>
        {Object.keys(incoming).length === 0 ? (
          <div className="empty-state">
            {keyReady
              ? "ready — waiting for files..."
              : connectedTo
                ? "exchanging keys..."
                : "waiting for connection..."}
          </div>
        ) : (
          Object.entries(incoming).map(([id, fi]) => (
            <IncomingItem key={id} fi={fi} onSave={() => onSave(id)} />
          ))
        )}
      </div>
    </div>
  );
}