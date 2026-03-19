import { useState, useEffect, useRef } from "react";
import { ref, set, onValue, push, remove, off } from "firebase/database";
import { db } from "./firebase";

// ── WebRTC ICE config ─────────────────────────────────────────────────────────
const RTC_CONFIG = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
    {
      urls: "turn:turn.cloudflare.com:3478",
      username: "free",
      credential: "free",
    },
  ],
};

// ── Constants ─────────────────────────────────────────────────────────────────
const CHUNK_SIZE = 65536; // 64 KB
const RESUME_KEY = "dvault_resume";

// ── Crypto helpers ────────────────────────────────────────────────────────────
async function genKeyPair() {
  return crypto.subtle.generateKey(
    { name: "ECDH", namedCurve: "P-256" },
    true,
    ["deriveKey"],
  );
}
async function exportPub(key) {
  const exported = await crypto.subtle.exportKey("spki", key);
  return btoa(String.fromCharCode(...new Uint8Array(exported)));
}
async function importPub(b64) {
  const raw = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  return crypto.subtle.importKey(
    "spki",
    raw,
    { name: "ECDH", namedCurve: "P-256" },
    true,
    [],
  );
}
async function deriveSharedKey(privateKey, publicKey) {
  return crypto.subtle.deriveKey(
    { name: "ECDH", public: publicKey },
    privateKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}
// Compute a short fingerprint from an spki base64 public key
async function fingerprintFromPub(b64) {
  try {
    const raw = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const hash = await crypto.subtle.digest("SHA-256", raw);
    const hex = Array.from(new Uint8Array(hash))
      .slice(0, 8)
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("")
      .toUpperCase();
    return hex.match(/.{1,4}/g).join(":");
  } catch (_) {
    return "????:????";
  }
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

// ── Resume helpers ────────────────────────────────────────────────────────────
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

// ── Format helpers ────────────────────────────────────────────────────────────
function formatBytes(b) {
  if (b < 1024) return b + " B";
  if (b < 1048576) return (b / 1024).toFixed(1) + " KB";
  if (b < 1073741824) return (b / 1048576).toFixed(1) + " MB";
  return (b / 1073741824).toFixed(2) + " GB";
}
// Format RTC/WebRTC error events into a readable string for logs
function formatRtcError(e) {
  try {
    if (!e) return String(e);
    // Prefer event.error (RTCErrorEvent) or nested Error-like objects
    const err = e.error || e.detail || e;
    if (!err) return String(e);
    if (typeof err === "string") return err;
    if (typeof err === "object") {
      const parts = [];
      if (err.name) parts.push(err.name);
      if (err.message) parts.push(err.message);
      if (err.code) parts.push("code:" + err.code);
      if (parts.length) return parts.join(" - ");
      // Fallback to toString if available
      try {
        return err.toString();
      } catch (_) {
        return JSON.stringify(err);
      }
    }
    if (e.message) return e.message;
    return String(e);
  } catch (_) {
    return "RTC error";
  }
}
function formatSpeed(bps) {
  if (bps < 1024) return bps.toFixed(0) + " B/s";
  if (bps < 1048576) return (bps / 1024).toFixed(1) + " KB/s";
  return (bps / 1048576).toFixed(1) + " MB/s";
}
function genId() {
  return Math.random().toString(36).slice(2, 10).toUpperCase();
}
function nowTime() {
  return new Date().toTimeString().slice(0, 8);
}

// ── Firebase signaling helpers ────────────────────────────────────────────────
// Signaling data is written to /rooms/{roomId}/ and cleaned up after connection.
// Only SDP offer/answer + ICE candidates pass through Firebase — never file data.

async function createOffer(pc, roomId, myId) {
  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  await set(ref(db, `rooms/${roomId}/offer`), {
    sdp: offer.sdp,
    type: offer.type,
    from: myId,
    ts: Date.now(),
  });
}

async function createAnswer(pc, roomId, myId) {
  const answer = await pc.createAnswer();
  await pc.setLocalDescription(answer);
  await set(ref(db, `rooms/${roomId}/answer`), {
    sdp: answer.sdp,
    type: answer.type,
    from: myId,
    ts: Date.now(),
  });
}

function listenForAnswer(roomId, callback) {
  const r = ref(db, `rooms/${roomId}/answer`);
  onValue(r, (snap) => {
    if (snap.val()) callback(snap.val());
  });
  return () => off(r);
}

function listenForOffer(roomId, callback) {
  const r = ref(db, `rooms/${roomId}/offer`);
  onValue(r, (snap) => {
    if (snap.val()) callback(snap.val());
  });
  return () => off(r);
}

function sendIceCandidate(roomId, fromId, candidate) {
  push(ref(db, `rooms/${roomId}/ice_${fromId}`), candidate.toJSON());
}

function listenForIce(roomId, fromId, callback) {
  const r = ref(db, `rooms/${roomId}/ice_${fromId}`);
  onValue(r, (snap) => {
    if (!snap.val()) return;
    Object.values(snap.val()).forEach((c) => callback(c));
  });
  return () => off(r);
}

async function cleanupRoom(roomId) {
  await remove(ref(db, `rooms/${roomId}`));
}

// ── LogView component ─────────────────────────────────────────────────────────
function LogView({ logs, onClear }) {
  const ref_ = useRef(null);
  useEffect(() => {
    if (ref_.current) ref_.current.scrollTop = ref_.current.scrollHeight;
  }, [logs]);
  const colors = {
    info: "#a99fff",
    ok: "#34d399",
    warn: "#fbbf24",
    err: "#f87171",
  };
  return (
    <div className="card">
      <div className="card-label">activity log</div>
      <div className="log" ref={ref_}>
        {logs.map((l, i) => (
          <div key={i} className="log-entry">
            <span className="log-time">{l.t}</span>
            <span style={{ color: colors[l.k] || "#556" }}>{l.m}</span>
          </div>
        ))}
      </div>
      <div style={{ marginTop: 10, textAlign: "right" }}>
        <button className="btn" onClick={onClear}>
          clear log
        </button>
      </div>
    </div>
  );
}

// ── FileItem component ────────────────────────────────────────────────────────
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
        <button className="file-remove" onClick={() => onRemove(id)}>
          ×
        </button>
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

// ── IncomingItem component ────────────────────────────────────────────────────
function IncomingItem({ fi, onSave }) {
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
            <path
              d="M2 11h9"
              stroke="#7c6fff"
              strokeWidth="1"
              strokeLinecap="round"
            />
          </svg>
        </div>
        <span className="file-name">{fi.name}</span>
        <span className="file-size">{formatBytes(fi.size)}</span>
      </div>
      <div className="progress-bar">
        <div
          className="progress-fill"
          style={{
            width: fi.pct + "%",
            background: fi.done ? "#34d399" : "#7c6fff",
          }}
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
          <button className="btn-primary" onClick={onSave}>
            save
          </button>
        )}
        {fi.saved && (
          <button className="btn" disabled>
            saved ✓
          </button>
        )}
      </div>
    </div>
  );
}

