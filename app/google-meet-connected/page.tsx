import GoogleMeetConnected from "@/components/GoogleMeetConnected";

export const metadata = { title: "Kết nối Google Meet" };

export default async function GoogleMeetConnectedPage({
  searchParams,
}: {
  searchParams: Promise<{ result?: string }>;
}) {
  const { result } = await searchParams;
  return <GoogleMeetConnected result={result ?? "failed"} />;
}
