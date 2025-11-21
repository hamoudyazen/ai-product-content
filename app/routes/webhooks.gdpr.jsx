import { parseShopifyWebhook } from "../server/shopifyWebhook.server";
import { wipeShopRecords, wipeShopSessions } from "../server/shopCleanup.server";

export const action = async ({ request }) => {
  const result = await parseShopifyWebhook(request);

  if (!result.valid) {
    console.warn("[gdpr] invalid HMAC");
    return new Response("Invalid HMAC", { status: 401 });
  }

  const { shopDomain, topic: rawTopic, payload } = result;

  // Normalize Shopify topic (CUSTOMERS_DATA_REQUEST → customers/data_request)
  const topic = String(rawTopic || "").toLowerCase().replace(/_/g, "/");

  console.log("[gdpr] valid webhook", topic, shopDomain);

  switch (topic) {
    case "customers/data_request": {
      return new Response(
        JSON.stringify({
          data: [],
          message: "This app does not store customer-specific data outside of Shopify.",
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      );
    }

    case "customers/redact": {
      console.log("[gdpr] customer redact", shopDomain, payload);
      return new Response("OK", { status: 200 });
    }

    case "shop/redact": {
      console.log("[gdpr] shop redact", shopDomain);
      await wipeShopSessions(shopDomain);
      await wipeShopRecords(shopDomain);
      return new Response("OK", { status: 200 });
    }

    default: {
      console.warn("[gdpr] unexpected topic", rawTopic);
      return new Response("OK", { status: 200 });
    }
  }
};
