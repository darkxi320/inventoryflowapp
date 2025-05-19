/*
  Warnings:

  - You are about to drop the `ProductInventory` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "ProductInventory";
PRAGMA foreign_keys=on;

-- CreateTable
CREATE TABLE "PriceInventoryUpdation" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "productId" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "price" REAL NOT NULL,
    "locationId" TEXT NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "PriceInventoryUpdation_productId_key" ON "PriceInventoryUpdation"("productId");

-- CreateIndex
CREATE UNIQUE INDEX "PriceInventoryUpdation_sku_key" ON "PriceInventoryUpdation"("sku");
