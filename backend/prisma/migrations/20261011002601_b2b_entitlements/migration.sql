-- CreateTable
CREATE TABLE "user_entitlements" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "user_id" INTEGER NOT NULL,
    "product_id" TEXT NOT NULL,
    "name" TEXT NOT NULL DEFAULT '',
    "kind" TEXT NOT NULL,
    "expires_at" INTEGER NOT NULL DEFAULT 0,
    "enabled" INTEGER NOT NULL DEFAULT 1,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "user_entitlements_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_payment_orders" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "user_id" INTEGER NOT NULL,
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
    CONSTRAINT "payment_orders_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_payment_orders" ("amount_fen", "created_at", "id", "merchant_order_no", "paid_at", "prepay_info", "product_id", "product_type", "quota_granted", "raw", "refunded_fen", "status", "trade_type", "user_id") SELECT "amount_fen", "created_at", "id", "merchant_order_no", "paid_at", "prepay_info", "product_id", "product_type", "quota_granted", "raw", "refunded_fen", "status", "trade_type", "user_id" FROM "payment_orders";
DROP TABLE "payment_orders";
ALTER TABLE "new_payment_orders" RENAME TO "payment_orders";
CREATE UNIQUE INDEX "payment_orders_merchant_order_no_key" ON "payment_orders"("merchant_order_no");
CREATE INDEX "payment_orders_user_id_status_idx" ON "payment_orders"("user_id", "status");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "user_entitlements_user_id_product_id_key" ON "user_entitlements"("user_id", "product_id");
