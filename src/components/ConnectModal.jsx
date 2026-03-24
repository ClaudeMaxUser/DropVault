import { useEffect, useRef, useState } from "react";

const INCOMING_TIMEOUT = 45;

export default function ConnectModal({ connModal, onAccept, onReject }) {
  const [secondsLeft, setSecondsLeft] = useState(INCOMING_TIMEOUT);
  const timerRef = useRef(null);
  const isIncomingRequest = connModal?.trigger === "request";

  // Run countdown only for incoming requests. Reset whenever a fresh
  // "request" trigger appears (i.e. a new incoming connection).
  useEffect(() => {
    if (!isIncomingRequest) {
      clearInterval(timerRef.current);
      setSecondsLeft(INCOMING_TIMEOUT);
      return;
    }

    setSecondsLeft(INCOMING_TIMEOUT);
    timerRef.current = setInterval(() => {
      setSecondsLeft((s) => {
        if (s <= 1) {
          clearInterval(timerRef.current);
          onReject();
          return 0;
        }
        return s - 1;
      });
    }, 1000);

    return () => clearInterval(timerRef.current);
    // onReject is stable (useCallback) — safe to include
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isIncomingRequest, connModal?.trigger]);

  if (!connModal) return null;

  const isOutgoing = connModal.trigger === "outgoing";
  const waitingForRemote = isOutgoing && !connModal.remoteFp;

  // SVG ring math
  const radius = 11;
  const circumference = 2 * Math.PI * radius;
  const dashOffset = circumference * (1 - secondsLeft / INCOMING_TIMEOUT);
  // Colour shifts amber → red in the last 10 seconds
  const ringColor = secondsLeft <= 10 ? "#f87171" : "#00d4c8";

  return (
    <div className="modal-overlay">
      <div className="modal">
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <h3 style={{ margin: 0 }}>
            {isOutgoing ? "Outgoing connection" : "Incoming connection"}
          </h3>

          {/* Countdown ring — only visible for incoming requests */}
          {isIncomingRequest && (
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <svg width="30" height="30" viewBox="0 0 30 30" style={{ transform: "rotate(-90deg)" }}>
                {/* Track */}
                <circle
                  cx="15" cy="15" r={radius}
                  fill="none"
                  stroke="rgba(128,128,128,0.2)"
                  strokeWidth="2.5"
                />
                {/* Progress arc */}
                <circle
                  cx="15" cy="15" r={radius}
                  fill="none"
                  stroke={ringColor}
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeDasharray={circumference}
                  strokeDashoffset={dashOffset}
                  style={{ transition: "stroke-dashoffset 0.9s linear, stroke 0.3s" }}
                />
              </svg>
              <span style={{
                fontVariantNumeric: "tabular-nums",
                fontSize: 13,
                color: ringColor,
                minWidth: 22,
                transition: "color 0.3s",
              }}>
                {secondsLeft}s
              </span>
            </div>
          )}
        </div>

        <p style={{ marginTop: 10 }}>
          {waitingForRemote
            ? "Request sent. Waiting for the remote peer to accept..."
            : isOutgoing
              ? "Remote peer accepted. Compare fingerprints out-of-band before proceeding."
              : `Verify the fingerprint matches what the sender sees, then accept. Auto-rejects in ${secondsLeft}s.`}
        </p>

        <div style={{ display: "flex", gap: 12, marginTop: 8 }}>
          <div style={{ flex: 1 }}>
            <div className="card-label">their fingerprint</div>
            <div style={{ fontFamily: "monospace", marginTop: 6, letterSpacing: 1 }}>
              {connModal.remoteFp || "—"}
            </div>
          </div>
          <div style={{ flex: 1 }}>
            <div className="card-label">your fingerprint</div>
            <div style={{ fontFamily: "monospace", marginTop: 6, letterSpacing: 1 }}>
              {connModal.localFp || "—"}
            </div>
          </div>
        </div>

        <div style={{ marginTop: 12, textAlign: "right" }}>
          {waitingForRemote ? (
            <button className="btn-danger" onClick={onReject}>cancel</button>
          ) : (
            <>
              <button className="btn-danger" onClick={onReject} style={{ marginRight: 8 }}>
                reject
              </button>
              <button className="btn-primary" onClick={onAccept}>
                accept
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}