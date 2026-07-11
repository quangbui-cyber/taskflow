const ROLE_BADGES: Record<string, { label: string; className: string }> = {
  ADMIN: { label: "Admin", className: "bg-blue-50 text-blue-700" },
  ACCOUNT: { label: "Account", className: "bg-cyan-50 text-cyan-700" },
  USER: { label: "User", className: "bg-zinc-100 text-zinc-500" },
};

export default function RoleBadge({ role }: { role: string }) {
  const badge = ROLE_BADGES[role];
  if (!badge) return null;
  return (
    <span className={`tf-badge ml-2 align-middle ${badge.className}`}>
      {badge.label}
    </span>
  );
}
