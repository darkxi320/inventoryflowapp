import express from "express";
import { fetch } from "undici";
import dotenv from "dotenv";
import { Server } from "socket.io";
import http from "http";
import multer from "multer";
import fs from "fs";
import path from "path";
import csvParser from "csv-parser";
import { fileURLToPath } from "url";
import { dirname } from "path";
import cors from "cors";
import prisma from "../db.server.js";
import crypto from "crypto";
import session from "express-session";

dotenv.config();

const app = express();
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const applicationUrl = "http://localhost:4001";

const reactBuildPath = path.resolve(__dirname, "../routes/build");
app.use(express.static(reactBuildPath));

app.get("*", (req, res, next) => {
  if (
    req.path.startsWith("/upload") ||
    req.path.startsWith("/shopify") ||
    req.path.startsWith("/socket.io")
  ) {
    return next();
  }
  res.sendFile(path.join(reactBuildPath, "index.html"));
});

app.use(
  session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
      secure: process.env.NODE_ENV === "production",
      httpOnly: true,
      maxAge: 3600000,
    },
  })
);

app.use(
  cors({
    origin: "http://localhost:3000",
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "shop-domain"],
  })
);

const uploadsDir = path.resolve(__dirname, "uploads");
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir);

const upload = multer({ dest: uploadsDir });

const server = new http.Server(app);
const io = new Server(server, {
  cors: { origin: "http://localhost:3000", methods: ["GET", "POST"] },
});

const PORT = 6004;

io.on("connection", (socket) => {
  console.log("Socket connected:", socket.id);
});

async function getValidAccessToken(shop) {
  const session = await prisma.session.findFirst({ where: { shop } });
  if (!session || !session.accessToken) throw new Error("No valid access token for shop.");
  if (session.revoked) throw new Error("Access token has been revoked.");
  return session.accessToken;
}

function getShopifyAdminApiUrl(shopDomain) {
  return `https://${shopDomain}/admin/api/2025-01/graphql.json`;
}

app.get("/shopify/authorize", (req, res) => {
  const shop = req.query.shop;
  if (!shop) return res.status(400).send("Shop domain is required.");

  const apiKey = process.env.SHOPIFY_API_KEY;
  const scopes = "read_products,write_products,read_locations";
  const redirectUri = `${applicationUrl}/shopify/callback`;

  const state = crypto.randomBytes(16).toString("hex");
  req.session.state = state;

  const shopifyAuthUrl = `https://${shop}/admin/oauth/authorize?client_id=${apiKey}&scope=${scopes}&redirect_uri=${encodeURIComponent(
    redirectUri
  )}&state=${state}`;

  console.log(`Redirecting to Shopify OAuth URL: ${shopifyAuthUrl}`);
  res.redirect(shopifyAuthUrl);
});

app.get("/shopify/callback", async (req, res) => {
  const { code, shop, state } = req.query;
  if (!shop || !code || !state) return res.status(400).send("Shop, code, or state missing.");
  if (state !== req.session.state) return res.status(400).send("State mismatch.");

  const apiKey = process.env.SHOPIFY_API_KEY;
  const apiSecret = process.env.SHOPIFY_API_SECRET;
  const redirectUri = `${applicationUrl}/shopify/callback`;

  const tokenRequestBody = new URLSearchParams({
    client_id: apiKey,
    client_secret: apiSecret,
    code,
    redirect_uri: redirectUri,
  });

  try {
    const response = await fetch(`https://${shop}/admin/oauth/access_token`, {
      method: "POST",
      body: tokenRequestBody,
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
    });

    const data = await response.json();

    if (data.access_token) {
      const accessToken = data.access_token;
      console.log("Access Token:", accessToken);

      await prisma.session.deleteMany({ where: { shop } });

      let shopRecord = await prisma.shop.findUnique({ where: { shopDomain: shop } });

      if (shopRecord) {
        shopRecord = await prisma.shop.update({
          where: { shopDomain: shop },
          data: { accessToken },
        });
      } else {
        shopRecord = await prisma.shop.create({
          data: { shopDomain: shop, accessToken },
        });
      }

      await prisma.session.create({
        data: { shop, accessToken, state, isOnline: true },
      });

      res.send("Shopify authentication successful and access token saved.");
    } else {
      res.status(500).send("Error retrieving access token.");
    }
  } catch (error) {
    console.error("Error during token exchange:", error);
    res.status(500).send("Error during token exchange.");
  }
});

