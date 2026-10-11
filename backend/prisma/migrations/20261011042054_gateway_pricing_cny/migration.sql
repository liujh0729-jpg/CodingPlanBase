/*
  Warnings:

  - You are about to drop the column `call_usd_price` on the `gateway_models` table. All the data in the column will be lost.

*/
-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_gateway_models" (
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
    "call_cny_price" REAL NOT NULL DEFAULT 0,
    "enable_groups" TEXT NOT NULL DEFAULT 'default',
    "groupRatio" REAL NOT NULL DEFAULT 1,
    "price_source" TEXT NOT NULL DEFAULT 'manual',
    "endpoints" TEXT NOT NULL DEFAULT 'chat',
    "multimodal" BOOLEAN NOT NULL DEFAULT false,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL
);
INSERT INTO "new_gateway_models" ("cache_read_ratio", "cache_write_ratio", "completion_ratio", "created_at", "description", "enable_groups", "endpoints", "groupRatio", "icon", "id", "model_name", "model_ratio", "multimodal", "price_source", "quota_type", "tags", "updated_at", "vendor_name") SELECT "cache_read_ratio", "cache_write_ratio", "completion_ratio", "created_at", "description", "enable_groups", "endpoints", "groupRatio", "icon", "id", "model_name", "model_ratio", "multimodal", "price_source", "quota_type", "tags", "updated_at", "vendor_name" FROM "gateway_models";
DROP TABLE "gateway_models";
ALTER TABLE "new_gateway_models" RENAME TO "gateway_models";
CREATE UNIQUE INDEX "gateway_models_model_name_key" ON "gateway_models"("model_name");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
