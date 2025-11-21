import { authenticate } from "../shopify.server";
import { wipeShopRecords, wipeShopSessions } from "../server/shopCleanup.server";

export const action = async ({ request }) => {
  const { shop, topic, payload } = await authenticate.webhook(request);

  switch (topic) {
    case "customers/data_request": {
      console.log("[gdpr] customer data request", shop, payload);
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
      console.log("[gdpr] customer redact", shop, payload);
      return new Response("OK", { status: 200 });
    }
    case "shop/redact": {
      console.log("[gdpr] shop redact", shop, payload);
      await wipeShopSessions(shop);
      await wipeShopRecords(shop);
      return new Response("OK", { status: 200 });
    }
    default: {
      console.warn("[gdpr] unsupported topic", topic);
      return new Response("OK", { status: 200 });
    }
  }
};
