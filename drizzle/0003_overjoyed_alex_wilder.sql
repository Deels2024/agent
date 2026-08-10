CREATE TABLE `legal_acceptances` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_email` text NOT NULL,
	`document_slug` text NOT NULL,
	`document_version` text NOT NULL,
	`role_scope` text DEFAULT 'buyer' NOT NULL,
	`status` text DEFAULT 'accepted' NOT NULL,
	`accepted_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`revoked_at` text,
	`ip_hash` text,
	`user_agent_hash` text,
	`evidence_json` text DEFAULT '{}' NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `legal_acceptances_user_doc_version_scope_uidx` ON `legal_acceptances` (`user_email`,`document_slug`,`document_version`,`role_scope`);--> statement-breakpoint
CREATE INDEX `legal_acceptances_user_status_idx` ON `legal_acceptances` (`user_email`,`status`);--> statement-breakpoint
ALTER TABLE `orders` ADD `legal_bundle_version` text;--> statement-breakpoint
ALTER TABLE `orders` ADD `transaction_confirmation_version` text;--> statement-breakpoint
ALTER TABLE `orders` ADD `sale_contract_party` text DEFAULT 'seller' NOT NULL;--> statement-breakpoint
ALTER TABLE `orders` ADD `payment_model` text DEFAULT 'seller_or_payment_partner' NOT NULL;