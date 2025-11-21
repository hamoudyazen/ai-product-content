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

  return new Response(null, { status: 200 });
};
