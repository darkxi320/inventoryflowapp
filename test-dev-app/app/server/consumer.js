import express from "express";
import Queue from "bull";
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
import Shopify from 'shopify-api-node';



dotenv.config();
const app = express();

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const applicationUrl = "http://localhost:4001"; // Your app URL

// Serve React static files (adjust path to where your React build will be copied in Docker)
const reactBuildPath = path.resolve(__dirname, "../routes/build");  // if React app is in app/routes
app.use(express.static(reactBuildPath));

// SPA fallback to index.html for client-side routing
app.get("*", (req, res, next) => {
  // If the request is NOT to your API or static files, serve React's index.html
  if (req.path.startsWith("/upload") || req.path.startsWith("/shopify") || req.path.startsWith("/socket.io")) {
    return next(); // Let those requests go through backend handlers
  }
  res.sendFile(path.join(reactBuildPath, "index.html"));
});


// const queue = new Queue("inventory-update-queue", {
//   redis: {
//     host: "master.redis-shopify.hsk4q2.use1.cache.amazonaws.com",
//     port: 6379,
//     tls: {}, // enable TLS connection
//     password: "thistokenforshopify777"
//   },
// });

// queue.on('error', (err) => {
//   console.error('Error connecting to Redis:', err);
// });

// queue.on('ready', () => {
//   console.log('Connected to Redis ElastiCache');
// });

// queue.add({ data: 'some data' });





