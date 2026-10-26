-- Chống trùng tên nhà cung cấp không phân biệt hoa thường ngay trong database.
-- Ứng dụng ghi nameKey/shortNameKey = tên đã chuẩn hoá và viết thường.

ALTER TABLE "FinanceSupplier" ADD COLUMN "nameKey" TEXT,
ADD COLUMN "shortNameKey" TEXT;

UPDATE "FinanceSupplier"
SET "nameKey" = lower(regexp_replace(btrim("name"), '\s+', ' ', 'g')),
    "shortNameKey" = CASE
      WHEN "shortName" IS NULL THEN NULL
      ELSE lower(regexp_replace(btrim("shortName"), '\s+', ' ', 'g'))
    END;

ALTER TABLE "FinanceSupplier" ALTER COLUMN "nameKey" SET NOT NULL;

-- DropIndex
DROP INDEX "FinanceSupplier_name_key";

-- DropIndex
DROP INDEX "FinanceSupplier_shortName_key";

-- CreateIndex
CREATE UNIQUE INDEX "FinanceSupplier_nameKey_key" ON "FinanceSupplier"("nameKey");

-- CreateIndex
CREATE UNIQUE INDEX "FinanceSupplier_shortNameKey_key" ON "FinanceSupplier"("shortNameKey");
