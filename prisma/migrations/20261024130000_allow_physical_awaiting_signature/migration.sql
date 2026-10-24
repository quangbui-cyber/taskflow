-- A physical-signing dossier is CHO_KY after submission and after approval,
-- until a signed scan batch is uploaded. Keep later evidence states unchanged.
ALTER TABLE "WorkflowSigningLifecycle"
  DROP CONSTRAINT "WorkflowSigningLifecycle_evidence_check";
ALTER TABLE "WorkflowSigningLifecycle"
  ADD CONSTRAINT "WorkflowSigningLifecycle_evidence_check"
  CHECK (("mode" = 'DIGITAL' AND "evidenceState" IN ('CHO_KY', 'DIGITAL_CONFIRMED'))
    OR ("mode" = 'PHYSICAL' AND "evidenceState" IN ('CHO_KY', 'PENDING', 'RETURNED', 'PHYSICAL_CONFIRMED')));

ALTER TABLE "WorkflowApprovedSnapshot"
  DROP CONSTRAINT "WorkflowApprovedSnapshot_evidence_check";
ALTER TABLE "WorkflowApprovedSnapshot"
  ADD CONSTRAINT "WorkflowApprovedSnapshot_evidence_check"
  CHECK (("mode" = 'DIGITAL' AND "evidenceState" IN ('CHO_KY', 'DIGITAL_CONFIRMED'))
    OR ("mode" = 'PHYSICAL' AND "evidenceState" IN ('CHO_KY', 'PENDING', 'RETURNED', 'PHYSICAL_CONFIRMED')));
