import { useState, useEffect, useRef } from "react";
import Peer from "peerjs";

// ── constants ────────────────────────────────────────────────────────────────
const CHUNK_SIZE = 65536; // 64 KB chunks
const RESUME_KEY = "dvault_resume";

// ── crypto helpers ────────────────────────────────────────────────────────────
async function genKeyPair() {
  return crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveKey"]);
}
async function exportPub(key) {
  const exported = await crypto.subtle.exportKey("spki", key);
  return btoa(String.fromCharCode(...new Uint8Array(exported)));
}
async function importPub(b64) {
  const raw = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  return crypto.subtle.importKey("spki", raw, { name: "ECDH", namedCurve: "P-256" }, true, []);
}
async function deriveSharedKey(privateKey, publicKey) {
  return crypto.subtle.deriveKey(
    { name: "ECDH", public: publicKey },
    privateKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}
async function encryptChunk(key, data) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const enc = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, data);
  const out = new Uint8Array(12 + enc.byteLength);
  out.set(iv);
  out.set(new Uint8Array(enc), 12);
  return out.buffer;
}
async function decryptChunk(key, data) {
  const iv = new Uint8Array(data.slice(0, 12));
  const enc = data.slice(12);
  return crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, enc);
}

// ── resume helpers ────────────────────────────────────────────────────────────
function saveResume(id, n, total) {
  try {
    const s = JSON.parse(localStorage.getItem(RESUME_KEY) || "{}");
    s[id] = { n, total, ts: Date.now() };
    localStorage.setItem(RESUME_KEY, JSON.stringify(s));
  } catch (_) {}
}
function getResume(id) {
  try {
    const s = JSON.parse(localStorage.getItem(RESUME_KEY) || "{}");
    return s[id] || null;
  } catch (_) {
    return null;
  }
}
function clearResume(id) {
  try {
    const s = JSON.parse(localStorage.getItem(RESUME_KEY) || "{}");
    delete s[id];
    localStorage.setItem(RESUME_KEY, JSON.stringify(s));
  } catch (_) {}
}

// ── format helpers ────────────────────────────────────────────────────────────
function formatBytes(b) {
  if (b < 1024) return b + " B";
  if (b < 1048576) return (b / 1024).toFixed(1) + " KB";
  if (b < 1073741824) return (b / 1048576).toFixed(1) + " MB";
  return (b / 1073741824).toFixed(2) + " GB";
}
function formatSpeed(bps) {
  if (bps < 1024) return bps.toFixed(0) + " B/s";
  if (bps < 1048576) return (bps / 1024).toFixed(1) + " KB/s";
  return (bps / 1048576).toFixed(1) + " MB/s";
}
function genId() {
  return "f_" + Date.now() + "_" + Math.random().toString(36).slice(2, 6);
}
function nowTime() {
  return new Date().toTimeString().slice(0, 8);
}

// ── LogView sub-component ────────────────────────────────────────────────────
function LogView({ logs, onClear }) {
  const ref = useRef(null);
  useEffect(() => {
    if (ref.current) ref.current.scrollTop = ref.current.scrollHeight;
  }, [logs]);

  const colors = { info: "#a99fff", ok: "#34d399", warn: "#fbbf24", err: "#f87171" };

  return (
    <div className="card">
      <div className="card-label">activity log</div>
      <div className="log" ref={ref}>
        {logs.map((l, i) => (
          <div key={i} className="log-entry">
            <span className="log-time">{l.t}</span>
            <span style={{ color: colors[l.k] || "#556" }}>{l.m}</span>
          </div>
        ))}
      </div>
      <div style={{ marginTop: 10, textAlign: "right" }}>
        <button className="btn" onClick={onClear}>clear log</button>
      </div>
    </div>
  );
}

