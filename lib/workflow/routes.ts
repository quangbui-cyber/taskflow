export const WORKFLOW_HUB_HREF = "/workflow";

function routeSegment(value: string) {
  return encodeURIComponent(value);
}

export function workflowDocumentHref(requestId: string) {
  return `${WORKFLOW_HUB_HREF}/${routeSegment(requestId)}`;
}

export function workflowPrintHref(requestId: string) {
  return `${workflowDocumentHref(requestId)}/print`;
}

export function workflowVerifyHref(capabilityToken: string) {
  return `${WORKFLOW_HUB_HREF}/verify/${routeSegment(capabilityToken)}`;
}

export function workflowProjectApprovalHref(projectId: string, requestId?: string) {
  const base = `/projects/${routeSegment(projectId)}/costflow?tab=approvals`;
  return requestId ? `${base}#request-${routeSegment(requestId)}` : base;
}

export function workflowRequestHref(request: {
  id: string;
  module: string;
  projectId: string | null;
}) {
  if (request.module === "COSTFLOW" && request.projectId) {
    return workflowProjectApprovalHref(request.projectId, request.id);
  }
  return workflowDocumentHref(request.id);
}

