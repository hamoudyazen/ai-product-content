import prisma from "../db.server";
import { getOrCreateShopCredit } from "./shopCredit.server";

const resolveShop = async ({ shopId, shopDomain }) => {
  if (shopId) {
    const record = await prisma.shop.findUnique({ where: { id: shopId } });
    if (record) return record;
  }
  if (shopDomain) {
    const record = await prisma.shop.findUnique({ where: { shopDomain } });
    if (record) return record;
    return getOrCreateShopCredit(shopDomain);
  }
  throw new Error("Unable to resolve shop for purchase record.");
};

export const recordPendingPurchase = async ({
  shopId,
  shopDomain,
  shopifyChargeId,
  creditsAdded,
  priceUsd,
  type = "one_time",
}) => {
  if (!shopifyChargeId) return null;
  const shop = await resolveShop({ shopId, shopDomain });
  return prisma.creditPurchase.upsert({
    where: { shopifyChargeId },
    create: {
      shopId: shop.id,
      shopDomain: shop.shopDomain,
      shopifyChargeId,
      creditsAdded,
      priceUsd: priceUsd != null ? priceUsd : null,
      type,
      status: "pending",
    },
    update: {
      shopId: shop.id,
      shopDomain: shop.shopDomain,
      creditsAdded,
      priceUsd: priceUsd != null ? priceUsd : null,
      type,
      status: "pending",
      updatedAt: new Date(),
    },
  });
};

export const completePurchase = async ({ shopifyChargeId, status, priceUsd }) => {
  if (!shopifyChargeId) return null;
  return prisma.creditPurchase.update({
    where: { shopifyChargeId },
    data: {
      status,
      ...(priceUsd != null ? { priceUsd } : {}),
      updatedAt: new Date(),
    },
  });
};

export const findPurchaseById = async (shopifyChargeId) => {
  if (!shopifyChargeId) return null;
  return prisma.creditPurchase.findUnique({ where: { shopifyChargeId } });
};

export const listPendingPurchases = async (shopDomain) => {
  if (!shopDomain) return [];
  return prisma.creditPurchase.findMany({
    where: { shopDomain, status: "pending" },
    orderBy: { createdAt: "asc" },
  });
};
