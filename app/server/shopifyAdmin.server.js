import { unauthenticated } from "../shopify.server";

export const getAdminClientForShop = async ({ shopDomain }) => {
  if (!shopDomain) {
    throw new Error("Missing shop domain for job. Please reopen the app to refresh access.");
  }
  const { admin } = await unauthenticated.admin(shopDomain);
  return admin;
};
