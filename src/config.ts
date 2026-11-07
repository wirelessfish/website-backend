import "dotenv/config";

const DB_FILE_NAME = process.env.DB_FILE_NAME;
if (!DB_FILE_NAME) throw new Error("DB_FILE_NAME not set");

const NTFY_ENDPOINT = process.env.NTFY_ENDPOINT;
if (!NTFY_ENDPOINT) throw new Error("NTFY_ENDPOINT not set");

const NTFY_NOTIFICATION = process.env.NTFY_NOTIFICATION;
if (!NTFY_NOTIFICATION) throw new Error("NTFY_NOTIFICATION not set");

const DB_BACKUP_DIR = process.env.DB_BACKUP_DIR;
if (!DB_BACKUP_DIR) throw new Error("DB_BACKUP_DIR not set");

const USER_AGENT = process.env.USER_AGENT;
if (!USER_AGENT) throw new Error("USER_AGENT not set");

const LASTFM_API_KEY = process.env.LASTFM_API_KEY;
if (!LASTFM_API_KEY) throw new Error("LASTFM_API_KEY not set");

const CORS_ENABLED = process.env.CORS_ENABLED !== "false";
const RATELIMIT = process.env.RATELIMIT !== "false";
const GENERAL_NOTIFICATIONS = process.env.GENERAL_NOTIFICATIONS !== "false";

export const Config = {
  port: 6778,
  fastifyLogger: false,
  userAgent: USER_AGENT,
  ratelimit: RATELIMIT,
  lastfm: {
    upstream: "https://ws.audioscrobbler.com",
    prefix: "/lastfm",
    apiKey: LASTFM_API_KEY,
    methods: [
      "user.getrecenttracks",
      "user.gettopartists",
      "user.gettoptracks",
      "user.gettopalbums",
      "user.getinfo",
      "artist.getinfo",
    ],
  },
  database: {
    backupsKept: 4,
    backupDir: DB_BACKUP_DIR,
    filename: DB_FILE_NAME,
  },
  ntfy: {
    notifEndpoint: NTFY_ENDPOINT,
    notifications: NTFY_NOTIFICATION,
    generalNotifications: GENERAL_NOTIFICATIONS,
  },
  cors: {
    allowList: new Array("https://f1sh.cz"),
    enabled: CORS_ENABLED,
  },
  logging: {
    enabledCategories: ["DEBUG", "INFO", "WARN", "ERROR"],
  },
};
