/*
  Warnings:

  - Made the column `shopDomain` on table `PriceInventoryUpdation` required. This step will fail if there are existing NULL values in that column.

*/
-- CreateTable
CREATE TABLE "Shop" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "shopDomain" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

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
    CONSTRAINT "PriceInventoryUpdation_shopDomain_fkey" FOREIGN KEY ("shopDomain") REFERENCES "Shop" ("shopDomain") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_PriceInventoryUpdation" ("id", "locationId", "price", "productId", "quantity", "shopDomain", "sku") SELECT "id", "locationId", "price", "productId", "quantity", "shopDomain", "sku" FROM "PriceInventoryUpdation";
DROP TABLE "PriceInventoryUpdation";
ALTER TABLE "new_PriceInventoryUpdation" RENAME TO "PriceInventoryUpdation";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "Shop_shopDomain_key" ON "Shop"("shopDomain");