// ── FileItem sub-component ───────────────────────────────────────────────────
function FileItem({ file, id, prog, onRemove }) {
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

// ── IncomingItem sub-component ────────────────────────────────────────────────
function IncomingItem({ fi }) {
  return (
    <div className="file-item">
      <div className="file-item-header">
        <div className="file-icon">
          <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
            <path d="M6.5 2v7M3.5 6l3 3 3-3" stroke="#7c6fff" strokeWidth="1" strokeLinecap="round" />
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
          {fi.done ? "saved ✓" : "receiving..."}
        </span>
      </div>
    </div>
  );
}

// ── StatBar sub-component ────────────────────────────────────────────────────
function StatBar({ stats }) {
  return (
    <div className="stats-grid">
      <div className="stat-box">
        <div className="stat-val">{stats.sent}</div>
        <div className="stat-lbl">files sent</div>
      </div>
      <div className="stat-box">
        <div className="stat-val">{stats.speed}</div>
        <div className="stat-lbl">speed</div>
      </div>
      <div className="stat-box">
        <div className="stat-val">{stats.total}</div>
        <div className="stat-lbl">total MB</div>
      </div>
    </div>
  );
}

// ── Main App component ────────────────────────────────────────────────────────
export default function DropVault() {
  const [tab, setTab] = useState("send");
  const [peerId, setPeerId] = useState("");
  const [connStatus, setConnStatus] = useState("init"); // init | connecting | online | error
  const [connLabel, setConnLabel] = useState("initializing...");
  const [remotePeer, setRemotePeer] = useState("");
  const [connectedTo, setConnectedTo] = useState("");
  const [keyReady, setKeyReady] = useState(false);
  const [files, setFiles] = useState([]); // [{ file, id }]
  const [progress, setProgress] = useState({}); // { [id]: { pct, spd, done } }
  const [incoming, setIncoming] = useState({}); // { [fileId]: { name, size, pct, done } }
  const [logs, setLogs] = useState([{ t: nowTime(), m: "peer initializing...", k: "info" }]);
  const [dragging, setDragging] = useState(false);
  const [stats, setStats] = useState({ sent: 0, speed: "—", total: "0" });
  const [sending, setSending] = useState(false);

  // Refs for mutable state that shouldn't re-render
  const peerRef = useRef(null);
  const connRef = useRef(null);
  const sharedKeyRef = useRef(null);
  const incomingDataRef = useRef({}); // stores raw chunks
  const resumeFromRef = useRef({}); // { [fileId]: chunkIndex }

  const addLog = (m, k = "info") =>
    setLogs((l) => [...l.slice(-99), { t: nowTime(), m, k }]);

  // ── Init PeerJS ────────────────────────────────────────────────────────────
  useEffect(() => {
    // NOTE: Replace this block with Firebase signaling when ready.
    // See FIREBASE_SIGNALING_SETUP.md comment at the bottom of this file.
    const p = new Peer(undefined, {
      host: "peerjs.com",
      port: 443,
      path: "/",
      secure: true,
      config: { iceServers: [{ urls: "stun:stun.l.google.com:19302" }] },
    });

    peerRef.current = p;

    p.on("open", (id) => {
      setPeerId(id);
      setConnStatus("online");
      setConnLabel("ready · " + id.slice(0, 8) + "...");
      addLog("peer ready: " + id, "ok");
    });

    p.on("connection", (c) => {
      connRef.current = c;
      addLog("incoming connection from: " + c.peer, "ok");
      setupConnection(c);
    });

    p.on("error", (err) => {
      setConnStatus("error");
      setConnLabel("error: " + err.type);
      addLog("peer error: " + err.type, "err");
    });

    p.on("disconnected", () => {
      setConnStatus("connecting");
      setConnLabel("reconnecting...");
      addLog("disconnected, retrying...", "warn");
      setTimeout(() => p.reconnect(), 2000);
    });

    return () => p.destroy();
  }, []);

  // ── Setup a data connection (outgoing or incoming) ─────────────────────────
  async function setupConnection(c) {
    setConnStatus("connecting");
    setConnLabel("handshaking...");

    const keyPair = await genKeyPair();

    c.on("open", async () => {
      setConnectedTo(c.peer);
      addLog("data channel open — starting key exchange", "info");
      const pub = await exportPub(keyPair.publicKey);
      c.send(JSON.stringify({ type: "key_exchange", pub }));
    });

    c.on("data", async (data) => {
      // ── JSON control messages ──
      if (typeof data === "string") {
        const msg = JSON.parse(data);

        // ECDH key exchange
        if (msg.type === "key_exchange") {
          const remotePubKey = await importPub(msg.pub);
          const sk = await deriveSharedKey(keyPair.privateKey, remotePubKey);
          sharedKeyRef.current = sk;
          setKeyReady(true);
          setConnStatus("online");
          setConnLabel("connected · e2e encrypted");
          addLog("AES-256-GCM session key established", "ok");
          // Send our key back if we haven't yet
          const myPub = await exportPub(keyPair.publicKey);
          if (msg.pub !== myPub) {
            c.send(JSON.stringify({ type: "key_ack", pub: myPub }));
          }
        }

        if (msg.type === "key_ack") {
          const remotePubKey = await importPub(msg.pub);
          const sk = await deriveSharedKey(keyPair.privateKey, remotePubKey);
          sharedKeyRef.current = sk;
          setKeyReady(true);
          setConnStatus("online");
          setConnLabel("connected · e2e encrypted");
          addLog("key ack — session ready", "ok");
        }

        // Incoming file metadata
        if (msg.type === "file_meta") {
          const rs = getResume("r_" + msg.fileId);
          const resumeFrom = rs ? rs.n : 0;
          incomingDataRef.current[msg.fileId] = {
            name: msg.name,
            size: msg.size,
            mimeType: msg.mtype,
            totalChunks: msg.total,
            chunks: {},
            got: resumeFrom,
          };
          setIncoming((prev) => ({
            ...prev,
            [msg.fileId]: { name: msg.name, size: msg.size, pct: 0, done: false },
          }));
          // Tell sender which chunk to resume from
          c.send(JSON.stringify({ type: "resume_ack", fileId: msg.fileId, from: resumeFrom }));
          addLog(`incoming: ${msg.name} (${formatBytes(msg.size)})${resumeFrom > 0 ? " resuming from " + resumeFrom : ""}`, "info");
        }

        // Sender learns where to resume from
        if (msg.type === "resume_ack") {
          resumeFromRef.current[msg.fileId] = msg.from;
          if (msg.from > 0) addLog("resume acknowledged from chunk " + msg.from, "info");
        }
      }

      // ── Binary chunk data ──
      else {
        const buf = data instanceof ArrayBuffer ? data : data.buffer;
        const dv = new DataView(buf);
        const fidLen = dv.getUint8(0);
        const fileId = new TextDecoder().decode(new Uint8Array(buf, 1, fidLen));
        const chunkIdx = dv.getUint32(1 + fidLen, false);
        const encChunk = buf.slice(1 + fidLen + 4);

        const fi = incomingDataRef.current[fileId];
        if (!fi || !sharedKeyRef.current) return;

        const decrypted = await decryptChunk(sharedKeyRef.current, encChunk);
        fi.chunks[chunkIdx] = decrypted;
        fi.got++;

        const pct = Math.round((fi.got / fi.totalChunks) * 100);
        setIncoming((prev) => ({ ...prev, [fileId]: { ...prev[fileId], pct } }));
        saveResume("r_" + fileId, fi.got, fi.totalChunks);

        // All chunks received — assemble and download
        if (fi.got >= fi.totalChunks) {
          const buffers = [];
          for (let i = 0; i < fi.totalChunks; i++) {
            if (fi.chunks[i]) buffers.push(fi.chunks[i]);
          }
          const blob = new Blob(buffers, { type: fi.mimeType || "application/octet-stream" });
          const url = URL.createObjectURL(blob);
          const a = document.createElement("a");
          a.href = url;
          a.download = fi.name;
          a.click();
          URL.revokeObjectURL(url);
          setIncoming((prev) => ({ ...prev, [fileId]: { ...prev[fileId], pct: 100, done: true } }));
          clearResume("r_" + fileId);
          addLog("file saved: " + fi.name, "ok");
        }
      }
    });

    c.on("close", () => {
      setConnectedTo("");
      setKeyReady(false);
      setConnStatus("online");
      setConnLabel("ready");
      addLog("connection closed", "warn");
    });

    c.on("error", (err) => addLog("connection error: " + err, "err"));
  }

  // ── Connect to remote peer ─────────────────────────────────────────────────
  function connectToPeer() {
    if (!remotePeer.trim() || !peerRef.current) return;
    addLog("connecting to: " + remotePeer, "info");
    const c = peerRef.current.connect(remotePeer.trim(), {
      reliable: true,
      serialization: "binary",
    });
    connRef.current = c;
    setupConnection(c);
  }

  // ── File drop/select handlers ──────────────────────────────────────────────
  function addFiles(fileList) {
    const items = [...fileList].map((f) => ({ file: f, id: genId() }));
    setFiles((prev) => [...prev, ...items]);
  }

  function removeFile(id) {
    setFiles((prev) => prev.filter((f) => f.id !== id));
    setProgress((prev) => { const n = { ...prev }; delete n[id]; return n; });
  }

  // ── Send all queued files ──────────────────────────────────────────────────
  async function sendAll() {
    if (!connRef.current || !sharedKeyRef.current) return;
    setSending(true);
    let filesSent = 0;
    let bytesSent = 0;

    for (const { file, id } of files) {
      const totalChunks = Math.ceil(file.size / CHUNK_SIZE);
      const rs = getResume(id);
      const savedChunk = rs ? rs.n : 0;

      // Send metadata, receiver replies with resume_ack
      connRef.current.send(
        JSON.stringify({
          type: "file_meta",
          fileId: id,
          name: file.name,
          size: file.size,
          mtype: file.type,
          total: totalChunks,
        })
      );

      addLog(`sending: ${file.name}${savedChunk > 0 ? " (resume from " + savedChunk + ")" : ""}`, "info");

      // Wait briefly for resume_ack
      await new Promise((r) => setTimeout(r, 400));
      const startChunk = resumeFromRef.current[id] ?? savedChunk;
      const t0 = Date.now();

      for (let ci = startChunk; ci < totalChunks; ci++) {
        const slice = file.slice(ci * CHUNK_SIZE, (ci + 1) * CHUNK_SIZE);
        const raw = await slice.arrayBuffer();
        const enc = await encryptChunk(sharedKeyRef.current, raw);

        // Packet layout: [1 byte: fileId length][fileId bytes][4 bytes: chunk index][encrypted data]
        const fidBytes = new TextEncoder().encode(id);
        const header = new ArrayBuffer(1 + fidBytes.length + 4);
        const dv = new DataView(header);
        dv.setUint8(0, fidBytes.length);
        fidBytes.forEach((b, i) => dv.setUint8(1 + i, b));
        dv.setUint32(1 + fidBytes.length, ci, false);

        const packet = new Uint8Array(header.byteLength + enc.byteLength);
        packet.set(new Uint8Array(header));
        packet.set(new Uint8Array(enc), header.byteLength);
        connRef.current.send(packet.buffer);

        const elapsed = (Date.now() - t0) / 1000 || 0.001;
        const speed = ((ci - startChunk + 1) * CHUNK_SIZE) / elapsed;
        const pct = Math.round(((ci + 1) / totalChunks) * 100);

        setProgress((prev) => ({ ...prev, [id]: { pct, spd: speed, done: false } }));
        setStats((s) => ({ ...s, speed: formatSpeed(speed) }));
        saveResume(id, ci + 1, totalChunks);

        // Yield to browser every 8 chunks to keep UI responsive
        if (ci % 8 === 0) await new Promise((r) => setTimeout(r, 0));
      }

      setProgress((prev) => ({ ...prev, [id]: { pct: 100, spd: 0, done: true } }));
      clearResume(id);
      filesSent++;
      bytesSent += file.size;
      setStats({ sent: filesSent, speed: "—", total: (bytesSent / 1048576).toFixed(1) });
      addLog("done: " + file.name, "ok");
    }

    setSending(false);
    addLog("all files transferred successfully", "ok");
  }

  // ── Status dot color ───────────────────────────────────────────────────────
  const dotColors = { online: "#34d399", connecting: "#fbbf24", error: "#f87171", init: "#556" };

  return (
    <div className="app">
      {/* Header */}
      <header className="header">
        <div className="logo">
          <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
            <path d="M9 2L13 6H10.5V11H7.5V6H5L9 2Z" fill="white" />
            <path d="M3 10V15H15V10" stroke="white" strokeWidth="1.5" strokeLinecap="round" />
            <path d="M6 12.5H12" stroke="white" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </div>
        <div>
          <h1>DropVault</h1>
          <p className="subtitle">P2P · AES-256-GCM · No server storage</p>
        </div>
        <div className="status-bar">
          <div className="dot" style={{ background: dotColors[connStatus], boxShadow: connStatus === "online" ? "0 0 6px #34d399" : "none" }} />
          <span>{connLabel}</span>
        </div>
      </header>

      {/* Badges */}
      <div className="badges">
        {[
          { label: "AES-256-GCM encrypted", color: "#34d399", bg: "rgba(52,211,153,0.08)" },
          { label: "WebRTC P2P", color: "#a99fff", bg: "rgba(124,111,255,0.08)" },
          { label: "resumable transfers", color: "#fbbf24", bg: "rgba(251,191,36,0.08)" },
          { label: "multi-file", color: "#556", bg: "transparent" },
        ].map((b) => (
          <span key={b.label} className="badge" style={{ borderColor: b.color, color: b.color, background: b.bg }}>
            {b.label}
          </span>
        ))}
      </div>

      {/* Tabs */}
      <div className="tabs">
        {["send", "receive", "log"].map((t) => (
          <button key={t} className={`tab ${tab === t ? "active" : ""}`} onClick={() => setTab(t)}>
            {t}
          </button>
        ))}
      </div>

      {/* ── SEND TAB ── */}
      {tab === "send" && (
        <div>
          <div className="card">
            <div className="card-label">your peer id — share with receiver</div>
            <div className="pid-box">
              <code className="pid">{peerId || "connecting..."}</code>
              <button
                className="btn"
                disabled={!peerId}
                onClick={() => { navigator.clipboard.writeText(peerId); addLog("peer id copied", "ok"); }}
              >
                copy
              </button>
            </div>
          </div>

          <div className="card">
            <div className="card-label">connect to receiver</div>
            <div className="row">
              <input
                type="text"
                value={remotePeer}
                onChange={(e) => setRemotePeer(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && connectToPeer()}
                placeholder="paste receiver's peer id..."
              />
              <button className="btn-primary" disabled={!peerId || !remotePeer.trim()} onClick={connectToPeer}>
                connect
              </button>
            </div>
            {connectedTo && (
              <p className="conn-note">
                connected to {connectedTo.slice(0, 20)}... {keyReady ? "· keys exchanged ✓" : "· exchanging keys..."}
              </p>
            )}
          </div>

          <div className="card">
            <div className="card-label">files to send</div>
            <div
              className={`drop-zone ${dragging ? "dragging" : ""}`}
              onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
              onDragLeave={() => setDragging(false)}
              onDrop={(e) => { e.preventDefault(); setDragging(false); addFiles(e.dataTransfer.files); }}
              onClick={() => document.getElementById("file-input").click()}
            >
              <input id="file-input" type="file" multiple style={{ display: "none" }} onChange={(e) => addFiles(e.target.files)} />
              <div className="drop-icon">
                <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
                  <path d="M9 2L13 6H10.5V12H7.5V6H5L9 2Z" fill="#7c6fff" />
                  <path d="M2 14V16H16V14" stroke="#7c6fff" strokeWidth="1.5" strokeLinecap="round" />
                </svg>
              </div>
              <p className="drop-text"><span className="drop-accent">drop files here</span> or click to browse</p>
              <p className="drop-sub">multiple files · any size · encrypted before sending</p>
            </div>

            <div className="file-list">
              {files.map(({ file, id }) => (
                <FileItem key={id} file={file} id={id} prog={progress[id]} onRemove={removeFile} />
              ))}
            </div>

            <div className="actions">
              {files.length > 0 && (
                <button className="btn-danger" onClick={() => { setFiles([]); setProgress({}); }}>
                  clear all
                </button>
              )}
              <button
                className="btn-primary"
                disabled={!keyReady || files.length === 0 || sending}
                onClick={sendAll}
              >
                {sending ? "sending..." : "send files"}
              </button>
            </div>
          </div>

          {(stats.sent > 0 || sending) && <StatBar stats={stats} />}
        </div>
      )}

      {/* ── RECEIVE TAB ── */}
      {tab === "receive" && (
        <div>
          <div className="card">
            <div className="card-label">your peer id — share with sender</div>
            <div className="pid-box">
              <code className="pid">{peerId || "connecting..."}</code>
              <button
                className="btn"
                disabled={!peerId}
                onClick={() => { navigator.clipboard.writeText(peerId); addLog("peer id copied", "ok"); }}
              >
                copy
              </button>
            </div>
          </div>

          <div className="card">
            <div className="card-label">incoming transfers</div>
            {Object.keys(incoming).length === 0 ? (
              <div className="empty-state">
                {keyReady ? "ready — waiting for files..." : "waiting for connection..."}
              </div>
            ) : (
              Object.entries(incoming).map(([id, fi]) => (
                <IncomingItem key={id} fi={fi} />
              ))
            )}
          </div>
        </div>
      )}

      {/* ── LOG TAB ── */}
      {tab === "log" && <LogView logs={logs} onClear={() => setLogs([])} />}

      <p className="footer">
        signaling via peerjs.com · no file data touches any server · swap with firebase for production
      </p>
    </div>
  );
}