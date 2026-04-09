# DropVault Protocol

DropVault transfers files directly between two browsers using WebRTC. No file data ever touches a server. This document describes exactly how the connection, key exchange, and transfer work.

---

## Overview

```
Peer A (sender)                Firebase (signaling only)             Peer B (receiver)
      |                                   |                                  |
      |--- SDP offer ------------------> [ ]                                 |
      |                                  [ ] <--- peer B reads offer --------|
      |                                  [ ] --- peer B writes answer -----> |
      | <-- SDP answer ----------------[ ]                                   |
      |<----------- ICE candidates (both directions) ----------------------->|
      |                                                                      |
      |<====================== direct WebRTC DataChannel ===================>|
      |                  (no more Firebase involvement)                      |
```

Once the DataChannel is open, Firebase is no longer used. All further communication — key exchange, file metadata, encrypted file chunks — flows directly peer-to-peer.

---

## Phase 1 — WebRTC Signaling (via Firebase)

WebRTC requires peers to exchange _session descriptions_ (SDP) and _ICE candidates_ before a direct connection can be established. DropVault uses Firebase Realtime Database as a temporary rendezvous point for this exchange only.

**Data written to Firebase:**

| Path                            | Content                                  | Written by        |
| ------------------------------- | ---------------------------------------- | ----------------- |
| `rooms/{receiverId}/offer`      | SDP offer + sender's peer ID + timestamp | Sender (caller)   |
| `rooms/{receiverId}/answer`     | SDP answer                               | Receiver (callee) |
| `rooms/{receiverId}/ice_caller` | ICE candidates from sender               | Sender            |
| `rooms/{receiverId}/ice_callee` | ICE candidates from receiver             | Receiver          |

All signaling data is deleted from Firebase as soon as the WebRTC connection reaches `connected` state. Rooms older than 24 hours are also cleaned up on app startup.

**No file data, no keys, no fingerprints are ever written to Firebase.**

---

## Phase 2 — Key Exchange (over the DataChannel)

Once the DataChannel is open, the two peers perform an authenticated key exchange using ECDH over P-256. The derived key is used for all subsequent encryption.

### Step-by-step

```
Sender                                        Receiver
  |                                               |
  |-- connect_request { pub: senderPubKeyB64 } -->|
  |                                               | (receiver sees incoming request modal)
  |                                               | (receiver verifies fingerprint out-of-band)
  |                                               | (receiver clicks Accept)
  |<-- connect_accept { pub: receiverPubKeyB64 } -|
  |                                               |
  | (sender sees accept modal with both fps)      |
  | (sender verifies fingerprint out-of-band)     |
  | (sender clicks Accept)                        |
  |                                               |
  Both peers derive the same AES-256-GCM key      |
```

### Key derivation

Raw ECDH shared secret bytes are never used directly as an encryption key. Instead, HKDF (RFC 5869) is used to derive a domain-separated AES-GCM key:

```
sharedSecret  = ECDH(senderPriv, receiverPub)
                = ECDH(receiverPriv, senderPub)   ← same value on both sides

hkdfKey       = HKDF-Extract(salt=0x00…00, ikm=sharedSecret)

sessionKey    = HKDF-Expand(
                  prk   = hkdfKey,
                  info  = "DropVault-AES-Session",
                  hash  = SHA-256,
                  len   = 256 bits
                )
```

The `info` string provides domain separation — the same ECDH keypairs used in a different application or context will produce a different key.

### Fingerprint verification

Each peer computes a short fingerprint of their own public key:

```
fingerprint = first 8 bytes of SHA-256(spki-encoded public key)
            = formatted as XX:XX:XX:XX:XX:XX:XX:XX
```

Both peers are shown _their own_ fingerprint and _the remote_ fingerprint side-by-side in the verification modal. They are expected to compare these out-of-band (voice call, in-person) before clicking Accept. This prevents a man-in-the-middle from substituting their own public key during the exchange.

---

## Phase 3 — File Transfer (encrypted chunks)

Once the session key is established, files are split into 64 KB chunks, encrypted individually, and sent over the DataChannel.

