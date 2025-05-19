import { json } from "@remix-run/node";
import db from "../db.server";
import { parse } from "csv-parse/sync";

export async function action({ request }) {
  let formData = await request.formData();
  let settings = Object.fromEntries(formData);
  let file = formData.get("inventoryFile");

  if (file && file.size > 0) {
    try {
      let content = await file.text();
      let records = parse(content, { columns: true });

      console.log("Parsed Records:", records);

      for (let record of records) {
        if (!record['Variant SKU'] || !record['Variant Inventory Qty'] || !record['Variant Price']) {
          console.error("Skipping record due to missing data:", record);
          continue;
        }

        let quantity = Number(record['Variant Inventory Qty']);
        let price = Number(record['Variant Price']);

        if (isNaN(quantity) || isNaN(price)) {
          console.error("Invalid number values in record:", record);
          continue;
        }

        const sku = record['Variant SKU'];
        let inventoryItem = await db.inventory.upsert({
          where: { sku },
          update: { quantity, price },
          create: { sku, quantity, price },
        });

        console.log(`Updated or created inventory item with SKU: ${sku}`);


        const SHOPIFY_STORE = process.env.SHOPIFY_STORE_URL;
        const ACCESS_TOKEN = process.env.SHOPIFY_ADMIN_API_ACCESS_TOKEN;
        // const LOCATION_ID = process.env.SHOPIFY_LOCATION_ID;

        if (!SHOPIFY_STORE || !ACCESS_TOKEN) {
          console.error("Missing Shopify environment variables!");
          continue;
        }

        try {
          const productRes = await fetch(`https://${SHOPIFY_STORE}/admin/api/2024-01/products.json?sku=${sku}`, {
            headers: {
              "Content-Type": "application/json",
              "X-Shopify-Access-Token": ACCESS_TOKEN,
            },
          });

          const productData = await productRes.json();
          if (!productData.products || productData.products.length === 0) {
            console.error(`Product not found for SKU: ${sku}`);
            continue;
          }

          const variant = productData.products[0]?.variants.find(v => v.sku === sku);
          if (!variant) {
            console.error(`No variant found for SKU: ${sku}`);
            continue;
          }

          const inventoryItemId = variant.inventory_item_id;
          const variantId = variant.id;

          await fetch(`https://${SHOPIFY_STORE}/admin/api/2024-01/inventory_levels/set.json`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "X-Shopify-Access-Token": ACCESS_TOKEN,
            },
            body: JSON.stringify({
              location_id: LOCATION_ID,
              inventory_item_id: inventoryItemId,
              available: quantity,
            }),
          });
          await fetch(`https://${SHOPIFY_STORE}/admin/api/2024-01/variants/${variantId}.json`, {
            method: "PUT",
            headers: {
              "Content-Type": "application/json",
              "X-Shopify-Access-Token": ACCESS_TOKEN,
            },
            body: JSON.stringify({
              variant: { id: variantId, price },
            }),
          });

          console.log(`Updated SKU ${sku} on Shopify with quantity: ${quantity} and price: ${price}`);

        } catch (shopifyError) {
          console.error(`Error syncing SKU ${sku} with Shopify:`, shopifyError);
          continue;
        }
      }

    } catch (error) {
      console.error("CSV Error:", error);
      return json({ success: false, error: "Error processing CSV" }, { status: 500 });
    }
  }

  return json({ success: true });
}
