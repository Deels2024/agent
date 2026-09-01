CREATE TABLE `buyer_marketplace_connections` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_email` text NOT NULL,
	`provider` text NOT NULL,
	`account_label` text DEFAULT 'Ozon' NOT NULL,
	`status` text DEFAULT 'not_connected' NOT NULL,
	`auth_method` text DEFAULT 'external_login' NOT NULL,
	`scopes_json` text DEFAULT '[]' NOT NULL,
	`item_count` integer DEFAULT 0 NOT NULL,
	`consent_version` text,
	`consented_at` text,
	`last_sync_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `buyer_marketplace_connections_user_provider_uidx` ON `buyer_marketplace_connections` (`user_email`,`provider`);--> statement-breakpoint
CREATE INDEX `buyer_marketplace_connections_user_status_idx` ON `buyer_marketplace_connections` (`user_email`,`status`);--> statement-breakpoint
CREATE TABLE `buyer_marketplace_items` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`connection_id` integer NOT NULL,
	`user_email` text NOT NULL,
	`provider` text NOT NULL,
	`source_list` text DEFAULT 'shared_link' NOT NULL,
	`external_id` text NOT NULL,
	`product_name` text NOT NULL,
	`product_url` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`connection_id`) REFERENCES `buyer_marketplace_connections`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `buyer_marketplace_items_connection_external_uidx` ON `buyer_marketplace_items` (`connection_id`,`external_id`,`source_list`);--> statement-breakpoint
CREATE INDEX `buyer_marketplace_items_user_provider_idx` ON `buyer_marketplace_items` (`user_email`,`provider`,`status`);