// Setup session middleware
app.use(
  session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
      secure: process.env.NODE_ENV === "production",
      httpOnly: true,
      maxAge: 3600000, // Session expiration time (1 hour)
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

// Function to get valid access token
async function getValidAccessToken(shop) {
  const session = await prisma.session.findFirst({ where: { shop } });
  if (!session || !session.accessToken) throw new Error("No valid access token for shop.");
  else if (session.revoked) throw new Error("Access token has been revoked.");
  else return session.accessToken;
}

// Helper function to get the correct Shopify Admin API URL for a given store
function getShopifyAdminApiUrl(shopDomain) {
  return `https://${shopDomain}/admin/api/2025-01/graphql.json`;
}
app.use(express.json());
// Shopify OAuth flow
app.get("/shopify/authorize", (req, res) => {
  const shop = req.query.shop;
  if (!shop) {
    return res.status(400).send("Shop domain is required.");
  }

  const apiKey = process.env.SHOPIFY_API_KEY;
  const scopes = "read_products,write_products,read_locations";
  const redirectUri = `https://${shop}/admin/apps/${process.env.APP_NAME}`;

  const state = crypto.randomBytes(16).toString("hex");
  req.session.state = state;

  const shopifyAuthUrl = `https://${shop}/admin/oauth/authorize?client_id=${apiKey}&scope=${scopes}&redirect_uri=${encodeURIComponent(
    redirectUri
  )}&state=${state}`;
  console.log(`Redirecting to Shopify OAuth URL: ${shopifyAuthUrl}`);

  res.redirect(shopifyAuthUrl);
});

// Shopify OAuth callback handler
app.get("/shopify/callback", async (req, res) => {
  const { code, shop, state } = req.query;

  if (!shop || !code || !state) {
    return res.status(400).send("Shop, code, or state missing in callback.");
  }

  if (state !== req.session.state) {
    return res.status(400).send("State mismatch.");
  }

  const apiKey = process.env.SHOPIFY_API_KEY;
  const apiSecret = process.env.SHOPIFY_API_SECRET;
  const redirectUri = `${applicationUrl}/shopify/callback`;

  const tokenRequestBody = new URLSearchParams({
    client_id: apiKey,
    client_secret: apiSecret,
    code: code,
    redirect_uri: redirectUri,
  });

  try {
    const response = await fetch(`https://${shop}/admin/oauth/access_token`, {
      method: "POST",
      body: tokenRequestBody,
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
    });

    const data = await response.json();

    if (data.access_token) {
      const accessToken = data.access_token;
      console.log("Access Token:", accessToken);

      await prisma.session.deleteMany({ where: { shop } });

      let shopRecord = await prisma.shop.findUnique({
        where: { shopDomain: shop },
      });

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

      const sessionRecord = await prisma.session.create({
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

  // Ensure shop exists (create if not)
  let shopRecord = await prisma.shop.findUnique({ where: { shopDomain } });
  if (!shopRecord) {
    shopRecord = await prisma.shop.create({ data: { shopDomain } });
  }

  // Get access token from session
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

      console.log("CSV parsing complete. Starting processing...");

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
            sku, quantity, price, barcode,
            tags, handle, productType, descriptionHtml,
            status, vendor, title, options
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
            // Update inventory & price
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
            // Prepare input for new product creation
            const input = {
              title: title || "",
              tags: tags ? tags.split(",").map(t => t.trim()).join(", ") : "",
              handle: handle || "",
              productType: productType || "",
              descriptionHtml: descriptionHtml || "",
              status: status || "DRAFT",
              vendor: vendor || "",
              options: options ? options.split(",").map(opt => ({ name: opt.trim() })) : [],
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

            const variants = [{
              sku,
              price: prc,
              barcode,
              quantity: qty,
              options: options ? options.split(",").map(opt => ({ name: opt.trim() })) : [],
            }];

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
          console.log("CSV processed completely, emitted jobCompleted.");
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
  if (!optionId) {
    console.error("Option ID not found for product:", productId);
    throw new Error("Option ID not found");
  }

  const locationIds = await getLocationIds(accessToken, shopDomain);
  if (locationIds.length === 0) {
    console.error("No location found for this shop.");
    throw new Error("No location found for this shop.");
  }

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

  // Include inventoryItem with sku as you requested
  const variantData = variants.map((variant) => ({
    price: variant.price?.toString(),
    barcode: variant.barcode,
    inventoryQuantities: [
      {
        availableQuantity: variant.quantity,
        locationId: locationId,
      },
    ],
    optionValues: [
      {
        name: "Meterial", // note: check spelling, should be "Material" if intentional
        optionId: optionId,
      },
    ],
    inventoryItem: {
      sku: variant.sku,
    },
  }));

  const variables = {
    productId,
    variants: variantData,
  };

  const response = await fetch(SHOPIFY_ADMIN_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": accessToken,
    },
    body: JSON.stringify({
      query: mutation,
      variables: variables,
    }),
  });

  const data = await response.json();

  if (
    data.errors ||
    data.data?.productVariantsBulkCreate?.userErrors?.length > 0
  ) {
    console.error(
      "Error creating variants:",
      data.errors || data.data.productVariantsBulkCreate.userErrors
    );
    throw new Error("Variant creation failed");
  }

  console.log("✅ Product variants created successfully:", data.data.productVariantsBulkCreate.productVariants);
}


async function checkVariantExistsBySku(sku, accessToken, shopDomain) {
  const SHOPIFY_ADMIN_API_URL = getShopifyAdminApiUrl(shopDomain);

  // Query to search for variants by SKU within products
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
      for (let productEdge of data.data.products.edges) {
        const product = productEdge.node;

        // Check each variant within the product for the matching SKU
        const existingVariant = product.variants.edges.find(
          (variant) => variant.node.sku === sku
        );

        if (existingVariant) {
          console.log(`Variant with SKU ${sku} already exists:`, product.title);
          return {
            productId: product.id,
            variantId: existingVariant.node.id,
            inventoryItemId: existingVariant.node.inventoryItem.id,
          };
        }
      }
    }

    console.log("No product/variant found with SKU:", sku);
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

  if (!data || !data.data || !data.data.locations || !data.data.locations.edges) {
    console.error("Error: Locations data is missing or invalid.");
    return [];
  }

  return data.data.locations.edges.map((edge) => edge.node.id);
}



async function createProduct(input, accessToken, shopDomain, sku, prc, qty, barcode, options) {
  const SHOPIFY_ADMIN_API_URL = getShopifyAdminApiUrl(shopDomain);

  const mutation = `
    mutation productCreate($input: ProductInput!) {
      productCreate(input: $input) {
        product {
          id
          title
          handle
          tags
          productType
          descriptionHtml
          status
          vendor
        }
        userErrors {
          field
          message
        }
      }
    }
  `;

  const variables = {
    input: {
      title: input.title,
      tags: input.tags,
      handle: input.handle,
      productType: input.productType,
      descriptionHtml: input.descriptionHtml,
      status: input.status,
      vendor: input.vendor,
    },
  };

  const response = await fetch(SHOPIFY_ADMIN_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": accessToken,
    },
    body: JSON.stringify({
      query: mutation,
      variables: variables,
    }),
  });

  const data = await response.json();

  if (data.errors || data.data.productCreate.userErrors.length > 0) {
    console.error("Error creating product:", data.errors || data.data.productCreate.userErrors);
    throw new Error("Product creation failed");
  } else {
    return data.data.productCreate.product.id; // Return productId for variant creation
  }
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
      setQuantities: [
        {
          inventoryItemId,
          quantity,
          locationId,
        },
      ],
      reason: "correction",
    },
  };

  const response = await fetch(SHOPIFY_ADMIN_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": accessToken,
    },
    body: JSON.stringify({
      query: mutation,
      variables: variables,
    }),
  });

  const data = await response.json();

  if (data.errors || data.data.inventorySetOnHandQuantities.userErrors.length > 0) {
    console.error("Error updating inventory:", data.errors || data.data.inventorySetOnHandQuantities.userErrors);
  } else {
    console.log(`Inventory updated for item: ${inventoryItemId}, Quantity: ${quantity}`);
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
    productId: productId,
    variants: [
      {
        id: variantId,
        price: price.toString(),
      },
    ],
  };

  const response = await fetch(SHOPIFY_ADMIN_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": accessToken,
    },
    body: JSON.stringify({
      query: mutation,
      variables: variables,
    }),
  });

  const data = await response.json();

  if (data.errors || data.data.productVariantsBulkUpdate.userErrors.length > 0) {
    console.error("Error updating prices:", data.errors || data.data.productVariantsBulkUpdate.userErrors);
  } else {
    console.log(`Price updated for variant: ${variantId}, New Price: ${price}`);
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

  const productId = data.data.productVariant?.product.id;
  return productId;
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
  console.log("GraphQL Response Data:", JSON.stringify(data, null, 2));

  if (!data.data || !data.data.products || !data.data.products.edges || data.data.products.edges.length === 0) {
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

// Worker to process inventory updates in Bull Queue
// queue.process(async (job) => {
//   const {
//     inventoryItemId,
//     quantity,
//     variantId,
//     price,
//     locationId,
//     shopDomain,
//     sku,
//   } = job.data;
//   try {
//     const accessToken = await getValidAccessToken(shopDomain);
//     await updateInventoryInBatch(
//       inventoryItemId,
//       quantity,
//       locationId,
//       accessToken,
//       shopDomain
//     );
//     await updatePricesInBatch(variantId, price, accessToken, shopDomain);
//     job.progress(100);
//     io.emit("jobProgress", { jobId: job.id, progress: 100 });
//     io.emit("jobCompleted", { jobId: job.id, status: "completed" });
//   } catch (err) {
//     console.error(`Job ${job.id} failed`, err);
//     io.emit("jobCompleted", { jobId: job.id, status: "failed" });
//   }
// });
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
    body: JSON.stringify({
      query: query,
      variables: variables,
    }),
  });

  const data = await response.json();

  if (data.errors || !data.data.product.options.length) {
    console.error("Error fetching options:", data.errors || "No options found");
    throw new Error("Failed to fetch product options");
  }

  return data.data.product.options[0].id;
}
async function updateSkuForInventoryItem(inventoryItemId, sku, accessToken, shopDomain) {
  const SHOPIFY_ADMIN_API_URL = getShopifyAdminApiUrl(shopDomain);

  const mutation = `
    mutation updateInventoryItem($id: ID!, $sku: String!) {
      inventoryItemUpdate(id: $id, input: { sku: $sku }) {
        inventoryItem {
          id
          sku
        }
        userErrors {
          field
          message
        }
      }
    }
  `;

  const variables = {
    id: inventoryItemId,
    sku: sku,
  };

  const response = await fetch(SHOPIFY_ADMIN_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": accessToken,
    },
    body: JSON.stringify({
      query: mutation,
      variables: variables,
    }),
  });

  const data = await response.json();

  if (data.errors || data.data.inventoryItemUpdate.userErrors.length > 0) {
    console.error("Error updating inventory item SKU:", data.errors || data.data.inventoryItemUpdate.userErrors);
    throw new Error("SKU update failed");
  } else {
    console.log(`SKU updated to ${sku} for inventory item ID: ${inventoryItemId}`);
  }
}
// async function getOptionId(productId, accessToken, shopDomain) {
//   const SHOPIFY_ADMIN_API_URL = getShopifyAdminApiUrl(shopDomain);

