-- DropIndex
DROP INDEX "PriceInventoryUpdation_sku_key";

-- AlterTable
ALTER TABLE "PriceInventoryUpdation" ADD COLUMN "shopDomain" TEXT;
