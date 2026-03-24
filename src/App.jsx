import { useState, useEffect } from "react";
import Header from "./components/Header";
import SendTab from "./components/SendTab";
import ReceiveTab from "./components/ReceiveTab";
import LogView from "./components/LogView";
import ConnectModal from "./components/ConnectModal";
import DisconnectModal from "./components/DisconnectModal";
import { useLogs } from "./hooks/useLogs";
import { usePeerConnection } from "./hooks/usePeerConnection";
import { useFileTransfer } from "./hooks/useFileTransfer";

export default function App() {
  const [tab, setTab] = useState("send");

  const [theme, setTheme] = useState(() => {
    try {
      const stored = localStorage.getItem("dv_theme");
      if (stored) return stored;
      return window.matchMedia?.("(prefers-color-scheme: light)").matches
        ? "light"
        : "dark";
    } catch (_) {
      return "dark";
    }
  });

  useEffect(() => {
    try {
      document.documentElement.setAttribute("data-theme", theme);
      localStorage.setItem("dv_theme", theme);
    } catch (_) {}
  }, [theme]);

  const { logs, addLog, clearLogs } = useLogs();

  const {
    myId,
    connStatus,
    connLabel,
    connectedTo,
    keyReady,
    connModal,
    disconnectModal,
    dcRef,
    sharedKeyRef,
    connectToPeer,
    requestDisconnect,
    handleConnAccept,
    handleConnReject,
    handleDisconnectConfirm,
    handleDisconnectCancel,
  } = usePeerConnection({
    addLog,
    onMessage: (e) => handleMessage(e),
  });

  const {
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
  } = useFileTransfer({ addLog, dcRef, sharedKeyRef });

  // Lock body scroll when a modal is open
  useEffect(() => {
    document.body.style.overflow = connModal || disconnectModal ? "hidden" : "";
    return () => { document.body.style.overflow = ""; };
  }, [connModal, disconnectModal]);

  return (
    <div className="app">
      <Header
        connStatus={connStatus}
        connLabel={connLabel}
        theme={theme}
        onToggleTheme={() => setTheme((t) => (t === "dark" ? "light" : "dark"))}
      />

      <div className="badges">
        {[
          { label: "AES-256-GCM encrypted", color: "#34d399", bg: "rgba(52,211,153,0.08)" },
          { label: "WebRTC P2P", color: "#1a9e2c", bg: "rgba(124,111,255,0.08)" },
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

      {tab === "send" && (
        <SendTab
          myId={myId}
          connectedTo={connectedTo}
          keyReady={keyReady}
          files={files}
          progress={progress}
          sending={sending}
          stats={stats}
          onAddFiles={addFiles}
          onRemoveFile={removeFile}
          onClearFiles={clearFiles}
          onSendAll={sendAll}
          onConnect={connectToPeer}
          onDisconnect={requestDisconnect}
        />
      )}

      {tab === "receive" && (
        <ReceiveTab
          myId={myId}
          connectedTo={connectedTo}
          keyReady={keyReady}
          incoming={incoming}
          savableCount={savableCount}
          onSave={handleSave}
          onSaveAll={handleSaveAll}
        />
      )}

      {tab === "log" && <LogView logs={logs} onClear={clearLogs} />}

      <ConnectModal
        connModal={connModal}
        onAccept={handleConnAccept}
        onReject={handleConnReject}
      />

      <DisconnectModal
        open={disconnectModal}
        onConfirm={handleDisconnectConfirm}
        onCancel={handleDisconnectCancel}
      />

      <p className="footer">
        only sdp/ice signaling passes through server · no data ever leaves your browser unencrypted
      </p>
    </div>
  );
}
