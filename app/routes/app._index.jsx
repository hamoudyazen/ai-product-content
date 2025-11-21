/* global globalThis */
import { useCallback, useEffect, useMemo, useState } from "react";
import { useFetcher, useLoaderData, useNavigate, useLocation } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { Redirect } from "@shopify/app-bridge/actions";
import { boundary } from "@shopify/shopify-app-react-router/server";
import prisma from "../db.server";
import { authenticate } from "../shopify.server";
import { mapBulkJobs } from "../server/jobMapper";
import { addCreditsToShop, getOrCreateShopCredit } from "../server/shopCredit.server";
import {
  completePurchase,
  listPendingPurchases,
  recordPendingPurchase,
} from "../server/creditPurchase.server";
import { aggregateProductQuality } from "../utils/productQuality";
import { PricingCard } from "../components/PricingCard";
import { PLAN_OPTIONS, PLAN_CONFIG, DEFAULT_PLAN } from "../utils/planConfig";

const HOST_STORAGE_KEY = "shopify-app-host";
const JOBS_PAGE_SIZE = 5;
const generationTypeLabelMap = {
  description: "Product description",
  productTitle: "Product title",
  metaDescription: "Meta description",
  metaTitle: "Meta title",
  altText: "Alt text",
  collectionDescription: "Collection description",
  collectionTitle: "Collection title",
  collectionMetaDescription: "Collection meta description",
  collectionMetaTitle: "Collection meta title",
};
const INITIAL_FREE_CREDITS = 5;
const WORDS_PER_CREDIT = 120;
const MIN_CREDIT_PURCHASE = 100;
const CREDIT_STEP = 100;
const QUICK_SELECT_PACKAGES = [100, 1000, 10000, 100000];
const BULK_DISCOUNT_THRESHOLD = 10000;
const BULK_DISCOUNT_RATE = 0.1;

const getJobDateParts = (job) => {
  const timestamp =
    typeof job?.createdAtMs === "number"
      ? job.createdAtMs
      : job?.createdAt
        ? Date.parse(job.createdAt)
        : NaN;
  if (!Number.isFinite(timestamp)) {
    return { date: job?.createdAt || "—", time: "" };
  }
  const date = new Date(timestamp);
  return {
    date: date.toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
    }),
    time: date.toLocaleTimeString(undefined, {
      hour: "numeric",
      minute: "2-digit",
    }),
  };
};

const PURCHASE_DETAILS_QUERY = `#graphql
  query GetOneTimePurchase($id: ID!) {
    node(id: $id) {
      __typename
      ... on AppPurchaseOneTime {
        id
        status
        name
      }
    }
  }
`;

const fetchPurchaseStatus = async (admin, purchaseId) => {
  if (!purchaseId) {
    return null;
  }
  try {
    const response = await admin.graphql(PURCHASE_DETAILS_QUERY, {
      variables: { id: purchaseId },
    });
    const data = await response.json();
    const node = data?.data?.node;
    if (node?.__typename === "AppPurchaseOneTime") {
      return node?.status ?? null;
    }
    return null;
  } catch (error) {
    console.error("[credits] Failed to load purchase status", error);
    return null;
  }
};

const getOrderDisplayId = (jobId) => {
  if (!jobId) {
    return "#—";
  }
  if (typeof jobId !== "string") {
    return `#${jobId}`;
  }
  const short = jobId.split("/").pop();
  return `#${short ?? jobId}`;
};

export const loader = async ({ request }) => {
  const { admin, session } = await authenticate.admin(request);
  const shopDomain = session.shop;
  const url = new URL(request.url);
  const hostParam = url.searchParams.get("host") || null;
  const pendingPurchases = await listPendingPurchases(shopDomain);
  let creditsFromSync = 0;

  for (const pending of pendingPurchases) {
    const status = await fetchPurchaseStatus(admin, pending.shopifyChargeId);
    if (!status) {
      continue;
    }
    const creditValue = Number(pending.creditsAdded) || 0;
    if (status === "ACTIVE") {
      try {
        if (creditValue > 0) {
          await addCreditsToShop(shopDomain, creditValue);
          creditsFromSync += creditValue;
        }
        await completePurchase({ shopifyChargeId: pending.shopifyChargeId, status: "completed" });
      } catch (error) {
        console.error("[credits] Failed to finalize pending purchase", {
          purchaseId: pending.shopifyChargeId,
          error,
        });
      }
      continue;
    }
    if (status !== "PENDING") {
      try {
        await completePurchase({
          shopifyChargeId: pending.shopifyChargeId,
          status: status.toLowerCase(),
        });
      } catch (error) {
        console.error("[credits] Failed to update purchase status", {
          purchaseId: pending.shopifyChargeId,
          status,
          error,
        });
      }
    }
  }
  let ratingSummary = { averageScore: null, label: null, sampleSize: 0 };

  try {
    const response = await admin.graphql(
      `#graphql
        query UsageSummaryProducts {
          products(first: 25) {
            edges {
              node {
                title
                productType
                vendor
                descriptionHtml
                seo {
                  title
                  description
                }
              }
            }
          }
        }
      `,
    );
    const data = await response.json();
    const productNodes =
      data?.data?.products?.edges?.map(({ node }) => node) ?? [];
    ratingSummary = aggregateProductQuality(productNodes);
  } catch (error) {
    console.error("Failed to load rating summary", error);
  }

  const jobs = await prisma.bulkJob.findMany({
    where: { shopDomain },
    orderBy: { createdAt: "desc" },
    take: 25,
  });
  const mappedJobs = mapBulkJobs(jobs);
  const hasActiveJob = jobs.some((job) => job.status === "queued" || job.status === "running");

  const creditRecord = await getOrCreateShopCredit(shopDomain);

  return {
    ratingSummary,
    jobs: mappedJobs,
    hasActiveJob,
    hostParam,
    creditBalance: creditRecord?.creditsBalance ?? 0,
    creditSync: { added: creditsFromSync },
    plan: creditRecord?.currentPlan || DEFAULT_PLAN,
  };
};

