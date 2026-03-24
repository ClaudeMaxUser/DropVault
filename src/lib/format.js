export function formatBytes(b) {
  if (b < 1024) return b + " B";
  if (b < 1048576) return (b / 1024).toFixed(1) + " KB";
  if (b < 1073741824) return (b / 1048576).toFixed(1) + " MB";
  return (b / 1073741824).toFixed(2) + " GB";
}

export function formatSpeed(bps) {
  if (bps < 1024) return bps.toFixed(0) + " B/s";
  if (bps < 1048576) return (bps / 1024).toFixed(1) + " KB/s";
  return (bps / 1048576).toFixed(1) + " MB/s";
}

export function formatRtcError(e) {
  try {
    if (!e) return String(e);
    const err = e.error || e.detail || e;
    if (!err) return String(e);
    if (typeof err === "string") return err;
    if (typeof err === "object") {
      const parts = [];
      if (err.name) parts.push(err.name);
      if (err.message) parts.push(err.message);
      if (err.code) parts.push("code:" + err.code);
      if (parts.length) return parts.join(" - ");
      try { return err.toString(); } catch (_) { return JSON.stringify(err); }
    }
    if (e.message) return e.message;
    return String(e);
  } catch (_) {
    return "RTC error";
  }
}

export function genId() {
  return Math.random().toString(36).slice(2, 10).toUpperCase();
}

export function nowTime() {
  return new Date().toTimeString().slice(0, 8);
}