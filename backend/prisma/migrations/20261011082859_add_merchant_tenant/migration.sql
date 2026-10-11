-- CreateTable
CREATE TABLE "merchants" (
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
CREATE TABLE "merchant_quota_txns" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "merchant_id" INTEGER NOT NULL,
    "delta" INTEGER NOT NULL,
    "quota_after" INTEGER NOT NULL,
    "operator_id" INTEGER NOT NULL DEFAULT 0,
    "note" TEXT NOT NULL DEFAULT '',
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "merchant_quota_txns_merchant_id_fkey" FOREIGN KEY ("merchant_id") REFERENCES "merchants" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
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
    "merchant_id" INTEGER,
    "aff_code" TEXT NOT NULL DEFAULT '',
    "inviter_id" INTEGER NOT NULL DEFAULT 0,
    "chandler_sub" TEXT NOT NULL DEFAULT '',
    "chandler_token" TEXT NOT NULL DEFAULT '',
    "last_login_at" INTEGER NOT NULL DEFAULT 0,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "users_merchant_id_fkey" FOREIGN KEY ("merchant_id") REFERENCES "merchants" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_users" ("aff_code", "chandler_sub", "chandler_token", "created_at", "display_name", "email", "id", "inviter_id", "last_login_at", "password_hash", "quota", "request_count", "role", "status", "used_quota", "user_group", "username") SELECT "aff_code", "chandler_sub", "chandler_token", "created_at", "display_name", "email", "id", "inviter_id", "last_login_at", "password_hash", "quota", "request_count", "role", "status", "used_quota", "user_group", "username" FROM "users";
DROP TABLE "users";
ALTER TABLE "new_users" RENAME TO "users";
CREATE UNIQUE INDEX "users_username_key" ON "users"("username");
CREATE UNIQUE INDEX "users_aff_code_key" ON "users"("aff_code");
CREATE INDEX "users_merchant_id_idx" ON "users"("merchant_id");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "merchants_code_key" ON "merchants"("code");

-- CreateIndex
CREATE INDEX "merchant_quota_txns_merchant_id_created_at_idx" ON "merchant_quota_txns"("merchant_id", "created_at");