app.post("/upload", upload.single("file"), async (req, res) => {
  const shopDomain = req.headers["shop-domain"];
  if (!shopDomain) return res.status(400).json({ message: "Missing shop domain" });

  let shopRecord = await prisma.shop.findUnique({ where: { shopDomain } });
  if (!shopRecord) {
    shopRecord = await prisma.shop.create({ data: { shopDomain } });
  }

  const session = await prisma.session.findFirst({ where: { shop: shopDomain } });
  if (!session || !session.accessToken) {
    return res.status(401).json({ message: "Session token not found. Please reauthorize the app." });
  }
  const accessToken = session.accessToken;

  const filePath = path.resolve(__dirname, req.file.path);
  let rows = [];
  let hasErrorOccurred = false;

  fs.createReadStream(filePath)
    .pipe(csvParser())
    .on("data", (row) => {
      if (!hasErrorOccurred) rows.push(row);
    })
    .on("error", (err) => {
      if (!hasErrorOccurred) {
        hasErrorOccurred = true;
        console.error("CSV read error:", err);
        return res.status(500).json({ message: "Error reading CSV file." });
      }
    })
    .on("end", async () => {
      if (hasErrorOccurred) return;

      try {
        const locationIds = await getLocationIds(accessToken, shopDomain);
        if (!locationIds || locationIds.length === 0) {
          hasErrorOccurred = true;
          io.emit("jobCompleted", {
            status: "failed",
            jobId: req.file.filename,
            errorMessage: "No location found for this shop.",
          });
          return res.status(500).json({ message: "No location found for this shop." });
        }
        const locationId = locationIds[0];

        const totalRows = rows.length;
        let processedRows = 0;

        for (const row of rows) {
          if (hasErrorOccurred) break;

          const {
            sku,
            quantity,
            price,
            barcode,
            tags,
            handle,
            productType,
            descriptionHtml,
            status,
            vendor,
            title,
            options,
          } = row;

          if (!sku || !quantity || !price || !barcode) {
            processedRows++;
            io.emit("jobProgress", {
              progress: Math.round((processedRows / totalRows) * 100),
              jobId: req.file.filename,
            });
            continue;
          }

          const qty = parseInt(quantity);
          const prc = parseFloat(price);
          if (isNaN(qty) || isNaN(prc)) {
            processedRows++;
            io.emit("jobProgress", {
              progress: Math.round((processedRows / totalRows) * 100),
              jobId: req.file.filename,
            });
            continue;
          }

          const existingVariant = await checkVariantExistsBySku(sku, accessToken, shopDomain);

          if (existingVariant) {
            await updateInventoryInBatch(existingVariant.inventoryItemId, qty, locationId, accessToken, shopDomain);
            await updatePricesInBatch(existingVariant.variantId, prc, accessToken, shopDomain);

            await prisma.priceInventoryUpdation.upsert({
              where: { shopDomain_sku: { shopDomain, sku } },
              update: { quantity: qty, price: prc },
              create: {
                sku,
                quantity: qty,
                price: prc,
                locationId,
                shopDomain,
                productId: existingVariant.productId,
              },
            });
          } else {
            const input = {
              title: title || "",
              tags: tags ? tags.split(",").map((t) => t.trim()).join(", ") : "",
              handle: handle || "",
              productType: productType || "",
              descriptionHtml: descriptionHtml || "",
              status: status || "DRAFT",
              vendor: vendor || "",
              options: options ? options.split(",").map((opt) => ({ name: opt.trim() })) : [],
            };

            const productId = await createProduct(input, accessToken, shopDomain, sku, prc, qty, barcode, options);

            await prisma.product.upsert({
              where: { sku },
              update: {
                productName: title || "",
                productDescription: descriptionHtml || "",
                manufacturerName: vendor || "",
                price: prc,
                updatedAt: new Date(),
                shopDomain,
              },
              create: {
                productName: title || "",
                productDescription: descriptionHtml || "",
                manufacturerName: vendor || "",
                sku,
                price: prc,
                shopDomain,
              },
            });

            const variants = [
              {
                sku,
                price: prc,
                barcode,
                quantity: qty,
                options: options ? options.split(",").map((opt) => ({ name: opt.trim() })) : [],
              },
            ];

            await createVariantInBulk(productId, variants, accessToken, shopDomain);

            const ids = await getVariantAndInventoryItemId(sku, accessToken, shopDomain);
            if (ids) {
              await updateInventoryInBatch(ids.inventoryItemId, qty, locationId, accessToken, shopDomain);
              await updatePricesInBatch(ids.variantId, prc, accessToken, shopDomain);

              await prisma.priceInventoryUpdation.upsert({
                where: { shopDomain_sku: { shopDomain, sku } },
                update: { quantity: qty, price: prc },
                create: {
                  sku,
                  quantity: qty,
                  price: prc,
                  locationId,
                  shopDomain,
                  productId: ids.productId,
                },
              });
            }
          }

          processedRows++;
          io.emit("jobProgress", {
            progress: Math.round((processedRows / totalRows) * 100),
            jobId: req.file.filename,
          });
        }

        if (!hasErrorOccurred) {
          io.emit("jobCompleted", { status: "completed", jobId: req.file.filename });
          return res.status(200).json({ message: "File uploaded and processed successfully." });
        }
      } catch (err) {
        if (!hasErrorOccurred) {
          hasErrorOccurred = true;
          console.error("Error during CSV processing:", err);
          io.emit("jobCompleted", { status: "failed", jobId: req.file.filename, errorMessage: err.message });
          return res.status(500).json({ message: "Error processing CSV rows." });
        }
      }
    });
});

