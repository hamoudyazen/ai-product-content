import { parseShopifyWebhook } from "../server/shopifyWebhook.server";
import { wipeShopRecords, wipeShopSessions } from "../server/shopCleanup.server";

export const action = async ({ request }) => {
  const result = await parseShopifyWebhook(request);

  if (!result.valid) {
    console.warn("[gdpr] invalid HMAC");
    return new Response("Invalid HMAC", { status: 401 });
  }

  const { shopDomain, topic: rawTopic, payload } = result;

  // Normalize topic so we can handle both:
  // CUSTOMERS_DATA_REQUEST, customers/data_request, etc.
  const topic = (rawTopic || "").toLowerCase();

  console.log("[gdpr] received topic", rawTopic, "normalized as", topic);

  switch (topic) {
    case "customers_data_request":
    case "customers/data_request": {
      console.log("[gdpr] customer data request", shopDomain, payload);

      return new Response(
        JSON.stringify({
          data: [],
          message:
            "This app does not store customer-specific data outside of Shopify.",
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      );
    }

    case "customers_redact":
    case "customers/redact": {
      console.log("[gdpr] customer redact", shopDomain, payload);
      // If you ever store per-customer data, delete it here
      return new Response("OK", { status: 200 });
    }

    case "shop_redact":
    case "shop/redact": {
      console.log("[gdpr] shop redact", shopDomain, payload);
      await wipeShopSessions(shopDomain);
      await wipeShopRecords(shopDomain);
      return new Response("OK", { status: 200 });
    }

    default: {
      console.warn("[gdpr] unsupported topic", rawTopic);
      return new Response("OK", { status: 200 });
    }
  }
};
