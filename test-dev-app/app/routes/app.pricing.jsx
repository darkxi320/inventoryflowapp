import { useState, useEffect } from "react";
import { useLoaderData, useNavigate } from "@remix-run/react";
import {
  Page,
  Card,
  Button,
  Text,
  Banner,
  Spinner,
  Badge,
} from "@shopify/polaris";

export const loader = async ({ request }) => {
  const url = new URL(request.url);
  return { shop: url.searchParams.get("shop") || "" };
};

export default function Billing() {
  const { shop: shopFromLoader } = useLoaderData();
  const [shop, setShop] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [selected, setSelected] = useState("");
  const [activePlan, setActivePlan] = useState("");
  const navigate = useNavigate();

  // Initialize shop domain from the URL or localStorage
  useEffect(() => {
    if (shopFromLoader) {
      localStorage.setItem("shop_origin", shopFromLoader);
      setShop(shopFromLoader);
    } else {
      const saved = localStorage.getItem("shop_origin");
      if (saved) {
        setShop(saved);
        navigate(`?shop=${saved}`, { replace: true });
      }
    }
  }, [shopFromLoader]);

  // Fetch active plan when the shop is set
  useEffect(() => {
    if (!shop) return;

    const fetchActivePlan = async () => {
      try {
        const res = await fetch(`http://localhost:6004/api/active-plan?shop=${shop}`);
        const data = await res.json();
        if (data.activePlan) {
          setActivePlan(data.activePlan);
        } else {
          setActivePlan("");
        }
      } catch (e) {
        console.error("Error fetching active plan:", e);
        setActivePlan("");
      }
    };

    fetchActivePlan();
  }, [shop, selected]);

  const choosePlan = async (plan) => {
    setLoading(true);
    setError("");
    setInfo("");
    setSelected(plan);

    try {
      // Send plan and shop details to backend API
      const response = await fetch(`http://localhost:6004/api/active-plan`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan, shop }),
      });

      const data = await response.json();
      setLoading(false);

      // Handle the confirmation URL from the backend
      if (data.confirmationUrl) {
        setInfo("Redirecting to Shopify billing...");
        window.top.location.href = data.confirmationUrl; // This will redirect to Shopify's billing page
      } else {
        setError(data.error || "Failed to start billing.");
      }
    } catch (e) {
      setLoading(false);
      setError("Network or server error. See console for details.");
      console.error("Error during billing process:", e);
    }
  };

  const plans = [
    { key: "basic", name: "Basic", price: 4.99, description: "Basic analytics & support" },
    { key: "pro", name: "Pro", price: 9.99, description: "Advanced analytics & priority support" },
  ];

  return (
    <Page title="Your Subscription Plan">
      <div style={{ maxWidth: 540, margin: "0 auto", marginTop: 40 }}>
        {error && (
          <div style={{ marginBottom: 24 }}>
            <Banner status="critical" title="Error">{error}</Banner>
          </div>
        )}
        {info && (
          <div style={{ marginBottom: 24 }}>
            <Banner status="info">{info}</Banner>
          </div>
        )}
        {activePlan && (
          <div style={{ marginBottom: 24 }}>
            <Banner status="success">
              <Text variant="headingMd" as="span">Current Subscription: </Text>
              <Badge status="success">{activePlan}</Badge>
            </Banner>
          </div>
        )}

        <div style={{ display: "flex", flexDirection: "column", gap: 32 }}>
          {plans.map((plan) => {
            const isActive =
              activePlan &&
              activePlan.toLowerCase().trim() === plan.name.toLowerCase();

            return (
              <Card
                key={plan.key}
                sectioned
                style={{
                  border: isActive ? "2px solid #008060" : undefined,
                  background: isActive ? "#F6FFF8" : undefined,
                  boxShadow: isActive ? "0 2px 16px #b1ecd133" : "0 1px 2px #f4f4f4",
                }}
              >
                <div style={{ display: "flex", flexDirection: "column", gap: 12, minHeight: 120 }}>
                  <Text variant="headingLg" as="h2" style={{ fontWeight: 600 }}>
                    ${plan.price}/month
                  </Text>
                  <Text color="subdued">{plan.description}</Text>
                  <div style={{ marginTop: "auto" }}>
                    {isActive ? (
                      <Button primary disabled fullWidth>Selected ✓</Button>
                    ) : (
                      <Button
                        primary
                        fullWidth
                        loading={loading && selected === plan.key}
                        onClick={() => choosePlan(plan.key)}
                        disabled={loading}
                      >
                        {loading && selected === plan.key ? <Spinner size="small" /> : "Choose " + plan.name}
                      </Button>
                    )}
                  </div>
                </div>
              </Card>
            );
          })}
        </div>

        {!activePlan && (
          <div style={{ marginTop: 20, textAlign: "center", color: "#AAA" }}>
            <small>Debug: No plan activated yet. Pay for a plan to see the badge.</small>
          </div>
        )}
      </div>
    </Page>
  );
}
