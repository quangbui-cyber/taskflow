import QRCode from "qrcode";

export async function createVerificationQrDataUrl(value: string) {
  return QRCode.toDataURL(value, {
    errorCorrectionLevel: "M",
    margin: 4,
    width: 320,
    type: "image/png",
    color: { dark: "#0f172a", light: "#ffffff" },
  });
}

export default async function QrCode({ value, alt = "QR tra cứu hồ sơ" }: { value: string; alt?: string }) {
  const src = await createVerificationQrDataUrl(value);
  // The data URL is produced by the maintained QR encoder from a server-owned URL.
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={src} alt={alt} width={128} height={128} className="size-32" />;
}
