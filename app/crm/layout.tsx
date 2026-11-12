import { notFound } from "next/navigation";
import { crmEnabled } from "@/lib/features";

export default function CrmLayout({ children }: { children: React.ReactNode }) {
  if (!crmEnabled()) notFound();
  return children;
}
