import { authenticate } from "../shopify.server";

export const action = async ({ request }) => {
  const { shop, topic, payload } = await authenticate.webhook(request);

  console.log(`[${topic}] Received for ${shop}`, payload);

  return new Response(null, { status: 200 });
};
