import { drizzle } from "drizzle-orm/better-sqlite3";

import Fastify, { type FastifyReply } from "fastify";
import { Type, TypeBoxTypeProvider } from "@fastify/type-provider-typebox";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import { guestbookTable, ntfyTable } from "./db/schema.js";
import fetch from "node-fetch";
import { and, eq, isNotNull, isNull, desc } from "drizzle-orm";
import Database from "better-sqlite3";
import path from "node:path";
import { mkdirSync, readdirSync, statSync, unlinkSync } from "node:fs";
import cron from "node-cron";
import proxy from "@fastify/http-proxy";
import { Config } from "./config.js";
import { log } from "./log.js";

if (!Config.ntfy.generalNotifications) {
  log("INFO", "General notifications are DISABLED");
}

const sqlite_db = new Database(Config.database.filename);
sqlite_db.pragma("foreign_keys = ON");
sqlite_db.pragma("journal_mode = WAL");

const db = drizzle(sqlite_db);

const fastify = Fastify({
  logger: Config.fastifyLogger,
}).withTypeProvider<TypeBoxTypeProvider>();

if (Config.cors.enabled) {
  await fastify.register(cors, {
    origin: Config.cors.allowList,
  });

  log("DEBUG", `CORS is set to ${Config.cors.allowList}`);
} else {
  await fastify.register(cors, {
    origin: "*",
  });

  log("DEBUG", "CORS is set to '*'");
}

if (Config.ratelimit) {
  await fastify.register(rateLimit, {
    max: 64,
    timeWindow: "1 minute",
  });
}

async function checkLastFmHealth() {
  const url = new URL("/2.0/", Config.lastfm.upstream);
  url.searchParams.set("method", "chart.gettopartists");
  url.searchParams.set("api_key", Config.lastfm.apiKey);
  url.searchParams.set("format", "json");

  const response = await fetch(url);
  return response;
}

fastify.register(proxy, {
  upstream: Config.lastfm.upstream,
  prefix: Config.lastfm.prefix,
  rewritePrefix: "/2.0/",
  httpMethods: ["GET"],
  preHandler: async (request, reply) => {
    const reqQuery = request.query as { method?: unknown };
    const method = reqQuery.method;

    // Healthcheck
    if (method === undefined) {
      let response = await checkLastFmHealth();

      if (!response.ok) {
        log("ERROR", "LastFM is unhealthy");

        await reply.code(502).send({
          status: "unhealthy",
          upstreamStatus: response.status,
        });

        return;
      }

      await reply.send({
        status: "healthy",
        upstreamStatus: response.status,
      });

      return;
    }

    // Query method check
    if (
      typeof method !== "string" ||
      !Config.lastfm.methods.includes(
        method as (typeof Config.lastfm.methods)[number],
      )
    ) {
      log("ERROR", `Invalid LastFM method used: ${method}`);

      await reply.code(400).send({
        error: "Unsupported or missing Last.fm method",
      });

      return;
    }
  },
  handler: async (request, reply, dest, options) => {
    const requestUrl = new URL(request.url, Config.lastfm.upstream);
    const upstreamUrl = new URL(dest, Config.lastfm.upstream);
    const query = upstreamUrl.searchParams;

    for (const [key, value] of requestUrl.searchParams) {
      query.set(key, value);
    }

    query.set("api_key", Config.lastfm.apiKey);
    query.set("format", "json");
    const method = requestUrl.searchParams.get("method");

    const logUpstreamURL = new URL(upstreamUrl);
    logUpstreamURL.searchParams.set("api_key", "hidden");
    log("DEBUG", `Last.fm proxy fetching: ${logUpstreamURL}`);

    const lastFmResponse = await fetch(upstreamUrl);
    if (!lastFmResponse.ok) {
      log("ERROR", "LastFM reply not ok");
      return reply.from(dest, options);
    }

    const lastFmData = (await lastFmResponse.json()) as {
      topartists?: {
        artist?: Array<{
          name?: string;
          image?: Array<{ "#text": string; size: string }>;
        }>;
      };
    };

    if (method === "user.gettopartists") {
      const artists = lastFmData.topartists?.artist ?? [];
      log(
        "DEBUG",
        `Intercepting ${artists.length} top artists for Deezer images`,
      );

      await Promise.all(
        artists.map(async (artist) => {
          if (!artist.name) {
            return;
          }

          const deezerUrl = new URL("https://api.deezer.com/search/artist");
          deezerUrl.searchParams.set("q", artist.name);
          deezerUrl.searchParams.set("limit", "10");
          deezerUrl.searchParams.set("strict", "on");

          const deezerResponse = await fetch(deezerUrl);

          if (!deezerResponse.ok) {
            log(
              "ERROR",
              `Deezer artist request failed (${deezerResponse.status})`,
            );
            return;
          }

          const deezerData = (await deezerResponse.json()) as {
            data?: Array<{
              picture_small?: string;
              picture_medium?: string;
              picture_big?: string;
              picture_xl?: string;
              nb_fan?: number;
              name: string;
            }>;
          };

          // because strict mode doesn't work for some reason
          deezerData.data = deezerData.data?.filter(
            (a) => a.name == artist.name,
          );

          const deezerArtist = deezerData.data
            ?.sort((a, b) => (b.nb_fan ?? 0) - (a.nb_fan ?? 0))
            .at(0);

          if (!deezerArtist) {
            return;
          }

          artist.image ??= [];

          const images = [
            ["small", deezerArtist.picture_small],
            ["medium", deezerArtist.picture_medium],
            ["large", deezerArtist.picture_big],
            ["extralarge", deezerArtist.picture_xl],
            ["mega", deezerArtist.picture_xl],
          ] as const;

          for (const [size, url] of images) {
            if (!url) {
              continue;
            }

            const image = artist.image.find((item) => item.size === size);

            if (image) {
              image["#text"] = url;
            } else {
              artist.image.push({ size, "#text": url });
            }
          }
        }),
      );

      return reply.send(lastFmData);
    }

    return reply.send(lastFmData);
  },
});

