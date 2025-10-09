// app/routes/api/active-plan.js

import { json } from "@remix-run/node";
import { PrismaClient } from "@prisma/client";
import Shopify from "shopify-api-node";  // Shopify SDK

const prisma = new PrismaClient();

// Action handler to handle POST request
export const action = async ({ request }) => {
  const { plan, shop } = await request.json();

  if (!plan || !shop) {
    return json({ error: "Missing plan or shop" }, { status: 400 });
  }

  // Define available plans
  const plans = {
    basic: { name: "Basic", price: 4.99, trial_days: 7 },
    pro: { name: "Pro", price: 9.99, trial_days: 7 },
  };

  const selectedPlan = plans[plan];
  if (!selectedPlan) {
    return json({ error: "Invalid plan" }, { status: 400 });
  }

  try {
    // Retrieve the session for the shop
    const session = await prisma.session.findFirst({ where: { shop } });
    if (!session || !session.accessToken) {
      return json({ error: "Access token not found" }, { status: 401 });
    }

    const shopify = new Shopify({
      shopName: shop.replace(".myshopify.com", ""),
      accessToken: session.accessToken,
    });

    // Create the charge for the plan
    const charge = await shopify.recurringApplicationCharge.create({
      name: selectedPlan.name,
      price: selectedPlan.price,
      return_url: `https://situation-later-automated-saves.trycloudflare.com/billing/callback?shop=${shop}`,
      trial_days: selectedPlan.trial_days,
      test: process.env.NODE_ENV !== "production", // Test mode for dev
    });

    return json({ confirmationUrl: charge.confirmation_url });
  } catch (err) {
    console.error(`Billing error for shop ${shop}:`, err);
    return json({ error: "Failed to create billing session" }, { status: 500 });
  }
};

// Loader for GET request (if necessary)
export const loader = ({ request }) => {
  return json({});
};
