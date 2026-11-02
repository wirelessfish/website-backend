CREATE TABLE `guestbook` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`date` text DEFAULT (current_timestamp) NOT NULL,
	`name` text NOT NULL,
	`content` text NOT NULL,
	`site` text,
	`reply` integer,
	`status` text DEFAULT 'visible' NOT NULL,
	`badge` text DEFAULT 'none',
	FOREIGN KEY (`reply`) REFERENCES `guestbook`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `ntfy` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`date` text DEFAULT (current_timestamp) NOT NULL,
	`content` text
);
