-- CreateTable
CREATE TABLE "ProductInventory" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "sku" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "price" REAL NOT NULL,
    "productId" TEXT NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "ProductInventory_sku_key" ON "ProductInventory"("sku");

-- CreateIndex
CREATE UNIQUE INDEX "ProductInventory_productId_key" ON "ProductInventory"("productId");
