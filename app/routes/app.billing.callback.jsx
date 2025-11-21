import { redirect } from "react-router";
import prisma from "../db.server";
import { PLAN_CONFIG, DEFAULT_PLAN } from "../utils/planConfig";

const redirectToApp = (hostParam, status, extras = {}) => {
  const params = new URLSearchParams();
  if (hostParam) {
    params.set("host", hostParam);
  }
  if (status) {
    params.set("planStatus", status);
  }
  Object.entries(extras).forEach(([key, value]) => {
    if (value != null) {
      params.set(key, String(value));
    }
  });
  const query = params.toString();
  throw redirect(query ? `/app?${query}` : "/app");
};

const getShopFromHost = (hostParam) => {
  if (!hostParam) return null;
  try {
    const decoded = Buffer.from(hostParam, "base64").toString("utf-8");
    const [, , storeHandle] = decoded.split("/");
    if (!storeHandle) {
      return null;
    }
    return `${storeHandle}.myshopify.com`;
  } catch (error) {
    console.warn("[plan callback] Failed to decode host", error);
    return null;
  }
};

const finalizeSubscription = async ({ shopDomain, planId, subscriptionId }) => {
  const planKey = PLAN_CONFIG[planId] ? planId : DEFAULT_PLAN;
  const planCredits = PLAN_CONFIG[planKey]?.creditsPerMonth || 0;
  const existing = await prisma.shop.findUnique({
    where: { shopDomain },
    select: { subscriptionId: true },
  });
  const alreadyApplied = existing?.subscriptionId === subscriptionId;
  await prisma.shop.update({
    where: { shopDomain },
    data: {
      currentPlan: planKey,
      subscriptionId,
      creditsBalance:
        planCredits > 0 && !alreadyApplied
          ? {
              increment: planCredits,
            }
          : undefined,
    },
  });
  return {
    plan: planKey,
    creditsAdded: alreadyApplied ? 0 : planCredits,
  };
};

const extractSubscriptionId = (params) =>
  params.get("charge_id") || params.get("subscription_id");

const resolveShopDomain = (shopParam, hostParam) =>
  shopParam || getShopFromHost(hostParam);

const jsonResponse = (body, init = {}) =>
  new Response(JSON.stringify(body), {
    status: init.status || 200,
    headers: {
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
  });

export const loader = async ({ request }) => {
  const url = new URL(request.url);
  console.log("[plan callback] hit", url.toString());
  const hostParam = url.searchParams.get("host");
  const planId = String(url.searchParams.get("plan") || "").toUpperCase();
  const subscriptionId = extractSubscriptionId(url.searchParams);
  const shopParam = url.searchParams.get("shop");
  const shopDomain = resolveShopDomain(shopParam, hostParam);

  if (!subscriptionId || !shopDomain) {
    redirectToApp(hostParam, "error");
  }

  try {
    const result = await finalizeSubscription({
      shopDomain,
      planId,
      subscriptionId,
    });
    redirectToApp(hostParam, "success", {
      plan: result.plan,
      planCredits: result.creditsAdded,
    });
  } catch (error) {
    console.error("[plan callback] Failed to persist subscription", error);
    redirectToApp(hostParam, "error");
  }
};

export const action = async ({ request }) => {
  const formData = await request.formData();
  const planId = String(formData.get("plan") || "").toUpperCase();
  const hostParam = formData.get("host");
  const shopParam = formData.get("shop");
  const subscriptionIdInput =
    formData.get("subscriptionId") ||
    formData.get("subscription_id") ||
    formData.get("charge_id");

  if (!subscriptionIdInput) {
    return jsonResponse(
      { success: false, message: "Missing subscription identifier." },
      { status: 400 },
    );
  }

  const subscriptionId = String(subscriptionIdInput);
  const shopDomain = resolveShopDomain(shopParam, hostParam);
  if (!shopDomain) {
    return jsonResponse(
      { success: false, message: "Missing shop domain." },
      { status: 400 },
    );
  }

  try {
    const result = await finalizeSubscription({
      shopDomain,
      planId,
      subscriptionId,
    });
    return jsonResponse({
      success: true,
      plan: result.plan,
      creditsAdded: result.creditsAdded,
    });
  } catch (error) {
    console.error("[plan callback] Failed to persist subscription", error);
    return jsonResponse(
      { success: false, message: "Unable to confirm subscription." },
      { status: 500 },
    );
  }
};

export default function BillingCallback() {
  return null;
}
