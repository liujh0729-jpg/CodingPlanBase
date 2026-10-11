-- CreateTable
CREATE TABLE "users" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "username" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "display_name" TEXT NOT NULL DEFAULT '',
    "role" INTEGER NOT NULL DEFAULT 1,
    "status" INTEGER NOT NULL DEFAULT 1,
    "email" TEXT NOT NULL DEFAULT '',
    "quota" INTEGER NOT NULL DEFAULT 0,
    "used_quota" INTEGER NOT NULL DEFAULT 0,
    "request_count" INTEGER NOT NULL DEFAULT 0,
    "user_group" TEXT NOT NULL DEFAULT 'default',
    "aff_code" TEXT NOT NULL DEFAULT '',
    "inviter_id" INTEGER NOT NULL DEFAULT 0,
    "chandler_sub" TEXT NOT NULL DEFAULT '',
    "last_login_at" INTEGER NOT NULL DEFAULT 0,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "settings" (
    "key" TEXT NOT NULL PRIMARY KEY,
    "value" TEXT NOT NULL DEFAULT '',
    "updated_at" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "channels" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "type" INTEGER NOT NULL DEFAULT 0,
    "name" TEXT NOT NULL,
    "key" TEXT NOT NULL DEFAULT '',
    "base_url" TEXT NOT NULL DEFAULT '',
    "models" TEXT NOT NULL DEFAULT '',
    "group" TEXT NOT NULL DEFAULT 'default',
    "priority" INTEGER NOT NULL DEFAULT 0,
    "weight" INTEGER NOT NULL DEFAULT 0,
    "status" INTEGER NOT NULL DEFAULT 1,
    "auto_ban" INTEGER NOT NULL DEFAULT 1,
    "model_mapping" TEXT NOT NULL DEFAULT '',
    "param_override" TEXT NOT NULL DEFAULT '',
    "header_override" TEXT NOT NULL DEFAULT '',
    "other_settings" TEXT NOT NULL DEFAULT '',
    "test_model" TEXT NOT NULL DEFAULT '',
    "response_time" INTEGER NOT NULL DEFAULT 0,
    "balance" REAL NOT NULL DEFAULT 0,
    "balance_updated_at" INTEGER NOT NULL DEFAULT 0,
    "used_quota" INTEGER NOT NULL DEFAULT 0,
    "tag" TEXT NOT NULL DEFAULT '',
    "remark" TEXT NOT NULL DEFAULT '',
    "is_managed" INTEGER NOT NULL DEFAULT 0,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "tokens" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "user_id" INTEGER NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL DEFAULT '',
    "status" INTEGER NOT NULL DEFAULT 1,
    "remain_quota" INTEGER NOT NULL DEFAULT 0,
    "unlimited_quota" BOOLEAN NOT NULL DEFAULT true,
    "used_quota" INTEGER NOT NULL DEFAULT 0,
    "model_limits_on" BOOLEAN NOT NULL DEFAULT false,
    "model_limits" TEXT NOT NULL DEFAULT '',
    "allow_ips" TEXT NOT NULL DEFAULT '',
    "expired_at" INTEGER NOT NULL DEFAULT -1,
    "group" TEXT NOT NULL DEFAULT '',
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "accessed_at" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "gateway_models" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "model_name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "icon" TEXT NOT NULL DEFAULT '',
    "tags" TEXT NOT NULL DEFAULT '',
    "vendor_name" TEXT NOT NULL DEFAULT '',
    "quota_type" INTEGER NOT NULL DEFAULT 0,
    "model_ratio" REAL NOT NULL DEFAULT 0,
    "completion_ratio" REAL NOT NULL DEFAULT 1,
    "cache_read_ratio" REAL NOT NULL DEFAULT 0,
    "cache_write_ratio" REAL NOT NULL DEFAULT 0,
    "call_usd_price" REAL NOT NULL DEFAULT 0,
    "enable_groups" TEXT NOT NULL DEFAULT 'default',
    "groupRatio" REAL NOT NULL DEFAULT 1,
    "price_source" TEXT NOT NULL DEFAULT 'manual',
    "endpoints" TEXT NOT NULL DEFAULT 'chat',
    "multimodal" BOOLEAN NOT NULL DEFAULT false,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "catalog_snapshot" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT DEFAULT 1,
    "schema_version" TEXT NOT NULL DEFAULT '',
    "revision" TEXT NOT NULL DEFAULT '',
    "source_base_url" TEXT NOT NULL DEFAULT '',
    "payload" TEXT NOT NULL DEFAULT '{}',
    "synced_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "logs" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "user_id" INTEGER NOT NULL,
    "type" INTEGER NOT NULL,
    "content" TEXT NOT NULL DEFAULT '',
    "username" TEXT NOT NULL DEFAULT '',
    "token_name" TEXT NOT NULL DEFAULT '',
    "model_name" TEXT NOT NULL DEFAULT '',
    "quota" INTEGER NOT NULL DEFAULT 0,
    "prompt_tokens" INTEGER NOT NULL DEFAULT 0,
    "completion_tokens" INTEGER NOT NULL DEFAULT 0,
    "use_time" INTEGER NOT NULL DEFAULT 0,
    "is_stream" BOOLEAN NOT NULL DEFAULT false,
    "channel_id" INTEGER NOT NULL DEFAULT 0,
    "channel_name" TEXT NOT NULL DEFAULT '',
    "token_id" INTEGER NOT NULL DEFAULT 0,
    "group" TEXT NOT NULL DEFAULT '',
    "ip" TEXT NOT NULL DEFAULT '',
    "request_id" TEXT NOT NULL DEFAULT '',
    "other" TEXT NOT NULL DEFAULT '{}',
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "logs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "logs_channel_id_fkey" FOREIGN KEY ("channel_id") REFERENCES "channels" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "logs_token_id_fkey" FOREIGN KEY ("token_id") REFERENCES "tokens" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "quota_txns" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "user_id" INTEGER NOT NULL,
    "type" TEXT NOT NULL,
    "delta" INTEGER NOT NULL,
    "quota_after" INTEGER NOT NULL,
    "operator_id" INTEGER NOT NULL DEFAULT 0,
    "note" TEXT NOT NULL DEFAULT '',
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "quota_txns_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "user_id" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "detail" TEXT NOT NULL DEFAULT '',
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "payment_orders" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "user_id" INTEGER NOT NULL,
    "merchant_order_no" TEXT NOT NULL,
    "product_type" TEXT NOT NULL DEFAULT 'membership',
    "product_id" TEXT NOT NULL DEFAULT '',
    "amount_fen" INTEGER NOT NULL DEFAULT 0,
    "quota_granted" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "trade_type" TEXT NOT NULL DEFAULT 'native',
    "prepay_info" TEXT NOT NULL DEFAULT '{}',
    "paid_at" INTEGER NOT NULL DEFAULT 0,
    "refunded_fen" INTEGER NOT NULL DEFAULT 0,
    "raw" TEXT NOT NULL DEFAULT '{}',
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "payment_orders_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "payment_refunds" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "order_id" INTEGER NOT NULL,
    "merchant_refund_no" TEXT NOT NULL,
    "amount_fen" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'SUBMITTED',
    "reason" TEXT NOT NULL DEFAULT '',
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "payment_refunds_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "payment_orders" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "users_username_key" ON "users"("username");

-- CreateIndex
CREATE UNIQUE INDEX "users_aff_code_key" ON "users"("aff_code");

-- CreateIndex
CREATE UNIQUE INDEX "tokens_key_key" ON "tokens"("key");

-- CreateIndex
CREATE INDEX "tokens_user_id_idx" ON "tokens"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "gateway_models_model_name_key" ON "gateway_models"("model_name");

-- CreateIndex
CREATE INDEX "logs_user_id_created_at_idx" ON "logs"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "quota_txns_user_id_created_at_idx" ON "quota_txns"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "audit_logs_user_id_action_idx" ON "audit_logs"("user_id", "action");

-- CreateIndex
CREATE UNIQUE INDEX "payment_orders_merchant_order_no_key" ON "payment_orders"("merchant_order_no");

-- CreateIndex
CREATE INDEX "payment_orders_user_id_status_idx" ON "payment_orders"("user_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "payment_refunds_merchant_refund_no_key" ON "payment_refunds"("merchant_refund_no");
