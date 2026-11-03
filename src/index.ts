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

const DB_FILE_NAME = process.env.DB_FILE_NAME;
if (!DB_FILE_NAME) throw new Error("DB_FILE_NAME not set");

const NTFY_ENDPOINT = process.env.NTFY_ENDPOINT;
if (!NTFY_ENDPOINT) throw new Error("NTFY_ENDPOINT not set");

const NTFY_NOTIFICATION = process.env.NTFY_NOTIFICATION;
if (!NTFY_NOTIFICATION) throw new Error("NTFY_NOTIFICATION not set");

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

fastify.listen({ port: 3000 }, function (err, address) {
  if (err) {
    fastify.log.error(err);
    process.exit(1);
  }
  // Server is now listening on ${address}
});
