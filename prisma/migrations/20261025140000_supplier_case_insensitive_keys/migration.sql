-- Chống trùng tên nhà cung cấp không phân biệt hoa thường ngay trong database.
-- Ứng dụng ghi nameKey/shortNameKey = tên đã chuẩn hoá và viết thường.

ALTER TABLE "Supplier" ADD COLUMN "nameKey" TEXT,
ADD COLUMN "shortNameKey" TEXT;

UPDATE "Supplier"
SET "nameKey" = lower(regexp_replace(btrim("name"), '\s+', ' ', 'g')),
    "shortNameKey" = CASE
      WHEN "shortName" IS NULL THEN NULL
      ELSE lower(regexp_replace(btrim("shortName"), '\s+', ' ', 'g'))
    END;

ALTER TABLE "Supplier" ALTER COLUMN "nameKey" SET NOT NULL;

-- DropIndex
DROP INDEX "Supplier_name_key";

-- DropIndex
DROP INDEX "Supplier_shortName_key";

-- CreateIndex
CREATE UNIQUE INDEX "Supplier_nameKey_key" ON "Supplier"("nameKey");

-- CreateIndex
CREATE UNIQUE INDEX "Supplier_shortNameKey_key" ON "Supplier"("shortNameKey");
