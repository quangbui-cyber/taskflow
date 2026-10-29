/**
 * myCreative Recorder - Content script cho trang kết nối (/profile/extension)
 *
 * Trang web gửi token qua window.postMessage khi người dùng bấm "Cho phép kết nối".
 * Script này chuyển token cho background (nơi kiểm tra và lưu), rồi báo kết quả lại cho trang.
 * Chỉ chạy trên các URL khai báo trong manifest.json; background kiểm tra lại origin của người gửi.
 */

const WEB_ORIGIN = window.location.origin;

function reply(payload) {
  window.postMessage({ type: "MYCREATIVE_RECORDER_CONNECT_RESULT", ...payload }, WEB_ORIGIN);
}

window.addEventListener("message", (event) => {
  // Chỉ nhận tin do chính trang này gửi, không nhận từ iframe hay cửa sổ khác
  if (event.source !== window || event.origin !== WEB_ORIGIN) return;

  const data = event.data;
  if (!data || data.type !== "MYCREATIVE_RECORDER_TOKEN" || typeof data.token !== "string") return;

  chrome.runtime
    .sendMessage({ type: "CONNECT_TOKEN", token: data.token })
    .then((res) => {
      if (res?.ok) {
        reply({ ok: true, user: res.user });
      } else {
        reply({ ok: false, error: res?.error || "Extension không lưu được token." });
      }
    })
    .catch((err) => reply({ ok: false, error: err?.message || "Không liên lạc được với Extension." }));
});
