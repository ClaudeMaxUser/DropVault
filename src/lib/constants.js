export const RTC_CONFIG = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
    { urls: "stun:stun.relay.metered.ca:80" },
    {
      urls: "turn:global.relay.metered.ca:80",
      username: "e8c6b982a60608caa5f5c79b",
      credential: "6TJW4q4B5S/yZjHW",
    },
    {
      urls: "turn:global.relay.metered.ca:80?transport=tcp",
      username: "e8c6b982a60608caa5f5c79b",
      credential: "6TJW4q4B5S/yZjHW",
    },
    {
      urls: "turn:global.relay.metered.ca:443",
      username: "e8c6b982a60608caa5f5c79b",
      credential: "6TJW4q4B5S/yZjHW",
    },
    {
      urls: "turns:global.relay.metered.ca:443?transport=tcp",
      username: "e8c6b982a60608caa5f5c79b",
      credential: "6TJW4q4B5S/yZjHW",
    },
  ],
};

export const CHUNK_SIZE = 65536; // 64 KB
export const RESUME_KEY = "dvault_resume";