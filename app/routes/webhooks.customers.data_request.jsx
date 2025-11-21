import { parseShopifyWebhook } from "../server/shopifyWebhook.server";

export const action = async ({ request }) => {
  const result = await parseShopifyWebhook(request);

  if (!result.valid) {
    return new Response("Invalid HMAC", {
      status: 401,
      headers: { "Content-Type": "text/plain" },
    });
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
