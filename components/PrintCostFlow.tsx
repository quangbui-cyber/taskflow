"use client";
import { Button } from "@/components/ui/Button";
export default function PrintCostFlow() {
  return <div className="tf-costflow-no-print mb-6"><Button onClick={() => window.print()}>In / lưu PDF</Button><p className="tf-ui-help mt-2">Chọn “Lưu dưới dạng PDF” trong cửa sổ in.</p></div>;
}
