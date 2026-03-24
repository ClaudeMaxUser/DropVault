export async function genKeyPair() {
  return crypto.subtle.generateKey(
    { name: "ECDH", namedCurve: "P-256" },
    true,
    ["deriveKey"],
  );
}

export async function exportPub(key) {
  const exported = await crypto.subtle.exportKey("spki", key);
  return btoa(String.fromCharCode(...new Uint8Array(exported)));
}

export async function importPub(b64) {
  const raw = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  return crypto.subtle.importKey(
    "spki",
    raw,
    { name: "ECDH", namedCurve: "P-256" },
    true,
    [],
  );
}

export async function deriveSharedKey(privateKey, publicKey) {
  try {
    const sharedSecret = await crypto.subtle.deriveBits(
      { name: "ECDH", public: publicKey },
      privateKey,
      256,
    );
    const info = new TextEncoder().encode("DropVault-AES-Session");
    const salt = new Uint8Array(32);
    const hkdfKey = await crypto.subtle.importKey(
      "raw",
      sharedSecret,
      { name: "HKDF" },
      false,
      ["deriveKey"],
    );
    return await crypto.subtle.deriveKey(
      { name: "HKDF", hash: "SHA-256", salt, info },
      hkdfKey,
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt", "decrypt"],
    );
  } catch (e) {
    console.warn("HKDF derivation failed, falling back:", e);
    return crypto.subtle.deriveKey(
      { name: "ECDH", public: publicKey },
      privateKey,
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt", "decrypt"],
    );
  }
}

export async function fingerprintFromPub(b64) {
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

export async function encryptChunk(key, data) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const enc = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, data);
  const out = new Uint8Array(12 + enc.byteLength);
  out.set(iv);
  out.set(new Uint8Array(enc), 12);
  return out.buffer;
}

export async function decryptChunk(key, data) {
  const iv = new Uint8Array(data.slice(0, 12));
  const enc = data.slice(12);
  return crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, enc);
}