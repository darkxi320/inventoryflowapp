import { Page, Card, Text, Button, Divider, Grid, BlockStack, ExceptionList } from '@shopify/polaris';
import { useLoaderData } from "@remix-run/react";
import { ChevronRightIcon } from '@shopify/polaris-icons';

export async function loader({ request }) {
  const { billing } = await import("../shopify.server");

  try {
    // Check the current billing plan
    const billingCheck = await billing.require({
      plans: ['Monthly subscription', 'Annual subscription'],
      onFailure: () => {
        throw new Error("No active plan");
      },
    });

    const subscription = billingCheck.appSubscriptions[0];
    return { billing, plan: subscription };
  } catch (error) {
    return { billing, plan: { name: "Free" } }; // Default to free plan if no active subscription
  }
}

export default function PricingPage() {
  const { plan } = useLoaderData();

  const planData = [
    {
      title: "Free",
      description: "Free plan with basic features",
      price: "0",
      action: "Upgrade to pro",
      name: "Free",
      url: "/app/upgrade",
      features: [
        "Basic inventory tracking",
        "Manual product imports",
        "Simple product categorization",
        "Stock level alerts",
        "Email support",
        "Basic inventory analytics"
      ]
    },
    {
      title: "Pro",
      description: "Pro plan with advanced features",
      price: "10",
      name: "Monthly subscription",
      action: "Upgrade to pro",
      url: "/app/upgrade",
      features: [
        "Unlimited inventory tracking",
        "Bulk product imports and exports",
        "Advanced product categorization",
        "Real-time stock level updates",
        "Priority customer support",
        "Advanced inventory analytics and reporting"
      ]
    },
  ];

  return (
    <Page title="Pricing">
      <Card title="Change your plan" sectioned>
        {plan.name === "Monthly subscription" ? (
          <Text variant="bodyMd">You're currently on the Pro plan. All features are unlocked.</Text>
        ) : (
          <Text variant="bodyMd">You're currently on the Free plan. Upgrade to Pro to unlock more features.</Text>
        )}
        <Button primary url="/app/upgrade">
          {plan.name === "Monthly subscription" ? "Cancel Subscription" : "Upgrade to Pro"}
        </Button>
      </Card>

      <Divider />

      <Grid>
        {planData.map((plan_item, index) => (
          <Grid.Cell key={index} columnSpan={{xs: 6, sm: 3, md: 3, lg: 6, xl: 6}}>
            <Card background={plan_item.name === plan.name ? "bg-surface-success" : "bg-surface"} sectioned>
              <Text as="h3" variant="headingMd">{plan_item.title}</Text>
              <Text as="p" variant="bodyMd">{plan_item.description}</Text>
              <Text as="p" variant="headingLg" fontWeight="bold">{plan_item.price === "0" ? "" : "$" + plan_item.price}</Text>
              <BlockStack gap={100}>
                {plan_item.features.map((feature, idx) => (
                  <ExceptionList
                    key={idx}
                    items={[{ icon: ChevronRightIcon, description: feature }]}
                  />
                ))}
              </BlockStack>
              <Button primary url={plan_item.url}>{plan_item.action}</Button>
            </Card>
          </Grid.Cell>
        ))}
      </Grid>
    </Page>
  );
}