async function ntfy(type: "endpoint" | "notif", content: string) {
  const url =
    type === "endpoint"
      ? (Config.ntfy.notifEndpoint as string)
      : (Config.ntfy.notifications as string);

  // General notifications are disabled
  if (type === "notif" && !Config.ntfy.generalNotifications) {
    return;
  }

  await fetch(url, {
    method: "POST",
    body: content,
  });
}

export async function backup() {
  const backupPath = path.join(
    Config.database.backupDir,
    `${Date.now()}.backup.db`,
  );

  log("DEBUG", "backupPath =", backupPath);

  // backup directory
  try {
    mkdirSync(Config.database.backupDir as string, { recursive: true });
  } catch (e) {
    if (e instanceof Error) {
      log(
        "ERROR",
        `Failed to create backup directory ${Config.database.backupDir}`,
        e,
      );

      try {
        await ntfy(
          "notif",
          `Backup FAILED at ${new Date().toLocaleString("cs-CZ")}. [${e.name}]`,
        );
      } catch (e) {
        log("ERROR", `ntfy error`, e);
      }
    }

    return;
  }

  // actual db backup
  try {
    await sqlite_db.backup(backupPath);

    log(
      "DEBUG",
      `DB Saved, removing old backups (keep ${Config.database.backupsKept} files)`,
    );

    const files = readdirSync(Config.database.backupDir as string, {
      withFileTypes: true,
    })
      .filter((f) => f.isFile() && f.name.includes(".backup.db"))
      .map((f) => {
        const filePath = path.join(Config.database.backupDir as string, f.name);
        return {
          name: f.name,
          path: filePath,
          birthtime: statSync(filePath).birthtime,
        };
      });

    files.sort((a, b) => b.birthtime.getTime() - a.birthtime.getTime());
    const filesToDelete = files.slice(Config.database.backupsKept);
    filesToDelete.forEach((f) => unlinkSync(f.path));

    log("DEBUG", "Old backups deleted");

    try {
      await ntfy(
        "notif",
        `Backup complete at ${new Date().toLocaleString("cs-CZ")}`,
      );
    } catch (e) {
      log("ERROR", `ntfy error`, e);
    }
  } catch (err) {
    if (err instanceof Error) {
      log("ERROR", "Backup failed", err);

      try {
        await ntfy(
          "notif",
          `Backup FAILED at ${new Date().toLocaleString("cs-CZ")}. [${err.name}]`,
        );
      } catch (e) {
        log("ERROR", `ntfy error`, e);
      }

      return;
    }
  }
}

fastify.get("/", function (request, reply) {
  reply.send({ status: "alive" });
});

