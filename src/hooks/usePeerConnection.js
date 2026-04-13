import { useEffect, useRef, useState, useCallback } from "react";
import { RTC_CONFIG } from "../lib/constants";
import {
  genKeyPair,
  exportPub,
  importPub,
  deriveSharedKey,
  fingerprintFromPub,
} from "../lib/crypto";
import {
  createOffer,
  createAnswer,
  listenForOffer,
  listenForIce,
  listenForAnswer,
  sendIceCandidate,
  cleanupRoom,
  cleanupStaleRooms,
} from "../lib/signaling";
import { genId, formatRtcError } from "../lib/format";

const OFFER_TIMEOUT_MS = 30_000; // 30 s before we give up waiting for an answer

export function usePeerConnection({ addLog, onMessage }) {
  const [myId, setMyId] = useState("");
  const [connStatus, setConnStatus] = useState("init");
  const [connLabel, setConnLabel] = useState("generating id...");
  const [connectedTo, setConnectedTo] = useState("");
  const [keyReady, setKeyReady] = useState(false);
  const [connModal, setConnModal] = useState(null);
  const [disconnectModal, setDisconnectModal] = useState(false);

  const pcRef = useRef(null);
  const dcRef = useRef(null);
  const sharedKeyRef = useRef(null);
  // Use a ref for connectedTo so cleanup closures always see the current value
  const connectedToRef = useRef("");
  const myIdRef = useRef("");
  // Accumulate unsub functions per connection, replaced on each new connection
  const connListeners = useRef([]);
  // Permanent listeners (e.g. incoming offer on our own room)
  const permanentListeners = useRef([]);

  // Keep ref in sync with state
  const setConnectedToSync = useCallback((id) => {
    connectedToRef.current = id;
    setConnectedTo(id);
  }, []);

  // ── Init peer ID + offer listener ──────────────────────────────────────────
  useEffect(() => {
    const id = genId();
    myIdRef.current = id;
    setMyId(id);
    setConnStatus("online");
    setConnLabel("ready · " + id);
    addLog("your peer id: " + id, "ok");

    // Best-effort stale room cleanup on startup
    cleanupStaleRooms().catch(() => {});

    const unsub = listenForOffer(id, async (offer) => {
      if (pcRef.current) return;
      addLog("incoming connection from " + offer.from, "info");
      await initConnection(false, id, offer.from, offer);
    });
    permanentListeners.current.push(unsub);

    const onBeforeUnload = () => {
      try {
        cleanupRoom(myIdRef.current).catch(() => {});
      } catch (_) {}
    };
    window.addEventListener("beforeunload", onBeforeUnload);

    return () => {
      permanentListeners.current.forEach((fn) => fn());
      permanentListeners.current = [];
      connListeners.current.forEach((fn) => fn());
      connListeners.current = [];
      window.removeEventListener("beforeunload", onBeforeUnload);
      if (pcRef.current) {
        try {
          pcRef.current.close();
        } catch (_) {}
      }
      try {
        cleanupRoom(id).catch(() => {});
      } catch (_) {}
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Tear down connection state ─────────────────────────────────────────────
  function teardown(reason = "warn") {
    connListeners.current.forEach((fn) => fn());
    connListeners.current = [];
    if (pcRef.current) {
      try {
        pcRef.current.close();
      } catch (_) {}
      pcRef.current = null;
    }
    dcRef.current = null;
    sharedKeyRef.current = null;
    setKeyReady(false);
    setConnectedToSync("");
    setConnStatus("online");
    setConnLabel("ready · " + myIdRef.current);
    if (reason) addLog("connection closed", reason);
  }

  // ── Init RTCPeerConnection ─────────────────────────────────────────────────
  async function initConnection(
    isCaller,
    myRoomId,
    remoteId,
    incomingOffer = null,
  ) {
    // Replace per-connection listeners on each new connection attempt
    connListeners.current.forEach((fn) => fn());
    connListeners.current = [];

    const pc = new RTCPeerConnection(RTC_CONFIG);
    pcRef.current = pc;

    pc.onicecandidate = ({ candidate }) => {
      if (candidate) {
        // Log candidate types for debugging
        const ctype = candidate.candidate.includes("relay")
          ? "relay"
          : candidate.candidate.includes("srflx")
            ? "srflx"
            : candidate.candidate.includes("host")
              ? "host"
              : "unknown";
        addLog(`ICE candidate: ${ctype}`, ctype === "relay" ? "ok" : "info");
        sendIceCandidate(remoteId, isCaller ? "caller" : "callee", candidate);
      } else {
        addLog("ICE gathering complete", "info");
      }
    };

    pc.onicegatheringstatechange = () => {
      addLog("ICE gathering: " + pc.iceGatheringState, "info");
    };

    pc.oniceconnectionstatechange = () => {
      const state = pc.iceConnectionState;
      if (state === "failed") {
        addLog("ICE connection failed — NAT/firewall may be blocking", "err");
      } else if (state === "checking") {
        addLog("ICE: checking connectivity...", "info");
      } else if (state === "connected" || state === "completed") {
        addLog("ICE: " + state, "ok");
      }
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
        setConnectedToSync(remoteId);
        try {
          cleanupRoom(remoteId).catch(() => {});
        } catch (_) {}
        try {
          cleanupRoom(myRoomId).catch(() => {});
        } catch (_) {}
      }
      if (
        state === "failed" ||
        state === "disconnected" ||
        state === "closed"
      ) {
        teardown("err");
      }
    };

    if (isCaller) {
      const dc = pc.createDataChannel("dropvault", { ordered: true });
      dcRef.current = dc;
      setupDataChannel(dc, remoteId, true);

      await createOffer(pc, remoteId, myIdRef.current);
      addLog("offer sent, waiting for answer...", "info");

      const unsubAnswer = listenForAnswer(myRoomId, async (answer) => {
        if (pc.remoteDescription) return;
        clearTimeout(offerTimer);
        await pc.setRemoteDescription(new RTCSessionDescription(answer));
        addLog("answer received from " + remoteId, "ok");
      });
      connListeners.current.push(unsubAnswer);

      // Give up if no answer arrives within the timeout window
      const offerTimer = setTimeout(() => {
        if (!pc.remoteDescription) {
          addLog("no answer received — connection timed out", "err");
          teardown("err");
        }
      }, OFFER_TIMEOUT_MS);

      const unsubIce = listenForIce(myRoomId, "callee", async (c) => {
        try {
          await pc.addIceCandidate(new RTCIceCandidate(c));
        } catch (_) {}
      });
      connListeners.current.push(unsubIce);
    } else {
      pc.ondatachannel = ({ channel }) => {
        dcRef.current = channel;
        setupDataChannel(channel, remoteId, false);
      };
      await pc.setRemoteDescription(new RTCSessionDescription(incomingOffer));
      await createAnswer(pc, remoteId, myIdRef.current);
      addLog("answer sent to " + remoteId, "ok");

      const unsubIce = listenForIce(myRoomId, "caller", async (c) => {
        try {
          await pc.addIceCandidate(new RTCIceCandidate(c));
        } catch (_) {}
      });
      connListeners.current.push(unsubIce);
    }
  }

  // ── Data channel setup + key exchange ─────────────────────────────────────
  function setupDataChannel(dc, remoteId, isCaller) {
    dc.binaryType = "arraybuffer";
    let keyPairPromise = genKeyPair();

    dc._remoteId = remoteId;
    dc._isCaller = !!isCaller;

    dc.onopen = async () => {
      addLog("data channel open — initiating key exchange", "info");
      setConnStatus("connecting");
      setConnLabel("awaiting approval...");
      const kp = await keyPairPromise;
      dc._myKeyPair = kp;
      const pub = await exportPub(kp.publicKey);
      const localFp = await fingerprintFromPub(pub);

      if (dc._isCaller) {
        // Caller sends connect_request and immediately shows their own fingerprint.
        // The "their fingerprint" slot stays "—" until connect_accept arrives with the
        // remote public key — fixed in the accept handler below.
        try {
          dc.send(JSON.stringify({ type: "connect_request", pub }));
          addLog("connect request sent — waiting for remote approval", "info");
        } catch (_) {}
        setConnModal({ trigger: "outgoing", localFp, remoteFp: null, dc });
      }
    };

    dc.onmessage = async ({ data }) => {
      if (typeof data === "string") {
        const msg = JSON.parse(data);

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
          // Now we have both fingerprints — update the modal that was already open
          setConnModal((prev) =>
            prev
              ? {
                  ...prev,
                  trigger: "accept",
                  remotePub: msg.pub,
                  remoteFp,
                  localFp,
                }
              : {
                  trigger: "accept",
                  remotePub: msg.pub,
                  remoteFp,
                  localFp,
                  dc,
                },
          );
          addLog("remote accepted — verify fingerprint to complete", "info");
        }

        if (msg.type === "connect_reject") {
          addLog("remote rejected the connection", "warn");
          setConnModal(null);
          teardown("err");
          return;
        }

        // Pass all other string messages to the consumer (useFileTransfer)
        onMessage?.({ data });
      } else {
        // Binary chunk — pass through
        onMessage?.({ data });
      }
    };

    dc.onclose = () => {
      addLog("data channel closed", "warn");
      teardown(null);
    };

    dc.onerror = (e) =>
      addLog("data channel error: " + formatRtcError(e), "err");
  }

  // ── Modal handlers ─────────────────────────────────────────────────────────
  const handleConnAccept = useCallback(async () => {
    if (!connModal) return;
    const { dc, remotePub } = connModal;
    try {
      const kp = dc._myKeyPair || (await genKeyPair());
      const remotePubKey = await importPub(remotePub);
      const sk = await deriveSharedKey(kp.privateKey, remotePubKey);
      sharedKeyRef.current = sk;
      setKeyReady(true);
      setConnStatus("online");
      setConnLabel("connected · AES-256-GCM ready");
      addLog("session key established — ready to transfer", "ok");

      if (connModal.trigger === "request") {
        const myPub = await exportPub(kp.publicKey);
        try {
          dc.send(JSON.stringify({ type: "connect_accept", pub: myPub }));
        } catch (_) {}
      }
    } catch (e) {
      if (import.meta.env.DEV) console.error("key establishment error:", e);
      addLog("error establishing session key", "err");
    }
    setConnModal(null);
  }, [connModal, addLog]);

  const handleConnReject = useCallback(() => {
    if (!connModal) return;
    const { dc } = connModal;
    try {
      if (dc) dc.send(JSON.stringify({ type: "connect_reject" }));
    } catch (_) {}
    setConnModal(null);
    addLog("connection rejected by user", "warn");
    teardown("warn");
  }, [connModal, addLog]);

  const requestDisconnect = useCallback(() => {
    setDisconnectModal(true);
  }, []);

  const handleDisconnectConfirm = useCallback(async () => {
    setDisconnectModal(false);
    const remoteId = connectedToRef.current;
    teardown("warn");
    if (remoteId) {
      try {
        await cleanupRoom(remoteId);
      } catch (_) {}
    }
    try {
      await cleanupRoom(myIdRef.current);
    } catch (_) {}
    addLog("disconnected by user", "warn");
  }, [addLog]);

  const handleDisconnectCancel = useCallback(() => {
    setDisconnectModal(false);
  }, []);

  const connectToPeer = useCallback(
    async (remotePeer) => {
      if (!remotePeer.trim()) return;
      const target = remotePeer.trim().toUpperCase();
      addLog("connecting to: " + target, "info");
      setConnStatus("connecting");
      setConnLabel("sending offer...");
      await initConnection(true, myIdRef.current, target);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    },
    [addLog],
  );

  return {
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
  };
}
