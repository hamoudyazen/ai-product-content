import { parseShopifyWebhook } from "../server/shopifyWebhook.server";

export const action = async ({ request }) => {
  const result = await parseShopifyWebhook(request);

  if (!result.valid) {
    return new Response(null, { status: 401 });
  }

  const { shopDomain, topic, payload } = result;
  console.log(`[${topic}] Received for ${shopDomain}`, payload);

  const body = {
    data: [],
    message: "This app does not store customer-specific data outside of Shopify.",
  };

  return new Response(JSON.stringify(body), {
    headers: {
      "Content-Type": "application/json",
    },
  });
};
