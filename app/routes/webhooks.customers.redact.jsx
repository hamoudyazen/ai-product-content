import { parseShopifyWebhook } from "../server/shopifyWebhook.server";

export const action = async ({ request }) => {
  const result = await parseShopifyWebhook(request);

  if (!result.valid) {
    return new Response(null, { status: 401 });
  }

  const { shopDomain, topic, payload } = result;
  console.log(`[${topic}] Received for ${shopDomain}`, payload);

  return new Response(null, { status: 200 });
};
