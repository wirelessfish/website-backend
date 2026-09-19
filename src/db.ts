import Database from "better-sqlite3";
import { v4 as uuidv4 } from "uuid";

import fs from "node:fs";
import path from "node:path";

import {
  GuestbookRow,
  InvalidReplyError,
  Message,
  MessageInsert,
} from "./types.js";

const DATA_DIR = path.join(import.meta.dirname, "../data");

const BACKUP_DIR = path.join(import.meta.dirname, "../backup");
const WEEKLY_DIR = path.join(BACKUP_DIR, "weekly");
const MONTHLY_DIR = path.join(BACKUP_DIR, "monthly");

const DB_FILEPATH = path.join(DATA_DIR, "db.sqlite");
console.log(`DB file path: ${DB_FILEPATH}`);

// fs stuff
fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(BACKUP_DIR, { recursive: true });

// db stuff
const DB = new Database(DB_FILEPATH);
const SCHEMA = fs.readFileSync(
  path.join(import.meta.dirname, "../schema.sql"),
  "utf8",
);

DB.pragma("journal_mode = WAL");
DB.pragma("foreign_keys = ON");
DB.exec(SCHEMA);

function getBackups(dir: string) {
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((f) => f.isFile() && f.name.toLowerCase().endsWith(".sqlite"))
    .map((f) => {
      const filePath = path.join(dir, f.name);
      return {
        name: f.name,
        path: filePath,
        birthtime: fs.statSync(filePath).birthtime,
      };
    });
}

// this things a mess, definitely needs a refactor since both the weekly and monthly part share a lot of similarities
export function backup() {
  // Keep 3 monthly and 4 weekly backups
  console.log(`Backup initiated on ${new Date().toLocaleString()}`);

  fs.mkdirSync(WEEKLY_DIR, { recursive: true });
  fs.mkdirSync(MONTHLY_DIR, { recursive: true });

  // weekly backup
  const weekly_backups = getBackups(WEEKLY_DIR);

  // sort by age, youngest first
  weekly_backups.sort((a, b) => b.birthtime.getTime() - a.birthtime.getTime());

  let week_in_past = new Date();
  week_in_past.setDate(week_in_past.getDate() - 7);

  if (
    weekly_backups.length <= 0 ||
    weekly_backups[0].birthtime.getTime() < week_in_past.getTime()
  ) {
    // if the youngest backup is over a week old, do a new one and delete others so that only the 4 youngest are kept
    const WEEKLY_BACKUP_PATH = path.join(
      WEEKLY_DIR,
      `backup-${new Date().toISOString()}.sqlite`,
    );

    DB.exec(`VACUUM INTO '${WEEKLY_BACKUP_PATH}'`);

    console.log(`New weekly backup made: ${WEEKLY_BACKUP_PATH}`);

    let new_weekly = getBackups(WEEKLY_DIR);
    new_weekly.sort((a, b) => b.birthtime.getTime() - a.birthtime.getTime());
    new_weekly = new_weekly.slice(4);
    new_weekly.forEach((f) => fs.unlinkSync(f.path));
  }

  // monthly backup
  const monthly_backups = getBackups(MONTHLY_DIR);

  // sort by age, youngest first
  monthly_backups.sort((a, b) => b.birthtime.getTime() - a.birthtime.getTime());

  let month_in_past = new Date();
  month_in_past.setMonth(month_in_past.getMonth() - 1);

  if (
    monthly_backups.length <= 0 ||
    monthly_backups[0].birthtime.getTime() < month_in_past.getTime()
  ) {
    // if the youngest backup is over a month old, do a new one and delete others so that only the 3 youngest are kept
    const MONTHLY_BACKUP_PATH = path.join(
      MONTHLY_DIR,
      `backup-${new Date().toISOString()}.sqlite`,
    );

    DB.exec(`VACUUM INTO '${MONTHLY_BACKUP_PATH}'`);

    console.log(`New monthly backup made: ${MONTHLY_BACKUP_PATH}`);

    let new_monthly = getBackups(MONTHLY_DIR);
    new_monthly.sort((a, b) => b.birthtime.getTime() - a.birthtime.getTime());
    new_monthly = new_monthly.slice(3);
    new_monthly.forEach((f) => fs.unlinkSync(f.path));
  }

  console.log("Backup finished");

  return;
}

export function insert_guestbook(msg: MessageInsert) {
  const reply_row = DB.prepare("SELECT reply FROM guestbook WHERE id = ?").get(
    msg.reply,
  ) as { reply: string | null } | undefined;
  if (reply_row && reply_row.reply !== null) {
    throw new Error("Cannot reply to replies");
  }

  const id = uuidv4();

  try {
    DB.prepare(
      "INSERT INTO guestbook (id, reply, name, message, website) VALUES (?, ?, ?, ?, ?)",
    ).run(id, msg.reply, msg.name, msg.message, msg.website);
  } catch (error) {
    // Must be a reply to an existent message, enforced with a foreign key by sqlite
    if (
      error instanceof Error &&
      error.message.includes("FOREIGN KEY constraint failed")
    ) {
      throw new InvalidReplyError("The reply target ID does not exist");
    }

    throw error;
  }

  return id;
}

export function get_guestbook(): Message[] {
  // Essentially get two arrays: one of root level messages and the other of replies
  // Then convert the rows to message types and map the replies to their parent messages
  // Replies cannot be replied to, but still contain an empty `replies` array just for the sake of a clean implementation
  const root_message_rows = DB.prepare(
    "SELECT id, reply, date, name, message, website FROM guestbook WHERE visible = 1 AND reply IS NULL ORDER BY date DESC, id DESC;",
  ).all() as GuestbookRow[];

  const reply_rows = DB.prepare(
    "SELECT id, reply, date, name, message, website FROM guestbook WHERE visible = 1 AND reply IS NOT NULL ORDER BY date ASC, id ASC;",
  ).all() as GuestbookRow[];

  const root_msgs: Message[] = root_message_rows.map((row) => ({
    ...row,
    replies: [],
    date: new Date(row.date),
  }));

  const replies: Message[] = reply_rows.map((row) => ({
    ...row,
    replies: [],
    date: new Date(row.date),
  }));

  const response: Message[] = root_msgs.map((msg) => ({
    ...msg,
    replies: replies.filter((reply) => reply.reply === msg.id),
  }));

  return response;
}

export function terminate_db() {
  DB.close();
}
