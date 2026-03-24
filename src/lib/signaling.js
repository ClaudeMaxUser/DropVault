import { ref, set, onValue, push, remove, off, get } from "firebase/database";
import { db } from "../firebase";

export async function createOffer(pc, roomId, myId) {
  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  await set(ref(db, `rooms/${roomId}/offer`), {
    sdp: offer.sdp,
    type: offer.type,
    from: myId,
    ts: Date.now(),
  });
}

export async function createAnswer(pc, roomId, myId) {
  const answer = await pc.createAnswer();
  await pc.setLocalDescription(answer);
  await set(ref(db, `rooms/${roomId}/answer`), {
    sdp: answer.sdp,
    type: answer.type,
    from: myId,
    ts: Date.now(),
  });
}

export function listenForAnswer(roomId, callback) {
  const r = ref(db, `rooms/${roomId}/answer`);
  onValue(r, (snap) => { if (snap.val()) callback(snap.val()); });
  return () => off(r);
}

export function listenForOffer(roomId, callback) {
  const r = ref(db, `rooms/${roomId}/offer`);
  onValue(r, (snap) => { if (snap.val()) callback(snap.val()); });
  return () => off(r);
}

export function sendIceCandidate(roomId, fromId, candidate) {
  push(ref(db, `rooms/${roomId}/ice_${fromId}`), candidate.toJSON());
}

export function listenForIce(roomId, fromId, callback) {
  const r = ref(db, `rooms/${roomId}/ice_${fromId}`);
  onValue(r, (snap) => {
    if (!snap.val()) return;
    Object.values(snap.val()).forEach((c) => callback(c));
  });
  return () => off(r);
}

export async function cleanupRoom(roomId) {
  if (!roomId) return;
  try { await remove(ref(db, `rooms/${roomId}`)); } catch (_) {}
  try { await remove(ref(db, `requests/${roomId}`)); } catch (_) {}
}

/**
 * Called once on app init. Silently removes rooms older than ttlMs (default 24h).
 * Best-effort — never throws.
 */
export async function cleanupStaleRooms(ttlMs = 1000 * 60 * 60 * 24) {
  try {
    const snap = await get(ref(db, "rooms"));
    if (!snap.exists()) return;
    const now = Date.now();
    const rooms = snap.val();
    await Promise.all(
      Object.entries(rooms).map(([id, val]) => {
        const ts =
          (val?.offer?.ts) || (val?.answer?.ts) || now;
        if (now - ts > ttlMs) {
          return remove(ref(db, `rooms/${id}`)).catch(() => {});
        }
        return Promise.resolve();
      }),
    );
  } catch (e) {
    if (import.meta.env.DEV) console.warn("cleanupStaleRooms:", e);
  }
}