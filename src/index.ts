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

if (!Config.ntfy.generalNotifications) {
  console.log("[INFO] General notifications are DISABLED");
}

if (!Config.cors.enabled) {
  console.log("[INFO] CORS is set to ['*']");
} else {
  console.log(`[INFO] CORS is set to ${Config.cors.allowList}`);
}

const sqlite_db = new Database(Config.database.filename);
sqlite_db.pragma("foreign_keys = ON");
sqlite_db.pragma("journal_mode = WAL");

const db = drizzle(sqlite_db);

const fastify = Fastify({
  logger: true,
}).withTypeProvider<TypeBoxTypeProvider>();

if (Config.cors.enabled) {
  await fastify.register(cors, {
    origin: Config.cors.allowList,
  });
} else {
  await fastify.register(cors, {
    origin: "*",
  });
}

if (Config.ratelimit) {
  await fastify.register(rateLimit, {
    max: 64,
    timeWindow: "1 minute",
  });
}

async function checkLastFmHealth(reply: FastifyReply) {
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
      let response = await checkLastFmHealth(reply);

      if (!response.ok) {
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

    // Debug thing
    // console.log(`Last.fm proxy fetching: ${upstreamUrl}`);

    await reply.from(`${upstreamUrl.pathname}?${query.toString()}`, options);
    return;
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
  console.log(`[${Date.now()}] Backup initiated`);

  const backupPath = path.join(
    Config.database.backupDir,
    `${Date.now()}.backup.db`,
  );

  try {
    mkdirSync(Config.database.backupDir as string, { recursive: true });
  } catch (e) {
    if (e instanceof Error) {
      console.log(
        `Failed to create the backup directory ${Config.database.backupDir}\n${e}`,
      );

      await ntfy(
        "notif",
        `Backup FAILED at ${new Date().toLocaleString("cs-CZ")}. [${e.name}]`,
      );
    }

    return;
  }

  try {
    await sqlite_db.backup(backupPath);
    console.log("Backup complete!");

    console.log("Purging old backups");

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

    console.log("Old backups deleted");

    try {
      await ntfy(
        "notif",
        `Backup complete at ${new Date().toLocaleString("cs-CZ")}`,
      );
    } catch (e) {
      console.error(`ntfy() error: ${e}`);
    }
  } catch (err) {
    if (err instanceof Error) {
      console.error("Backup failed:", err);

      await ntfy(
        "notif",
        `Backup FAILED at ${new Date().toLocaleString("cs-CZ")}. [${err.name}]`,
      );

      throw err;
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

    await db.insert(ntfyTable).values({ content });

    await ntfy("endpoint", content);

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
    if (request.body.reply !== undefined) {
      let targetComment = await db
        .select()
        .from(guestbookTable)
        .where(eq(guestbookTable.id, request.body.reply));

      // only allow replies to existing IDs
      if (targetComment.length === 0) {
        await reply
          .send({
            error: `Comment ID (${request.body.reply}) you are replying to does not exist!`,
          })
          .code(400);
        return;
      }

      // disallow replying to replies
      if (targetComment[0].reply !== undefined) {
        await reply
          .send({
            error: `Replying to replies is currently unsupported!`,
          })
          .code(400);
        return;
      }

      // disallow replying to hidden comments
      if (targetComment[0].status === "hidden") {
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

    await ntfy("notif", `Guestbook entry by ${request.body.name}`);

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

fastify.listen({ port: 3000 }, function (err, address) {
  if (err) {
    fastify.log.error(err);
    process.exit(1);
  }
  // Server is now listening on ${address}
});
