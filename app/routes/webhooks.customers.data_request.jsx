import { authenticate } from "../shopify.server";

export const action = async ({ request }) => {
  const { shop, topic, payload } = await authenticate.webhook(request);

  console.log(`[${topic}] Received for ${shop}`, payload);

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
