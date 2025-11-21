import { authenticate } from "../shopify.server";
import { wipeShopRecords, wipeShopSessions } from "../server/shopCleanup.server";

export const action = async ({ request }) => {
  const { shop, topic } = await authenticate.webhook(request);

  console.log(`[${topic}] Received for ${shop}`);

  await wipeShopSessions(shop);
  await wipeShopRecords(shop);

  return new Response(null, { status: 200 });
};
