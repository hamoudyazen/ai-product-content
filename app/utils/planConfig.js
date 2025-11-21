export const PLAN_ORDER = ["FREE", "STARTER", "GROWTH", "PRO"];

export const PLAN_CONFIG = {
  FREE: {
    id: "FREE",
    title: "FREE",
    description: "Test the workflows with a handful of products.",
    features: ["5 credits/month", "Max 5 products per bulk job"],
    price: "$0",
    priceAmount: 0,
    frequency: "",
    creditsPerMonth: 5,
    maxProductsPerJob: 5,
  },
  STARTER: {
    id: "STARTER",
    title: "STARTER",
    description: "Affordable automation for small catalogs.",
    features: [
      "2,500 credits/month",
      "Max 200 products per bulk job",
      "Basic templates",
      "Basic history",
      "Standard support",
    ],
    price: "$12",
    priceAmount: 12,
    frequency: "month",
    creditsPerMonth: 2500,
    maxProductsPerJob: 200,
  },
  GROWTH: {
    id: "GROWTH",
    title: "GROWTH",
    badge: "Most popular",
    description: "Level up production with bigger queues.",
    features: [
      "13,000 credits/month",
      "Max 750 products per bulk job",
      "Unlimited templates",
      "30-day history",
      "Priority queue",
      "Priority support",
    ],
    price: "$45",
    priceAmount: 45,
    frequency: "month",
    creditsPerMonth: 13000,
    maxProductsPerJob: 750,
  },
  PRO: {
    id: "PRO",
    title: "PRO",
    description: "Enterprise-grade throughput and support.",
    features: [
      "115,000 credits/month",
      "Max 3,000 products per bulk job",
      "Unlimited templates",
      "Full history",
      "Fastest queue priority",
      "Priority voice/email support",
    ],
    price: "$190",
    priceAmount: 190,
    frequency: "month",
    creditsPerMonth: 115000,
    maxProductsPerJob: 3000,
  },
};

export const PLAN_OPTIONS = PLAN_ORDER.map((id) => PLAN_CONFIG[id]);

export const DEFAULT_PLAN = "FREE";

export const PLAN_IDS = PLAN_ORDER;

export const getPlanConfig = (planId) => PLAN_CONFIG[planId] || PLAN_CONFIG[DEFAULT_PLAN];
