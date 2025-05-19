/*
  Warnings:

  - A unique constraint covering the columns `[shopDomain,sku]` on the table `PriceInventoryUpdation` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateIndex
CREATE UNIQUE INDEX "PriceInventoryUpdation_shopDomain_sku_key" ON "PriceInventoryUpdation"("shopDomain", "sku");
