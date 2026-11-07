PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_ntfy` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`date` text DEFAULT (current_timestamp) NOT NULL,
	`content` text NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_ntfy`("id", "date", "content") SELECT "id", "date", "content" FROM `ntfy`;--> statement-breakpoint
DROP TABLE `ntfy`;--> statement-breakpoint
ALTER TABLE `__new_ntfy` RENAME TO `ntfy`;--> statement-breakpoint
PRAGMA foreign_keys=ON;