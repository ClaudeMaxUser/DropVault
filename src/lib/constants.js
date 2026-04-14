const TURN_USERNAME = import.meta.env.VITE_TURN_USERNAME || "";
const TURN_CREDENTIAL = import.meta.env.VITE_TURN_CREDENTIAL || "";
const TURN_URLS = (import.meta.env.VITE_TURN_URLS || "").split(",").map(s => s.trim()).filter(Boolean);

const iceServers = [
  { urls: "stun:stun.relay.metered.ca:80" },
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun1.l.google.com:19302" },
];

if (TURN_URLS.length && TURN_USERNAME && TURN_CREDENTIAL) {
  // Use custom TURN servers from environment
  TURN_URLS.forEach((u) => {
    iceServers.push({ urls: u, username: TURN_USERNAME, credential: TURN_CREDENTIAL });
  });
} else {
  iceServers.push(
    { urls: "turn:a.relay.metered.ca:80", username: "e87cfa839d5c5e1de0eb6c14", credential: "G4/veYlLfUPTp70V" },
    { urls: "turn:a.relay.metered.ca:80?transport=tcp", username: "e87cfa839d5c5e1de0eb6c14", credential: "G4/veYlLfUPTp70V" },
    { urls: "turn:a.relay.metered.ca:443", username: "e87cfa839d5c5e1de0eb6c14", credential: "G4/veYlLfUPTp70V" },
    { urls: "turns:a.relay.metered.ca:443?transport=tcp", username: "e87cfa839d5c5e1de0eb6c14", credential: "G4/veYlLfUPTp70V" }
  );
}

export const RTC_CONFIG = { iceServers };

export const CHUNK_SIZE = 65536; // 64 KB
export const RESUME_KEY = "dvault_resume";