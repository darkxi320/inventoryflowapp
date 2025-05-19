import { json } from "@remix-run/node";
import db from "../db.server";

const SHOPIFY_ACCESS_TOKEN = process.env.SHOPIFY_ACCESS_TOKEN;
const SHOPIFY_STORE_URL = process.env.SHOPIFY_STORE_URL || "test.myshopify.com";

if (!SHOPIFY_ACCESS_TOKEN) {
    throw new Error("Shopify access token is missing. Make sure it's set in your .env file.");
}
async function getProductName(productId) {
    const query = `
        query getProductName($id: ID!) {
            product(id: $id) {
                title
            }
        }
    `;
    const response = await fetch(`https://${SHOPIFY_STORE_URL}/admin/api/2023-10/graphql.json`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "X-Shopify-Access-Token": SHOPIFY_ACCESS_TOKEN,
        },
        body: JSON.stringify({ query, variables: { id: productId } }),
    });

    const data = await response.json();
    console.log("Product API Response:", JSON.stringify(data, null, 2)); // 🔍 Debug log

    return data?.data?.product?.title || "Unknown Product";
}

async function getCustomerName(customerId) {
    const query = `
        query getCustomerName($id: ID!) {
            customer(id: $id) {
                firstName
                lastName
            }
        }
    `;
    const response = await fetch(`https://${SHOPIFY_STORE_URL}/admin/api/2023-10/graphql.json`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "X-Shopify-Access-Token": SHOPIFY_ACCESS_TOKEN,
        },
        body: JSON.stringify({ query, variables: { id: customerId } }),
    });

    const data = await response.json();
    console.log("Customer API Response:", JSON.stringify(data, null, 2));

    const firstName = data?.data?.customer?.firstName || "";
    const lastName = data?.data?.customer?.lastName || "";
    return firstName && lastName ? `${firstName} ${lastName}` : "Unknown Customer";
}


export async function action({ request }) {
    if (request.method !== "POST") {
        return new Response("Method Not Allowed", { status: 405 });
    }

    try {
        let data = await request.formData();
        data = Object.fromEntries(data);

        const customerId = data.customerId;
        const productId = data.productId;
        const shop = data.shop;
        const _action = data._action;

        if (!customerId || !productId || !shop || !_action) {
            return json({ message: "Missing data", method: _action }, { status: 400 });
        }

        const formattedCustomerId = `gid://shopify/Customer/${customerId}`;
        const formattedProductId = `gid://shopify/Product/${productId}`;
        
        const customerName = await getCustomerName(formattedCustomerId);
        const productName = await getProductName(formattedProductId);

        let response;

        switch (_action) {
            case "POST":
                await db.wishlist.create({
                    data: {
                        customerId,
                        customerName,
                        productId,
                        productName,
                        shop,
                    },
                });
                response = json({ message: "Product added to wishlist", method: _action, wishlisted: true });
                return response;

            case "DELETE":
                await db.wishlist.deleteMany({ where: { customerId, shop, productId } });
                response = json({ message: "Product removed from wishlist", method: _action, wishlisted: false });
                return response;

            default:
                return json({ message: "Invalid _action", method: _action }, { status: 400 });
        }
    } catch (error) {
        console.error("Error in action function:", error);
        return json({ message: "Internal Server Error", error: error.message }, { status: 500 });
    }
}
