import type { ApprovalStep } from "@/lib/workflow/approval";

export function ordinaryApprovalSteps(input: {
  directManagerId: string | null | undefined;
  accountantId: string;
  ceoId: string;
}): ApprovalStep[] {
  return [
    { role: "MANAGER", assigneeId: input.directManagerId ?? "" },
    { role: "ACCOUNTANT", assigneeId: input.accountantId },
    { role: "CEO", assigneeId: input.ceoId },
  ];
}
