import { parseShopifyWebhook } from "../server/shopifyWebhook.server";
import { wipeShopRecords, wipeShopSessions } from "../server/shopCleanup.server";

export const action = async ({ request }) => {
  const result = await parseShopifyWebhook(request);

  if (!result.valid) {
    return new Response(null, { status: 401 });
  }

  const { shopDomain, topic } = result;
  console.log(`[${topic}] Received for ${shopDomain}`);

  await wipeShopSessions(shopDomain);
  await wipeShopRecords(shopDomain);

  return new Response(null, { status: 200 });
};
