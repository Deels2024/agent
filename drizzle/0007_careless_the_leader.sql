CREATE TABLE `product_feedback` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`search_id` integer NOT NULL,
	`user_email` text,
	`sentiment` text NOT NULL,
	`reason` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`search_id`) REFERENCES `searches`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `product_feedback_search_idx` ON `product_feedback` (`search_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `product_feedback_sentiment_idx` ON `product_feedback` (`sentiment`,`created_at`);