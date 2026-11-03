import "dotenv/config";
import { drizzle } from "drizzle-orm/better-sqlite3";

import Fastify from "fastify";
import { Type, TypeBoxTypeProvider } from "@fastify/type-provider-typebox";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import { guestbookTable, ntfyTable } from "./db/schema.js";
import fetch from "node-fetch";
import { and, eq, isNotNull, isNull } from "drizzle-orm";
import Database from "better-sqlite3";
import path from "node:path";
import { mkdirSync, readdirSync, statSync, unlinkSync } from "node:fs";
import cron from "node-cron";

const DB_FILE_NAME = process.env.DB_FILE_NAME;
if (!DB_FILE_NAME) throw new Error("DB_FILE_NAME not set");

const NTFY_ENDPOINT = process.env.NTFY_ENDPOINT;
if (!NTFY_ENDPOINT) throw new Error("NTFY_ENDPOINT not set");

const NTFY_NOTIFICATION = process.env.NTFY_NOTIFICATION;
if (!NTFY_NOTIFICATION) throw new Error("NTFY_NOTIFICATION not set");

const DB_BACKUP_DIR = process.env.DB_BACKUP_DIR;
if (!DB_BACKUP_DIR) throw new Error("DB_BACKUP_DIR not set");

const BACKUPS_KEPT = Number(process.env.BACKUPS_KEPT);
if (!BACKUPS_KEPT) throw new Error("BACKUPS_KEPT not set");

const RATELIMIT = process.env.RATELIMIT !== "false";

const sqlite_db = new Database(DB_FILE_NAME);
sqlite_db.pragma("foreign_keys = ON");
sqlite_db.pragma("journal_mode = WAL");

const db = drizzle(sqlite_db);

const fastify = Fastify({
  logger: true,
}).withTypeProvider<TypeBoxTypeProvider>();

async function ntfy(type: "endpoint" | "notif", content: string) {
  const url =
    type === "endpoint"
      ? (NTFY_ENDPOINT as string)
      : (NTFY_NOTIFICATION as string);

  await fetch(url, {
    method: "POST",
    body: content,
  });
}

export async function backup() {
  console.log(`[${Date.now()}] Backup initiated`);

  const backupPath = path.join(
    DB_BACKUP_DIR as string,
    `${Date.now()}.backup.db`,
  );

  try {
    mkdirSync(DB_BACKUP_DIR as string, { recursive: true });
  } catch (e) {
    if (e instanceof Error) {
      console.log(
        `Failed to create the backup directory ${DB_BACKUP_DIR}\n${e}`,
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

    const files = readdirSync(DB_BACKUP_DIR as string, { withFileTypes: true })
      .filter((f) => f.isFile() && f.name.includes(".backup.db"))
      .map((f) => {
        const filePath = path.join(DB_BACKUP_DIR as string, f.name);
        return {
          name: f.name,
          path: filePath,
          birthtime: statSync(filePath).birthtime,
        };
      });

    files.sort((a, b) => b.birthtime.getTime() - a.birthtime.getTime());
    const filesToDelete = files.slice(BACKUPS_KEPT);
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

await fastify.register(cors, {
  origin: "https://wireless.fish",
});

if (RATELIMIT) {
  await fastify.register(rateLimit, {
    max: 64,
    timeWindow: "1 minute",
  });
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
  },
);

fastify.get("/guestbook", async function (request, reply) {
  let comments = await db
    .select()
    .from(guestbookTable)
    .where(
      and(isNull(guestbookTable.reply), eq(guestbookTable.status, "visible")),
    )
    .orderBy(guestbookTable.date);

  let replies = await db
    .select()
    .from(guestbookTable)
    .where(
      and(
        isNotNull(guestbookTable.reply),
        eq(guestbookTable.status, "visible"),
      ),
    )
    .orderBy(guestbookTable.date);

  let responseComments = new Array();

  comments.forEach((c) => {
    // omit reply and status

    let entry = {
      id: c.id,
      name: c.name,
      content: c.content,
      site: c.site,
      date: c.date,
      badge: c.badge,

      replies: new Array(),
    };

    replies
      .filter((r) => r.reply === c.id)
      .forEach((r) => {
        let reply = {
          id: r.id,
          name: r.name,
          content: r.content,
          site: r.site,
          date: r.date,
          badge: r.badge,
        };

        entry.replies.push(reply);
      });

    responseComments.push(entry);
  });

  await reply.send(responseComments).code(200);
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
