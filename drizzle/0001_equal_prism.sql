PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_guestbook` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`date` text DEFAULT (current_timestamp) NOT NULL,
	`name` text NOT NULL,
	`content` text NOT NULL,
	`site` text,
	`reply` integer,
	`status` text DEFAULT 'visible' NOT NULL,
	`badge` text,
	FOREIGN KEY (`reply`) REFERENCES `guestbook`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_guestbook`("id", "date", "name", "content", "site", "reply", "status", "badge") SELECT "id", "date", "name", "content", "site", "reply", "status", "badge" FROM `guestbook`;--> statement-breakpoint
DROP TABLE `guestbook`;--> statement-breakpoint
ALTER TABLE `__new_guestbook` RENAME TO `guestbook`;--> statement-breakpoint
PRAGMA foreign_keys=ON;