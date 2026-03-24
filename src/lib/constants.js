export const RTC_CONFIG = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
    {
      urls: "turn:turn.cloudflare.com:3478",
      username: "free",
      credential: "free",
    },
  ],
};

export const CHUNK_SIZE = 65536; // 64 KB
export const RESUME_KEY = "dvault_resume";