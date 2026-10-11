-- 用户体系重构：人 ↔ 租户多对多，额度与用量记在成员身份上
-- 回填顺序很关键：tenant_members 与三张表的 tenant_id 都要在 `users` 被重建（丢掉 tenant_id/quota）之前取数。

-- CreateTable
CREATE TABLE "tenant_members" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "tenant_id" INTEGER NOT NULL,
    "user_id" INTEGER NOT NULL,
    "role" INTEGER NOT NULL DEFAULT 1,
    "status" INTEGER NOT NULL DEFAULT 1,
    "quota" INTEGER NOT NULL DEFAULT 0,
    "used_quota" INTEGER NOT NULL DEFAULT 0,
    "request_count" INTEGER NOT NULL DEFAULT 0,
    "joined_at" INTEGER NOT NULL DEFAULT 0,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "tenant_members_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "tenant_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- 原 users.tenant_id 平移成成员身份；全局 role=5 变成租户内 role=5，其余落为普通成员
INSERT INTO "tenant_members" ("tenant_id", "user_id", "role", "status", "quota", "used_quota", "request_count", "joined_at", "created_at")
SELECT u."tenant_id",
       u."id",
       CASE WHEN u."role" = 5 THEN 5 ELSE 1 END,
       u."status",
       u."quota",
       u."used_quota",
       u."request_count",
       -- Prisma 在 SQLite 里把 DateTime 存成整数毫秒，直接换算成秒；strftime 对整数入参返回 NULL
       CAST(u."created_at" / 1000 AS INTEGER),
       u."created_at"
FROM "users" u
WHERE u."tenant_id" IS NOT NULL;

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_logs" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "user_id" INTEGER NOT NULL,
    "tenant_id" INTEGER NOT NULL DEFAULT 0,
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
    "channel_id" INTEGER,
    "channel_name" TEXT NOT NULL DEFAULT '',
    "token_id" INTEGER,
    "group" TEXT NOT NULL DEFAULT '',
    "ip" TEXT NOT NULL DEFAULT '',
    "request_id" TEXT NOT NULL DEFAULT '',
    "other" TEXT NOT NULL DEFAULT '{}',
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "logs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_logs" ("channel_id", "channel_name", "completion_tokens", "content", "created_at", "group", "id", "ip", "is_stream", "model_name", "other", "prompt_tokens", "quota", "request_id", "token_id", "token_name", "type", "use_time", "user_id", "username") SELECT "channel_id", "channel_name", "completion_tokens", "content", "created_at", "group", "id", "ip", "is_stream", "model_name", "other", "prompt_tokens", "quota", "request_id", "token_id", "token_name", "type", "use_time", "user_id", "username" FROM "logs";
DROP TABLE "logs";
ALTER TABLE "new_logs" RENAME TO "logs";
CREATE INDEX "logs_user_id_created_at_idx" ON "logs"("user_id", "created_at");
CREATE INDEX "logs_tenant_id_created_at_idx" ON "logs"("tenant_id", "created_at");
-- 历史日志按当时的归属补上租户（无租户的平台账号留 0，表示归属未知）
UPDATE "logs" SET "tenant_id" = COALESCE((SELECT u."tenant_id" FROM "users" u WHERE u."id" = "logs"."user_id"), 0);
CREATE TABLE "new_quota_txns" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "user_id" INTEGER NOT NULL,
    "tenant_id" INTEGER NOT NULL DEFAULT 0,
    "type" TEXT NOT NULL,
    "delta" INTEGER NOT NULL,
    "quota_after" INTEGER NOT NULL,
    "operator_id" INTEGER NOT NULL DEFAULT 0,
    "note" TEXT NOT NULL DEFAULT '',
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "quota_txns_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_quota_txns" ("created_at", "delta", "id", "note", "operator_id", "quota_after", "type", "user_id") SELECT "created_at", "delta", "id", "note", "operator_id", "quota_after", "type", "user_id" FROM "quota_txns";
DROP TABLE "quota_txns";
ALTER TABLE "new_quota_txns" RENAME TO "quota_txns";
CREATE INDEX "quota_txns_user_id_created_at_idx" ON "quota_txns"("user_id", "created_at");
CREATE INDEX "quota_txns_tenant_id_created_at_idx" ON "quota_txns"("tenant_id", "created_at");
UPDATE "quota_txns" SET "tenant_id" = COALESCE((SELECT u."tenant_id" FROM "users" u WHERE u."id" = "quota_txns"."user_id"), 0);
CREATE TABLE "new_tokens" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "user_id" INTEGER NOT NULL,
    "tenant_id" INTEGER NOT NULL DEFAULT 0,
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
INSERT INTO "new_tokens" ("accessed_at", "allow_ips", "created_at", "expired_at", "group", "id", "key", "model_limits", "model_limits_on", "name", "remain_quota", "status", "unlimited_quota", "used_quota", "user_id") SELECT "accessed_at", "allow_ips", "created_at", "expired_at", "group", "id", "key", "model_limits", "model_limits_on", "name", "remain_quota", "status", "unlimited_quota", "used_quota", "user_id" FROM "tokens";
DROP TABLE "tokens";
ALTER TABLE "new_tokens" RENAME TO "tokens";
CREATE UNIQUE INDEX "tokens_key_key" ON "tokens"("key");
CREATE INDEX "tokens_user_id_idx" ON "tokens"("user_id");
CREATE INDEX "tokens_tenant_id_user_id_idx" ON "tokens"("tenant_id", "user_id");
UPDATE "tokens" SET "tenant_id" = COALESCE((SELECT u."tenant_id" FROM "users" u WHERE u."id" = "tokens"."user_id"), 0);
-- 归属不明的历史令牌一律停用：新口径下没有当前租户的令牌不可能被正确计费
UPDATE "tokens" SET "status" = 0 WHERE "tenant_id" = 0;
CREATE TABLE "new_users" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "username" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "display_name" TEXT NOT NULL DEFAULT '',
    "role" INTEGER NOT NULL DEFAULT 1,
    "status" INTEGER NOT NULL DEFAULT 1,
    "email" TEXT NOT NULL DEFAULT '',
    "user_group" TEXT NOT NULL DEFAULT 'default',
    "aff_code" TEXT NOT NULL DEFAULT '',
    "inviter_id" INTEGER NOT NULL DEFAULT 0,
    "chandler_sub" TEXT NOT NULL DEFAULT '',
    "chandler_token" TEXT NOT NULL DEFAULT '',
    "last_login_at" INTEGER NOT NULL DEFAULT 0,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO "new_users" ("aff_code", "chandler_sub", "chandler_token", "created_at", "display_name", "email", "id", "inviter_id", "last_login_at", "password_hash", "role", "status", "user_group", "username") SELECT "aff_code", "chandler_sub", "chandler_token", "created_at", "display_name", "email", "id", "inviter_id", "last_login_at", "password_hash", "role", "status", "user_group", "username" FROM "users";
DROP TABLE "users";
ALTER TABLE "new_users" RENAME TO "users";
CREATE UNIQUE INDEX "users_username_key" ON "users"("username");
CREATE UNIQUE INDEX "users_aff_code_key" ON "users"("aff_code");
-- 全局身份不再包含 5：租户管理员是租户内角色，历史数据统一落回普通用户
UPDATE "users" SET "role" = 1 WHERE "role" = 5;
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "tenant_members_user_id_idx" ON "tenant_members"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "tenant_members_tenant_id_user_id_key" ON "tenant_members"("tenant_id", "user_id");
