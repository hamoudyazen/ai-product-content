import prisma from "../db.server";

const DEFAULT_CREDITS = Number(process.env.INITIAL_SHOP_CREDITS || 1000);

const normalizeAmount = (value) => {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.floor(value));
};

export const getOrCreateShopCredit = async (shopDomain) => {
  if (!shopDomain) {
    throw new Error("Missing shop domain for credit lookup.");
  }

  const existing = await prisma.shop.findUnique({ where: { shopDomain } });
  if (existing) {
    return existing;
  }

  // Legacy fallback: attempt to hydrate from previous ShopCredit table if it still exists.
  let legacyCredits = DEFAULT_CREDITS;
  try {
    const rows = await prisma.$queryRaw`
      SELECT "credits"
      FROM "ShopCredit"
      WHERE "shopDomain" = ${shopDomain}
      LIMIT 1;
    `;
    if (Array.isArray(rows) && rows[0]?.credits != null) {
      legacyCredits = Number(rows[0].credits) || DEFAULT_CREDITS;
    }
  } catch {
    // Table might not exist anymore; ignore.
  }

  return prisma.shop.create({
    data: {
      shopDomain,
      creditsBalance: legacyCredits,
    },
  });
};

export const addCreditsToShop = async (shopDomain, amount) => {
  const credits = normalizeAmount(amount);
  if (credits <= 0) {
    throw new Error("Credit amount must be positive.");
  }
  await getOrCreateShopCredit(shopDomain);
  return prisma.shop.update({
    where: { shopDomain },
    data: {
      creditsBalance: {
        increment: credits,
      },
      updatedAt: new Date(),
    },
  });
};

export const reserveShopCredits = async (shopDomain, amount) => {
  const credits = normalizeAmount(amount);
  await getOrCreateShopCredit(shopDomain);
  if (credits <= 0) {
    const record = await prisma.shop.findUnique({ where: { shopDomain } });
    return record?.creditsBalance ?? DEFAULT_CREDITS;
  }

  return prisma.$transaction(async (tx) => {
    const rows = await tx.$queryRaw`
      SELECT "id", "creditsBalance"
      FROM "Shop"
      WHERE "shopDomain" = ${shopDomain}
      FOR UPDATE
    `;
    const record = Array.isArray(rows) ? rows[0] : null;
    if (!record) {
      throw new Error("Credit record not found.");
    }
    if (record.creditsBalance < credits) {
      throw new Error("Insufficient credits. Please add more to continue.");
    }
    const updated = await tx.shop.update({
      where: { shopDomain },
      data: {
        creditsBalance: {
          decrement: credits,
        },
        updatedAt: new Date(),
      },
    });
    return updated.creditsBalance;
  });
};

export const refundShopCredits = async (shopDomain, amount) => {
  const credits = normalizeAmount(amount);
  if (credits <= 0) {
    return null;
  }
  await getOrCreateShopCredit(shopDomain);
  return prisma.shop.update({
    where: { shopDomain },
    data: {
      creditsBalance: {
        increment: credits,
      },
      updatedAt: new Date(),
    },
  });
};