export const action = async ({ request }) => {
  const { admin, session } = await authenticate.admin(request);
  const shopDomain = session.shop;
  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "purchaseCredits") {
    const credits = Number(formData.get("credits"));
    const amount = Number(formData.get("amount"));
    const isValidNumber = Number.isFinite(credits) && Number.isFinite(amount);

    const normalizedCredits =
      isValidNumber && credits >= MIN_CREDIT_PURCHASE && credits % CREDIT_STEP === 0
        ? credits
        : NaN;
    const pricePerCredit = 0.005;
    const discountedPrice = pricePerCredit * (1 - BULK_DISCOUNT_RATE);
    const computePrice = (creditCount) => {
      if (!Number.isFinite(creditCount) || creditCount <= 0) return NaN;
      const unit = creditCount >= BULK_DISCOUNT_THRESHOLD ? discountedPrice : pricePerCredit;
      return Number((creditCount * unit).toFixed(2));
    };
    const expectedAmount = computePrice(normalizedCredits);
    if (!Number.isFinite(expectedAmount) || Math.abs(expectedAmount - amount) > 0.01) {
      return {
        creditPurchase: {
          success: false,
          message: "Credit amount and price must match an approved package.",
        },
      };
    }

    const requestUrl = new URL(request.url);
    const hostParam = requestUrl.searchParams.get("host");
    const nodeEnv =
      typeof globalThis !== "undefined" && globalThis.process?.env?.NODE_ENV
        ? globalThis.process.env.NODE_ENV
        : "production";
    const isTestCharge = nodeEnv !== "production";
    const returnUrl = new URL("/app/credit-callback", requestUrl.origin);
    if (hostParam) {
      returnUrl.searchParams.set("host", hostParam);
    }
    returnUrl.searchParams.set("shop", shopDomain);

    const response = await admin.graphql(
      `#graphql
        mutation PurchaseCredits($name: String!, $price: MoneyInput!, $returnUrl: URL!, $test: Boolean) {
          appPurchaseOneTimeCreate(name: $name, price: $price, returnUrl: $returnUrl, test: $test) {
            appPurchaseOneTime {
              id
              status
            }
            confirmationUrl
            userErrors {
              field
              message
            }
          }
        }
      `,
      {
        variables: {
          name: `Credit pack (${normalizedCredits.toLocaleString()} credits)`,
          price: {
            amount: expectedAmount.toFixed(2),
            currencyCode: "USD",
          },
          returnUrl: returnUrl.toString(),
          test: isTestCharge,
        },
      },
    );
    const responseJson = await response.json();
    const payload = responseJson?.data?.appPurchaseOneTimeCreate;
    const userErrors = payload?.userErrors ?? [];
    if (userErrors.length > 0) {
      return {
        creditPurchase: {
          success: false,
          message: userErrors[0]?.message || "Unable to process payment.",
        },
      };
    }
    const purchaseId = payload?.appPurchaseOneTime?.id;
    if (purchaseId) {
      await recordPendingPurchase({
        shopDomain,
        shopifyChargeId: purchaseId,
        creditsAdded: normalizedCredits,
        priceUsd: expectedAmount,
        type: "one_time",
      });
    }

    return {
      creditPurchase: {
        success: true,
        confirmationUrl: payload?.confirmationUrl,
      },
    };
  }

  if (intent === "changePlan") {
    const requestedPlan = String(formData.get("plan") || "").toUpperCase();
    if (!PLAN_CONFIG[requestedPlan]) {
      return {
        planChange: {
          success: false,
          message: "Unknown plan selection.",
        },
      };
    }
    const planCredits = PLAN_CONFIG[requestedPlan]?.creditsPerMonth || 0;
    await prisma.shop.update({
      where: { shopDomain },
      data: {
        currentPlan: requestedPlan,
        creditsBalance: {
          increment: Math.max(0, planCredits),
        },
      },
    });
    return {
      planChange: {
        success: true,
        plan: requestedPlan,
        creditsAdded: planCredits,
      },
    };
  }

  return { error: "Unsupported action." };
};

