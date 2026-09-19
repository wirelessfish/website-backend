import Fastify from "fastify";
import {
  backup,
  getMessageData,
  insertMessage,
  insertNotification,
} from "./database.js";
import dotenv from "dotenv";
import cors from "cors";
import { rateLimit } from "express-rate-limit";
import * as cron from "node-cron";
import { proxyLastFm } from "./lastfm.js";
import { z } from "zod";

dotenv.config({ quiet: true });
const DEV_ENV = process.env.DEV_ENV;
const NTFY_BACKEND = process.env.NTFY_BACKEND;
const NTFY_MOBILE = process.env.NTFY_MOBILE;

const app = express();
const port = 3000;
app.use(express.json());
app.use(cors());
app.set("trust proxy", 1);

if (!NTFY_BACKEND) {
  throw new Error("No NTFY_BACKEND env variable!");
} else if (!NTFY_MOBILE) {
  throw new Error("No NTFY_MOBILE env variable!");
}

if (!DEV_ENV) {
  const limiter = rateLimit({
    windowMs: 5 * 60 * 1000, // 5 minutes
    limit: 100, // Limit each IP to 100 requests per `window` (here, per 15 minutes).
    standardHeaders: "draft-8", // draft-6: `RateLimit-*` headers; draft-7 & draft-8: combined `RateLimit` header
    legacyHeaders: false, // Disable the `X-RateLimit-*` headers.
    ipv6Subnet: 56, // Set to 60 or 64 to be less aggressive, or 52 or 48 to be more aggressive
    // store: ... , // Redis, Memcached, etc. See below.
  });

  app.use(limiter);
}

async function notify(url: string, msg: string) {
  let resp = await fetch(url, {
    method: "POST", // PUT works too
    body: msg,
    headers: {
      "Content-Type": "text/plain",
      "User-Agent": "vercel-serverless",
    },
  });

  if (!resp.ok) {
    throw new Error(
      `Error trying to send ntfy.sh notification (${resp.status}). ${await resp.json()}`,
    );
  }
}

app.get("/", (req, res): void => {
  res.status(200).json("I am alive.");
});

app.get("/guestbook", (req, res) => {
  res.json(getMessageData());
});

app.get("/lastfm", async (req, res) => {
  const lastfm_res = await fetch("https://ws.audioscrobbler.com/2.0/");

  if (lastfm_res.status < 500) {
    res.status(200).json(`lastfm's api seems to be running!`);
  } else {
    res
      .status(502)
      .json(`lastfm's api seems to be down, (response ${lastfm_res.status})`);
  }
});

// Last.fm proxy
app.get("/lastfm/proxy/:method", async (req, res) => {
  const method = req.params.method;
  const { user, ...rest } = req.query;

  if (!user) {
    res.status(400).json("`user` query is missing");
    return;
  }

  const queryParams: Record<string, string> = { user: user.toString() };
  for (const [key, value] of Object.entries(rest)) {
    if (typeof value === "string") queryParams[key] = value;
  }

  try {
    res.status(200).json(await proxyLastFm(method, queryParams));
  } catch (e: any) {
    console.error(`Error in /lastfm/proxy/${method}:`, e);
    const status = e.message?.startsWith("Method") ? 400 : 500;
    res.status(status).json(e.message);
  }
});

const GuestbookQuery = z.object({
  name: z.string(),
  content: z.string(),
  reply_to: z.coerce
    .number()
    .int()
    .positive()
    .optional()
    .transform((v) => v ?? null),

  // web url regex, see "Web URLs" section of https://zod.dev/api?id=optionals#urls
  site: z
    .preprocess(
      (v) => (v === "" || v == null ? undefined : v),
      z
        .url({
          protocol: /^https?$/,
          hostname: z.regexes.domain,
        })
        .optional(),
    )
    .transform((v) => v ?? null),
});

app.post("/guestbook", async (req, res) => {
  const result = GuestbookQuery.safeParse(req.body);
  if (!result.success)
    return res.status(400).json(z.treeifyError(result.error));

  const { name, content, reply_to, site } = result.data;
  insertMessage(name, content, reply_to, site);

  await notify(
    NTFY_BACKEND,
    `[${new Date().toLocaleDateString()}] New guestbook comment by "${name}"`,
  );

  res.sendStatus(200);
});

const NtfyQuery = z.object({
  text: z.string(),
});

app.post("/ntfy", async (req, res) => {
  const result = NtfyQuery.safeParse(req.body);
  if (!result.success)
    return res.status(400).json(z.treeifyError(result.error));

  try {
    insertNotification(result.data.text);
    await notify(NTFY_MOBILE, result.data.text);
    res.sendStatus(200);
  } catch (e) {
    console.error("Error in /ntfy endpoint:", e);
    res.status(500).json("ERROR: Failed to process notification");
  }
});

app.listen(port, "0.0.0.0", () => {
  console.log(`Listening on port http://localhost:${port}`);
});

cron.schedule("0 2 * * Sunday", async () => {
  console.log("[CRON] Initiating weekly backup");

  try {
    await backup();
    console.log("[CRON] Weekly backup completed successfully");
  } catch (error) {
    console.error("[CRON] Weekly backup failed:", error);
  }
});

console.log("Init database backup");
await backup();

export default app;
