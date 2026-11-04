import { Download } from "lucide-react";

export default function ExtensionDownload() {
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <a
          href="/downloads/mycreative-recorder-1.3.1.zip"
          download="mycreative-recorder-1.3.1.zip"
          className="tf-button-primary text-xs"
        >
          <Download size={16} aria-hidden="true" />
          Tải Extension
        </a>
        <span className="text-xs text-zinc-500">v1.3.1 · ZIP · Chrome / Edge</span>
      </div>
      <details className="text-xs text-zinc-500">
        <summary className="w-fit cursor-pointer rounded font-medium text-zinc-600 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-brand-500">
          Hướng dẫn cài đặt
        </summary>
        <ol className="mt-3 list-decimal space-y-2 pl-5 leading-relaxed">
          <li>Tải và giải nén file ZIP.</li>
          <li>
            Mở <code>chrome://extensions</code> hoặc <code>edge://extensions</code>,
            bật <strong>Developer mode</strong>, chọn <strong>Load unpacked</strong> và
            chọn thư mục <code>extension</code> vừa giải nén.
          </li>
          <li>Bấm icon myCreative Recorder → Kết nối ngay để kết nối tài khoản.</li>
        </ol>
        <p className="mt-3 leading-relaxed">
          Nếu đã cài: thay thư mục cũ bằng bản mới, bấm Reload trong trang tiện ích
          rồi tải lại tab cuộc họp. Hỗ trợ Google Meet, Teams và Zoom trong trình duyệt.
        </p>
      </details>
    </div>
  );
}