export default function Index() {
  const loaderData = useLoaderData();
  const ratingSummary =
    loaderData?.ratingSummary ?? { averageScore: null, label: null, sampleSize: 0 };
  const initialJobs = useMemo(() => loaderData?.jobs ?? [], [loaderData?.jobs]);
  const initialCreditBalance = loaderData?.creditBalance ?? INITIAL_FREE_CREDITS;
  const initialPlanId = loaderData?.plan || DEFAULT_PLAN;
  const [embeddedHost, setEmbeddedHost] = useState(() => loaderData?.hostParam ?? null);
  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    if (embeddedHost) {
      window.sessionStorage.setItem(HOST_STORAGE_KEY, embeddedHost);
      return;
    }
    const storedHost = window.sessionStorage.getItem(HOST_STORAGE_KEY);
    if (storedHost) {
      setEmbeddedHost(storedHost);
      return;
    }
    const hostFromUrl = new URLSearchParams(window.location.search).get("host");
    if (hostFromUrl) {
      setEmbeddedHost(hostFromUrl);
    }
  }, [embeddedHost]);
  const withHost = useCallback(
    (path) => {
      let host = embeddedHost;
      if (!host && typeof window !== "undefined") {
        host =
          window.sessionStorage.getItem(HOST_STORAGE_KEY) ||
          new URLSearchParams(window.location.search).get("host");
        if (host && !embeddedHost) {
          setEmbeddedHost(host);
        }
      }
      if (!host) return path;
      const separator = path.includes("?") ? "&" : "?";
      return `${path}${separator}host=${encodeURIComponent(host)}`;
    },
    [embeddedHost],
  );
  const fetcher = useFetcher();
  const creditFetcher = useFetcher();
  const planFetcher = useFetcher();
  const billingCallbackFetcher = useFetcher();
  const navigate = useNavigate();
  const shopify = useAppBridge();
  const [appBridgeToast, setAppBridgeToast] = useState(null);
  useEffect(() => {
    if (!shopify) {
      setAppBridgeToast(null);
      return;
    }

    try {
      setAppBridgeToast(shopify.toast ?? null);
    } catch (error) {
      console.warn("[billing] Unable to read App Bridge toast", error);
      setAppBridgeToast(null);
    }
  }, [shopify]);
  const redirect = useMemo(() => (shopify ? Redirect.create(shopify) : null), [shopify]);
  const location = useLocation();
  const [billingCallbackTriggered, setBillingCallbackTriggered] = useState(false);
  const redirectToUrl = useCallback(
    (url) => {
      if (!url) return;
      if (redirect && typeof redirect.dispatch === "function") {
        try {
          redirect.dispatch(Redirect.Action.REMOTE, { url });
          return;
        } catch (error) {
          console.error("[billing] Failed to dispatch App Bridge redirect", error);
        }
      }
      if (typeof window !== "undefined") {
        try {
          if (window.top && window.top !== window) {
            window.top.location.href = url;
            return;
          }
        } catch (error) {
          console.warn("[billing] Unable to access top window for redirect", error);
        }
        const newWindow = window.open(url, "_blank", "noopener,noreferrer");
        if (newWindow) {
          newWindow.focus?.();
        } else {
          window.location.assign(url);
        }
      }
    },
    [redirect],
  );
  const [jobs, setJobs] = useState(initialJobs);
  const [jobsPage, setJobsPage] = useState(0);
  const [creditAmount, setCreditAmount] = useState("1000");
  const [creditBalance, setCreditBalance] = useState(initialCreditBalance);
  const [currentPlanId, setCurrentPlanId] = useState(initialPlanId);
  const [usageStats, setUsageStats] = useState(() =>
    deriveUsageStats(initialJobs, initialCreditBalance),
  );
  useEffect(() => {
    setJobs(initialJobs);
    setCreditBalance(initialCreditBalance);
    setUsageStats(deriveUsageStats(initialJobs, initialCreditBalance));
  }, [initialJobs, initialCreditBalance]);

  useEffect(() => {
    setCurrentPlanId(initialPlanId);
  }, [initialPlanId]);
  useEffect(() => {
    const billing = planFetcher.data?.billing;
    if (!billing || planFetcher.state !== "idle") {
      return;
    }
    if (billing.error) {
      appBridgeToast?.show?.(billing.error);
      return;
    }
    if (!billing?.confirmationUrl) {
      return;
    }
    redirectToUrl(billing.confirmationUrl);
  }, [planFetcher.data, planFetcher.state, redirectToUrl, appBridgeToast]);

  const fetchJobs = useCallback(async () => {
    try {
      const response = await fetch(withHost("/app/jobs/list"), {
        credentials: "include",
      });
      const contentType = response.headers.get("content-type") || "";
      if (!response.ok || !contentType.includes("application/json")) {
        throw new Error("Failed to load jobs");
      }
      const json = await response.json();
      const refreshedJobs = json?.jobs ?? [];
      const refreshedCredits =
        typeof json?.credits === "number" ? json.credits : creditBalance;
      setJobs(refreshedJobs);
      setCreditBalance(refreshedCredits);
      setUsageStats(deriveUsageStats(refreshedJobs, refreshedCredits));
    } catch (error) {
      console.error("Failed to fetch jobs", error);
    }
  }, [withHost, creditBalance]);

  useEffect(() => {
    fetchJobs();
    const interval = setInterval(fetchJobs, 5000);
    return () => clearInterval(interval);
  }, [fetchJobs]);

  const sortedJobs = useMemo(() => {
    return [...jobs].sort((a, b) => {
      const aTime =
        typeof a?.createdAtMs === "number" ? a.createdAtMs : Date.parse(a?.createdAt ?? "") || 0;
      const bTime =
        typeof b?.createdAtMs === "number" ? b.createdAtMs : Date.parse(b?.createdAt ?? "") || 0;
      return bTime - aTime;
    });
  }, [jobs]);

  const totalJobsPages = Math.max(1, Math.ceil(Math.max(sortedJobs.length, 1) / JOBS_PAGE_SIZE));

  useEffect(() => {
    setJobsPage((current) => Math.min(current, totalJobsPages - 1));
  }, [totalJobsPages]);

  const currentJobsPage = Math.min(jobsPage, totalJobsPages - 1);
  const pagedJobs = sortedJobs.slice(
    currentJobsPage * JOBS_PAGE_SIZE,
    (currentJobsPage + 1) * JOBS_PAGE_SIZE,
  );

  const changeJobsPage = (direction) => {
    setJobsPage((current) => {
      const next = current + direction;
      return Math.min(Math.max(next, 0), totalJobsPages - 1);
    });
  };

  const goToJobsPage = (page) => {
    const clamped = Math.min(Math.max(page, 0), totalJobsPages - 1);
    setJobsPage(clamped);
  };

  useEffect(() => {
    if (fetcher.data?.product?.id) {
      appBridgeToast?.show?.("Product created");
    }
  }, [fetcher.data?.product?.id, appBridgeToast]);
  useEffect(() => {
    const result = creditFetcher.data?.creditPurchase;
    if (!result || creditFetcher.state !== "idle") {
      return;
    }
    if (result?.confirmationUrl) {
      redirectToUrl(result.confirmationUrl);
      return;
    }
    if (result?.message) {
      appBridgeToast?.show?.(result.message);
    }
  }, [creditFetcher.data, creditFetcher.state, redirectToUrl, appBridgeToast]);

  useEffect(() => {
    const planChange = planFetcher.data?.planChange;
    if (!planChange || planFetcher.state !== "idle") {
      return;
    }
    if (planChange.success && planChange.plan) {
      setCurrentPlanId(planChange.plan);
      const label = PLAN_CONFIG[planChange.plan]?.title || planChange.plan;
      const creditMsg =
        typeof planChange.creditsAdded === "number" && planChange.creditsAdded > 0
          ? ` Added ${planChange.creditsAdded.toLocaleString()} credits to your balance.`
          : "";
      appBridgeToast?.show?.(`Plan updated to ${label}.${creditMsg}`);
    } else if (planChange.message) {
      appBridgeToast?.show?.(planChange.message);
    }
  }, [planFetcher.data, planFetcher.state, appBridgeToast]);

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const subscriptionId =
      params.get("subscription_id") || params.get("charge_id");
    if (!subscriptionId || billingCallbackTriggered) {
      return;
    }
    const formData = new FormData();
    formData.set("subscriptionId", subscriptionId);
    const planParam = params.get("plan");
    if (planParam) {
      formData.set("plan", planParam);
    }
    const shopParam = params.get("shop");
    if (shopParam) {
      formData.set("shop", shopParam);
    }
    const hostParam = params.get("host");
    if (hostParam) {
      formData.set("host", hostParam);
    }
    billingCallbackFetcher.submit(formData, {
      method: "post",
      action: withHost("/app/billing/callback"),
    });
    setBillingCallbackTriggered(true);
  }, [
    billingCallbackFetcher,
    billingCallbackTriggered,
    location.search,
    withHost,
  ]);

  useEffect(() => {
    if (
      billingCallbackFetcher.state === "idle" &&
      billingCallbackFetcher.data?.success === false
    ) {
      setBillingCallbackTriggered(false);
    }
  }, [billingCallbackFetcher.data, billingCallbackFetcher.state]);

  useEffect(() => {
    if (billingCallbackFetcher.state !== "idle") {
      return;
    }
    const result = billingCallbackFetcher.data;
    if (!result) {
      return;
    }
    if (result.success) {
      const planLabel = PLAN_CONFIG[result.plan]?.title || result.plan || "Plan";
      const creditMsg =
        typeof result.creditsAdded === "number" && result.creditsAdded > 0
          ? ` Added ${result.creditsAdded.toLocaleString()} credits to your balance.`
          : "";
      appBridgeToast?.show?.(`${planLabel} activated.${creditMsg}`);
      if (result.plan) {
        setCurrentPlanId(result.plan);
      }
    } else if (result.message) {
      appBridgeToast?.show?.(result.message);
    }
  }, [billingCallbackFetcher.data, billingCallbackFetcher.state, appBridgeToast]);

  useEffect(() => {
    if (!billingCallbackTriggered) {
      return;
    }
    if (billingCallbackFetcher.state !== "idle") {
      return;
    }
    const params = new URLSearchParams(location.search);
    const keysToRemove = ["subscription_id", "charge_id", "plan", "shop"];
    let cleaned = false;
    keysToRemove.forEach((key) => {
      if (params.has(key)) {
        params.delete(key);
        cleaned = true;
      }
    });
    if (!cleaned) {
      return;
    }
    navigate(
      { pathname: location.pathname, search: params.toString() ? `?${params.toString()}` : "" },
      { replace: true },
    );
  }, [
    billingCallbackFetcher.state,
    billingCallbackTriggered,
    location.pathname,
    location.search,
    navigate,
  ]);

  useEffect(() => {
    const addedFromSync = loaderData?.creditSync?.added ?? 0;
    if (addedFromSync > 0) {
      appBridgeToast?.show?.(
        `${addedFromSync.toLocaleString()} credit${addedFromSync === 1 ? "" : "s"} added to your balance.`,
      );
    }
  }, [loaderData?.creditSync?.added, appBridgeToast]);

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const creditStatus = params.get("creditStatus");
    if (creditStatus) {
      params.delete("creditStatus");
      let creditMessage = null;
      if (creditStatus === "success") {
        creditMessage = "Credits added to your balance.";
      } else if (creditStatus === "declined") {
        creditMessage = "Payment was not completed. Please try again.";
      } else if (creditStatus === "error") {
        creditMessage =
          "We couldn't verify that payment. Contact support if it succeeded.";
      } else if (creditStatus === "missing") {
        creditMessage = "Missing purchase details from Shopify checkout.";
      }
      if (creditMessage) {
        appBridgeToast?.show?.(creditMessage);
      }
    }
    const planStatus = params.get("planStatus");
    if (planStatus) {
      params.delete("planStatus");
      const planParam = params.get("plan");
      const creditsParam = Number(params.get("planCredits") || 0);
      params.delete("plan");
      params.delete("planCredits");
      let planMessage = null;
      if (planStatus === "success") {
        const planLabel = PLAN_CONFIG[planParam]?.title || planParam || "Plan";
        const creditsNote =
          creditsParam > 0
            ? ` Added ${creditsParam.toLocaleString()} credits to your balance.`
            : "";
        planMessage = `${planLabel} activated.${creditsNote}`;
      } else if (planStatus === "declined") {
        planMessage =
          "Plan activation was not completed. Please try again or contact support.";
      } else if (planStatus === "error") {
        planMessage = "We couldn't verify that subscription. Please try again later.";
      }
      if (planMessage) {
        appBridgeToast?.show?.(planMessage);
      }
    }
    if (creditStatus || planStatus) {
      navigate(
        { pathname: location.pathname, search: params.toString() ? `?${params.toString()}` : "" },
        { replace: true },
      );
    }
  }, [location, navigate, appBridgeToast]);
  const hasJobs = sortedJobs.length > 0;
  const creditPackages = QUICK_SELECT_PACKAGES;
  const pricePerCredit = 0.005;
  const parsedCredits = Math.max(0, Number(creditAmount) || 0);
  const formattedCredits = parsedCredits.toLocaleString();
  const appliesBulkDiscount = parsedCredits >= BULK_DISCOUNT_THRESHOLD;
  const effectivePricePerCredit = appliesBulkDiscount
    ? pricePerCredit * (1 - BULK_DISCOUNT_RATE)
    : pricePerCredit;
  const totalCost = parsedCredits * effectivePricePerCredit;
  const formattedTotal = `$${totalCost.toFixed(2)}`;
  const isValidCreditAmount =
    parsedCredits >= MIN_CREDIT_PURCHASE && parsedCredits % CREDIT_STEP === 0;
  const creditPurchaseLoading = ["loading", "submitting"].includes(creditFetcher.state);
  const creditPurchaseFailed = creditFetcher.data?.creditPurchase?.success === false;
  const creditPurchaseMessage = creditFetcher.data?.creditPurchase?.message;
  const averageRating = ratingSummary?.averageScore;
  const ratingSampleSize = ratingSummary?.sampleSize ?? 0;
  const ratingLabel = ratingSummary?.label ?? null;
  const ratingDisplay =
    typeof averageRating === "number" ? `${averageRating.toFixed(1)} / 10` : "—";
  const ratingTooltip = ratingSampleSize
    ? `${ratingLabel ?? "Quality"} across ${ratingSampleSize} product${
        ratingSampleSize === 1 ? "" : "s"
      }.`
    : "Generate or sync products to calculate a rating.";
  const ratingBadgeTone =
    ratingLabel === "Great" ? "success" : ratingLabel === "OK" ? "attention" : "critical";
  const activePlan = PLAN_CONFIG[currentPlanId] || PLAN_CONFIG[DEFAULT_PLAN];
  const planLimitText =
    typeof activePlan?.maxProductsPerJob === "number"
      ? `Max ${activePlan.maxProductsPerJob.toLocaleString()} products/bulk job`
      : null;
  const planCreditsText =
    typeof activePlan?.creditsPerMonth === "number"
      ? `${activePlan.creditsPerMonth.toLocaleString()} credits/month`
      : null;
  const planMetaBadges = [planCreditsText, planLimitText].filter(Boolean);
  const planSubmittingId = planFetcher.formData?.get?.("plan")?.toString() || null;

  const handlePurchaseCredits = () => {
    if (!isValidCreditAmount || creditPurchaseLoading) {
      return;
    }
    creditFetcher.submit(
      {
        intent: "purchaseCredits",
        credits: parsedCredits.toString(),
        amount: totalCost.toFixed(2),
      },
      { method: "post" },
    );
  };

  return (
    <s-page heading="Shopify app template">
 <s-button slot="primary-action" variant="primary" commandFor="upgrade-plan-modal">
    Upgrade plan
  </s-button>

  <s-button slot="secondary-actions" variant="secondary" commandFor="add-credit-modal">
    Add credit
  </s-button>

      <s-modal id="upgrade-plan-modal" heading="Upgrade plan">
        <s-stack direction="block" gap="base">
          <s-text appearance="subdued">
            Choose the billing plan that fits your current catalog and switch anytime .
          </s-text>
          <s-stack
            direction="inline"
            gap="base"
            style={{ justifyContent: "flex-start", width: "100%", flexWrap: "wrap" }}
          >
            {PLAN_OPTIONS.map((plan) => {
              const isCurrent = plan.id === currentPlanId;
              const submittingThisPlan =
                planFetcher.state !== "idle" && planSubmittingId === plan.id;
              const props = {
                variant: isCurrent ? "secondary" : "primary",
                disabled: isCurrent || planFetcher.state !== "idle",
                ...(submittingThisPlan ? { loading: true } : {}),
              };
              if (!isCurrent) {
                props.onClick = () =>
                  planFetcher.submit(
                    { plan: plan.id },
                    {
                      method: "post",
                      action: withHost("/app/billing/start"),
                    },
                  );
              }
              return (
                <PricingCard
                  key={plan.id}
                  title={plan.title}
                  description={plan.description}
                  features={plan.features}
                  price={plan.price}
                  frequency={plan.frequency}
                  featuredText={plan.badge}
                  button={{
                    content: isCurrent ? "Current plan" : "Select plan",
                    props,
                  }}
                />
              );
            })}
          </s-stack>
        </s-stack>
      </s-modal>

      <s-modal id="add-credit-modal" heading="Add credits">
        <s-stack direction="block" gap="base">
          <s-stack direction="block" gap="extra-tight">
            <s-heading level={3}>One-time purchase</s-heading>
            <s-paragraph>
              Buy credits whenever you need more generation capacity. Each credit powers one AI content item.
            </s-paragraph>
          </s-stack>
          <s-divider />

          <s-stack direction="block" gap="tight">
            <s-heading level={3}>
              Choose your package
              <s-text type="strong" style={{ marginLeft: "0.25rem" }}>
                *
              </s-text>
            </s-heading>
            <s-text-field
              type="number"
              name="creditCount"
              min={MIN_CREDIT_PURCHASE}
              step={CREDIT_STEP}
              value={creditAmount}
              onInput={(event) => setCreditAmount(event.target.value)}
              icon="money"
              label="Credit amount"
              labelAccessibilityVisibility="hidden"
              style={{ marginBottom: "0.6rem" }}
            ></s-text-field>
            <div style={{ marginTop: "0.5rem" }}>
              <s-stack direction="inline" align="center" gap="base">
                {isValidCreditAmount ? (
                  <s-stack direction="inline" align="center" gap="tight">
                    <s-icon
                      type="info"
                      tone="subdued"
                      size="large"
                      style={{ display: "inline-flex", alignItems: "center" }}
                    />
                    <s-text tone="success">
                      Get{" "}
                      <s-text type="strong">{formattedCredits}</s-text>{" "}
                      credits for{" "}
                      <s-text type="strong">{formattedTotal}</s-text>
                    </s-text>
                  </s-stack>
                ) : (
                  <s-stack direction="inline" align="center" gap="tight">
                    <s-icon
                      type="info"
                      tone="subdued"
                      size="small"
                      style={{ display: "inline-flex", alignItems: "center" }}
                    />
                    <s-text tone="success">
                      Enter at least {MIN_CREDIT_PURCHASE.toLocaleString()} credits in{" "}
                      {CREDIT_STEP.toLocaleString()} increments
                    </s-text>
                  </s-stack>
                )}
                {isValidCreditAmount && appliesBulkDiscount && (
                  <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                    <s-badge tone="success">
                      Save <s-text type="strong">10%</s-text>
                    </s-badge>
                  </div>
                )}
              </s-stack>
            </div>
            <div style={{ marginTop: "0.75rem" }}>
              <s-button
                variant="primary"
                style={{ alignSelf: "flex-start" }}
                disabled={!isValidCreditAmount || creditPurchaseLoading}
                onClick={handlePurchaseCredits}
                {...(creditPurchaseLoading ? { loading: "" } : {})}
              >
                {isValidCreditAmount
                  ? `Get ${formattedCredits} credits for ${formattedTotal}`
                  : "Enter a valid amount to continue"}
              </s-button>
              {creditPurchaseFailed && creditPurchaseMessage && (
                <s-text tone="critical" style={{ marginTop: "0.5rem" }}>
                  {creditPurchaseMessage}
                </s-text>
              )}
            </div>
          </s-stack>

          <s-stack direction="block" gap="tight">
            <s-text type="strong">Quick select:</s-text>
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                gap: "0.5rem",
                paddingTop: "0.25rem",
              }}
            >
              {creditPackages.map((preset) => (
                <s-button
                  key={`credit-preset-${preset}`}
                  variant="secondary"
                  style={{ minWidth: "96px" }}
                  onClick={() => setCreditAmount(String(preset))}
                >
                  {preset.toLocaleString()}
                </s-button>
              ))}
            </div>
          </s-stack>

          <s-divider />

          <s-stack direction="block" gap="loose">
            <s-heading level={3}>What your credits unlock</s-heading>
            <s-stack direction="block" gap="base">
              {[
                { copy: "Generate polished product descriptions at scale", icon: "product" },
                { copy: "Autofill onboarding or import flows with AI suggestions", icon: "settings" },
                { copy: "Translate listings into multiple languages instantly", icon: "select" },
                { copy: "Adjust tone presets for seasonal or campaign-ready copy", icon: "adjust" },
                { copy: "Produce ad headlines, social blurbs, and announcement text", icon: "marketing" },
              ].map(({ copy, icon }) => (
                <s-stack key={copy} direction="inline" gap="tight" align="center">
                  <s-icon type={icon} tone="info" size="large"></s-icon>
                  <s-text>{copy}</s-text>
                </s-stack>
              ))}
            </s-stack>
          </s-stack>
        </s-stack>


        <s-button slot="secondary-actions" commandFor="add-credit-modal" command="--hide">
          Cancel
        </s-button>


        <s-button
                  slot="primary-action"
                variant="primary"
                style={{ alignSelf: "flex-start" }}
                disabled={!isValidCreditAmount || creditPurchaseLoading}
                onClick={handlePurchaseCredits}
                {...(creditPurchaseLoading ? { loading: "" } : {})}
              >
                {isValidCreditAmount
                  ? `Get ${formattedCredits} credits for ${formattedTotal}`
                  : "Enter a valid amount to continue"}
              </s-button>


      </s-modal>

      <s-section heading="Your usage summary">
        <s-grid
          gridTemplateColumns="repeat(auto-fit, minmax(220px, 1fr))"
          gap="small"
          justifyContent="center"
        >
          <s-grid-item gridColumn="span 1">
            <s-box background="strong" padding="base" borderRadius="base">
              <s-stack direction="block" gap="tight">
              <s-stack direction="inline" gap="tight" align="center">
                <s-icon type="text-font" tone="success" size="large" />
                <s-text variant="headingSm">
                  <s-text type="strong">Words Generated</s-text>
                </s-text>
              </s-stack>
              <div style={{ display: "flex", alignItems: "center", gap: "0.25rem" }}>
                <s-text variant="headingLg" type="strong">
                  {usageStats.generatedWords.toLocaleString()}
                </s-text>
                <s-tooltip id="words-generated-tooltip">Total AI words produced.</s-tooltip>
                <s-icon
                  type="info"
                  tone="subdued"
                  size="small"
                  interestFor="words-generated-tooltip"
                  style={{ cursor: "pointer" }}
                />
              </div>
              </s-stack>
            </s-box>
          </s-grid-item>
          <s-grid-item gridColumn="span 1">
            <s-box background="strong" padding="base" borderRadius="base">
              <s-stack direction="block" gap="tight">
              <s-stack direction="inline" gap="tight" align="center">
                <s-icon type="star" tone="info" size="large" />
                <s-text variant="headingSm">
                  <s-text type="strong">Avg. product rating</s-text>
                </s-text>
              </s-stack>
              <div style={{ display: "flex", alignItems: "center", gap: "0.25rem" }}>
                <s-text variant="headingLg" type="strong">
                  {ratingDisplay}
                </s-text>
                {ratingLabel && (
                  <s-badge tone={ratingBadgeTone} appearance="subdued">
                    {ratingLabel}
                  </s-badge>
                )}
                <s-tooltip id="product-rating-tooltip">{ratingTooltip}</s-tooltip>
                <s-icon
                  type="info"
                  tone="subdued"
                  size="small"
                  interestFor="product-rating-tooltip"
                  style={{ cursor: "pointer" }}
                />
              </div>
              </s-stack>
            </s-box>
          </s-grid-item>
          <s-grid-item gridColumn="span 1">
            <s-box background="strong" padding="base" borderRadius="base">
              <s-stack direction="block" gap="tight">
              <s-stack direction="inline" gap="tight" align="center">
                <s-icon type="cash-dollar" tone="info" size="large" />
                <s-text variant="headingSm">
                  <s-text type="strong">Credits left</s-text>
                </s-text>
              </s-stack>
              <div style={{ display: "flex", alignItems: "center", gap: "0.25rem" }}>
                <s-text variant="headingLg" type="strong">
                  {usageStats.creditsRemaining.toLocaleString()}
                </s-text>
                <s-tooltip id="credits-left-tooltip">Remaining AI generation balance.</s-tooltip>
                <s-icon
                  type="info"
                  tone="subdued"
                  size="small"
                  interestFor="credits-left-tooltip"
                  style={{ cursor: "pointer" }}
                />
              </div>
              </s-stack>
            </s-box>
          </s-grid-item>
          <s-grid-item gridColumn="span 1">
            <s-box background="strong" padding="base" borderRadius="base">
              <s-stack direction="block" gap="tight">
                <s-stack direction="inline" gap="tight" align="center">
                  <s-icon type="plan" tone="success" size="large" />
                  <s-text variant="headingSm">
                    <s-text type="strong">Current plan</s-text>
                  </s-text>
                  <s-tooltip id="current-plan-tooltip">
                    Monthly credits and bulk job limits for this plan.
                  </s-tooltip>
                  <s-icon
                    type="info"
                    tone="subdued"
                    size="small"
                    interestFor="current-plan-tooltip"
                    style={{ cursor: "pointer" }}
                  />
                </s-stack>
                <div style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
                  <s-text variant="headingLg" type="strong">
                    {activePlan.title}
                  </s-text>
                  <s-stack
                    direction="inline"
                    gap="small"
                    style={{ flexWrap: "wrap", marginTop: "0.5rem" }}
                  >
                    {planMetaBadges.map((badgeText) => (
                      <s-badge
                        key={badgeText}
                        tone="info"
                        appearance="subdued"
                        style={{
                          borderRadius: "999px",
                          fontWeight: 600,
                          padding: "0.25rem 0.75rem",
                          fontSize: "0.95rem",
                        }}
                      >
                        {badgeText}
                      </s-badge>
                    ))}
                  </s-stack>
                </div>
              </s-stack>
            </s-box>
          </s-grid-item>
        </s-grid>
      </s-section>

      <s-section heading="Order history">
        <s-card padding="base" borderRadius="base">

          {hasJobs ? (
            <>
              <s-section padding="none">
                <div
                  style={{
                    border: "1px solid var(--p-color-border-subdued, #D0D5DD)",
                    borderRadius: "8px",
                    overflowX: "auto",
                  }}
                >
                  <s-table>
                  <s-table-header-row>
                    <s-table-header listSlot="primary">Order ID</s-table-header>
                    <s-table-header listSlot="secondary">Created</s-table-header>
                    <s-table-header listSlot="inline">Products</s-table-header>
                    <s-table-header listSlot="labeled">Type</s-table-header>
                    <s-table-header listSlot="inline">Credits</s-table-header>
                    <s-table-header>Status</s-table-header>
                  </s-table-header-row>
                  <s-table-body>
                    {pagedJobs.map((job, index) => {
                      const productCount = job.selection?.products ?? 0;
                      const collectionCount = job.selection?.collections ?? 0;
                      const typeLabels =
                        job.types?.map((typeId) => generationTypeLabelMap[typeId] || typeId) ?? [];
                      const isQueued = job.status === "queued";
                      const isRunning = job.status === "running";
                      const isFailed = job.status === "failed";
                      const totalWorkItems = job.workItemCount ?? job.estimatedCredits ?? 0;
                      const estimatedCredits = job.estimatedCredits ?? job.workItemCount ?? 0;
                      const completedItemsRaw = Number(job.completedItems) || 0;
                      const completedItems =
                        totalWorkItems > 0
                          ? Math.min(completedItemsRaw, totalWorkItems)
                          : completedItemsRaw;
                      const { date, time } = getJobDateParts(job);
                      const primaryType = typeLabels[0] || "—";
                      const remainingTypes = typeLabels.length > 1 ? typeLabels.length - 1 : 0;
                      const orderDisplayId = getOrderDisplayId(job.id);
                      let statusLabel = "Completed";
                      if (isFailed) {
                        statusLabel = "Failed";
                      } else if (isQueued) {
                        statusLabel = "Queued";
                      } else if (isRunning) {
                        statusLabel = totalWorkItems
                          ? `${completedItems}/${totalWorkItems} In progress`
                          : "In progress";
                      } else if (totalWorkItems) {
                        statusLabel = `${totalWorkItems}/${totalWorkItems} Completed`;
                      }
                      return (
                        <s-table-row
                          key={job.id}
                          style={{
                            backgroundColor:
                              index % 2 === 0
                                ? "var(--p-color-bg-surface, #fff)"
                                : "var(--p-color-bg-surface-secondary, #f9fafb)",
                          }}
                        >
                          <s-table-cell>
                            <s-text type="strong">{orderDisplayId}</s-text>
                          </s-table-cell>
                          <s-table-cell>
                            <s-stack direction="block" gap="extra-tight">
                              <s-text>{date}</s-text>
                              {time && <s-text appearance="subdued">{time}</s-text>}
                            </s-stack>
                          </s-table-cell>
                          <s-table-cell>
                            {productCount || collectionCount ? (
                              <s-stack direction="block" gap="extra-tight">
                                {productCount > 0 && (
                                  <s-text>
                                    {productCount} {productCount === 1 ? "Product" : "Products"}
                                  </s-text>
                                )}
                                {collectionCount > 0 && (
                                  <s-text appearance="subdued">
                                    {collectionCount} {collectionCount === 1 ? "Collection" : "Collections"}
                                  </s-text>
                                )}
                              </s-stack>
                            ) : (
                              <s-text>—</s-text>
                            )}
                          </s-table-cell>
                          <s-table-cell>
                            <s-badge tone="info" appearance="subdued">
                              {primaryType}
                            </s-badge>
                            {remainingTypes > 0 && (
                              <s-text appearance="subdued" style={{ marginLeft: "0.25rem" }}>
                                +{remainingTypes} more
                              </s-text>
                            )}
                          </s-table-cell>
                          <s-table-cell>
                            <s-text>
                              {typeof estimatedCredits === "number"
                                ? estimatedCredits.toLocaleString()
                                : "—"}
                            </s-text>
                          </s-table-cell>
                          <s-table-cell>
                            {isRunning ? (
                              <s-stack direction="inline" gap="tight" align="center">
                                <s-text appearance="subdued">{statusLabel}</s-text>
                                <s-spinner accessibilityLabel="Job in progress" size="base" />
                              </s-stack>
                            ) : isQueued ? (
                              <s-badge tone="warning">{statusLabel}</s-badge>
                            ) : isFailed ? (
                              <s-badge tone="critical">{statusLabel}</s-badge>
                            ) : (
                              <s-badge tone="success">{statusLabel}</s-badge>
                            )}
                          </s-table-cell>
                        </s-table-row>
                      );
                    })}
                  </s-table-body>
                </s-table>
                </div>
              </s-section>
              {totalJobsPages > 1 && (
                <s-stack
                  direction="block"
                  align="center"
                  gap="tight"
                  style={{ marginTop: "1rem", paddingTop: "0.75rem" }}
                >
                  <s-pagination
                    has-previous={currentJobsPage > 0}
                    has-next={currentJobsPage < totalJobsPages - 1}
                    style={{
                      display: "flex",
                      gap: "1rem",
                      alignItems: "center",
                      justifyContent: "center",
                      paddingTop:"1rem",
                    }}
                  >
                    <s-button
                      slot="previous"
                      variant="secondary"
                      onClick={() => changeJobsPage(-1)}
                      disabled={currentJobsPage === 0}
                    >
                      ←
                    </s-button>
                    <s-stack direction="inline" gap="extra-tight" align="center">
                      {Array.from({ length: totalJobsPages }).map((_, index) => (
                        <s-button
                          key={`jobs-page-${index}`}
                          variant={index === currentJobsPage ? "primary" : "tertiary"}
                          onClick={() => goToJobsPage(index)}
                        >
                          {index + 1}
                        </s-button>
                      ))}
                    </s-stack>
                    <s-button
                      slot="next"
                      variant="secondary"
                      onClick={() => changeJobsPage(1)}
                      disabled={currentJobsPage >= totalJobsPages - 1}
                    >
                      →
                    </s-button>
                  </s-pagination>
                </s-stack>
              )}
            </>
          ) : (
            <s-empty-state heading="No jobs yet">
              Generate bulk content to see its progress here.
            </s-empty-state>
          )}
        </s-card>
      </s-section>

    </s-page>
  );
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
const deriveUsageStats = (jobsList, creditsRemaining = 0) => {
  const usedCredits = jobsList.reduce((total, job) => {
    const creditsUsed = typeof job.workItemCount === "number" ? job.workItemCount : 0;
    return total + creditsUsed;
  }, 0);
  return {
    generatedWords: Math.max(0, usedCredits * WORDS_PER_CREDIT),
    creditsRemaining: Math.max(0, creditsRemaining),
  };
};
