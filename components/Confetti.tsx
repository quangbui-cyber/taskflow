import type { CSSProperties } from "react";

const COLORS = ["#a8d431", "#587216", "#f59e0b", "#c7e365", "#465a16", "#fbbf24"];

/**
 * Pháo giấy chỉ bằng CSS, chạy một lần (xem .tf-confetti trong globals.css).
 * Vị trí các mảnh tính theo chỉ số nên server và trình duyệt render giống nhau.
 * "fall": rơi từ mép trên khung; "burst": bung ra từ giữa phần tử cha.
 */
export default function Confetti({
  variant = "fall",
  count = 18,
}: {
  variant?: "fall" | "burst";
  count?: number;
}) {
  return (
    <span
      aria-hidden="true"
      className={`tf-confetti ${variant === "fall" ? "tf-confetti-fall" : "tf-confetti-burst"}`}
    >
      {Array.from({ length: count }, (_, index) => {
        // Rải đều nhưng lệch nhẹ để không thành hàng thẳng.
        const spread = (index * 37) % 100;
        const color = COLORS[index % COLORS.length];
        const round = index % 4 === 0;
        const style: Record<string, string> = {
          backgroundColor: color,
          width: round ? "6px" : index % 3 === 0 ? "10px" : "7px",
          height: round ? "6px" : index % 3 === 0 ? "4px" : "7px",
          borderRadius: round ? "999px" : "2px",
          "--tf-rotate": `${(index % 2 === 0 ? 1 : -1) * (180 + ((index * 53) % 360))}deg`,
        };

        if (variant === "fall") {
          style.left = `${2 + spread * 0.96}%`;
          style["--tf-delay"] = `${150 + ((index * 97) % 700)}ms`;
          style["--tf-duration"] = `${1600 + ((index * 131) % 800)}ms`;
          style["--tf-dx"] = `${((index * 29) % 40) - 20}px`;
          style["--tf-fall"] = `${130 + ((index * 17) % 60)}px`;
        } else {
          const angle = (index / count) * Math.PI * 2;
          const distance = 34 + ((index * 23) % 22);
          style["--tf-dx"] = `${Math.round(Math.cos(angle) * distance)}px`;
          style["--tf-dy"] = `${Math.round(Math.sin(angle) * distance)}px`;
          style["--tf-delay"] = `${(index * 13) % 80}ms`;
        }

        return (
          <span
            key={index}
            className="tf-confetti-piece"
            style={style as CSSProperties}
          />
        );
      })}
    </span>
  );
}
