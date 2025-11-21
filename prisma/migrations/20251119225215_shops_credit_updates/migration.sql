-- Create shops table
CREATE TABLE IF NOT EXISTS "Shop" (
    "id" TEXT NOT NULL,
    "shopDomain" TEXT NOT NULL,
    "accessToken" TEXT,
    "creditsBalance" INTEGER NOT NULL DEFAULT 0,
    "currentPlan" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Shop_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "Shop_shopDomain_key" ON "Shop"("shopDomain");

-- Seed Shop rows from legacy ShopCredit records if they exist
INSERT INTO "Shop" ("id", "shopDomain", "creditsBalance", "createdAt", "updatedAt")
SELECT sc."shopDomain" AS id, sc."shopDomain", sc."credits", COALESCE(sc."createdAt", NOW()), COALESCE(sc."updatedAt", NOW())
FROM "ShopCredit" sc
ON CONFLICT ("shopDomain") DO NOTHING;

-- Ensure all shop domains referenced by existing credit purchases are represented
INSERT INTO "Shop" ("id", "shopDomain", "creditsBalance", "createdAt", "updatedAt")
SELECT DISTINCT cp."shopDomain" AS id, cp."shopDomain", 0, NOW(), NOW()
FROM "CreditPurchase" cp
WHERE NOT EXISTS (
    SELECT 1 FROM "Shop" s WHERE s."shopDomain" = cp."shopDomain"
)
ON CONFLICT ("shopDomain") DO NOTHING;

-- Add new structure to credit purchases
DO $$
BEGIN
    ALTER TABLE "CreditPurchase"
        RENAME COLUMN "purchaseId" TO "shopifyChargeId";
EXCEPTION
    WHEN undefined_column THEN NULL;
END $$;

DO $$
BEGIN
    ALTER TABLE "CreditPurchase"
        RENAME COLUMN "credits" TO "creditsAdded";
EXCEPTION
    WHEN undefined_column THEN NULL;
END $$;

ALTER TABLE "CreditPurchase"
    ADD COLUMN IF NOT EXISTS "priceUsd" DECIMAL(65,30);

ALTER TABLE "CreditPurchase"
    ADD COLUMN IF NOT EXISTS "type" TEXT DEFAULT 'one_time';

ALTER TABLE "CreditPurchase"
    ADD COLUMN IF NOT EXISTS "shopId" TEXT;

UPDATE "CreditPurchase" cp
SET "shopId" = s."id"
FROM "Shop" s
WHERE cp."shopDomain" = s."shopDomain" AND cp."shopId" IS NULL;

ALTER TABLE "CreditPurchase"
    ALTER COLUMN "shopId" SET NOT NULL;

ALTER TABLE "CreditPurchase"
    ALTER COLUMN "type" SET NOT NULL;

ALTER TABLE "CreditPurchase"
    ALTER COLUMN "createdAt" SET DATA TYPE TIMESTAMP(3);

ALTER TABLE "CreditPurchase"
    ALTER COLUMN "updatedAt" SET DATA TYPE TIMESTAMP(3);

-- Drop legacy unique index and recreate with new column name
DO $$
BEGIN
    ALTER TABLE "CreditPurchase" DROP CONSTRAINT "CreditPurchase_purchaseId_key";
EXCEPTION
    WHEN undefined_object THEN
        DROP INDEX IF EXISTS "CreditPurchase_purchaseId_key";
END $$;
DO $$
BEGIN
    CREATE UNIQUE INDEX "CreditPurchase_shopifyChargeId_key" ON "CreditPurchase"("shopifyChargeId");
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

-- Add FK to Shop
DO $$
BEGIN
    ALTER TABLE "CreditPurchase"
        ADD CONSTRAINT "CreditPurchase_shopId_fkey"
        FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

-- Drop legacy ShopCredit table now that balances live on Shop
DROP TABLE IF EXISTS "ShopCredit";
