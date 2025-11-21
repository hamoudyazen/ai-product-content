import { redirect } from "react-router";
import shopify, { authenticate, sessionStorage } from "../shopify.server";
import { addCreditsToShop } from "../server/shopCredit.server";
import {
  completePurchase,
  findPurchaseById,
  recordPendingPurchase,
} from "../server/creditPurchase.server";

const redirectToApp = (hostParam, outcome) => {
  const search = new URLSearchParams();
  if (hostParam) {
    search.set("host", hostParam);
  }
  if (outcome) {
    search.set("creditStatus", outcome);
  }
  const query = search.toString();
  const target = query ? `/app?${query}` : "/app";
  throw redirect(target);
};

const parseCreditsFromName = (name) => {
  if (typeof name !== "string") {
    return null;
  }
  const match = name.match(/([\d,]+)\s+credits/i);
  if (!match) {
    return null;
  }
  const numeric = Number(match[1].replace(/,/g, ""));
  return Number.isFinite(numeric) && numeric > 0 ? numeric : null;
};

const createOfflineAdminClient = async (shopDomain) => {
  if (!shopDomain) {
    return null;
  }
  try {
    const offlineSession = await sessionStorage.loadSession(`offline_${shopDomain}`);
    if (!offlineSession) {
      return null;
    }
    const GraphqlClient =
      shopify.clients?.Graphql || shopify.api?.clients?.Graphql || null;
    if (!GraphqlClient) {
      console.error("[credit callback] GraphQL client unavailable for offline session");
      return null;
    }
    const baseClient = new GraphqlClient({ session: offlineSession });
    return {
      graphql: async (query, options) => {
        const result = await baseClient.request(query, {
          variables: options?.variables,
          headers: options?.headers,
        });
        return new Response(JSON.stringify(result));
      },
    };
  } catch (error) {
    console.error("[credit callback] Failed to create offline admin client", error);
    return null;
  }
};

export const loader = async ({ request }) => {
  const url = new URL(request.url);
  const hostParam = url.searchParams.get("host");
  const shopParam = url.searchParams.get("shop");
  const purchaseId =
    url.searchParams.get("charge_id") ||
    url.searchParams.get("purchase_id") ||
    url.searchParams.get("purchaseId");

  if (!purchaseId) {
    redirectToApp(hostParam, "missing");
  }

  let localRecord = await findPurchaseById(purchaseId);
  let shopDomain = localRecord?.shopDomain || shopParam || null;
  let adminClient = null;

  try {
    const { admin, session } = await authenticate.admin(request);
    adminClient = admin;
    shopDomain = session.shop;
  } catch (error) {
    if (!(error instanceof Response)) {
      throw error;
    }
    // No active session; fall back to offline session later.
  }

  if (!adminClient) {
    if (!shopDomain) {
      console.error("[credit callback] Missing shop for purchase", { purchaseId });
      redirectToApp(hostParam, "error");
    }
    adminClient = await createOfflineAdminClient(shopDomain);
    if (!adminClient) {
      console.error("[credit callback] Unable to acquire admin client", {
        purchaseId,
        shopDomain,
      });
      redirectToApp(hostParam, "error");
    }
  }

  let purchaseStatus = null;
  let purchaseName = null;
  try {
    const response = await adminClient.graphql(
      `#graphql
        query GetPurchase($id: ID!) {
          node(id: $id) {
            __typename
            ... on AppPurchaseOneTime {
              id
              status
              name
            }
          }
        }
      `,
      { variables: { id: purchaseId } },
    );
    const json = await response.json();
    const node = json?.data?.node;
    if (node?.__typename === "AppPurchaseOneTime") {
      purchaseStatus = node?.status ?? null;
      purchaseName = node?.name ?? null;
    } else {
      purchaseStatus = null;
      purchaseName = null;
    }
  } catch (error) {
    console.error("[credit callback] Failed to verify purchase", error);
    redirectToApp(hostParam, "error");
  }

  if (!purchaseStatus) {
    redirectToApp(hostParam, "error");
  }

  localRecord = localRecord || (await findPurchaseById(purchaseId));
  let creditAmount = localRecord?.creditsAdded;
  if (typeof creditAmount !== "number" || creditAmount <= 0) {
    creditAmount = parseCreditsFromName(purchaseName) ?? null;
  }
  if (!localRecord && creditAmount && shopDomain) {
    try {
      localRecord = await recordPendingPurchase({
        shopDomain,
        shopifyChargeId: purchaseId,
        creditsAdded: creditAmount,
        type: "one_time",
      });
    } catch (error) {
      console.error("[credit callback] Failed to backfill purchase record", error);
    }
  }

  if (purchaseStatus === "ACTIVE") {
    if (!localRecord) {
      console.error("[credit callback] No local record for purchase", purchaseId);
      redirectToApp(hostParam, "error");
    }
    if (localRecord?.status !== "completed") {
      if (!creditAmount) {
        console.error("[credit callback] Missing credit amount for purchase", purchaseId);
        redirectToApp(hostParam, "error");
      }
      try {
        await addCreditsToShop(shopDomain, creditAmount);
        await completePurchase({ shopifyChargeId: purchaseId, status: "completed" });
      } catch (error) {
        console.error("[credit callback] Failed to finalize purchase", error);
        redirectToApp(hostParam, "error");
      }
    }
    redirectToApp(hostParam, "success");
  }

  if (localRecord) {
    const derivedStatus =
      typeof purchaseStatus === "string" ? purchaseStatus.toLowerCase() : purchaseStatus;
    await completePurchase({ shopifyChargeId: purchaseId, status: derivedStatus });
  }

  redirectToApp(hostParam, "declined");
};

export default function CreditCallback() {
  return null;
}
