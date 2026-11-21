import { getConfig, setConfig } from "./api.js";

const micStatusText = document.getElementById("micStatusText");
const btnRequestMic = document.getElementById("btnRequestMic");
const serverInput = document.getElementById("serverInput");
const userNameInput = document.getElementById("userNameInput");
const attendeesInput = document.getElementById("attendeesInput");
const chatNoticeCheckbox = document.getElementById("chatNoticeCheckbox");
const btnSaveConfig = document.getElementById("btnSaveConfig");
const saveNotice = document.getElementById("saveNotice");

async function loadForm() {
  const config = await getConfig();
  serverInput.value = config.baseUrl;
  userNameInput.value = config.userName;
  attendeesInput.value = config.defaultAttendees;
  chatNoticeCheckbox.checked = config.sendChatNotice;
}

async function checkMicPermission() {
  try {
    const permission = await navigator.permissions.query({ name: "microphone" });
    if (permission.state === "granted") {
      micStatusText.innerText = "✅ Đã cấp quyền micro";
      micStatusText.style.color = "#059669";
      btnRequestMic.innerText = "Kiểm tra lại";
    } else {
      micStatusText.innerText = "⚠️ Chưa cấp quyền micro";
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
    micStatusText.innerText = "✅ Đã cấp quyền micro thành công!";
    micStatusText.style.color = "#059669";
    btnRequestMic.innerText = "Đã cấp quyền";
  } catch (err) {
    alert(`Không thể truy cập micro: ${err.message}`);
  }
};

btnSaveConfig.onclick = async () => {
  await setConfig({
    baseUrl: serverInput.value,
    userName: userNameInput.value,
    defaultAttendees: attendeesInput.value,
    sendChatNotice: chatNoticeCheckbox.checked,
  });
  saveNotice.innerText = "✓ Đã lưu cài đặt!";
  setTimeout(() => {
    saveNotice.innerText = "";
  }, 2500);
};

loadForm();
checkMicPermission();