//   const query = `
//     query getOptions($id: ID!) {
//       product(id: $id) {
//         options {
//           name
//           id
//         }
//       }
//     }
//   `;

//   const variables = { id: productId };

//   const response = await fetch(SHOPIFY_ADMIN_API_URL, {
//     method: "POST",
//     headers: {
//       "Content-Type": "application/json",
//       "X-Shopify-Access-Token": accessToken,
//     },
//     body: JSON.stringify({
//       query: query,
//       variables: variables,
//     }),
//   });

//   const data = await response.json();

//   if (data.errors || !data.data.product.options.length) {
//     console.error("Error fetching options:", data.errors || "No options found");
//     throw new Error("Failed to fetch product options");
//   }

//   return data.data.product.options[0].id;  // Assuming the first option is what we need
// }

app.post("/api/active-plan", async (req, res) => {
  const { plan, shop } = req.body;
  console.log("Received request:", { plan, shop });

  if (!plan || !shop) {
    console.error("Error: Missing plan or shop in request.");
    return res.status(400).json({ error: "Missing plan or shop" });
  }

  const plans = {
    basic: { name: "Basic", price: 4.99, trial_days: 7 },
    pro: { name: "Pro", price: 9.99, trial_days: 7 },
  };

  const selectedPlan = plans[plan];
  if (!selectedPlan) {
    console.error("Error: Invalid plan.");
    return res.status(400).json({ error: "Invalid plan" });
  }

  try {
    // Use the `shop` as unique identifier now
    let session = await prisma.session.findFirst({ where: { shop } });

    // If no session is found, create a new one
    if (!session) {
      console.log("No existing session found, creating a new session for the store:", shop);
      const accessToken = "newly_generated_access_token";  // Replace with the actual access token you retrieve from Shopify
      session = await prisma.session.create({
        data: {
          shop,
          accessToken,
          activePlan: selectedPlan.name, // Set initial plan
          isOnline: true,
        },
      });
      console.log("New session created:", session);
    } else {
      // If the session exists, update the active plan
      console.log("Updating active plan for the store:", shop);
      session = await prisma.session.update({
        where: { shop }, // Using `shop` as unique identifier
        data: { activePlan: selectedPlan.name },
      });
      console.log("Session updated with new active plan:", session);
    }

    // Create a new Shopify instance with the store's access token
    const shopify = new Shopify({
      shopName: shop.replace(".myshopify.com", ""),
      accessToken: session.accessToken,
    });

    // Create the recurring charge with Shopify
    const charge = await shopify.recurringApplicationCharge.create({
      name: selectedPlan.name,
      price: selectedPlan.price,
      return_url: `https://${shop}/admin/apps/${process.env.APP_NAME}`,
      trial_days: selectedPlan.trial_days,
      test: process.env.NODE_ENV !== "production", // Use test flag for development
    });

    // Return confirmation URL to the frontend
    res.json({ confirmationUrl: charge.confirmation_url });

  } catch (err) {
    console.error("Error during billing process:", err);
    res.status(500).json({ error: "Failed to create billing session" });
  }
});







