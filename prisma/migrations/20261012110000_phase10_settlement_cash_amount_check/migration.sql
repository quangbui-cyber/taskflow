ALTER TABLE "SettlementCashAllocation"
  DROP CONSTRAINT "SettlementCashAllocation_amount_check";

ALTER TABLE "SettlementCashAllocation"
  ADD CONSTRAINT "SettlementCashAllocation_amount_check"
    CHECK ("amount" ~ '^[1-9][0-9]*$');
