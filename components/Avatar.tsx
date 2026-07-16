import { avatarClass } from "@/lib/avatar";

export default function Avatar({
  id,
  name,
  avatarUrl,
  className = "h-9 w-9 text-sm",
}: {
  id: string;
  name: string;
  avatarUrl?: string | null;
  className?: string;
}) {
  return (
    <span
      className={`flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-cover bg-center font-semibold ${
        avatarUrl ? "bg-zinc-100 text-transparent" : avatarClass(id)
      } ${className}`}
      style={avatarUrl ? { backgroundImage: `url(${avatarUrl})` } : undefined}
      role="img"
      aria-label={`Ảnh đại diện ${name}`}
    >
      {avatarUrl ? "" : name.trim().charAt(0).toUpperCase() || "?"}
    </span>
  );
}