async function createVariantInBulk(productId, variants, accessToken, shopDomain) {
  const SHOPIFY_ADMIN_API_URL = getShopifyAdminApiUrl(shopDomain);

  const optionId = await getOptionId(productId, accessToken, shopDomain);
  if (!optionId) throw new Error("Option ID not found");

  const locationIds = await getLocationIds(accessToken, shopDomain);
  if (locationIds.length === 0) throw new Error("No location found for this shop.");

  const locationId = locationIds[0];

  const mutation = `
    mutation productVariantsBulkCreate($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
      productVariantsBulkCreate(productId: $productId, variants: $variants) {
        productVariants {
          id
          title
          selectedOptions {
            name
            value
          }
          barcode
          inventoryItem {
            id
            sku
          }
        }
        userErrors {
          field
          message
        }
      }
    }
  `;

  const variantData = variants.map((variant) => ({
    price: variant.price?.toString(),
    barcode: variant.barcode,
    inventoryQuantities: [
      {
        availableQuantity: variant.quantity,
        locationId,
      },
    ],
    optionValues: [
      {
        name: "Meterial", // Confirm spelling if needed
        optionId,
      },
    ],
    inventoryItem: {
      sku: variant.sku,
    },
  }));

  const variables = { productId, variants: variantData };

  const response = await fetch(SHOPIFY_ADMIN_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": accessToken,
    },
    body: JSON.stringify({ query: mutation, variables }),
  });

  const data = await response.json();

  if (data.errors || data.data?.productVariantsBulkCreate?.userErrors?.length > 0) {
    console.error("Error creating variants:", data.errors || data.data.productVariantsBulkCreate.userErrors);
    throw new Error("Variant creation failed");
  }
}

async function checkVariantExistsBySku(sku, accessToken, shopDomain) {
  const SHOPIFY_ADMIN_API_URL = getShopifyAdminApiUrl(shopDomain);
  const query = `
    query {
      products(first: 250, query: "sku:${sku}") {
        edges {
          node {
            id
            title
            variants(first: 250) {
              edges {
                node {
                  id
                  sku
                  barcode
                  inventoryItem {
                    id
                  }
                }
              }
            }
          }
        }
      }
    }
  `;

  try {
    const response = await fetch(SHOPIFY_ADMIN_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": accessToken,
      },
      body: JSON.stringify({ query }),
    });

    const data = await response.json();

    if (data && data.data && data.data.products) {
      for (const productEdge of data.data.products.edges) {
        const product = productEdge.node;
        const existingVariant = product.variants.edges.find((variant) => variant.node.sku === sku);
        if (existingVariant) {
          return {
            productId: product.id,
            variantId: existingVariant.node.id,
            inventoryItemId: existingVariant.node.inventoryItem.id,
          };
        }
      }
    }
    return null;
  } catch (error) {
    console.error("Error checking variant existence by SKU:", error);
    return null;
  }
}

async function getLocationIds(accessToken, shopDomain) {
  const SHOPIFY_ADMIN_API_URL = getShopifyAdminApiUrl(shopDomain);
  const query = `query { locations(first: 2) { edges { node { id name } } } }`;

  const response = await fetch(SHOPIFY_ADMIN_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": accessToken,
    },
    body: JSON.stringify({ query }),
  });

  const data = await response.json();

  if (!data?.data?.locations?.edges) {
    console.error("Locations data is missing or invalid.");
    return [];
  }

  return data.data.locations.edges.map((edge) => edge.node.id);
}

async function createProduct(input, accessToken, shopDomain) {
  const SHOPIFY_ADMIN_API_URL = getShopifyAdminApiUrl(shopDomain);

  const mutation = `
    mutation productCreate($input: ProductInput!) {
      productCreate(input: $input) {
        product {
          id
        }
        userErrors {
          field
          message
        }
      }
    }
  `;

  const variables = { input };

  const response = await fetch(SHOPIFY_ADMIN_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": accessToken,
    },
    body: JSON.stringify({ query: mutation, variables }),
  });

  const data = await response.json();

  if (data.errors || data.data.productCreate.userErrors.length > 0) {
    console.error("Error creating product:", data.errors || data.data.productCreate.userErrors);
    throw new Error("Product creation failed");
  }

  return data.data.productCreate.product.id;
}

