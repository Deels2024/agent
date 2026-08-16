CREATE TABLE `delivery_addresses` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_email` text NOT NULL,
	`label` text DEFAULT 'Основной адрес' NOT NULL,
	`recipient_name` text NOT NULL,
	`phone` text NOT NULL,
	`country_code` text DEFAULT 'RU' NOT NULL,
	`postal_code` text,
	`region` text,
	`city` text NOT NULL,
	`address_line` text NOT NULL,
	`apartment` text,
	`entrance` text,
	`floor` text,
	`comment` text,
	`is_default` integer DEFAULT false NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `delivery_addresses_user_idx` ON `delivery_addresses` (`user_email`,`is_default`);--> statement-breakpoint
CREATE TABLE `delivery_connections` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`seller_id` integer NOT NULL,
	`provider` text DEFAULT 'apiship' NOT NULL,
	`account_label` text NOT NULL,
	`secret_ciphertext` text,
	`secret_iv` text,
	`status` text DEFAULT 'encrypted' NOT NULL,
	`last_checked_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`seller_id`) REFERENCES `sellers`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `delivery_connections_seller_idx` ON `delivery_connections` (`seller_id`,`provider`);--> statement-breakpoint
CREATE UNIQUE INDEX `delivery_connections_seller_provider_uidx` ON `delivery_connections` (`seller_id`,`provider`);--> statement-breakpoint
CREATE TABLE `delivery_quotes` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`public_id` text NOT NULL,
	`order_id` integer NOT NULL,
	`buyer_email` text NOT NULL,
	`provider` text NOT NULL,
	`provider_label` text NOT NULL,
	`service_name` text NOT NULL,
	`method` text NOT NULL,
	`tariff_id` text NOT NULL,
	`amount` real NOT NULL,
	`days_min` integer NOT NULL,
	`days_max` integer NOT NULL,
	`pickup_point_ids_json` text DEFAULT '[]' NOT NULL,
	`is_demo` integer DEFAULT false NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`expires_at` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `delivery_quotes_public_id_unique` ON `delivery_quotes` (`public_id`);--> statement-breakpoint
CREATE INDEX `delivery_quotes_order_idx` ON `delivery_quotes` (`order_id`,`status`);--> statement-breakpoint
CREATE INDEX `delivery_quotes_buyer_idx` ON `delivery_quotes` (`buyer_email`,`expires_at`);--> statement-breakpoint
CREATE TABLE `seller_delivery_profiles` (
	`seller_id` integer PRIMARY KEY NOT NULL,
	`contact_name` text NOT NULL,
	`phone` text NOT NULL,
	`country_code` text DEFAULT 'RU' NOT NULL,
	`postal_code` text,
	`region` text,
	`city` text NOT NULL,
	`address_line` text NOT NULL,
	`comment` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`seller_id`) REFERENCES `sellers`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
ALTER TABLE `deliveries` ADD `quote_public_id` text;--> statement-breakpoint
ALTER TABLE `deliveries` ADD `address_id` integer REFERENCES delivery_addresses(id);--> statement-breakpoint
ALTER TABLE `deliveries` ADD `method` text DEFAULT 'courier' NOT NULL;--> statement-breakpoint
ALTER TABLE `deliveries` ADD `service_name` text;--> statement-breakpoint
ALTER TABLE `deliveries` ADD `tariff_id` text;--> statement-breakpoint
ALTER TABLE `deliveries` ADD `amount` real DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `deliveries` ADD `days_min` integer;--> statement-breakpoint
ALTER TABLE `deliveries` ADD `days_max` integer;--> statement-breakpoint
ALTER TABLE `deliveries` ADD `pickup_point_id` text;--> statement-breakpoint
ALTER TABLE `deliveries` ADD `pickup_point_json` text;--> statement-breakpoint
ALTER TABLE `deliveries` ADD `recipient_json` text;--> statement-breakpoint
ALTER TABLE `deliveries` ADD `tracking_number` text;--> statement-breakpoint
ALTER TABLE `deliveries` ADD `is_demo` integer DEFAULT false NOT NULL;--> statement-breakpoint
CREATE INDEX `deliveries_external_idx` ON `deliveries` (`provider`,`external_id`);--> statement-breakpoint
ALTER TABLE `inventory_items` ADD `weight_grams` integer;--> statement-breakpoint
ALTER TABLE `inventory_items` ADD `length_cm` integer;--> statement-breakpoint
ALTER TABLE `inventory_items` ADD `width_cm` integer;--> statement-breakpoint
ALTER TABLE `inventory_items` ADD `height_cm` integer;