// ── StatBar component ─────────────────────────────────────────────────────────
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

// ── Main App ──────────────────────────────────────────────────────────────────
export default function App() {
  const [tab, setTab] = useState("send");
  const [myId, setMyId] = useState("");
  const [connStatus, setConnStatus] = useState("init");
  const [connLabel, setConnLabel] = useState("generating id...");
  const [remotePeer, setRemotePeer] = useState("");
  const [connectedTo, setConnectedTo] = useState("");
  const [keyReady, setKeyReady] = useState(false);
  const [files, setFiles] = useState([]);
  const [progress, setProgress] = useState({});
  const [incoming, setIncoming] = useState({});
  const [logs, setLogs] = useState([
    { t: nowTime(), m: "initializing...", k: "info" },
  ]);
  const [dragging, setDragging] = useState(false);
  const [stats, setStats] = useState({ sent: 0, speed: "—", total: "0 MB" });
  const [sending, setSending] = useState(false);
  const [copied, setCopied] = useState(false);
  const [connModal, setConnModal] = useState(null); // { trigger, remotePub, remoteFp, localFp, dc }
  const [disconnectModal, setDisconnectModal] = useState(false);

  // Prevent background interaction/scroll when modal is open
  useEffect(() => {
    const prev = document.body.style.overflow;
    if (connModal) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = prev;
    }
    return () => {
      document.body.style.overflow = prev;
    };
  }, [connModal]);

  const pcRef = useRef(null); // RTCPeerConnection
  const dcRef = useRef(null); // RTCDataChannel
  const sharedKeyRef = useRef(null); // AES-GCM session key
  const myIdRef = useRef(""); // our peer ID
  const incomingDataRef = useRef({}); // raw chunk storage
  const resumeFromRef = useRef({}); // { [fileId]: chunkIndex }
  const cleanupListeners = useRef([]); // Firebase listener unsubscribers

  const addLog = (m, k = "info") =>
    setLogs((l) => [...l.slice(-99), { t: nowTime(), m, k }]);

  // ── Generate peer ID and listen for incoming offers ───────────────────────
  useEffect(() => {
    const id = genId();
    myIdRef.current = id;
    setMyId(id);
    setConnStatus("online");
    setConnLabel("ready · " + id);
    addLog("your peer id: " + id, "ok");

    // Listen for an incoming offer on our room
    const unsub = listenForOffer(id, async (offer) => {
      if (pcRef.current) return; // already connected
      addLog("incoming connection request from " + offer.from, "info");
      await initConnection(false, id, offer.from, offer);
    });
    cleanupListeners.current.push(unsub);

    return () => {
      cleanupListeners.current.forEach((fn) => fn());
      if (pcRef.current) pcRef.current.close();
      cleanupRoom(id);
    };
  }, []);

  // ── Init RTCPeerConnection ────────────────────────────────────────────────
  // isCaller=true  → we send the offer  (sender side)
  // isCaller=false → we send the answer (receiver side)
  async function initConnection(
    isCaller,
    myRoomId,
    remoteId,
    incomingOffer = null,
  ) {
    const pc = new RTCPeerConnection(RTC_CONFIG);
    pcRef.current = pc;

    // ICE candidates → Firebase
    pc.onicecandidate = ({ candidate }) => {
      if (candidate)
        sendIceCandidate(
          remoteId, // always receiver's room
          isCaller ? "caller" : "callee", // fixed role key
          candidate,
        );
    };

    pc.onconnectionstatechange = () => {
      const state = pc.connectionState;
      addLog(
        "WebRTC: " + state,
        state === "connected" ? "ok" : state === "failed" ? "err" : "info",
      );
      if (state === "connected") {
        setConnStatus("online");
        setConnLabel("connected · e2e encrypted");
        setConnectedTo(remoteId);
        // Clean up signaling data — no longer needed
        cleanupRoom(isCaller ? remoteId : remoteId); // both clean remoteId now
      }
      if (
        state === "failed" ||
        state === "disconnected" ||
        state === "closed"
      ) {
        setConnStatus("error");
        setConnLabel("connection lost");
        setKeyReady(false);
        setConnectedTo("");
        // ensure refs are cleared so we can accept new incoming offers
        try {
          if (pcRef.current) {
            try {
              pcRef.current.close();
            } catch (_) {}
          }
        } catch (_) {}
        pcRef.current = null;
        dcRef.current = null;
        sharedKeyRef.current = null;
      }
    };

    if (isCaller) {
      // ── CALLER: create data channel, make offer ──
      const dc = pc.createDataChannel("dropvault", { ordered: true });
      dcRef.current = dc;
      setupDataChannel(dc, remoteId, true);

      await createOffer(pc, remoteId, myIdRef.current);
      addLog("offer sent, waiting for answer...", "info");

      // Listen for answer (answer will be written to our own room)
      const unsubAnswer = listenForAnswer(myRoomId, async (answer) => {
        if (pc.remoteDescription) return;
        await pc.setRemoteDescription(new RTCSessionDescription(answer));
        addLog("answer received from " + remoteId, "ok");
      });
      cleanupListeners.current.push(unsubAnswer);

      // Listen for remote ICE candidates (they'll write to our room)
      const unsubIce = listenForIce(myRoomId, "callee", async (c) => {
        try {
          await pc.addIceCandidate(new RTCIceCandidate(c));
        } catch (_) {}
      });
      cleanupListeners.current.push(unsubIce);
    } else {
      // ── CALLEE: set remote offer, create answer ──
      pc.ondatachannel = ({ channel }) => {
        dcRef.current = channel;
        setupDataChannel(channel, remoteId, false);
      };

      await pc.setRemoteDescription(new RTCSessionDescription(incomingOffer));
      await createAnswer(pc, remoteId, myIdRef.current);
      addLog("answer sent to " + remoteId, "ok");

      // Listen for caller's ICE candidates (they write to our room)
      const unsubIce = listenForIce(myRoomId, "caller", async (c) => {
        try {
          await pc.addIceCandidate(new RTCIceCandidate(c));
        } catch (_) {}
      });
      cleanupListeners.current.push(unsubIce);
    }
  }

  // ── Setup data channel events + key exchange ──────────────────────────────
  function setupDataChannel(dc, remoteId, isCaller) {
    dc.binaryType = "arraybuffer";
    let keyPairPromise = genKeyPair();

    dc._remoteId = remoteId;
    dc._isCaller = !!isCaller;

    dc.onopen = async () => {
      addLog("data channel open — sending connect request", "info");
      setConnStatus("connecting");
      setConnLabel("awaiting approval...");
      const kp = await keyPairPromise;
      const pub = await exportPub(kp.publicKey);
      dc._myKeyPair = kp;
      const localFp = await fingerprintFromPub(pub);
      // If we're the initiator, show our local fingerprint so user can read it to remote.
      if (dc._isCaller) {
        setConnModal({ trigger: "outgoing", localFp, dc });
        try {
          dc.send(JSON.stringify({ type: "connect_request", pub }));
          addLog("connect request sent — waiting for remote approval", "info");
        } catch (_) {}
      }
    };

    dc.onmessage = async ({ data }) => {
      if (typeof data === "string") {
        const msg = JSON.parse(data);

        // Handshake messages
        if (msg.type === "connect_request") {
          dc._pendingRemotePub = msg.pub;
          const kp = await (dc._myKeyPair || keyPairPromise);
          const localPub = await exportPub(kp.publicKey);
          const remoteFp = await fingerprintFromPub(msg.pub);
          const localFp = await fingerprintFromPub(localPub);
          setConnModal({
            trigger: "request",
            remotePub: msg.pub,
            remoteFp,
            localFp,
            dc,
          });
          addLog("incoming connect request — verification required", "warn");
        }

        if (msg.type === "connect_accept") {
          dc._pendingRemotePub = msg.pub;
          const kp = await (dc._myKeyPair || keyPairPromise);
          const localPub = await exportPub(kp.publicKey);
          const remoteFp = await fingerprintFromPub(msg.pub);
          const localFp = await fingerprintFromPub(localPub);
          setConnModal({
            trigger: "accept",
            remotePub: msg.pub,
            remoteFp,
            localFp,
            dc,
          });
          addLog("remote accepted — verify fingerprint to complete", "info");
        }

        if (msg.type === "connect_reject") {
          addLog("remote rejected the connection", "warn");
          setConnStatus("error");
          setConnLabel("connection rejected");
          try {
            if (pcRef.current)
              try {
                pcRef.current.close();
              } catch (_) {}
            pcRef.current = null;
            dcRef.current = null;
            sharedKeyRef.current = null;
          } catch (_) {}
          return;
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
            [msg.fileId]: {
              name: msg.name,
              size: msg.size,
              pct: 0,
              done: false,
              url: null,
              saved: false,
            },
          }));
          dc.send(
            JSON.stringify({
              type: "resume_ack",
              fileId: msg.fileId,
              from: resumeFrom,
            }),
          );
          addLog(
            `incoming: ${msg.name} (${formatBytes(msg.size)})${resumeFrom > 0 ? " · resuming" : ""}`,
            "info",
          );
        }

        if (msg.type === "resume_ack") {
          resumeFromRef.current[msg.fileId] = msg.from;
          if (msg.from > 0) addLog("resuming from chunk " + msg.from, "warn");
        }
      } else {
        // Binary chunk
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
        setIncoming((prev) => ({
          ...prev,
          [fileId]: { ...prev[fileId], pct },
        }));
        saveResume("r_" + fileId, fi.got, fi.totalChunks);

        // All chunks received — assemble and download
        if (fi.got >= fi.totalChunks) {
          const buffers = [];
          for (let i = 0; i < fi.totalChunks; i++)
            if (fi.chunks[i]) buffers.push(fi.chunks[i]);
          const blob = new Blob(buffers, {
            type: fi.mimeType || "application/octet-stream",
          });
          const url = URL.createObjectURL(blob);
          // Store URL and mark as received; user can click Save to download
          setIncoming((prev) => ({
            ...prev,
            [fileId]: {
              ...prev[fileId],
              pct: 100,
              done: true,
              url,
              saved: false,
            },
          }));
          clearResume("r_" + fileId);
          addLog(
            "file received: " + fi.name + " · click save to download",
            "ok",
          );
        }
      }
    };

    dc.onclose = () => {
      setKeyReady(false);
      setConnectedTo("");
      setConnStatus("online");
      setConnLabel("ready · " + myIdRef.current);
      // clear data channel ref so new incoming offers are accepted
      dcRef.current = null;
      addLog("data channel closed", "warn");
    };

    dc.onerror = (e) =>
      addLog("data channel error: " + formatRtcError(e), "err");
  }

  // Modal handlers: accept or reject incoming/accepted connection
  async function handleConnAccept() {
    if (!connModal) return;
    const { dc, remotePub, trigger } = connModal;
    try {
      const kp = dc._myKeyPair || (await genKeyPair());
      // derive shared key
      const remotePubKey = await importPub(remotePub);
      const sk = await deriveSharedKey(kp.privateKey, remotePubKey);
      sharedKeyRef.current = sk;
      setKeyReady(true);
      setConnStatus("online");
      setConnLabel("connected · AES-256-GCM ready");
      addLog("session key established — ready to transfer", "ok");

      // If we accepted a request (we're the callee), send connect_accept carrying our pub
      if (trigger === "request") {
        const myPub = await exportPub(kp.publicKey);
        try {
          dc.send(JSON.stringify({ type: "connect_accept", pub: myPub }));
        } catch (_) {}
      }
    } catch (e) {
      addLog("error establishing session key", "err");
    }
    setConnModal(null);
  }

  function handleConnReject() {
    if (!connModal) return;
    const { dc } = connModal;
    try {
      if (dc) dc.send(JSON.stringify({ type: "connect_reject" }));
    } catch (_) {}
    setConnModal(null);
    setConnStatus("error");
    setConnLabel("connection rejected");
    try {
      if (pcRef.current)
        try {
          pcRef.current.close();
        } catch (_) {}
      pcRef.current = null;
      dcRef.current = null;
      sharedKeyRef.current = null;
    } catch (_) {}
    addLog("connection rejected by user", "warn");
  }

  // Disconnect flow
  function requestDisconnect() {
    setDisconnectModal(true);
    setConnectedTo("");
    setRemotePeer("");
  }

  async function handleDisconnectConfirm() {
    setDisconnectModal(false);
    try {
      if (pcRef.current) {
        pcRef.current.close();
      }
      if (dcRef.current) {
        try {
          dcRef.current.close();
        } catch (_) {}
      }
      // ensure refs cleared so incoming offers will be handled
      pcRef.current = null;
      dcRef.current = null;
      sharedKeyRef.current = null;
      // cleanup state
      sharedKeyRef.current = null;
      setKeyReady(false);
      setConnectedTo("");
      setConnStatus("online");
      setConnLabel("ready · " + myIdRef.current);
      addLog("connection closed by user", "warn");
      // attempt to cleanup signaling room for remote
      try {
        if (connectedTo) await cleanupRoom(connectedTo);
      } catch (_) {}
    } catch (e) {
      addLog("error during disconnect", "err");
    }
  }

  function handleDisconnectCancel() {
    setDisconnectModal(false);
  }

  // ── Initiate outgoing connection ──────────────────────────────────────────
  async function connectToPeer() {
    if (!remotePeer.trim()) return;
    const target = remotePeer.trim().toUpperCase();
    addLog("connecting to: " + target, "info");
    setConnStatus("connecting");
    setConnLabel("sending offer...");
    await initConnection(true, myIdRef.current, target);
  }

  // ── File handlers ─────────────────────────────────────────────────────────
  function addFiles(fileList) {
    const items = [...fileList].map((f) => ({ file: f, id: genId() }));
    setFiles((prev) => [...prev, ...items]);
  }

  function removeFile(id) {
    setFiles((prev) => prev.filter((f) => f.id !== id));
    setProgress((prev) => {
      const n = { ...prev };
      delete n[id];
      return n;
    });
  }

  // ── Send all files ────────────────────────────────────────────────────────
  async function sendAll() {
    if (!dcRef.current || !sharedKeyRef.current) return;
    setSending(true);
    let filesSent = 0,
      bytesSent = 0;

    for (const { file, id } of files) {
      const totalChunks = Math.ceil(file.size / CHUNK_SIZE);
      const rs = getResume(id);
      const savedChunk = rs ? rs.n : 0;

      dcRef.current.send(
        JSON.stringify({
          type: "file_meta",
          fileId: id,
          name: file.name,
          size: file.size,
          mtype: file.type,
          total: totalChunks,
        }),
      );

      addLog(
        `sending: ${file.name}${savedChunk > 0 ? " (resume from " + savedChunk + ")" : ""}`,
        "info",
      );
      await new Promise((r) => setTimeout(r, 400));
      const startChunk = resumeFromRef.current[id] ?? savedChunk;
      const t0 = Date.now();

      for (let ci = startChunk; ci < totalChunks; ci++) {
        const raw = await file
          .slice(ci * CHUNK_SIZE, (ci + 1) * CHUNK_SIZE)
          .arrayBuffer();
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
        dcRef.current.send(packet.buffer);

        const elapsed = (Date.now() - t0) / 1000 || 0.001;
        const speed = ((ci - startChunk + 1) * CHUNK_SIZE) / elapsed;
        const pct = Math.round(((ci + 1) / totalChunks) * 100);

        setProgress((prev) => ({
          ...prev,
          [id]: { pct, spd: speed, done: false },
        }));
        setStats((s) => ({ ...s, speed: formatSpeed(speed) }));
        saveResume(id, ci + 1, totalChunks);

        // Yield to browser every 8 chunks to keep UI responsive
        if (ci % 8 === 0) await new Promise((r) => setTimeout(r, 0));
      }

      setProgress((prev) => ({
        ...prev,
        [id]: { pct: 100, spd: 0, done: true },
      }));
      clearResume(id);
      filesSent++;
      bytesSent += file.size;
      setStats({
        sent: filesSent,
        speed: "—",
        total: (bytesSent / 1048576).toFixed(1) + " MB",
      });
      addLog("done: " + file.name, "ok");
    }

    setSending(false);
    addLog("all files transferred", "ok");
  }

  // Save received file (user-triggered)
  function handleSave(fileId) {
    const item = incoming[fileId];
    if (!item || !item.url) return;
    try {
      const a = document.createElement("a");
      a.href = item.url;
      a.download = item.name;
      a.click();
      URL.revokeObjectURL(item.url);
      setIncoming((prev) => ({
        ...prev,
        [fileId]: { ...prev[fileId], saved: true, url: null },
      }));
      addLog("file saved: " + item.name, "ok");
    } catch (e) {
      addLog("error saving file: " + item.name, "err");
    }
  }

  // Save all received files that are ready
  function handleSaveAll() {
    Object.entries(incoming).forEach(([fileId, item]) => {
      if (item && item.done && item.url && !item.saved) {
        try {
          const a = document.createElement("a");
          a.href = item.url;
          a.download = item.name;
          // append/click/remove to ensure consistent behavior
          document.body.appendChild(a);
          a.click();
          a.remove();
          URL.revokeObjectURL(item.url);
          setIncoming((prev) => ({
            ...prev,
            [fileId]: { ...prev[fileId], saved: true, url: null },
          }));
          addLog("file saved: " + item.name, "ok");
        } catch (e) {
          addLog("error saving file: " + item.name, "err");
        }
      }
    });
  }

  function copyId() {
    navigator.clipboard.writeText(myId);
    setCopied(true);
    addLog("peer id copied", "ok");
    setTimeout(() => setCopied(false), 1500);
  }

  // number of received files ready to be saved
  const savableCount = Object.values(incoming).filter(
    (fi) => fi.done && fi.url && !fi.saved,
  ).length;

  const dotColors = {
    online: "#34d399",
    connecting: "#fbbf24",
    error: "#f87171",
    init: "#556",
  };

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="app">
      {/* Header */}
      <header className="header">
        <div className="logo">
          <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
            <path d="M9 2L13 6H10.5V11H7.5V6H5L9 2Z" fill="white" />
            <path
              d="M3 10V15H15V10"
              stroke="white"
              strokeWidth="1.5"
              strokeLinecap="round"
            />
            <path
              d="M6 12.5H12"
              stroke="white"
              strokeWidth="1.5"
              strokeLinecap="round"
            />
          </svg>
        </div>
        <div>
          <h1>DropVault</h1>
          {/* <p className="subtitle">
            P2P · AES-256-GCM · Firebase signaling · No file storage
          </p> */}
        </div>
        <div className="status-bar">
          <div
            className="dot"
            style={{
              background: dotColors[connStatus],
              boxShadow:
                connStatus === "online"
                  ? "0 0 6px #34d399"
                  : connStatus === "connecting"
                    ? "0 0 6px #fbbf24"
                    : "none",
              animation:
                connStatus === "connecting" ? "pulse 1s infinite" : "none",
            }}
          />
          <span>{connLabel}</span>
        </div>
      </header>

      {/* Badges */}
      <div className="badges">
        {[
          {
            label: "AES-256-GCM encrypted",
            color: "#34d399",
            bg: "rgba(52,211,153,0.08)",
          },
          {
            label: "WebRTC P2P",
            color: "#a99fff",
            bg: "rgba(124,111,255,0.08)",
          },
        ].map((b) => (
          <span
            key={b.label}
            className="badge"
            style={{ borderColor: b.color, color: b.color, background: b.bg }}
          >
            {b.label}
          </span>
        ))}
      </div>

      {/* Tabs */}
      <div className="tabs">
        {["send", "receive", "log"].map((t) => (
          <button
            key={t}
            className={`tab ${tab === t ? "active" : ""}`}
            onClick={() => setTab(t)}
          >
            {t}
          </button>
        ))}
      </div>

      {/* SEND TAB */}
      {tab === "send" && (
        <div>
          <div className="card">
            <div className="card-label">your peer id — share with receiver</div>
            <div className="pid-box">
              <code className="pid">{myId || "generating..."}</code>
              <button className="btn" disabled={!myId} onClick={copyId}>
                {copied ? "copied ✓" : "copy"}
              </button>
            </div>
          </div>

          <div className="card">
            <div className="card-label">connect to receiver</div>
            <div className="row">
              <input
                type="text"
                value={remotePeer ? remotePeer : connectedTo}
                onChange={(e) => setRemotePeer(e.target.value.toUpperCase())}
                onKeyDown={(e) => e.key === "Enter" && connectToPeer()}
                placeholder="paste receiver's peer id..."
                style={{ textTransform: "uppercase", letterSpacing: 2 }}
                disabled={!!connectedTo}
              />
              {connectedTo ? (
                <button className="btn-danger" onClick={requestDisconnect}>
                  disconnect
                </button>
              ) : (
                <button
                  className="btn-primary"
                  disabled={!myId || !remotePeer.trim()}
                  onClick={connectToPeer}
                >
                  connect
                </button>
              )}
            </div>
            {connectedTo && (
              <p className="conn-note">
                connected to {connectedTo}{" "}
                {keyReady
                  ? "· AES-256 session active ✓"
                  : "· exchanging keys..."}
              </p>
            )}
          </div>

          <div className="card">
            <div className="card-label">files to send</div>
            <div
              className={`drop-zone ${dragging ? "dragging" : ""}`}
              onDragOver={(e) => {
                e.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragging(false);
                addFiles(e.dataTransfer.files);
              }}
              onClick={() => document.getElementById("file-input").click()}
            >
              <input
                id="file-input"
                type="file"
                multiple
                style={{ display: "none" }}
                onChange={(e) => addFiles(e.target.files)}
              />
              <div className="drop-icon">
                <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
                  <path d="M9 2L13 6H10.5V12H7.5V6H5L9 2Z" fill="#7c6fff" />
                  <path
                    d="M2 14V16H16V14"
                    stroke="#7c6fff"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                  />
                </svg>
              </div>
              <p className="drop-text">
                <span className="drop-accent">drop files here</span> or click to
                browse
              </p>
              <p className="drop-sub">
                multiple files · any size · encrypted locally before sending
              </p>
            </div>

            <div className="file-list">
              {files.map(({ file, id }) => (
                <FileItem
                  key={id}
                  file={file}
                  id={id}
                  prog={progress[id]}
                  onRemove={removeFile}
                />
              ))}
            </div>

            <div className="actions">
              {files.length > 0 && (
                <button
                  className="btn-danger"
                  onClick={() => {
                    setFiles([]);
                    setProgress({});
                  }}
                >
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

      {/* RECEIVE TAB */}
      {tab === "receive" && (
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
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
              }}
            >
              <div className="card-label">incoming transfers</div>
              {savableCount > 0 && (
                <div>
                  <button className="btn-primary" onClick={handleSaveAll}>
                    save all
                  </button>
                </div>
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
                <IncomingItem key={id} fi={fi} onSave={() => handleSave(id)} />
              ))
            )}
          </div>
        </div>
      )}

      {/* LOG TAB */}
      {tab === "log" && <LogView logs={logs} onClear={() => setLogs([])} />}

      {/* Connection verification modal */}
      {connModal && (
        <div className="modal-overlay">
          <div className="modal">
            <h3>
              {connModal.trigger === "outgoing"
                ? "Outgoing connection"
                : "Incoming connection"}
            </h3>
            <p>
              {connModal.trigger === "outgoing"
                ? "Share the following fingerprint with your remote peer so they can verify it. Waiting for their acceptance."
                : "Verify the short fingerprint with your remote peer before accepting."}
            </p>
            <div style={{ display: "flex", gap: 12, marginTop: 8 }}>
              <div style={{ flex: 1 }}>
                <div className="card-label">their fingerprint</div>
                <div style={{ fontFamily: "monospace", marginTop: 6 }}>
                  {connModal.remoteFp || "—"}
                </div>
              </div>
              <div style={{ flex: 1 }}>
                <div className="card-label">your fingerprint</div>
                <div style={{ fontFamily: "monospace", marginTop: 6 }}>
                  {connModal.localFp || "—"}
                </div>
              </div>
            </div>
            <div style={{ marginTop: 12, textAlign: "right" }}>
              <button
                className="btn-danger"
                onClick={handleConnReject}
                style={{ marginRight: 8 }}
              >
                reject
              </button>
              <button className="btn-primary" onClick={handleConnAccept}>
                accept
              </button>
            </div>
          </div>
        </div>
      )}

      {disconnectModal && (
        <div className="modal-overlay">
          <div className="modal">
            <h3>Disconnect</h3>
            <p>
              Are you sure you want to disconnect? This will stop any active
              transfer.
            </p>
            <div style={{ marginTop: 12, textAlign: "right" }}>
              <button
                className="btn"
                onClick={handleDisconnectCancel}
                style={{ marginRight: 8 }}
              >
                cancel
              </button>
              <button className="btn-danger" onClick={handleDisconnectConfirm}>
                disconnect
              </button>
            </div>
          </div>
        </div>
      )}

      <p className="footer">
        only sdp/ice signaling passes through server · no data ever leaves your
        browser unencrypted
      </p>
    </div>
  );
}
