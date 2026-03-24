import { RESUME_KEY } from "./constants";

/**
 * Derive a stable resume key from file identity so it survives page refresh.
 * For sent files we combine name + size + lastModified.
 * For received files we prefix with "r_" + fileId (server-assigned, stable per transfer).
 */
export function senderResumeKey(file) {
  return `${file.name}__${file.size}__${file.lastModified}`;
}

export function receiverResumeKey(fileId) {
  return `r_${fileId}`;
}

export function saveResume(id, n, total) {
  try {
    const s = JSON.parse(localStorage.getItem(RESUME_KEY) || "{}");
    s[id] = { n, total, ts: Date.now() };
    localStorage.setItem(RESUME_KEY, JSON.stringify(s));
  } catch (_) {}
}

export function getResume(id) {
  try {
    const s = JSON.parse(localStorage.getItem(RESUME_KEY) || "{}");
    return s[id] || null;
  } catch (_) {
    return null;
  }
}

export function clearResume(id) {
  try {
    const s = JSON.parse(localStorage.getItem(RESUME_KEY) || "{}");
    delete s[id];
    localStorage.setItem(RESUME_KEY, JSON.stringify(s));
  } catch (_) {}
}