### Metadata message (JSON)

Before any binary data, the sender transmits a JSON metadata frame:

```json
{
  "type": "file_meta",
  "fileId": "A1B2C3D4",
  "name": "report.pdf",
  "size": 4194304,
  "mtype": "application/pdf",
  "total": 64
}
```

The receiver responds with a `resume_ack` indicating which chunk to start from (0 for a fresh transfer, N for a resume):

```json
{ "type": "resume_ack", "fileId": "A1B2C3D4", "from": 0 }
```

### Binary chunk packet layout

```
[ 1 byte  ] fileId length (L)
[ L bytes ] fileId (UTF-8)
[ 4 bytes ] chunk index (big-endian uint32)
[ N bytes ] encrypted chunk payload
```

### Chunk encryption

Each 64 KB chunk is encrypted independently with AES-256-GCM:

```
iv         = 12 random bytes (crypto.getRandomValues)
ciphertext = AES-GCM-Encrypt(key=sessionKey, iv=iv, plaintext=chunk)
payload    = iv || ciphertext
```

The IV is prepended to the ciphertext so the receiver can extract it. Because each chunk uses a fresh random IV, IV reuse is not possible even across very large files.

### Resume support

The sender saves progress to `localStorage` using a key derived from `filename + size + lastModified`. The receiver saves progress using the `fileId` assigned by the sender. If either peer reloads mid-transfer, the transfer resumes from the last confirmed chunk rather than restarting.

---

## Security properties

| Property          | Mechanism                                            |
| ----------------- | ---------------------------------------------------- |
| Confidentiality   | AES-256-GCM per chunk, session key derived via HKDF  |
| Integrity         | AES-GCM authentication tag rejects tampered chunks   |
| Forward secrecy   | Ephemeral ECDH keypairs generated fresh each session |
| MITM resistance   | Out-of-band fingerprint verification                 |
| Signaling privacy | Only SDP/ICE (no content) touches Firebase           |

---

## What this does NOT protect against

- **Compromised endpoint**: if the browser or OS is compromised, plaintext is accessible before encryption.
- **Skipped fingerprint verification**: users who click Accept without comparing fingerprints out-of-band lose the MITM protection.
- **Firebase account access**: a Firebase admin could observe SDP/ICE data, but this contains no file content or encryption keys.

---

## Firebase Signaling & Security

DropVault uses Firebase Realtime Database only for WebRTC signaling (SDP and ICE). Because the client-side app is public, follow these recommendations to reduce abuse and privacy risk.

- **Preferred: Server-side cleanup.** Run a scheduled Cloud Function to delete rooms older than 10 hours. This allows you to deny collection-level reads on `/rooms` in your rules (prevents enumeration) while still cleaning stale data.
- **Enable App Check.** Enforce Firebase App Check to stop unauthorized scripted clients from writing to your database.
- **Harden rules (summary):**
  - Deny collection-level `.read` on `/rooms` when possible; allow reads only at `rooms/$roomId`.
  - Validate `$roomId` format (e.g. `^[A-Z0-9]{8}$`).
  - Enforce offer/answer payload shape and types (require `sdp`, `type`, `from`, `ts`) and reasonable size limits (e.g. SDP < 10 KB).
  - Prefer write-once semantics for `offer`/`answer` (allow writes only when `!data.exists()`), if your reconnection flow permits.
  - Validate `ice_caller` / `ice_callee` children and limit candidate field lengths.
- **If you keep client-side cleanup:** you may need collection-level read access so clients can enumerate rooms to remove stale entries — accept the enumeration risk or move cleanup server-side.

Example (concise rules snippet):

```json
{
  "rules": {
    "rooms": {
      ".read": false,
      "$roomId": {
        ".validate": "$roomId.matches(/^[A-Z0-9]{8}$/)",
        "offer": { ".write": true, ".validate": "newData.hasChildren(['sdp','type','from','ts'])" },
        "answer": { ".write": true, ".validate": "newData.hasChildren(['sdp','type','from','ts'])" },
        "ice_caller": { ".write": true },
        "ice_callee": { ".write": true }
      }
    }
  }
}
```

