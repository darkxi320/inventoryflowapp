import { redirect } from "@remix-run/node";

export const loader = async ({ request }) => {
  const { authenticate, MONTHLY_PLAN, ANNUAL_PLAN } = await import("../shopify.server");

  const { billing, session } = await authenticate.admin(request);
  let { shop } = session;
  let myShop = shop.replace("myShopify.com", "");

  try {
    await billing.require({
      plans: [MONTHLY_PLAN],
      onFailure: async () => {
        console.log("Requesting subscription upgrade...");
        return billing.request({
          plan: MONTHLY_PLAN,
          isTest: false, // Set this to false for live apps
          returnUrl: `https://admin.shopify.com/store/${myShop}/apps/${process.env.APP_NAME}/billing-pages`,
        });
      },
    });

    const subscription = billing.appSubscriptions[0];
    console.log(`Shop is on ${subscription.name} (id ${subscription.id})`);
    
    return redirect('/app/pricing'); // Redirect after successful upgrade

  } catch (error) {
    console.error("Error during billing process:", error);
    return redirect('/app/error'); // Redirect to error page on failure
  }
};
