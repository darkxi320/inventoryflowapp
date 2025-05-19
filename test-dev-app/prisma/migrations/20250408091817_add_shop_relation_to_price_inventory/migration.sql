/*
  Warnings:

  - Added the required column `variantId` to the `PriceInventoryUpdation` table without a default value. This is not possible if the table is not empty.

*/
-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_PriceInventoryUpdation" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "productId" TEXT NOT NULL,
    "variantId" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "price" REAL NOT NULL,
    "locationId" TEXT NOT NULL,
    "shopDomain" TEXT NOT NULL,
    CONSTRAINT "PriceInventoryUpdation_shopDomain_fkey" FOREIGN KEY ("shopDomain") REFERENCES "Shop" ("shopDomain") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_PriceInventoryUpdation" ("id", "locationId", "price", "productId", "quantity", "shopDomain", "sku") SELECT "id", "locationId", "price", "productId", "quantity", "shopDomain", "sku" FROM "PriceInventoryUpdation";
DROP TABLE "PriceInventoryUpdation";
ALTER TABLE "new_PriceInventoryUpdation" RENAME TO "PriceInventoryUpdation";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
