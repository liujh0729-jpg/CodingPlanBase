-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_logs" (
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
    "channel_id" INTEGER,
    "channel_name" TEXT NOT NULL DEFAULT '',
    "token_id" INTEGER,
    "group" TEXT NOT NULL DEFAULT '',
    "ip" TEXT NOT NULL DEFAULT '',
    "request_id" TEXT NOT NULL DEFAULT '',
    "other" TEXT NOT NULL DEFAULT '{}',
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "logs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "logs_channel_id_fkey" FOREIGN KEY ("channel_id") REFERENCES "channels" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "logs_token_id_fkey" FOREIGN KEY ("token_id") REFERENCES "tokens" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_logs" ("channel_id", "channel_name", "completion_tokens", "content", "created_at", "group", "id", "ip", "is_stream", "model_name", "other", "prompt_tokens", "quota", "request_id", "token_id", "token_name", "type", "use_time", "user_id", "username") SELECT "channel_id", "channel_name", "completion_tokens", "content", "created_at", "group", "id", "ip", "is_stream", "model_name", "other", "prompt_tokens", "quota", "request_id", "token_id", "token_name", "type", "use_time", "user_id", "username" FROM "logs";
DROP TABLE "logs";
ALTER TABLE "new_logs" RENAME TO "logs";
CREATE INDEX "logs_user_id_created_at_idx" ON "logs"("user_id", "created_at");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
