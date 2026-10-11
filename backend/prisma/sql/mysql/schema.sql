-- MySQL 8 表结构
-- 由 Prisma 生成自 prisma/dialects/mysql.prisma，变更结构请改该文件后重新生成，不要手工编辑本文件。
-- 前置：先建好空库（utf8mb4）并把 DATABASE_URL 设为 mysql://... 指向它。
-- 应用：pnpm --filter codingplan-base-api db:apply:mysql
-- 之后：pnpm --filter codingplan-base-api prisma:generate:mysql（为 MySQL 重新生成 client），再重启服务。
-- CodingPlan Base · mysql
-- CreateTable
CREATE TABLE `tenants` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(191) NOT NULL,
    `code` VARCHAR(191) NOT NULL,
    `contact` VARCHAR(191) NOT NULL DEFAULT '',
    `status` INTEGER NOT NULL DEFAULT 1,
    `quota_pool` INTEGER NOT NULL DEFAULT 0,
    `used_quota` INTEGER NOT NULL DEFAULT 0,
    `expires_at` INTEGER NOT NULL DEFAULT 0,
    `remark` VARCHAR(191) NOT NULL DEFAULT '',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `tenants_code_key`(`code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `tenant_entitlements` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `tenant_id` INTEGER NOT NULL,
    `product_id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL DEFAULT '',
    `kind` VARCHAR(191) NOT NULL,
    `expires_at` INTEGER NOT NULL DEFAULT 0,
    `enabled` INTEGER NOT NULL DEFAULT 1,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `tenant_entitlements_tenant_id_product_id_key`(`tenant_id`, `product_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `tenant_quota_txns` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `tenant_id` INTEGER NOT NULL,
    `delta` INTEGER NOT NULL,
    `quota_after` INTEGER NOT NULL,
    `operator_id` INTEGER NOT NULL DEFAULT 0,
    `note` VARCHAR(191) NOT NULL DEFAULT '',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `tenant_quota_txns_tenant_id_created_at_idx`(`tenant_id`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `users` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `username` VARCHAR(191) NOT NULL,
    `password_hash` VARCHAR(191) NOT NULL,
    `display_name` VARCHAR(191) NOT NULL DEFAULT '',
    `role` INTEGER NOT NULL DEFAULT 1,
    `status` INTEGER NOT NULL DEFAULT 1,
    `email` VARCHAR(191) NOT NULL DEFAULT '',
    `user_group` VARCHAR(191) NOT NULL DEFAULT 'default',
    `aff_code` VARCHAR(191) NOT NULL DEFAULT '',
    `inviter_id` INTEGER NOT NULL DEFAULT 0,
    `chandler_sub` VARCHAR(191) NOT NULL DEFAULT '',
    `chandler_token` VARCHAR(191) NOT NULL DEFAULT '',
    `last_login_at` INTEGER NOT NULL DEFAULT 0,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `users_username_key`(`username`),
    UNIQUE INDEX `users_aff_code_key`(`aff_code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `tenant_members` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `tenant_id` INTEGER NOT NULL,
    `user_id` INTEGER NOT NULL,
    `role` INTEGER NOT NULL DEFAULT 1,
    `status` INTEGER NOT NULL DEFAULT 1,
    `quota` INTEGER NOT NULL DEFAULT 0,
    `used_quota` INTEGER NOT NULL DEFAULT 0,
    `request_count` INTEGER NOT NULL DEFAULT 0,
    `joined_at` INTEGER NOT NULL DEFAULT 0,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `tenant_members_user_id_idx`(`user_id`),
    UNIQUE INDEX `tenant_members_tenant_id_user_id_key`(`tenant_id`, `user_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `settings` (
    `key` VARCHAR(191) NOT NULL,
    `value` VARCHAR(191) NOT NULL DEFAULT '',
    `updated_at` DATETIME(3) NOT NULL,

    PRIMARY KEY (`key`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `channels` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `type` INTEGER NOT NULL DEFAULT 1,
    `name` VARCHAR(191) NOT NULL,
    `key` VARCHAR(191) NOT NULL DEFAULT '',
    `base_url` VARCHAR(191) NOT NULL DEFAULT '',
    `api_prefix` VARCHAR(191) NOT NULL DEFAULT '/v1',
    `models` VARCHAR(191) NOT NULL DEFAULT '',
    `group` VARCHAR(191) NOT NULL DEFAULT 'default',
    `priority` INTEGER NOT NULL DEFAULT 0,
    `weight` INTEGER NOT NULL DEFAULT 0,
    `status` INTEGER NOT NULL DEFAULT 1,
    `auto_ban` INTEGER NOT NULL DEFAULT 1,
    `model_mapping` VARCHAR(191) NOT NULL DEFAULT '',
    `param_override` VARCHAR(191) NOT NULL DEFAULT '',
    `header_override` VARCHAR(191) NOT NULL DEFAULT '',
    `other_settings` VARCHAR(191) NOT NULL DEFAULT '',
    `test_model` VARCHAR(191) NOT NULL DEFAULT '',
    `response_time` INTEGER NOT NULL DEFAULT 0,
    `balance` DOUBLE NOT NULL DEFAULT 0,
    `balance_updated_at` INTEGER NOT NULL DEFAULT 0,
    `used_quota` INTEGER NOT NULL DEFAULT 0,
    `tag` VARCHAR(191) NOT NULL DEFAULT '',
    `remark` VARCHAR(191) NOT NULL DEFAULT '',
    `is_managed` INTEGER NOT NULL DEFAULT 0,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `tokens` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `user_id` INTEGER NOT NULL,
    `tenant_id` INTEGER NOT NULL DEFAULT 0,
    `key` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL DEFAULT '',
    `status` INTEGER NOT NULL DEFAULT 1,
    `remain_quota` INTEGER NOT NULL DEFAULT 0,
    `unlimited_quota` BOOLEAN NOT NULL DEFAULT true,
    `used_quota` INTEGER NOT NULL DEFAULT 0,
    `model_limits_on` BOOLEAN NOT NULL DEFAULT false,
    `model_limits` VARCHAR(191) NOT NULL DEFAULT '',
    `allow_ips` VARCHAR(191) NOT NULL DEFAULT '',
    `expired_at` INTEGER NOT NULL DEFAULT -1,
    `group` VARCHAR(191) NOT NULL DEFAULT '',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `accessed_at` INTEGER NOT NULL DEFAULT 0,

    UNIQUE INDEX `tokens_key_key`(`key`),
    INDEX `tokens_user_id_idx`(`user_id`),
    INDEX `tokens_tenant_id_user_id_idx`(`tenant_id`, `user_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `gateway_models` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `model_name` VARCHAR(191) NOT NULL,
    `description` VARCHAR(191) NOT NULL DEFAULT '',
    `icon` VARCHAR(191) NOT NULL DEFAULT '',
    `tags` VARCHAR(191) NOT NULL DEFAULT '',
    `vendor_name` VARCHAR(191) NOT NULL DEFAULT '',
    `quota_type` INTEGER NOT NULL DEFAULT 0,
    `model_ratio` DOUBLE NOT NULL DEFAULT 0,
    `completion_ratio` DOUBLE NOT NULL DEFAULT 1,
    `cache_read_ratio` DOUBLE NOT NULL DEFAULT 0,
    `cache_write_ratio` DOUBLE NOT NULL DEFAULT 0,
    `call_cny_price` DOUBLE NOT NULL DEFAULT 0,
    `enable_groups` VARCHAR(191) NOT NULL DEFAULT 'default',
    `groupRatio` DOUBLE NOT NULL DEFAULT 1,
    `price_source` VARCHAR(191) NOT NULL DEFAULT 'manual',
    `endpoints` VARCHAR(191) NOT NULL DEFAULT 'chat',
    `multimodal` BOOLEAN NOT NULL DEFAULT false,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `gateway_models_model_name_key`(`model_name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `catalog_snapshot` (
    `id` INTEGER NOT NULL DEFAULT 1,
    `schema_version` VARCHAR(191) NOT NULL DEFAULT '',
    `revision` VARCHAR(191) NOT NULL DEFAULT '',
    `source_base_url` VARCHAR(191) NOT NULL DEFAULT '',
    `payload` VARCHAR(191) NOT NULL DEFAULT '{}',
    `synced_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `logs` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `user_id` INTEGER NOT NULL,
    `tenant_id` INTEGER NOT NULL DEFAULT 0,
    `type` INTEGER NOT NULL,
    `content` VARCHAR(191) NOT NULL DEFAULT '',
    `username` VARCHAR(191) NOT NULL DEFAULT '',
    `token_name` VARCHAR(191) NOT NULL DEFAULT '',
    `model_name` VARCHAR(191) NOT NULL DEFAULT '',
    `quota` INTEGER NOT NULL DEFAULT 0,
    `prompt_tokens` INTEGER NOT NULL DEFAULT 0,
    `completion_tokens` INTEGER NOT NULL DEFAULT 0,
    `use_time` INTEGER NOT NULL DEFAULT 0,
    `is_stream` BOOLEAN NOT NULL DEFAULT false,
    `channel_id` INTEGER NULL,
    `channel_name` VARCHAR(191) NOT NULL DEFAULT '',
    `token_id` INTEGER NULL,
    `group` VARCHAR(191) NOT NULL DEFAULT '',
    `ip` VARCHAR(191) NOT NULL DEFAULT '',
    `request_id` VARCHAR(191) NOT NULL DEFAULT '',
    `other` VARCHAR(191) NOT NULL DEFAULT '{}',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `logs_user_id_created_at_idx`(`user_id`, `created_at`),
    INDEX `logs_tenant_id_created_at_idx`(`tenant_id`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `quota_txns` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `user_id` INTEGER NOT NULL,
    `tenant_id` INTEGER NOT NULL DEFAULT 0,
    `type` VARCHAR(191) NOT NULL,
    `delta` INTEGER NOT NULL,
    `quota_after` INTEGER NOT NULL,
    `operator_id` INTEGER NOT NULL DEFAULT 0,
    `note` VARCHAR(191) NOT NULL DEFAULT '',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `quota_txns_user_id_created_at_idx`(`user_id`, `created_at`),
    INDEX `quota_txns_tenant_id_created_at_idx`(`tenant_id`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `audit_logs` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `user_id` VARCHAR(191) NOT NULL,
    `action` VARCHAR(191) NOT NULL,
    `detail` VARCHAR(191) NOT NULL DEFAULT '',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `audit_logs_user_id_action_idx`(`user_id`, `action`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `payment_orders` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `user_id` INTEGER NOT NULL,
    `tenant_id` INTEGER NULL,
    `merchant_order_no` VARCHAR(191) NOT NULL,
    `platform_order_no` VARCHAR(191) NOT NULL DEFAULT '',
    `product_type` VARCHAR(191) NOT NULL DEFAULT 'quota',
    `product_id` VARCHAR(191) NOT NULL DEFAULT '',
    `amount_fen` INTEGER NOT NULL DEFAULT 0,
    `quota_granted` INTEGER NOT NULL DEFAULT 0,
    `service_days` INTEGER NOT NULL DEFAULT 0,
    `status` VARCHAR(191) NOT NULL DEFAULT 'PENDING',
    `trade_type` VARCHAR(191) NOT NULL DEFAULT 'native',
    `prepay_info` VARCHAR(191) NOT NULL DEFAULT '{}',
    `paid_at` INTEGER NOT NULL DEFAULT 0,
    `refunded_fen` INTEGER NOT NULL DEFAULT 0,
    `raw` VARCHAR(191) NOT NULL DEFAULT '{}',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `payment_orders_merchant_order_no_key`(`merchant_order_no`),
    INDEX `payment_orders_user_id_status_idx`(`user_id`, `status`),
    INDEX `payment_orders_tenant_id_status_idx`(`tenant_id`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `payment_refunds` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `order_id` INTEGER NOT NULL,
    `merchant_refund_no` VARCHAR(191) NOT NULL,
    `amount_fen` INTEGER NOT NULL DEFAULT 0,
    `status` VARCHAR(191) NOT NULL DEFAULT 'SUBMITTED',
    `reason` VARCHAR(191) NOT NULL DEFAULT '',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `payment_refunds_merchant_refund_no_key`(`merchant_refund_no`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `tenant_entitlements` ADD CONSTRAINT `tenant_entitlements_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `tenant_quota_txns` ADD CONSTRAINT `tenant_quota_txns_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `tenant_members` ADD CONSTRAINT `tenant_members_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `tenant_members` ADD CONSTRAINT `tenant_members_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `tokens` ADD CONSTRAINT `tokens_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `logs` ADD CONSTRAINT `logs_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `quota_txns` ADD CONSTRAINT `quota_txns_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `payment_orders` ADD CONSTRAINT `payment_orders_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `payment_orders` ADD CONSTRAINT `payment_orders_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `payment_refunds` ADD CONSTRAINT `payment_refunds_order_id_fkey` FOREIGN KEY (`order_id`) REFERENCES `payment_orders`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

