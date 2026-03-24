# DropVault

DropVault is a lightweight browser client for secure, ad-hoc peer-to-peer file transfers.

Designed for quick, private transfers between browsers, DropVault focuses on simplicity, strong per-transfer encryption, and zero server-side file storage.

Highlights

- Peer-to-peer transfers over WebRTC data channels — files travel directly between peers when possible.
- End-to-end encryption: ephemeral ECDH (P-256) key exchange with AES-256-GCM for chunk encryption.
- Resumable, chunked transfers (64 KiB chunks) to support large files and improve UX.
- Minimal server role: Firebase Realtime Database is used only for SDP/ICE signaling; file contents are never sent to the server.

This repo contains the client implementation (see `src/DropVault.jsx`) and a simple Firebase signaling setup (`src/firebase.js`).

## Quick start

Requirements: Node 18+ (or use `nvm`) and a browser that supports WebRTC and SubtleCrypto.

Install and run in development:

```bash
npm install
npm run dev
```

Build for production:

```bash
npm run build
npm run preview
```

## Try it / Live demo

- Live demo:

## Disclaimer

This software is provided "as-is" without any warranty. The author is not responsible for any damages, data loss, or other consequences arising from the use of this software. Use at your own risk.

## Who is this for

- People who need a fast, private way to transfer files between devices without uploading to cloud storage.

## How it works (brief)

1. Each client gets a short random peer id on start.
2. Caller writes SDP offer and ICE to Firebase under `rooms/{peerId}` for signaling.
3. Callee answers; ICE is exchanged and a direct WebRTC data channel is established.
4. Peers perform an ECDH key exchange over the data channel and (optionally) verify short fingerprints shown in the UI.
5. A symmetric AES-256-GCM session key is derived and used to encrypt each chunk before sending.
6. Receiver decrypts and reassembles chunks into a Blob which can be saved locally.

Files in this project to review:

- Core logic: `src/DropVault.jsx`
- Firebase init: `src/firebase.js`
- Styling and UI: `src/App.css`, `src/index.css`

## Security posture (what's protected)

- Confidentiality: File contents are encrypted end-to-end with AES-GCM; the server never sees plaintext file data.
- Integrity: AES-GCM provides authenticated encryption per-chunk.
- Ephemeral keys: ECDH keys are generated per session — there is no persistent key on the server.

These characteristics make DropVault suitable for private, short-lived transfers where both endpoints are controlled by users.
