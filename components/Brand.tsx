import { CreativeStationLogo } from "@/components/CreativeStationLogo";

export default function Brand({
  compact = false,
  large = false,
  className = "",
}: {
  compact?: boolean;
  large?: boolean;
  className?: string;
}) {
  const logoSize = large
    ? "w-[260px]"
    : compact
      ? "w-[150px]"
      : "w-[200px]";

  return (
    <span className={`flex min-w-0 items-center ${className}`}>
      <CreativeStationLogo className={`h-auto ${logoSize}`} />
    </span>
  );
}
