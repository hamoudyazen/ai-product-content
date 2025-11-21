import db from "../db.server";

export async function wipeShopRecords(shopDomain) {
  if (!shopDomain) {
    return;
  }

  await Promise.all([
    db.bulkJob.deleteMany({ where: { shopDomain } }),
    db.creditPurchase.deleteMany({ where: { shopDomain } }),
    db.shop.deleteMany({ where: { shopDomain } }),
  ]);
}

export async function wipeShopSessions(shopDomain) {
  if (!shopDomain) {
    return;
  }

  await db.session.deleteMany({ where: { shop: shopDomain } });
}
