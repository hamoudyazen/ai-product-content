/* global globalThis */
import prisma from "../db.server";
import { authenticate } from "../shopify.server";
import { PLAN_CONFIG } from "../utils/planConfig";

const CREATE_SUBSCRIPTION_MUTATION = `#graphql
  mutation StartSubscription(
    $name: String!
    $lineItems: [AppSubscriptionLineItemInput!]!
    $returnUrl: URL!
    $test: Boolean
  ) {
    appSubscriptionCreate(
      name: $name
      lineItems: $lineItems
      returnUrl: $returnUrl
      test: $test
    ) {
      appSubscription {
        id
      }
      confirmationUrl
      userErrors {
        field
        message
      }
    }
  }
`;

const jsonResponse = (body, init = {}) =>
  new Response(JSON.stringify(body), {
    status: init.status || 200,
    headers: {
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
  });

export const loader = () =>
  jsonResponse({ error: "Method not allowed." }, { status: 405 });

export const action = async ({ request }) => {
  const { admin, session } = await authenticate.admin(request);
  const shopDomain = session.shop;
  const formData = await request.formData();
  const requestedPlan = String(formData.get("plan") || "").toUpperCase();
  const planConfig = PLAN_CONFIG[requestedPlan];
  if (!planConfig || typeof planConfig.priceAmount !== "number") {
    return jsonResponse(
      { billing: { error: "Select a valid plan." } },
      { status: 400 },
    );
  }
  const planCredits = planConfig.creditsPerMonth || 0;

  if (planConfig.priceAmount <= 0) {
    await prisma.shop.update({
      where: { shopDomain },
      data: {
        currentPlan: requestedPlan,
        creditsBalance:
          planCredits > 0
            ? {
                increment: planCredits,
              }
            : undefined,
      },
    });
    return jsonResponse({
      planChange: {
        success: true,
        plan: requestedPlan,
        creditsAdded: planCredits,
      },
    });
  }

  const requestUrl = new URL(request.url);
  const hostParam = requestUrl.searchParams.get("host");
  const returnUrl = new URL(
    `/admin/apps/${globalThis.process?.env?.SHOPIFY_API_KEY}`,
    `https://${shopDomain}`,
  );
  returnUrl.searchParams.set("shop", shopDomain);
  if (hostParam) {
    returnUrl.searchParams.set("host", hostParam);
  }
  returnUrl.searchParams.set("plan", requestedPlan);

  const nodeEnv =
    typeof globalThis !== "undefined" && globalThis.process?.env?.NODE_ENV
      ? globalThis.process.env.NODE_ENV
      : "production";
  const isTestCharge = nodeEnv !== "production";

  const response = await admin.graphql(CREATE_SUBSCRIPTION_MUTATION, {
    variables: {
      name: `${planConfig.title} plan`,
      lineItems: [
        {
          plan: {
            appRecurringPricingDetails: {
              price: {
                amount: planConfig.priceAmount,
                currencyCode: "USD",
              },
            },
          },
        },
      ],
      returnUrl: returnUrl.toString(),
      test: isTestCharge,
    },
  });

  const json = await response.json();
  const payload = json?.data?.appSubscriptionCreate;
  const userErrors = payload?.userErrors ?? [];
  if (userErrors.length || !payload?.confirmationUrl) {
    const message =
      userErrors.map((err) => err?.message).filter(Boolean).join("; ") ||
      "Unable to start billing.";
    return jsonResponse(
      { billing: { error: message } },
      { status: 400 },
    );
  }

  return jsonResponse({
    billing: { confirmationUrl: payload.confirmationUrl },
  });
};
