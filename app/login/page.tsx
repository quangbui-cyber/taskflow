import LoginForm from "@/components/LoginForm";
import { googleAuthConfigured } from "@/lib/googleAuth";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ google?: string | string[] }>;
}) {
  const { google } = await searchParams;
  return (
    <LoginForm
      googleEnabled={googleAuthConfigured()}
      googleResult={typeof google === "string" ? google : undefined}
    />
  );
}
