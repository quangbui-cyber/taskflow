import { getConfig, setConfig, checkAuth, clearToken } from "./api.js";

const statusCard = document.getElementById("statusCard");
const statusTitle = document.getElementById("statusTitle");
const statusEmail = document.getElementById("statusEmail");
const btnOpenConnect = document.getElementById("btnOpenConnect");
const tokenInput = document.getElementById("tokenInput");
const btnSaveToken = document.getElementById("btnSaveToken");
const micStatusText = document.getElementById("micStatusText");
const btnRequestMic = document.getElementById("btnRequestMic");
const serverInput = document.getElementById("serverInput");
const btnSaveServer = document.getElementById("btnSaveServer");

async function renderStatus() {
  const { token, baseUrl } = await getConfig();
  serverInput.value = baseUrl;

  if (!token) {
    statusCard.className = "card-status";
    statusTitle.innerText = "Chưa kết nối";
    statusEmail.innerText = "Bấm nút bên phải để cấp quyền kết nối";
    btnOpenConnect.innerText = "Đăng nhập & Cấp quyền";
    btnOpenConnect.onclick = () => chrome.tabs.create({ url: `${baseUrl}/profile/extension` });
    tokenInput.value = "";
    return;
  }

  statusTitle.innerText = "Đang kiểm tra kết nối...";
  try {
    const user = await checkAuth();
    if (user) {
      statusCard.className = "card-status card-success";
      statusTitle.innerText = `Đã kết nối: ${user.name}`;
      statusEmail.innerText = user.email;
      btnOpenConnect.innerText = "Ngắt kết nối";
      btnOpenConnect.onclick = async () => {
        if (confirm("Bạn có chắc chắn muốn ngắt kết nối tài khoản này?")) {
          await clearToken();
          await renderStatus();
        }
      };
      tokenInput.value = token;
    }
  } catch (err) {
    statusCard.className = "card-status";
    statusTitle.innerText = "Kết nối không hợp lệ";
    statusEmail.innerText = err.message || "Token đã hết hạn hoặc không đúng.";
    btnOpenConnect.innerText = "Cấp quyền lại";
    btnOpenConnect.onclick = () => chrome.tabs.create({ url: `${baseUrl}/profile/extension` });
  }
}

// Kiểm tra quyền Micro
async function checkMicPermission() {
  try {
    const permission = await navigator.permissions.query({ name: "microphone" });
    if (permission.state === "granted") {
      micStatusText.innerText = "Đã cấp quyền micro";
      micStatusText.style.color = "#059669";
      btnRequestMic.innerText = "Kiểm tra lại";
    } else {
      micStatusText.innerText = "Chưa cấp quyền micro";
      micStatusText.style.color = "#dc2626";
    }
  } catch {
    micStatusText.innerText = "Cần cấp quyền micro";
  }
}

btnRequestMic.onclick = async () => {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    stream.getTracks().forEach((track) => track.stop());
    micStatusText.innerText = "Đã cấp quyền micro thành công!";
    micStatusText.style.color = "#059669";
    btnRequestMic.innerText = "Hoàn tất";
  } catch (err) {
    alert(`Không thể truy cập micro: ${err.message}`);
  }
};

btnSaveToken.onclick = async () => {
  const token = tokenInput.value.trim();
  if (!token) {
    alert("Vui lòng nhập mã token.");
    return;
  }
  btnSaveToken.disabled = true;
  btnSaveToken.innerText = "Đang lưu...";
  await setConfig({ token });
  await renderStatus();
  btnSaveToken.disabled = false;
  btnSaveToken.innerText = "Lưu";
};

btnSaveServer.onclick = async () => {
  const baseUrl = serverInput.value.trim();
  if (!baseUrl) {
    alert("Địa chỉ máy chủ không được để trống.");
    return;
  }
  await setConfig({ baseUrl });
  alert("Đã lưu địa chỉ máy chủ!");
  await renderStatus();
};

// Tự cập nhật trạng thái khi extension nhận được token từ trang kết nối
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && (changes.mycreative_token || changes.mycreative_base_url)) {
    renderStatus();
  }
});

// Mở từ bước kết nối lần đầu (?setup=mic): xin quyền micro luôn nếu chưa có
async function autoSetupMic() {
  if (new URLSearchParams(window.location.search).get("setup") !== "mic") return;
  const state = await navigator.permissions
    .query({ name: "microphone" })
    .then((p) => p.state)
    .catch(() => "prompt");
  if (state !== "granted") btnRequestMic.click();
}

renderStatus();
checkMicPermission().then(autoSetupMic);
