import { sql } from "drizzle-orm";
import {
  AnySQLiteColumn,
  int,
  sqliteTable,
  text,
} from "drizzle-orm/sqlite-core";

export const GUESTBOOK_ENTRY_STATUS = ["visible", "hidden"] as const;
export const GUESTBOOK_BADGE = ["none", "owner"] as const;

export const guestbookTable = sqliteTable("guestbook", {
  id: int("id").primaryKey({ autoIncrement: true }),
  date: text("date")
    .notNull()
    .default(sql`(current_timestamp)`),
  name: text("name").notNull(),
  content: text("content").notNull(),
  site: text("site"),
  reply: int("reply").references((): AnySQLiteColumn => guestbookTable.id), // make ts shut up
  status: text("status", { enum: GUESTBOOK_ENTRY_STATUS })
    .notNull()
    .default("visible"),
  badge: text("badge", { enum: GUESTBOOK_BADGE }).default("none"),
});

export const ntfyTable = sqliteTable("ntfy", {
  id: int("id").primaryKey({ autoIncrement: true }),
  date: text("date")
    .notNull()
    .default(sql`(current_timestamp)`),
  content: text("content"),
});
