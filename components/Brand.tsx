import Image from "next/image";

export default function Brand({
  compact = false,
  large = false,
}: {
  compact?: boolean;
  large?: boolean;
}) {
  const logoSize = large
    ? "w-[260px]"
    : compact
      ? "w-[150px]"
      : "w-[200px]";

  return (
    <span className="flex min-w-0 items-center">
      <Image
        src="/creative-station-logo.png"
        width={1914}
        height={370}
        alt="Creative Station"
        className={`h-auto ${logoSize}`}
        priority
      />
    </span>
  );
}
