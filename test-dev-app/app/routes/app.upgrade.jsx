import { redirect } from "@remix-run/node";

export const loader = async ({ request }) => {
  const { authenticate, MONTHLY_PLAN, ANNUAL_PLAN } = await import("../shopify.server");

  // Authenticate the admin and get the session details
  const { billing, session } = await authenticate.admin(request);
  let { shop } = session;

  // Clean up the shop domain to use it properly
  let myShop = shop.replace("myShopify.com", "");

  try {
    // Ensure the shop is subscribed to a valid plan
    await billing.require({
      plans: [MONTHLY_PLAN],
      onFailure: async () => {
        console.log("Requesting subscription upgrade...");
        // If the shop is not on the required plan, request the upgrade
        return billing.request({
          plan: MONTHLY_PLAN,
          isTest: false, // Set this to false for live apps
          returnUrl: `https://admin.shopify.com/store/${myShop}/apps/${process.env.APP_NAME}/billing-pages`,
        });
      },
    });

    const subscription = billing.appSubscriptions[0];
    console.log(`Shop is on ${subscription.name} (id ${subscription.id})`);

    // Redirect the user to pricing page after successful upgrade
    return redirect('/app/pricing');

  } catch (error) {
    console.error("Error during billing process:", error);
    // Redirect to an error page if something goes wrong
    return redirect('/app/error');
  }
};
