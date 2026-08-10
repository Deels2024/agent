CREATE TABLE `demand_requests` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`public_id` text NOT NULL,
	`buyer_email` text NOT NULL,
	`query` text NOT NULL,
	`barcode` text,
	`target_price` real,
	`city` text,
	`quantity` integer DEFAULT 1 NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`expires_at` text NOT NULL,
	`accepted_proposal_id` integer,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `demand_requests_public_id_unique` ON `demand_requests` (`public_id`);--> statement-breakpoint
CREATE INDEX `demand_requests_buyer_idx` ON `demand_requests` (`buyer_email`,`created_at`);--> statement-breakpoint
CREATE INDEX `demand_requests_status_idx` ON `demand_requests` (`status`,`expires_at`);--> statement-breakpoint
CREATE INDEX `demand_requests_barcode_idx` ON `demand_requests` (`barcode`);--> statement-breakpoint
CREATE TABLE `quotes` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`public_id` text NOT NULL,
	`user_email` text,
	`search_id` integer,
	`offer_id` integer,
	`seller_id` integer,
	`inventory_item_id` integer,
	`provider` text NOT NULL,
	`provider_label` text NOT NULL,
	`seller_name` text NOT NULL,
	`product_name` text NOT NULL,
	`item_amount` real NOT NULL,
	`delivery_amount` real DEFAULT 0 NOT NULL,
	`total_amount` real NOT NULL,
	`currency` text DEFAULT 'RUB' NOT NULL,
	`source_url` text,
	`is_demo` integer DEFAULT false NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`expires_at` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`search_id`) REFERENCES `searches`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`offer_id`) REFERENCES `offers`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`seller_id`) REFERENCES `sellers`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`inventory_item_id`) REFERENCES `inventory_items`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `quotes_public_id_unique` ON `quotes` (`public_id`);--> statement-breakpoint
CREATE INDEX `quotes_user_status_idx` ON `quotes` (`user_email`,`status`);--> statement-breakpoint
CREATE INDEX `quotes_expires_idx` ON `quotes` (`expires_at`);--> statement-breakpoint
CREATE TABLE `seller_proposals` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`request_id` integer NOT NULL,
	`seller_id` integer NOT NULL,
	`inventory_item_id` integer,
	`price` real NOT NULL,
	`delivery_price` real DEFAULT 0 NOT NULL,
	`delivery_days` integer DEFAULT 1 NOT NULL,
	`warranty_months` integer DEFAULT 12 NOT NULL,
	`comment` text,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`request_id`) REFERENCES `demand_requests`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`seller_id`) REFERENCES `sellers`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`inventory_item_id`) REFERENCES `inventory_items`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `seller_proposals_request_idx` ON `seller_proposals` (`request_id`,`status`);--> statement-breakpoint
CREATE INDEX `seller_proposals_seller_idx` ON `seller_proposals` (`seller_id`,`created_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `seller_proposals_request_seller_uidx` ON `seller_proposals` (`request_id`,`seller_id`);--> statement-breakpoint
CREATE TABLE `webhook_events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`provider` text NOT NULL,
	`event_key` text NOT NULL,
	`status` text DEFAULT 'received' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `webhook_events_provider_key_uidx` ON `webhook_events` (`provider`,`event_key`);--> statement-breakpoint
ALTER TABLE `offers` ADD `provider_label` text DEFAULT 'Источник' NOT NULL;--> statement-breakpoint
ALTER TABLE `offers` ADD `seller_id` integer;--> statement-breakpoint
ALTER TABLE `offers` ADD `inventory_item_id` integer;--> statement-breakpoint
ALTER TABLE `offers` ADD `delivery_price` real DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `offers` ADD `match_confidence` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `offers` ADD `verified` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `orders` ADD `quote_public_id` text;--> statement-breakpoint
ALTER TABLE `orders` ADD `provider` text DEFAULT 'local_seller' NOT NULL;--> statement-breakpoint
ALTER TABLE `orders` ADD `seller_name` text;--> statement-breakpoint
ALTER TABLE `orders` ADD `item_amount` real DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `orders` ADD `delivery_amount` real DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `orders` ADD `is_demo` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `orders` ADD `terms_accepted_at` text;--> statement-breakpoint
ALTER TABLE `searches` ADD `user_email` text;--> statement-breakpoint
CREATE INDEX `searches_user_created_idx` ON `searches` (`user_email`,`created_at`);