async function updateInventoryInBatch(inventoryItemId, quantity, locationId, accessToken, shopDomain) {
  const SHOPIFY_ADMIN_API_URL = getShopifyAdminApiUrl(shopDomain);

  const mutation = `
    mutation ($input: InventorySetOnHandQuantitiesInput!) {
      inventorySetOnHandQuantities(input: $input) {
        userErrors { field message }
      }
    }`;

  const variables = {
    input: {
      setQuantities: [{ inventoryItemId, quantity, locationId }],
      reason: "correction",
    },
  };

  const response = await fetch(SHOPIFY_ADMIN_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": accessToken,
    },
    body: JSON.stringify({ query: mutation, variables }),
  });

  const data = await response.json();

  if (data.errors || data.data.inventorySetOnHandQuantities.userErrors.length > 0) {
    console.error("Error updating inventory:", data.errors || data.data.inventorySetOnHandQuantities.userErrors);
  }
}

async function updatePricesInBatch(variantId, price, accessToken, shopDomain) {
  const SHOPIFY_ADMIN_API_URL = getShopifyAdminApiUrl(shopDomain);
  const productId = await getProductIdFromVariant(variantId, accessToken, shopDomain);
  if (!productId) {
    console.error("Product not found for variant ID:", variantId);
    return;
  }

  const mutation = `
    mutation productVariantsBulkUpdate($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
      productVariantsBulkUpdate(productId: $productId, variants: $variants) {
        userErrors {
          field
          message
        }
        productVariants {
          id
          price
          inventoryQuantity
        }
      }
    }`;

  const variables = {
    productId,
    variants: [{ id: variantId, price: price.toString() }],
  };

  const response = await fetch(SHOPIFY_ADMIN_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": accessToken,
    },
    body: JSON.stringify({ query: mutation, variables }),
  });

  const data = await response.json();

  if (data.errors || data.data.productVariantsBulkUpdate.userErrors.length > 0) {
    console.error("Error updating prices:", data.errors || data.data.productVariantsBulkUpdate.userErrors);
  }
}

async function getProductIdFromVariant(variantId, accessToken, shopDomain) {
  const SHOPIFY_ADMIN_API_URL = getShopifyAdminApiUrl(shopDomain);
  const query = `
    query {
      productVariant(id: "${variantId}") {
        product {
          id
        }
      }
    }
  `;

  const response = await fetch(SHOPIFY_ADMIN_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": accessToken,
    },
    body: JSON.stringify({ query }),
  });

  const data = await response.json();
  if (data.errors) {
    console.error("Error fetching productId:", data.errors);
    return null;
  }

  return data.data.productVariant?.product.id;
}

async function getVariantAndInventoryItemId(sku, accessToken, shopDomain) {
  const SHOPIFY_ADMIN_API_URL = getShopifyAdminApiUrl(shopDomain);
  const query = `
    query {
      products(first: 1, query: "sku:${sku}") {
        edges {
          node {
            id
            variants(first: 1) {
              edges {
                node {
                  id
                  inventoryItem {
                    id
                  }
                }
              }
            }
          }
        }
      }
    }
  `;

  const response = await fetch(SHOPIFY_ADMIN_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": accessToken,
    },
    body: JSON.stringify({ query }),
  });

  const data = await response.json();

  if (
    !data.data ||
    !data.data.products ||
    !data.data.products.edges ||
    data.data.products.edges.length === 0
  ) {
    console.error("Error: No products found or data is malformed.");
    return null;
  }

  const product = data.data.products.edges[0]?.node;
  const variant = product?.variants.edges[0]?.node;

  if (!variant) {
    console.error("Error: Variant not found for SKU:", sku);
    return null;
  }

  return {
    productId: product.id,
    variantId: variant.id,
    inventoryItemId: variant.inventoryItem.id,
  };
}

async function getOptionId(productId, accessToken, shopDomain) {
  const SHOPIFY_ADMIN_API_URL = getShopifyAdminApiUrl(shopDomain);

  const query = `
    query getOptions($id: ID!) {
      product(id: $id) {
        options {
          name
          id
        }
      }
    }
  `;

  const variables = { id: productId };

  const response = await fetch(SHOPIFY_ADMIN_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": accessToken,
    },
    body: JSON.stringify({ query, variables }),
  });

  const data = await response.json();

  if (data.errors || !data.data.product.options.length) {
    console.error("Error fetching options:", data.errors || "No options found");
    throw new Error("Failed to fetch product options");
  }

  return data.data.product.options[0].id;
}

server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
