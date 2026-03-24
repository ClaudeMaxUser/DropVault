# DropVault

> Serverless P2P file transfer in the browser — WebRTC + AES-256-GCM, no file data ever touches a server.

![WebRTC](https://img.shields.io/badge/WebRTC-P2P-blue) ![AES-256-GCM](https://img.shields.io/badge/AES--256--GCM-E2EE-34d399) ![React](https://img.shields.io/badge/React-18-61dafb) ![Vite](https://img.shields.io/badge/Vite-5-646cff)

**[Live demo →]()**

---

## What it does

DropVault lets two people transfer files directly between their browsers — no accounts, no cloud storage, no upload limits. Files are encrypted in the browser before they leave, decrypted only at the other end, and no file data ever passes through a server.

The only server involved is Firebase Realtime Database, used purely as a temporary rendezvous to exchange the WebRTC handshake (SDP offer/answer and ICE candidates). Once the connection is established, Firebase is no longer in the loop and the signaling data is deleted.

---

## Technical highlights

**End-to-end encryption**
Each session generates a fresh ECDH (P-256) keypair. The two peers exchange public keys over the DataChannel, then derive a 256-bit AES-GCM session key using HKDF with a domain-separation string (`DropVault-AES-Session`). Every 64 KB chunk is encrypted with a random IV before it leaves the sender's browser. The server never sees plaintext.

**Fingerprint verification**
Both peers are shown a short fingerprint of each other's public key (first 8 bytes of SHA-256, formatted as `XX:XX:XX:XX:XX:XX:XX:XX`). Comparing these out-of-band (voice, in-person) defeats a man-in-the-middle who substitutes their own key during the exchange. Incoming requests auto-reject after 30 seconds if left unattended.

**Transfer resume**
Progress is checkpointed to `localStorage` using a key derived from `filename + size + lastModified`. If either peer reloads mid-transfer, the transfer picks up from the last confirmed chunk rather than restarting from zero.

**Zero server storage**
Firebase only ever holds SDP and ICE data (a few hundred bytes per session, TTL 24h). No file content, no keys, no metadata.

---

## Architecture

```
src/
├── App.jsx                      # Root shell — wires hooks to components (~80 lines)
├── firebase.js                  # Firebase init
│
├── lib/                         # Pure utilities, no React dependency
│   ├── constants.js             # RTC config, chunk size
│   ├── crypto.js                # ECDH, HKDF, AES-GCM, fingerprinting
│   ├── signaling.js             # Firebase read/write helpers
│   ├── resume.js                # localStorage checkpoint helpers
│   └── format.js                # Bytes, speed, IDs, error formatting
│
├── hooks/                       # React logic — no JSX
│   ├── usePeerConnection.js     # WebRTC setup, ICE, key exchange, modals
│   ├── useFileTransfer.js       # Chunking, encryption, send/receive
│   └── useLogs.js               # Activity log state
│
└── components/                  # Presentational UI
    ├── Header.jsx
    ├── SendTab.jsx
    ├── ReceiveTab.jsx
    ├── FileItem.jsx
    ├── IncomingItem.jsx
    ├── ConnectModal.jsx          # Fingerprint verification + countdown
    ├── DisconnectModal.jsx
    ├── LogView.jsx
    └── StatBar.jsx
```

The full connection handshake, key derivation, and chunk packet layout are documented in [PROTOCOL.md](PROTOCOL.md).

---

## Getting started

**Requirements:** Node 18+, a browser with WebRTC and SubtleCrypto support (all modern browsers).

```bash
npm install
npm run dev
```

```bash
# Production build
npm run build
npm run preview
```

**Firebase setup:** Create a Realtime Database, copy your config into `src/firebase.js`, and set read/write rules that allow unauthenticated access to `rooms/` (or scope it as needed). The app writes only SDP/ICE data — there is nothing sensitive in Firebase.

---

## How a transfer works

1. Each peer gets a short random ID on load (`XXXXXXXX`).
2. The sender enters the receiver's ID and clicks Connect. An SDP offer is written to `rooms/{receiverId}` in Firebase.
3. The receiver's browser picks up the offer, writes an SDP answer, and ICE candidates are exchanged. Firebase is no longer involved once the DataChannel opens.
4. Both peers generate ephemeral ECDH keypairs and exchange public keys over the DataChannel.
5. Each peer derives the same AES-256-GCM session key via HKDF. Both are shown fingerprints to verify out-of-band.
6. The sender slices files into 64 KB chunks, encrypts each with a fresh IV, and streams them over the DataChannel.
7. The receiver decrypts and reassembles chunks into a Blob. A Save button triggers a local download — nothing is auto-written to disk.

---

## Security properties

| Property | Mechanism |
|---|---|
| Confidentiality | AES-256-GCM per chunk; server never sees plaintext |
| Integrity | AES-GCM authentication tag per chunk |
| Forward secrecy | Ephemeral ECDH keypairs, no persistent keys |
| MITM resistance | Out-of-band fingerprint verification |
| Signaling privacy | Only SDP/ICE (no content) passes through Firebase |

**Limitations:** Endpoint compromise, skipped fingerprint verification, and Firebase admin access to SDP data are out of scope. See [PROTOCOL.md](PROTOCOL.md) for the full threat model.

---

## License

MIT