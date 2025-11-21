import { parseShopifyWebhook } from "../server/shopifyWebhook.server";
import { wipeShopRecords, wipeShopSessions } from "../server/shopCleanup.server";

export const action = async ({ request }) => {
  const result = await parseShopifyWebhook(request);

  if (!result.valid) {
    return new Response("Invalid HMAC", { status: 401 });
  }

  const { shopDomain, topic, payload } = result;

  switch (topic) {
    case "customers/data_request": {
      console.log("[gdpr] customer data request", shopDomain, payload);
      break;
    }
    case "customers/redact": {
      console.log("[gdpr] customer redact", shopDomain, payload);
      break;
    }
    case "shop/redact": {
      console.log("[gdpr] shop redact", shopDomain, payload);
      await wipeShopSessions(shopDomain);
      await wipeShopRecords(shopDomain);
      break;
    }
    default: {
      console.warn("[gdpr] unsupported topic", topic);
    }
  }

  return new Response("OK", { status: 200 });
};
