/*
  Warnings:

  - You are about to drop the `merchant_quota_txns` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `merchants` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `user_entitlements` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the column `merchant_id` on the `users` table. All the data in the column will be lost.

*/
-- DropIndex
DROP INDEX "merchant_quota_txns_merchant_id_created_at_idx";

-- DropIndex
DROP INDEX "merchants_code_key";

-- DropIndex
DROP INDEX "user_entitlements_user_id_product_id_key";

-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "merchant_quota_txns";
PRAGMA foreign_keys=on;

-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "merchants";
PRAGMA foreign_keys=on;

-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "user_entitlements";
PRAGMA foreign_keys=on;

-- CreateTable
CREATE TABLE "tenants" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "contact" TEXT NOT NULL DEFAULT '',
    "status" INTEGER NOT NULL DEFAULT 1,
    "quota_pool" INTEGER NOT NULL DEFAULT 0,
    "used_quota" INTEGER NOT NULL DEFAULT 0,
    "expires_at" INTEGER NOT NULL DEFAULT 0,
    "remark" TEXT NOT NULL DEFAULT '',
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "tenant_entitlements" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "tenant_id" INTEGER NOT NULL,
    "product_id" TEXT NOT NULL,
    "name" TEXT NOT NULL DEFAULT '',
    "kind" TEXT NOT NULL,
    "expires_at" INTEGER NOT NULL DEFAULT 0,
    "enabled" INTEGER NOT NULL DEFAULT 1,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "tenant_entitlements_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "tenant_quota_txns" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "tenant_id" INTEGER NOT NULL,
    "delta" INTEGER NOT NULL,
    "quota_after" INTEGER NOT NULL,
    "operator_id" INTEGER NOT NULL DEFAULT 0,
    "note" TEXT NOT NULL DEFAULT '',
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "tenant_quota_txns_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_payment_orders" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "user_id" INTEGER NOT NULL,
    "tenant_id" INTEGER,
    "merchant_order_no" TEXT NOT NULL,
    "platform_order_no" TEXT NOT NULL DEFAULT '',
    "product_type" TEXT NOT NULL DEFAULT 'quota',
    "product_id" TEXT NOT NULL DEFAULT '',
    "amount_fen" INTEGER NOT NULL DEFAULT 0,
    "quota_granted" INTEGER NOT NULL DEFAULT 0,
    "service_days" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "trade_type" TEXT NOT NULL DEFAULT 'native',
    "prepay_info" TEXT NOT NULL DEFAULT '{}',
    "paid_at" INTEGER NOT NULL DEFAULT 0,
    "refunded_fen" INTEGER NOT NULL DEFAULT 0,
    "raw" TEXT NOT NULL DEFAULT '{}',
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "payment_orders_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "payment_orders_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_payment_orders" ("amount_fen", "created_at", "id", "merchant_order_no", "paid_at", "platform_order_no", "prepay_info", "product_id", "product_type", "quota_granted", "raw", "refunded_fen", "service_days", "status", "trade_type", "user_id") SELECT "amount_fen", "created_at", "id", "merchant_order_no", "paid_at", "platform_order_no", "prepay_info", "product_id", "product_type", "quota_granted", "raw", "refunded_fen", "service_days", "status", "trade_type", "user_id" FROM "payment_orders";
DROP TABLE "payment_orders";
ALTER TABLE "new_payment_orders" RENAME TO "payment_orders";
CREATE UNIQUE INDEX "payment_orders_merchant_order_no_key" ON "payment_orders"("merchant_order_no");
CREATE INDEX "payment_orders_user_id_status_idx" ON "payment_orders"("user_id", "status");
CREATE INDEX "payment_orders_tenant_id_status_idx" ON "payment_orders"("tenant_id", "status");
CREATE TABLE "new_users" (
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
    "tenant_id" INTEGER,
    "aff_code" TEXT NOT NULL DEFAULT '',
    "inviter_id" INTEGER NOT NULL DEFAULT 0,
    "chandler_sub" TEXT NOT NULL DEFAULT '',
    "chandler_token" TEXT NOT NULL DEFAULT '',
    "last_login_at" INTEGER NOT NULL DEFAULT 0,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "users_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_users" ("aff_code", "chandler_sub", "chandler_token", "created_at", "display_name", "email", "id", "inviter_id", "last_login_at", "password_hash", "quota", "request_count", "role", "status", "used_quota", "user_group", "username") SELECT "aff_code", "chandler_sub", "chandler_token", "created_at", "display_name", "email", "id", "inviter_id", "last_login_at", "password_hash", "quota", "request_count", "role", "status", "used_quota", "user_group", "username" FROM "users";
DROP TABLE "users";
ALTER TABLE "new_users" RENAME TO "users";
CREATE UNIQUE INDEX "users_username_key" ON "users"("username");
CREATE UNIQUE INDEX "users_aff_code_key" ON "users"("aff_code");
CREATE INDEX "users_tenant_id_idx" ON "users"("tenant_id");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "tenants_code_key" ON "tenants"("code");

-- CreateIndex
CREATE UNIQUE INDEX "tenant_entitlements_tenant_id_product_id_key" ON "tenant_entitlements"("tenant_id", "product_id");

-- CreateIndex
CREATE INDEX "tenant_quota_txns_tenant_id_created_at_idx" ON "tenant_quota_txns"("tenant_id", "created_at");