app.get('/billing/callback', async (req, res) => {
  const { shop, charge_id } = req.query;

  if (!shop || !charge_id) {
    return res.status(400).send('Missing params');
  }

  try {
    console.log('[CALLBACK]', { shop, charge_id });

    // Retrieve the session from your database
    const session = await prisma.session.findFirst({ where: { shop } });
    if (!session || !session.accessToken) {
      console.log('Session not found or missing accessToken');
      return res.status(401).send('Access token not found');
    }

    const shopify = new Shopify({
      shopName: shop.replace('.myshopify.com', ''),
      accessToken: session.accessToken,
    });

    // Get the charge details from Shopify
    const charge = await shopify.recurringApplicationCharge.get(charge_id);
    console.log('Charge status:', charge.status, '| name:', charge.name);

    // If the charge was accepted, activate it
    if (charge.status === 'accepted' || charge.status === 'active') {
      if (charge.status === 'accepted') {
        // Activate the charge if it was accepted
        await shopify.recurringApplicationCharge.activate(charge_id);
        console.log('Charge activated.');
      }

      // Save the active plan in the session or database
      // Use session.id to uniquely identify the session and avoid issues with other stores
      await prisma.session.update({
        where: { id: session.id },
        data: { activePlan: charge.name },
      });
      console.log('Session updated with plan:', charge.name);
    }

    // Redirect the user to your app's admin page
    const appUrl = `https://${shop}/admin/apps/${process.env.APP_NAME}`;
    res.send(`
      <html>
        <head>
          <script>
            window.top.location.href = "${appUrl}";
          </script>
        </head>
        <body>
          <p>Redirecting to your app...</p>
        </body>
      </html>
    `);
  } catch (err) {
    console.error(`[${shop}] Billing callback error:`, err);
    res.status(500).send('Failed to activate billing.');
  }
});










server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