fastify.post(
  "/ntfy",
  {
    schema: {
      body: Type.Object({
        content: Type.String(),
      }),
    },
  },
  async function (request, reply) {
    const content = request.body.content;

    log("DEBUG", "New ntfy push:", content);

    await db.insert(ntfyTable).values({ content });

    try {
      await ntfy("endpoint", content);
    } catch (e) {
      log("ERROR", `ntfy error`, e);
    }

    await reply.code(200);
  },
);

fastify.post(
  "/guestbook",
  {
    schema: {
      body: Type.Object({
        name: Type.String({ minLength: 1, maxLength: 100 }),
        content: Type.String({ minLength: 1, maxLength: 2000 }),
        site: Type.Optional(Type.String({ maxLength: 100 })),
        reply: Type.Optional(Type.Integer()),
      }),
    },
  },
  async function (request, reply) {
    log(
      "DEBUG",
      "New guestbook push",
      `name=${request.body.name}`,
      `content=${request.body.content}`,
      `site=${request.body.site}`,
      `reply=${request.body.reply}`,
    );

    if (request.body.reply !== undefined) {
      let targetComment = await db
        .select()
        .from(guestbookTable)
        .where(eq(guestbookTable.id, request.body.reply));

      // only allow replies to existing IDs
      if (targetComment.length === 0) {
        log(
          "ERROR",
          `Cannot reply, target comment ID ${request.body.reply} does not exist`,
        );

        await reply
          .send({
            error: `Comment ID (${request.body.reply}) you are replying to does not exist!`,
          })
          .code(400);
        return;
      }

      // disallow replying to replies
      if (targetComment[0].reply !== undefined) {
        log("ERROR", "Replying to reply forbidden");

        await reply
          .send({
            error: `Replying to replies is currently unsupported!`,
          })
          .code(400);
        return;
      }

      // disallow replying to hidden comments
      if (targetComment[0].status === "hidden") {
        log("ERROR", "Replying to hidden comments forbidden");

        await reply
          .send({
            error: `Cannot reply to hidden comments!`,
          })
          .code(400);
        return;
      }
    }

    await db.insert(guestbookTable).values({
      name: request.body.name,
      content: request.body.content,
      site: request.body.site,
      reply: request.body.reply,
    });

    try {
      await ntfy("notif", `Guestbook entry by ${request.body.name}`);
    } catch (e) {
      log("ERROR", `ntfy error`, e);
    }

    await reply.code(201);
    return;
  },
);

fastify.get("/guestbook", async function (request, reply) {
  let comments = await db
    .select()
    .from(guestbookTable)
    .where(
      and(isNull(guestbookTable.reply), eq(guestbookTable.status, "visible")),
    )
    .orderBy(desc(guestbookTable.date));

  let replies = await db
    .select()
    .from(guestbookTable)
    .where(
      and(
        isNotNull(guestbookTable.reply),
        eq(guestbookTable.status, "visible"),
      ),
    )
    .orderBy(desc(guestbookTable.date));

  let responseComments = new Array();

  comments.forEach((c) => {
    // omit reply and status

    const isoDate = c.date.replace(" ", "T") + "Z";

    let entry = {
      id: c.id,
      name: c.name,
      content: c.content,
      site: c.site,
      date: isoDate,
      badge: c.badge,

      replies: new Array(),
    };

    replies
      .filter((r) => r.reply === c.id)
      .forEach((r) => {
        const replyIsoDate = r.date.replace(" ", "T") + "Z";

        let reply = {
          id: r.id,
          name: r.name,
          content: r.content,
          site: r.site,
          date: replyIsoDate,
          badge: r.badge,
        };

        entry.replies.push(reply);
      });

    responseComments.push(entry);
  });

  await reply
    .send({
      entries: responseComments,
    })
    .code(200);
});

cron.schedule("0 2 * * Sunday", async () => {
  log("INFO", "Initiating weekly backup");

  try {
    await backup();
    log("INFO", "Weekly backup completed successfully");
  } catch (error) {
    log("ERROR", "Weekly backup failed:", error);
  }
});

log("INFO", "Init database backup");
await backup();

fastify.listen({ host: "0.0.0.0", port: Config.port }, function (err, address) {
  if (err) {
    fastify.log.error(err);
    process.exit(1);
  }
  // Server is now listening on ${address}
});
