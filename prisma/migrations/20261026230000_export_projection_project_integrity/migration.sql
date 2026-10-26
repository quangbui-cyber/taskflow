DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "SettlementExportSourceProjection" source
    JOIN "ProjectSettlementVersion" dossier_version
      ON dossier_version."id" = source."dossierVersionId"
    WHERE source."dossierVersionId" IS NOT NULL
      AND source."projectId" <> dossier_version."projectId"
  ) THEN
    RAISE EXCEPTION 'Cannot restore export projection project integrity: cross-project dossier links exist.';
  END IF;
END $$;

ALTER TABLE "SettlementExportSourceProjection"
  DROP CONSTRAINT IF EXISTS "SettlementExportSourceProjection_dossierVersionId_fkey";

ALTER TABLE "SettlementExportSourceProjection"
  ADD CONSTRAINT "SettlementExportProjection_dossier_project_fkey"
    FOREIGN KEY ("dossierVersionId", "projectId")
    REFERENCES "ProjectSettlementVersion"("id", "projectId")
    ON DELETE RESTRICT ON UPDATE CASCADE;
