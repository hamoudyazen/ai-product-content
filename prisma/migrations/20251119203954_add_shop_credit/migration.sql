-- CreateTable
CREATE TABLE "ShopCredit" (
    "shopDomain" TEXT NOT NULL,
    "credits" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ShopCredit_pkey" PRIMARY KEY ("shopDomain")
);
