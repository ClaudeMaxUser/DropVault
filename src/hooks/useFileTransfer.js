import { useState, useRef, useCallback } from "react";
import { CHUNK_SIZE } from "../lib/constants";
import { encryptChunk, decryptChunk } from "../lib/crypto";
import { formatBytes, formatSpeed, genId } from "../lib/format";
import {
  saveResume,
  getResume,
  clearResume,
  senderResumeKey,
  receiverResumeKey,
} from "../lib/resume";

export function useFileTransfer({ addLog, dcRef, sharedKeyRef }) {
  const [files, setFiles] = useState([]);
  const [progress, setProgress] = useState({});
  const [incoming, setIncoming] = useState({});
  const [sending, setSending] = useState(false);
  const [stats, setStats] = useState({ sent: 0, speed: "—", total: "0 MB" });

  const incomingDataRef = useRef({});
  const resumeFromRef = useRef({});

  // Called by usePeerConnection whenever a data-channel message arrives
  const handleMessage = useCallback(
    async ({ data }) => {
      if (typeof data === "string") {
        const msg = JSON.parse(data);

        if (msg.type === "file_meta") {
          const rKey = receiverResumeKey(msg.fileId);
          const rs = getResume(rKey);
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
          try {
            dcRef.current?.send(
              JSON.stringify({
                type: "resume_ack",
                fileId: msg.fileId,
                from: resumeFrom,
              }),
            );
          } catch (_) {}
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
        saveResume(receiverResumeKey(fileId), fi.got, fi.totalChunks);

        if (fi.got >= fi.totalChunks) {
          const buffers = [];
          for (let i = 0; i < fi.totalChunks; i++)
            if (fi.chunks[i]) buffers.push(fi.chunks[i]);
          const blob = new Blob(buffers, {
            type: fi.mimeType || "application/octet-stream",
          });
          const url = URL.createObjectURL(blob);
          setIncoming((prev) => ({
            ...prev,
            [fileId]: { ...prev[fileId], pct: 100, done: true, url, saved: false },
          }));
          clearResume(receiverResumeKey(fileId));
          addLog("file received: " + fi.name + " · click save to download", "ok");
        }
      }
    },
    [addLog, dcRef, sharedKeyRef],
  );

  const addFiles = useCallback((fileList) => {
    const items = [...fileList].map((f) => ({ file: f, id: genId() }));
    setFiles((prev) => [...prev, ...items]);
  }, []);

  const removeFile = useCallback((id) => {
    setFiles((prev) => prev.filter((f) => f.id !== id));
    setProgress((prev) => {
      const n = { ...prev };
      delete n[id];
      return n;
    });
  }, []);

  const clearFiles = useCallback(() => {
    setFiles([]);
    setProgress({});
  }, []);

  const sendAll = useCallback(async () => {
    if (!dcRef.current || !sharedKeyRef.current) return;
    setSending(true);
    let filesSent = 0,
      bytesSent = 0;

    for (const { file, id } of files) {
      const totalChunks = Math.ceil(file.size / CHUNK_SIZE);
      // Use stable file-identity key for sender-side resume
      const rKey = senderResumeKey(file);
      const rs = getResume(rKey);
      const savedChunk = rs ? rs.n : 0;

      try {
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
      } catch (e) {
        addLog("error sending file meta for " + file.name, "err");
        continue;
      }

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

        const fidBytes = new TextEncoder().encode(id);
        const header = new ArrayBuffer(1 + fidBytes.length + 4);
        const dvH = new DataView(header);
        dvH.setUint8(0, fidBytes.length);
        fidBytes.forEach((b, i) => dvH.setUint8(1 + i, b));
        dvH.setUint32(1 + fidBytes.length, ci, false);

        const packet = new Uint8Array(header.byteLength + enc.byteLength);
        packet.set(new Uint8Array(header));
        packet.set(new Uint8Array(enc), header.byteLength);

        try {
          dcRef.current.send(packet.buffer);
        } catch (e) {
          addLog("send error at chunk " + ci + " for " + file.name, "err");
          break;
        }

        const elapsed = (Date.now() - t0) / 1000 || 0.001;
        const speed = ((ci - startChunk + 1) * CHUNK_SIZE) / elapsed;
        const pct = Math.round(((ci + 1) / totalChunks) * 100);
        setProgress((prev) => ({ ...prev, [id]: { pct, spd: speed, done: false } }));
        setStats((s) => ({ ...s, speed: formatSpeed(speed) }));
        saveResume(rKey, ci + 1, totalChunks);

        if (ci % 8 === 0) await new Promise((r) => setTimeout(r, 0));
      }

      setProgress((prev) => ({ ...prev, [id]: { pct: 100, spd: 0, done: true } }));
      clearResume(rKey);
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
  }, [files, addLog, dcRef, sharedKeyRef]);

  const handleSave = useCallback(
    (fileId) => {
      const item = incoming[fileId];
      if (!item?.url) return;
      try {
        const a = document.createElement("a");
        a.href = item.url;
        a.download = item.name;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(item.url);
        setIncoming((prev) => ({ ...prev, [fileId]: { ...prev[fileId], saved: true, url: null } }));
        addLog("file saved: " + item.name, "ok");
      } catch (e) {
        addLog("error saving file: " + item.name, "err");
      }
    },
    [incoming, addLog],
  );

  const handleSaveAll = useCallback(() => {
    Object.entries(incoming).forEach(([fileId, item]) => {
      if (item?.done && item.url && !item.saved) {
        try {
          const a = document.createElement("a");
          a.href = item.url;
          a.download = item.name;
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
  }, [incoming, addLog]);

  const savableCount = Object.values(incoming).filter(
    (fi) => fi.done && fi.url && !fi.saved,
  ).length;

  return {
    files,
    progress,
    incoming,
    sending,
    stats,
    savableCount,
    addFiles,
    removeFile,
    clearFiles,
    sendAll,
    handleSave,
    handleSaveAll,
    handleMessage,
  };
}