const ROLE_BADGES: Record<string, { label: string; className: string }> = {
  ADMIN: { label: "Admin", className: "bg-brand-50 text-brand-800" },
  ACCOUNT: { label: "Account", className: "bg-blue-50 text-blue-700" },
  ACCOUNTANT: { label: "Kế toán", className: "bg-violet-50 text-violet-700" },
  USER: { label: "User", className: "bg-orange-50 text-orange-700" },
};

export default function RoleBadge({ role }: { role: string }) {
  const badge = ROLE_BADGES[role];
  if (!badge) return null;
  return (
    <span className={`tf-badge shrink-0 align-middle ${badge.className}`}>
      {badge.label}
    </span>
  );
}
