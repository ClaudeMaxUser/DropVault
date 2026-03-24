import { useState } from "react";
import FileItem from "./FileItem";
import StatBar from "./StatBar";

export default function SendTab({
  myId,
  connectedTo,
  keyReady,
  files,
  progress,
  sending,
  stats,
  onAddFiles,
  onRemoveFile,
  onClearFiles,
  onSendAll,
  onConnect,
  onDisconnect,
}) {
  const [remotePeer, setRemotePeer] = useState("");
  const [dragging, setDragging] = useState(false);
  const [copied, setCopied] = useState(false);

  function copyId() {
    navigator.clipboard.writeText(myId);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  function handleConnect() {
    onConnect(remotePeer);
    // don't clear the input — user can see what they typed
  }

  return (
    <div>
      {/* Peer ID card */}
      <div className="card">
        <div className="card-label">your peer id — share with receiver</div>
        <div className="pid-box">
          <code className="pid">{myId || "generating..."}</code>
          <button className="btn" disabled={!myId} onClick={copyId}>
            {copied ? "copied ✓" : "copy"}
          </button>
        </div>
      </div>

      {/* Connect card */}
      <div className="card">
        <div className="card-label">connect to receiver</div>
        <div className="row">
          <input
            type="text"
            value={connectedTo || remotePeer}
            onChange={(e) => setRemotePeer(e.target.value.toUpperCase())}
            onKeyDown={(e) => e.key === "Enter" && !connectedTo && handleConnect()}
            placeholder="paste receiver's peer id..."
            style={{ textTransform: "uppercase", letterSpacing: 2 }}
            disabled={!!connectedTo}
          />
          {connectedTo ? (
            <button className="btn-danger" onClick={onDisconnect}>disconnect</button>
          ) : (
            <button
              className="btn-primary"
              disabled={!myId || !remotePeer.trim()}
              onClick={handleConnect}
            >
              connect
            </button>
          )}
        </div>
        {connectedTo && (
          <p className="conn-note">
            connected to {connectedTo}{" "}
            {keyReady ? "· AES-256 session active ✓" : "· exchanging keys..."}
          </p>
        )}
      </div>

      {/* Drop zone card */}
      <div className="card">
        <div className="card-label">files to send</div>
        <div
          className={`drop-zone ${dragging ? "dragging" : ""}`}
          onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            onAddFiles(e.dataTransfer.files);
          }}
          onClick={() => document.getElementById("file-input").click()}
        >
          <input
            id="file-input"
            type="file"
            multiple
            style={{ display: "none" }}
            onChange={(e) => onAddFiles(e.target.files)}
          />
          <div className="drop-icon">
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
              <path d="M9 2L13 6H10.5V12H7.5V6H5L9 2Z" fill="#00d4c8" />
              <path d="M2 14V16H16V14" stroke="#00d4c8" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </div>
          <p className="drop-text">
            <span className="drop-accent">drop files here</span> or click to browse
          </p>
          <p className="drop-sub">
            multiple files · any size · encrypted locally before sending
          </p>
        </div>

        <div className="file-list">
          {files.map(({ file, id }) => (
            <FileItem key={id} file={file} id={id} prog={progress[id]} onRemove={onRemoveFile} />
          ))}
        </div>

        <div className="actions">
          {files.length > 0 && (
            <button className="btn-danger" onClick={onClearFiles}>clear all</button>
          )}
          <button
            className="btn-primary"
            disabled={!keyReady || files.length === 0 || sending}
            onClick={onSendAll}
          >
            {sending ? "sending..." : "send files"}
          </button>
        </div>
      </div>

      {(stats.sent > 0 || sending) && <StatBar stats={stats} />}
    </div>
  );
}