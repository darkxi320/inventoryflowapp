/*
  Warnings:

  - Made the column `productId` on table `PriceInventoryUpdation` required. This step will fail if there are existing NULL values in that column.

*/
-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_PriceInventoryUpdation" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "productId" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "price" REAL NOT NULL,
    "locationId" TEXT NOT NULL,
    "shopDomain" TEXT NOT NULL,
    "productName" TEXT,
    "productDescription" TEXT,
    "manufacturerName" TEXT,
    CONSTRAINT "PriceInventoryUpdation_shopDomain_fkey" FOREIGN KEY ("shopDomain") REFERENCES "Shop" ("shopDomain") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_PriceInventoryUpdation" ("id", "locationId", "manufacturerName", "price", "productDescription", "productId", "productName", "quantity", "shopDomain", "sku") SELECT "id", "locationId", "manufacturerName", "price", "productDescription", "productId", "productName", "quantity", "shopDomain", "sku" FROM "PriceInventoryUpdation";
DROP TABLE "PriceInventoryUpdation";
ALTER TABLE "new_PriceInventoryUpdation" RENAME TO "PriceInventoryUpdation";
CREATE UNIQUE INDEX "PriceInventoryUpdation_shopDomain_sku_key" ON "PriceInventoryUpdation"("shopDomain", "sku");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
