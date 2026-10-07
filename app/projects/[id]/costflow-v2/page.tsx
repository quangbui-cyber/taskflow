import { redirect } from "next/navigation";

export default async function CostflowV2RedirectPage({
  params
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  redirect(`/projects/${id}/costflow?tab=scope`);
}
