CREATE TABLE `marketplace_events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`provider` text NOT NULL,
	`event_type` text NOT NULL,
	`status` text NOT NULL,
	`message` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `marketplace_events_provider_idx` ON `marketplace_events` (`provider`,`created_at`);--> statement-breakpoint
CREATE TABLE `offers` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`search_id` integer NOT NULL,
	`provider` text NOT NULL,
	`external_id` text NOT NULL,
	`product_name` text NOT NULL,
	`seller_name` text NOT NULL,
	`price` real NOT NULL,
	`old_price` real,
	`delivery_days` integer,
	`in_stock` integer DEFAULT true NOT NULL,
	`score` integer DEFAULT 0 NOT NULL,
	`url` text,
	`fetched_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`search_id`) REFERENCES `searches`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `offers_search_id_idx` ON `offers` (`search_id`);--> statement-breakpoint
CREATE INDEX `offers_provider_external_idx` ON `offers` (`provider`,`external_id`);--> statement-breakpoint
CREATE TABLE `recognitions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`product_name` text NOT NULL,
	`brand` text,
	`model` text,
	`barcode` text,
	`confidence` real DEFAULT 0 NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE `searches` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`query` text NOT NULL,
	`search_type` text DEFAULT 'text' NOT NULL,
	`recognized_name` text,
	`barcode` text,
	`provider_count` integer DEFAULT 0 NOT NULL,
	`offer_count` integer DEFAULT 0 NOT NULL,
	`is_demo` integer DEFAULT false NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `searches_created_at_idx` ON `searches` (`created_at`);