/* eslint-disable no-buffer-constructor */
/* global globalThis */
import { createHmac, timingSafeEqual } from "node:crypto";

const SHOPIFY_SECRET = process.env.SHOPIFY_API_SECRET || "";

export async function parseShopifyWebhook(request) {
  const bodyText = await request.text();
  const hmac = request.headers.get("x-shopify-hmac-sha256");
  const topic = request.headers.get("x-shopify-topic");
  const shopDomain = request.headers.get("x-shopify-shop-domain");
  const shopId = request.headers.get("x-shopify-shop-id");

  if (!hmac || !SHOPIFY_SECRET) {
    return { valid: false };
  }

  const computedHash = createHmac("sha256", SHOPIFY_SECRET)
    .update(bodyText, "utf8")
    .digest("base64");

  const verified =
    hmac.length === computedHash.length &&
    timingSafeEqual(
      globalThis.Buffer.from(hmac, "base64"),
      globalThis.Buffer.from(computedHash, "base64"),
    );

  if (!verified) {
    return { valid: false };
  }

  let payload;
  try {
    payload = bodyText ? JSON.parse(bodyText) : {};
  } catch (error) {
    return { valid: false };
  }

  return {
    valid: true,
    payload,
    text: bodyText,
    shopDomain,
    shopId,
    topic,
  };
}
