/** Display-only tiles; counts come unchanged from pipelineReport (careToBrief, outsideWinRate). */
export function outsideWinRateTile({ cancelled, declined, legacyUnclassified }: { cancelled: number; declined: number; legacyUnclassified: number }) {
  return {
    label: "Ngoài win rate", value: cancelled + declined + legacyUnclassified,
    caption: `Khách hủy ${cancelled} · CS không tham gia ${declined}${legacyUnclassified > 0 ? ` · Chưa rõ kết quả ${legacyUnclassified}` : ""}`,
  };
}
export function careToBriefTile({ reached, total, open }: { reached: number; total: number; open: number }) {
  return {
    label: "Đã nhận Brief", value: `${reached}/${total}`,
    caption: total ? `${reached} trên ${total} Cơ hội đã qua Chăm sóc, ${open} còn đang mở` : "Chưa có Cơ hội trong kỳ",
  };
}
