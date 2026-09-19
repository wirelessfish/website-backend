import Fastify from "fastify";
import si from "systeminformation";
import validator from "validator";
import cron from "node-cron";
import rateLimit from "@fastify/rate-limit";
import cors from "@fastify/cors";

import "dotenv/config";

import {
  InvalidReplyError,
  LastFmProxyParams,
  LastFmProxyQuery,
  POST_guestbookSchema,
  POST_Message,
  POST_ntfy,
} from "./types.js";
import { proxyLastFm } from "./lastfm.js";
import { backup, get_guestbook, insert_guestbook, terminate_db } from "./db.js";

const PORT = 3000;
const NTFY_URL_BACKEND = process.env.NTFY_URL_BACKEND;

if (!NTFY_URL_BACKEND) {
  throw new Error("Env var `NTFY_URL_BACKEND` is not defined!");
}

const fastify = Fastify({
  logger: true,
  trustProxy: true,
});

if (process.env.RATELIMIT === "true") {
  await fastify.register(rateLimit, { max: 50, timeWindow: "1 minute" });
}

if (process.env.CORS === "true") {
  await fastify.register(cors, {
    origin: ["https://wireless.fish"],
  });
}

async function ntfy(msg: string, url: string) {
  const response = await fetch(`${url}`, {
    method: "POST",
    body: msg,
  });

  if (!response.ok) {
    throw new Error(
      `Error trying to send ntfy.sh notification to ${url}: ${response.status} - ${await response.json()}`,
    );
  }
}

// Run the backup every midnight between friday and saturday
cron.schedule(
  "0 0 * * 6",
  () => {
    try {
      backup();

      ntfy(`Weekly backup finished`, NTFY_URL_BACKEND).catch((ntfy_error) => {
        console.error(ntfy_error);
      });
    } catch (backup_error) {
      if (backup_error instanceof Error) {
        console.log(backup_error);

        ntfy(
          `Weekly backup FAILED: ${backup_error.name}`,
          NTFY_URL_BACKEND,
        ).catch((ntfy_error) => {
          console.error(ntfy_error);
        });
      }
    }
  },
  {
    timezone: "Europe/Prague",
  },
);

// GET /
fastify.get("/", function (request, reply) {
  reply.code(200).send({ status: "online" });
});

// GET /status
fastify.get("/status", async function (request, reply) {
  const currentLoad = await si.currentLoad();
  const memory = await si.mem();
  const temperature = await si.cpuTemperature();
  const filesystems = await si.fsSize();

  const status = {
    memoryTotal: memory.total,
    memoryFree: memory.free,
    cpuUsage: currentLoad.avgLoad,
    temperature: temperature.main,
    filesystems,
  };

  reply.code(200).send(status);
});

// GET /lastfm
fastify.get("/lastfm", async function (request, reply) {
  const lastfm_res = await fetch("https://ws.audioscrobbler.com/2.0/");

  if (lastfm_res.status < 500) {
    reply.code(200).send({ status: "online" });
  } else {
    reply
      .code(502)
      .send({ status: `unreachable, (response ${lastfm_res.status})` });
  }
});

// GET /lastfm/proxy/:method
fastify.get<{
  Params: LastFmProxyParams;
  Querystring: LastFmProxyQuery;
}>("/lastfm/proxy/:method", async function (request, reply) {
  const { method } = request.params;

  const queryParams: Record<string, string> = {};
  for (const [key, value] of Object.entries(request.query)) {
    if (typeof value === "string") queryParams[key] = value;
  }

  try {
    reply.code(200).send(await proxyLastFm(method, queryParams));
  } catch (e: any) {
    console.error(`Error in /lastfm/proxy/${method}:`, e);
    const status = e.message?.startsWith("Method") ? 400 : 500;
    reply.code(status).send({ error: e.message });
  }
});

// GET /guestbook
fastify.get("/guestbook", async function (request, reply) {
  reply.send(get_guestbook());
});

// POST /notify
fastify.post<{ Body: { message: string } }>(
  "/notify",
  { schema: POST_ntfy },
  async function (request, reply) {
    try {
      await ntfy(request.body.message, NTFY_URL_BACKEND);
      reply.code(201).send();
    } catch (error) {
      if (error instanceof Error) {
        reply.code(500).send(`${error.name}: ${error.message}`);
      }
    }
  },
);

// POST /guestbook
fastify.post<{ Body: POST_Message }>(
  "/guestbook",
  { schema: POST_guestbookSchema },
  async function (request, reply) {
    // website
    if (
      request.body.website != null &&
      !validator.isURL(request.body.website, {
        protocols: ["http", "https"],
        require_protocol: true,
      })
    ) {
      reply.code(400).send({ error: "'website' is not a valid URL" });
      return;
    }

    try {
      insert_guestbook({
        name: request.body.name,
        message: request.body.message,
        reply: request.body.reply ?? null,
        website: request.body.website ?? null,
      });
    } catch (error) {
      if (error instanceof InvalidReplyError) {
        reply.code(400).send({ error: "Invalid target reply id" });
        return;
      } else if (error instanceof Error) {
        reply.code(500).send({ error: `${error.name}: ${error.message}` });
        return;
      }
    }

    reply.code(201).send();

    try {
      await ntfy(
        `[Guestbook] New comment by ${request.body.name}`,
        NTFY_URL_BACKEND,
      );
    } catch (error) {
      console.error(error);
    }
  },
);

fastify.listen({ port: PORT }, function (err, address) {
  if (err) {
    fastify.log.error(err);
    process.exit(1);
  }

  console.log(`Server is listening at ${address}`);
});

process.on("SIGTERM", () => {
  terminate_db();
  process.exit(0);
});
