import type { ApprovedActualCostConsumer, ApprovedActualCostLine, ApprovedActualCostQuery } from "../../lib/costflow/approvedActualCost";

export class ApprovedAcConsumerFixture implements ApprovedActualCostConsumer {
  constructor(private readonly lines: ApprovedActualCostLine[]) {}

  async resolveApprovedLines(query: ApprovedActualCostQuery) {
    return this.lines.filter(line => line.projectId === query.projectId && line.versionId === query.versionId && line.approvalEventId === query.approvalEventId && line.approvalAttemptId === query.approvalAttemptId && query.lineIds.includes(line.stableLineId));
  }
}
