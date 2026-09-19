import dotenv from "dotenv";
import Database from "better-sqlite3";
import {
  Message,
  Ntfy,
  MessageInsert,
  NtfyInsert,
  MessageWithReplies,
} from "./types.js";
import { readdirSync, statSync, unlinkSync } from "node:fs";
import path from "node:path";

dotenv.config({ quiet: true });

const DB_PATH = process.env.DB_PATH;
const BACKUP_DIR = process.env.BACKUP_DIR;
const BACKUPS_KEPT = Number(process.env.BACKUPS_KEPT);

if (!DB_PATH) {
  throw new Error("env var DB_PATH is not set!");
}

if (!BACKUP_DIR) {
  throw new Error("env var BACKUP_DIR is not set!");
}

if (!BACKUPS_KEPT || BACKUPS_KEPT < 0) {
  throw new Error("env var BACKUPS_KEPT is not set or is invalid!");
}

const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");

export function insertNotification(text: string) {
  const msg: NtfyInsert = {
    text: text,
  };

  db.prepare("INSERT INTO ntfy (text) VALUES (?)").run(msg.text);
}

export function getMessages() {
  const rows = db
    .prepare(
      `SELECT id, created, name, content, site, verified FROM messages WHERE visible = 1 AND reply_to IS NULL ORDER BY created DESC;`,
    )
    .all() as Message[];
  return rows;
}

export function getMessageReplies(id: number) {
  const rows = db
    .prepare(
      "SELECT id, created, name, content, site, verified FROM messages WHERE visible = 1 AND reply_to = ? ORDER BY created DESC;",
    )
    .all(id) as Message[];

  return rows;
}

export async function backup() {
  console.log(`[${Date.now()}] Backup initiated`);

  const backupPath = path.join(
    BACKUP_DIR as string,
    `backup-${Date.now()}.backup.sqlite`,
  );

  try {
    await db.backup(backupPath);
    console.log("Backup complete!");

    console.log("Purging old backups");

    const files = readdirSync(BACKUP_DIR as string, { withFileTypes: true })
      .filter((f) => f.isFile())
      .map((f) => {
        const filePath = path.join(BACKUP_DIR as string, f.name);
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
  } catch (err) {
    console.log("Backup failed:", err);
    throw err;
  }
}

export function getMessageData() {
  let data = getMessages();
  let response = {
    count: data.length,
    entries: data as MessageWithReplies[],
  };

  for (const message of response.entries) {
    let replies = getMessageReplies(message.id);
    message.replies = replies;
    message.reply_count = replies.length;
  }

  return response;
}

export function insertMessage(
  name: string,
  content: string,
  reply: number | null,
  site: string | null,
) {
  const msg: MessageInsert = {
    name: name,
    content: content,
    reply_to: reply,
    site: site,
  };

  db.prepare(
    "INSERT INTO messages (name, content, reply_to, site) VALUES (?, ?, ?, ?)",
  ).run(msg.name, msg.content, msg.reply_to, msg.site);
}
