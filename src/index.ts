import "dotenv/config";
import { drizzle } from "drizzle-orm/better-sqlite3";

import Fastify from "fastify";
import { Type, TypeBoxTypeProvider } from "@fastify/type-provider-typebox";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import { ntfyTable } from "./db/schema.js";
import fetch from "node-fetch";

const DB_FILE_NAME = process.env.DB_FILE_NAME;
if (!DB_FILE_NAME) throw new Error("DB_FILE_NAME not set");

const NTFY_ENDPOINT = process.env.NTFY_ENDPOINT;
if (!NTFY_ENDPOINT) throw new Error("NTFY_ENDPOINT not set");

const NTFY_NOTIFICATION = process.env.NTFY_NOTIFICATION;
if (!NTFY_NOTIFICATION) throw new Error("NTFY_NOTIFICATION not set");

const RATELIMIT = Boolean(process.env.RATELIMIT) ?? true;

const db = drizzle(DB_FILE_NAME);

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
    body: JSON.stringify({ content: content }),
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
  },
);

fastify.listen({ port: 3000 }, function (err, address) {
  if (err) {
    fastify.log.error(err);
    process.exit(1);
  }
  // Server is now listening on ${address}
});
