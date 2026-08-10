CREATE TABLE `audit_logs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`actor_email` text,
	`action` text NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` text,
	`ip_hash` text,
	`metadata_json` text DEFAULT '{}' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `audit_logs_created_idx` ON `audit_logs` (`created_at`);--> statement-breakpoint
CREATE TABLE `deliveries` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`order_id` integer NOT NULL,
	`provider` text NOT NULL,
	`external_id` text,
	`status` text DEFAULT 'created' NOT NULL,
	`eta` text,
	`tracking_url` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `deliveries_order_idx` ON `deliveries` (`order_id`,`status`);--> statement-breakpoint
CREATE TABLE `disputes` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`order_id` integer NOT NULL,
	`opened_by_email` text NOT NULL,
	`reason` text NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`resolution` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `disputes_order_status_idx` ON `disputes` (`order_id`,`status`);--> statement-breakpoint
CREATE TABLE `inventory_items` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`seller_id` integer NOT NULL,
	`external_id` text,
	`product_name` text NOT NULL,
	`barcode` text,
	`price` real NOT NULL,
	`stock` integer DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`seller_id`) REFERENCES `sellers`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `inventory_seller_status_idx` ON `inventory_items` (`seller_id`,`status`);--> statement-breakpoint
CREATE INDEX `inventory_barcode_idx` ON `inventory_items` (`barcode`);--> statement-breakpoint
CREATE TABLE `marketplace_connections` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`seller_id` integer NOT NULL,
	`provider` text NOT NULL,
	`account_label` text NOT NULL,
	`secret_ciphertext` text,
	`secret_iv` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`last_sync_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`seller_id`) REFERENCES `sellers`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `marketplace_connections_seller_idx` ON `marketplace_connections` (`seller_id`,`provider`);--> statement-breakpoint
CREATE TABLE `notifications` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`recipient_email` text NOT NULL,
	`channel` text DEFAULT 'in_app' NOT NULL,
	`template` text NOT NULL,
	`payload_json` text DEFAULT '{}' NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`scheduled_at` text,
	`sent_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `notifications_recipient_status_idx` ON `notifications` (`recipient_email`,`status`);--> statement-breakpoint
CREATE TABLE `orders` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`public_id` text NOT NULL,
	`buyer_email` text NOT NULL,
	`seller_id` integer,
	`product_name` text NOT NULL,
	`amount` real NOT NULL,
	`currency` text DEFAULT 'RUB' NOT NULL,
	`status` text DEFAULT 'created' NOT NULL,
	`payment_status` text DEFAULT 'not_started' NOT NULL,
	`delivery_status` text DEFAULT 'not_started' NOT NULL,
	`protection_until` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`seller_id`) REFERENCES `sellers`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `orders_public_id_unique` ON `orders` (`public_id`);--> statement-breakpoint
CREATE INDEX `orders_buyer_created_idx` ON `orders` (`buyer_email`,`created_at`);--> statement-breakpoint
CREATE INDEX `orders_seller_status_idx` ON `orders` (`seller_id`,`status`);--> statement-breakpoint
CREATE TABLE `payment_intents` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`order_id` integer NOT NULL,
	`provider` text NOT NULL,
	`external_id` text,
	`idempotency_key` text NOT NULL,
	`amount` real NOT NULL,
	`status` text DEFAULT 'created' NOT NULL,
	`confirmation_url` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `payment_intents_idempotency_key_unique` ON `payment_intents` (`idempotency_key`);--> statement-breakpoint
CREATE INDEX `payment_intents_order_idx` ON `payment_intents` (`order_id`,`status`);--> statement-breakpoint
CREATE TABLE `price_alerts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_email` text NOT NULL,
	`query` text NOT NULL,
	`target_price` real NOT NULL,
	`current_price` real,
	`channel` text DEFAULT 'in_app' NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`last_checked_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `price_alerts_user_status_idx` ON `price_alerts` (`user_email`,`status`);--> statement-breakpoint
CREATE TABLE `rate_limits` (
	`key` text PRIMARY KEY NOT NULL,
	`window_started_at` integer NOT NULL,
	`count` integer DEFAULT 0 NOT NULL,
	`blocked_until` integer
);
--> statement-breakpoint
CREATE TABLE `risk_events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`actor_email` text,
	`event_type` text NOT NULL,
	`score` integer DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`details_json` text DEFAULT '{}' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `risk_events_status_score_idx` ON `risk_events` (`status`,`score`);--> statement-breakpoint
CREATE TABLE `seller_verifications` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`seller_id` integer NOT NULL,
	`provider` text DEFAULT 'manual' NOT NULL,
	`external_id` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`comment` text,
	`checked_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`seller_id`) REFERENCES `sellers`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `seller_verifications_seller_idx` ON `seller_verifications` (`seller_id`,`status`);--> statement-breakpoint
CREATE TABLE `sellers` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`owner_email` text NOT NULL,
	`name` text NOT NULL,
	`inn` text,
	`status` text DEFAULT 'draft' NOT NULL,
	`kyc_status` text DEFAULT 'not_started' NOT NULL,
	`risk_score` integer DEFAULT 0 NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `sellers_owner_email_idx` ON `sellers` (`owner_email`);--> statement-breakpoint
CREATE INDEX `sellers_status_idx` ON `sellers` (`status`,`kyc_status`);--> statement-breakpoint
CREATE TABLE `subscriptions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_email` text NOT NULL,
	`plan` text DEFAULT 'plus' NOT NULL,
	`provider` text DEFAULT 'internal' NOT NULL,
	`external_id` text,
	`status` text DEFAULT 'trial' NOT NULL,
	`current_period_end` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `subscriptions_user_status_idx` ON `subscriptions` (`user_email`,`status`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`email` text NOT NULL,
	`display_name` text,
	`role` text DEFAULT 'buyer' NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_unique` ON `users` (`email`);--> statement-breakpoint
CREATE INDEX `users_role_status_idx` ON `users` (`role`,`status`);