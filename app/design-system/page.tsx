import type { Metadata } from "next";
import DesignSystemGallery from "./DesignSystemGallery";

export const metadata: Metadata = { title: "Design system — myCreative" };

export default function DesignSystemPage() {
  return <DesignSystemGallery />;
}
