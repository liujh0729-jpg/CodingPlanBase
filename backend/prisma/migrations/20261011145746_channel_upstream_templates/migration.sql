-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_channels" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "type" INTEGER NOT NULL DEFAULT 1,
    "name" TEXT NOT NULL,
    "key" TEXT NOT NULL DEFAULT '',
    "base_url" TEXT NOT NULL DEFAULT '',
    "api_prefix" TEXT NOT NULL DEFAULT '/v1',
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
INSERT INTO "new_channels" ("auto_ban", "balance", "balance_updated_at", "base_url", "created_at", "group", "header_override", "id", "is_managed", "key", "model_mapping", "models", "name", "other_settings", "param_override", "priority", "remark", "response_time", "status", "tag", "test_model", "type", "used_quota", "weight") SELECT "auto_ban", "balance", "balance_updated_at", "base_url", "created_at", "group", "header_override", "id", "is_managed", "key", "model_mapping", "models", "name", "other_settings", "param_override", "priority", "remark", "response_time", "status", "tag", "test_model", "type", "used_quota", "weight" FROM "channels";
DROP TABLE "channels";
ALTER TABLE "new_channels" RENAME TO "channels";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- 渠道类型编号改对齐 new-api：0 OpenAI兼容 -> 1 OpenAI，1 Anthropic -> 14 Anthropic。
-- 顺序不能颠倒：先 1->14 腾空编号 1，再 0->1，否则原有 Anthropic 渠道会被认成 OpenAI。
UPDATE "channels" SET "type" = 14 WHERE "type" = 1;
UPDATE "channels" SET "type" = 1 WHERE "type" = 0;
