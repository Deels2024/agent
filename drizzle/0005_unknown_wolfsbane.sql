CREATE TABLE `auth_tokens` (
	`token_hash` text PRIMARY KEY NOT NULL,
	`user_email` text NOT NULL,
	`purpose` text NOT NULL,
	`expires_at` text NOT NULL,
	`used_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `auth_tokens_user_purpose_idx` ON `auth_tokens` (`user_email`,`purpose`,`created_at`);--> statement-breakpoint
CREATE INDEX `auth_tokens_expires_idx` ON `auth_tokens` (`expires_at`);--> statement-breakpoint
ALTER TABLE `auth_credentials` ADD `email_verified_at` text;--> statement-breakpoint
UPDATE `auth_credentials` SET `email_verified_at` = `updated_at` WHERE `email_verified_at` IS NULL;--> statement-breakpoint
ALTER TABLE `notifications` ADD `read_at` text;
