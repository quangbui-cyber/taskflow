ALTER TABLE "Project"
ADD COLUMN "purchaseOrderNumber" TEXT;

WITH purchase_orders AS (
  SELECT
    "id",
    UPPER(SUBSTRING("description" FROM 'PO:[[:space:]]*(C-[0-9]{8,})')) AS "poNumber",
    ROW_NUMBER() OVER (
      PARTITION BY UPPER(SUBSTRING("description" FROM 'PO:[[:space:]]*(C-[0-9]{8,})'))
      ORDER BY "createdAt", "id"
    ) AS "duplicateRank"
  FROM "Project"
  WHERE "description" ~* 'PO:[[:space:]]*C-[0-9]{8,}'
)
UPDATE "Project" AS project
SET "purchaseOrderNumber" = purchase_orders."poNumber"
FROM purchase_orders
WHERE project."id" = purchase_orders."id"
  AND purchase_orders."duplicateRank" = 1;

CREATE UNIQUE INDEX "Project_purchaseOrderNumber_key"
ON "Project"("purchaseOrderNumber");
