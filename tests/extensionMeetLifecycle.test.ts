import assert from "node:assert/strict";
import { copyFileSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { beforeEach, describe, it, mock } from "node:test";
import { pathToFileURL } from "node:url";
import vm from "node:vm";

/* eslint-disable @typescript-eslint/no-explicit-any */

const EXTENSION_DIR = path.join(process.cwd(), "extension");
// Bản sao ESM thuần của background.js + api.js (extension/ không có package.json "type": "module"),
// mỗi test một bản riêng để biến trạng thái và listener không dính nhau.
const ESM_DIR = mkdtempSync(path.join(tmpdir(), "mycreative-ext-"));
writeFileSync(path.join(ESM_DIR, "package.json"), '{"type":"module"}');
copyFileSync(path.join(EXTENSION_DIR, "api.js"), path.join(ESM_DIR, "api.js"));
let moduleCounter = 0;
function importFreshBackground() {
  const file = path.join(ESM_DIR, `background-${moduleCounter++}.js`);
  copyFileSync(path.join(EXTENSION_DIR, "background.js"), file);
  return import(pathToFileURL(file).href);
}

const flush = () => new Promise<void>((resolve) => setImmediate(resolve));
async function settle() {
  for (let i = 0; i < 8; i++) await flush();
}

// ---------------------------------------------------------------------------
// Giả lập chrome.* cho service worker
// ---------------------------------------------------------------------------

function createChromeFake() {
  const local: Record<string, any> = { mycreative_token: "tok", mycreative_base_url: "https://mycreative.test" };
  const session: Record<string, any> = {};
  const listeners: Record<string, ((...args: any[]) => any)[]> = {};
  const state = {
    offscreenOpen: false,
    offscreenMessages: [] as { type: string; payload?: any }[],
    badges: [] as string[],
    notifications: [] as { id: string; title: string; message: string }[],
    tabsAlive: new Set<number>([7]),
    closeCalls: 0,
    stopResponse: { ok: true } as any,
  };

  const area = (store: Record<string, any>) => ({
    async get(keys?: string | string[] | ((items: any) => void), cb?: (items: any) => void) {
      const list = typeof keys === "string" ? [keys] : Array.isArray(keys) ? keys : Object.keys(store);
      const out: Record<string, any> = {};
      for (const k of list) if (k in store) out[k] = structuredClone(store[k]);
      if (typeof keys === "function") keys(out);
      else if (cb) cb(out);
      return out;
    },
    async set(items: Record<string, any>) {
      for (const [k, v] of Object.entries(items)) store[k] = structuredClone(v);
    },
    async remove(keys: string | string[]) {
      for (const k of Array.isArray(keys) ? keys : [keys]) delete store[k];
    },
  });

  const event = (name: string) => ({
    addListener: (fn: (...args: any[]) => any) => {
      (listeners[name] ||= []).push(fn);
    },
  });

  const chrome = {
    storage: { local: area(local), session: area(session) },
    runtime: {
      ContextType: { OFFSCREEN_DOCUMENT: "OFFSCREEN_DOCUMENT" },
      getContexts: async () => (state.offscreenOpen ? [{}] : []),
      getURL: (p: string) => `chrome-extension://x/${p}`,
      sendMessage: async (msg: any) => {
        if (msg.target !== "offscreen") return undefined;
        state.offscreenMessages.push({ type: msg.type, payload: msg.payload });
        if (msg.type === "STOP") return state.stopResponse;
        return { ok: true };
      },
      onMessage: event("runtime.onMessage"),
      onStartup: event("runtime.onStartup"),
      onInstalled: event("runtime.onInstalled"),
    },
    offscreen: {
      Reason: { USER_MEDIA: "USER_MEDIA" },
      createDocument: async () => {
        state.offscreenOpen = true;
      },
      closeDocument: async () => {
        state.offscreenOpen = false;
        state.closeCalls++;
      },
    },
    action: {
      setBadgeText: ({ text }: { text: string }) => state.badges.push(text),
      setBadgeBackgroundColor: () => undefined,
    },
    alarms: { create: () => undefined, clear: () => undefined, onAlarm: event("alarms.onAlarm") },
    tabs: {
      onRemoved: event("tabs.onRemoved"),
      onUpdated: event("tabs.onUpdated"),
      sendMessage: async () => ({ success: true }),
      query: async () => [],
      get: async (id: number) => {
        if (!state.tabsAlive.has(id)) throw new Error("No tab");
        return { id };
      },
      create: async () => undefined,
    },
    tabCapture: { getMediaStreamId: async () => "stream-1" },
    commands: { onCommand: event("commands.onCommand") },
    notifications: {
      create: (id: string, opts: any) => state.notifications.push({ id, title: opts.title, message: opts.message }),
      clear: () => undefined,
      onClicked: event("notifications.onClicked"),
    },
    scripting: { executeScript: async () => undefined },
  };

  const emit = (name: string, ...args: any[]) => Promise.all((listeners[name] || []).map((fn) => fn(...args)));
  return { chrome, state, local, session, listeners, emit };
}

type Fake = ReturnType<typeof createChromeFake>;

const MEETING = { id: "m1", title: "Họp tuần", meetCode: "abc-defg-hij" };
const stopCount = (fake: Fake) => fake.state.offscreenMessages.filter((m) => m.type === "STOP").length;

async function sendMessage(fake: Fake, message: any, sender: any = {}) {
  return new Promise<any>((resolve) => {
    const handlers = fake.listeners["runtime.onMessage"] || [];
    let responded = false;
    const respond = (value: any) => {
      responded = true;
      resolve(value);
    };
    for (const fn of handlers) if (fn(message, sender, respond) === true) return;
    if (!responded) resolve(undefined);
  });
}

describe("extension background: kết thúc cuộc họp tự động", () => {
  let fake: Fake;
  let bg: any;

  beforeEach(async () => {
    mock.timers.reset();
    fake = createChromeFake();
    (globalThis as any).chrome = fake.chrome;
    // Mỗi test nạp lại module để có listener và biến trạng thái mới
    bg = await importFreshBackground();
    await bg.startRecordingSession({ tabId: 7, meeting: MEETING, meetCode: "abc-defg-hij" });
  });

  it("bắt đầu ghi: lưu phiên và bản ghi chờ tải lên", async () => {
    assert.equal(fake.session.current_recording_session.phase, "recording");
    assert.equal(fake.local.mycreative_pending_upload.meetingId, "m1");
    assert.equal(fake.state.offscreenMessages[0].type, "START");
    assert.equal(fake.state.offscreenMessages[0].payload.token, "tok");
  });

  it("đóng tab cuộc họp: dừng và chuyển sang tải lên đúng một lần", async () => {
    await fake.emit("tabs.onRemoved", 7);
    await fake.emit("tabs.onRemoved", 7);
    assert.equal(stopCount(fake), 1);
    assert.equal(fake.session.current_recording_session.phase, "uploading");
    assert.equal(fake.session.current_recording_session.endReason, "tab-closed");
  });

  it("đóng tab khác không ảnh hưởng", async () => {
    await fake.emit("tabs.onRemoved", 99);
    assert.equal(stopCount(fake), 0);
    assert.equal(fake.session.current_recording_session.phase, "recording");
  });

  it("rời họp: chờ 5s rồi dừng; nhận MEET_LEFT lặp lại không dừng thêm lần nào và không đóng offscreen giữa chừng", async () => {
    mock.timers.enable({ apis: ["setTimeout"] });
    const sender = { tab: { id: 7 } };

    // Content script cũ báo MEET_LEFT mỗi 3s: tín hiệu lặp lại không được dời hẹn hay kích hoạt dừng thêm
    await sendMessage(fake, { type: "MEET_LEFT" }, sender);
    await settle();
    mock.timers.tick(3000);
    await sendMessage(fake, { type: "MEET_LEFT" }, sender);
    await settle();
    assert.equal(stopCount(fake), 0);

    mock.timers.tick(2000);
    await settle();
    assert.equal(stopCount(fake), 1);

    for (let i = 0; i < 5; i++) {
      await sendMessage(fake, { type: "MEET_LEFT" }, sender);
      mock.timers.tick(3000);
      await settle();
    }
    assert.equal(stopCount(fake), 1);
    assert.equal(fake.state.closeCalls, 0, "không được đóng offscreen khi bản ghi còn đang tải lên");
    assert.equal(fake.state.offscreenOpen, true);
  });

  it("vào lại phòng trong thời gian chờ thì huỷ lệnh dừng", async () => {
    mock.timers.enable({ apis: ["setTimeout"] });
    const sender = { tab: { id: 7 } };
    await sendMessage(fake, { type: "MEET_LEFT" }, sender);
    await settle();
    await sendMessage(fake, { type: "MEET_JOINED" }, sender);
    await settle();
    mock.timers.tick(10000);
    await settle();
    assert.equal(stopCount(fake), 0);
    assert.equal(fake.session.current_recording_session.phase, "recording");
  });

  it("MEET_LEFT từ tab khác bị bỏ qua", async () => {
    mock.timers.enable({ apis: ["setTimeout"] });
    await sendMessage(fake, { type: "MEET_LEFT" }, { tab: { id: 123 } });
    await settle();
    mock.timers.tick(10000);
    await settle();
    assert.equal(stopCount(fake), 0);
  });

  it("tab chuyển sang trang khác thì dừng, vẫn ở phòng họp (đổi query) thì không", async () => {
    await fake.emit("tabs.onUpdated", 7, { url: "https://meet.google.com/abc-defg-hij?authuser=1" });
    assert.equal(stopCount(fake), 0);
    await fake.emit("tabs.onUpdated", 7, { url: "https://meet.google.com/landing" });
    assert.equal(stopCount(fake), 1);
    assert.equal(fake.session.current_recording_session.endReason, "navigated");
  });

  it("offscreen tự dừng (tab capture kết thúc) thì sau đó đóng tab không dừng lần hai", async () => {
    await sendMessage(fake, { type: "RECORDING_STOPPED", reason: "tab-capture-ended", meetingId: "m1" });
    await settle();
    assert.equal(fake.session.current_recording_session.phase, "uploading");
    await fake.emit("tabs.onRemoved", 7);
    assert.equal(stopCount(fake), 0);
  });

  it("tải lên xong: xoá bản chờ, báo thông báo, rồi mới đóng offscreen", async () => {
    await fake.emit("tabs.onRemoved", 7);
    mock.timers.enable({ apis: ["setTimeout"] });
    await sendMessage(fake, { type: "UPLOADING_SUCCESS", meetingId: "m1" });
    await settle();
    assert.equal(fake.session.current_recording_session.phase, "done");
    assert.equal(fake.local.mycreative_pending_upload, undefined);
    assert.equal(fake.state.notifications.at(-1)?.id, "recap-ok:m1");
    assert.equal(fake.state.closeCalls, 0);
    mock.timers.tick(1500);
    await settle();
    assert.equal(fake.state.closeCalls, 1);
  });

  it("tải lên lỗi: giữ bản ghi, báo lỗi, cho phép thử tải lại", async () => {
    await fake.emit("tabs.onRemoved", 7);
    await sendMessage(fake, { type: "UPLOADING_ERROR", error: "Hết hạn mức" });
    await settle();
    assert.equal(fake.session.current_recording_session.phase, "failed");
    assert.equal(fake.local.mycreative_pending_upload.error, "Hết hạn mức");
    assert.equal(fake.state.notifications.at(-1)?.id, "recap-failed");

    const res = await sendMessage(fake, { type: "RETRY_UPLOAD" });
    assert.equal(res.ok, true);
    const retry = fake.state.offscreenMessages.find((m) => m.type === "RETRY_UPLOAD");
    assert.equal(retry?.payload.meetingId, "m1");
    assert.equal(fake.session.current_recording_session.phase, "uploading");
  });

  it("không cho bắt đầu phiên mới khi bản ghi trước đang tải lên", async () => {
    await fake.emit("tabs.onRemoved", 7);
    await assert.rejects(
      bg.startRecordingSession({ tabId: 8, meeting: MEETING, meetCode: "abc-defg-hij" }),
      /đang được tải lên/
    );
  });

  it("đồng hồ phát hiện tab đã mất mà lỡ sự kiện đóng tab", async () => {
    fake.state.tabsAlive.delete(7);
    await fake.emit("alarms.onAlarm", { name: "recording_timer" });
    assert.equal(stopCount(fake), 1);
    assert.equal(fake.session.current_recording_session.endReason, "tab-closed");
  });

  it("dừng thủ công từ popup đi qua cùng đường và không chờ tải lên xong", async () => {
    const res = await sendMessage(fake, { type: "STOP_SESSION" });
    assert.equal(res.ok, true);
    assert.equal(fake.session.current_recording_session.phase, "uploading");
    assert.equal(fake.session.current_recording_session.endReason, "manual");
  });
});

// ---------------------------------------------------------------------------
// content-meet.js: phát hiện rời họp
// ---------------------------------------------------------------------------

function loadContentScript() {
  let now = 1_000_000;
  const sent: any[] = [];
  const intervals: (() => void)[] = [];
  const timeouts: { due: number; fn: () => void }[] = [];
  const windowListeners: Record<string, ((e: any) => void)[]> = {};
  const documentListeners: Record<string, ((e: any) => void)[]> = {};
  const doc: any = {
    title: "Meet",
    body: { innerText: "" },
    querySelector: () => null,
    addEventListener: (type: string, fn: any) => (documentListeners[type] ||= []).push(fn),
  };

  class FakeElement {
    constructor(public label: string) {}
    getAttribute(name: string) {
      return name === "aria-label" ? this.label : null;
    }
    get textContent() {
      return this.label;
    }
    closest() {
      return this;
    }
  }

  const sandbox: any = {
    document: doc,
    Element: FakeElement,
    Date: { now: () => now },
    console,
    Event: class {},
    KeyboardEvent: class {},
    setInterval: (fn: () => void) => intervals.push(fn),
    setTimeout: (fn: () => void, ms: number) => timeouts.push({ due: now + ms, fn }),
    chrome: {
      runtime: {
        id: "ext",
        sendMessage: (m: any) => {
          sent.push(m);
          return Promise.resolve();
        },
        onMessage: { addListener: () => undefined },
      },
    },
  };
  sandbox.window = sandbox;
  sandbox.location = { origin: "https://meet.google.com", pathname: "/abc-defg-hij", search: "", href: "https://meet.google.com/abc-defg-hij" };
  sandbox.addEventListener = (type: string, fn: any) => (windowListeners[type] ||= []).push(fn);
  sandbox.postMessage = () => undefined;
  vm.createContext(sandbox);
  vm.runInContext(readFileSync(path.join(EXTENSION_DIR, "content-meet.js"), "utf8"), sandbox);
  // `window` bên trong vm là global của context, khác với object sandbox truyền vào
  const pageWindow = vm.runInContext("window", sandbox);

  return {
    sent,
    doc,
    pcCount(count: number) {
      for (const fn of windowListeners.message || []) {
        fn({ source: pageWindow, origin: "https://meet.google.com", data: { source: "mycreative-meet-hook", type: "PC_COUNT", count } });
      }
    },
    click(label: string) {
      for (const fn of documentListeners.click || []) fn({ target: new FakeElement(label) });
    },
    advance(ms: number) {
      // Chạy theo từng giây như setInterval(…, 1000) thật
      for (let elapsed = 0; elapsed < ms; elapsed += 500) {
        now += 500;
        for (const t of timeouts.splice(0)) {
          if (t.due <= now) t.fn();
          else timeouts.push(t);
        }
        if ((now / 500) % 2 === 0) intervals.forEach((fn) => fn());
      }
    },
    types: () => sent.map((m) => m.type).filter((t) => t === "MEET_LEFT" || t === "MEET_JOINED"),
  };
}

describe("content-meet.js: phát hiện rời họp", () => {
  it("mọi kết nối đóng và không có tín hiệu nào khác: chờ đủ 10s mới báo, chỉ báo một lần", () => {
    const page = loadContentScript();
    page.pcCount(2);
    page.pcCount(0);
    page.advance(5000);
    assert.deepEqual(page.types(), []);
    page.advance(8000);
    assert.deepEqual(page.types(), ["MEET_LEFT"]);
    page.advance(20000);
    assert.deepEqual(page.types(), ["MEET_LEFT"]);
  });

  it("bấm nút rời cuộc gọi (icon call_end) thì báo nhanh hơn nhiều khi kết nối đóng", () => {
    const page = loadContentScript();
    page.pcCount(1);
    page.click("call_end");
    page.pcCount(0);
    page.advance(3000);
    assert.deepEqual(page.types(), ["MEET_LEFT"]);
  });

  it("nhận diện nút theo nhãn tiếng Việt / tiếng Anh, kể cả 'kết thúc cuộc gọi cho tất cả'", () => {
    for (const label of ["Rời khỏi cuộc gọi", "Leave call", "Kết thúc cuộc gọi cho tất cả mọi người", "End call for everyone"]) {
      const page = loadContentScript();
      page.pcCount(1);
      page.click(label);
      page.pcCount(0);
      page.advance(3000);
      assert.deepEqual(page.types(), ["MEET_LEFT"], label);
    }
  });

  it("bấm nút bất kỳ khác rồi mất kết nối vẫn phải chờ đủ 10s", () => {
    const page = loadContentScript();
    page.pcCount(1);
    page.click("Bật micrô");
    page.pcCount(0);
    page.advance(3000);
    assert.deepEqual(page.types(), []);
  });

  it("bấm Rời nhưng huỷ (kết nối vẫn còn) thì không báo", () => {
    const page = loadContentScript();
    page.pcCount(1);
    page.click("Leave call");
    page.advance(30000);
    assert.deepEqual(page.types(), []);
  });

  it("màn hình 'Bạn đã rời khỏi cuộc họp' báo ngay cả khi không có hook", () => {
    const page = loadContentScript();
    page.doc.body.innerText = "Bạn đã rời khỏi cuộc họp\nTham gia lại";
    page.advance(3000);
    assert.deepEqual(page.types(), ["MEET_LEFT"]);
  });

  it("vào lại phòng thì báo MEET_JOINED để huỷ lệnh dừng", () => {
    const page = loadContentScript();
    page.pcCount(1);
    page.click("call_end");
    page.pcCount(0);
    page.advance(3000);
    page.pcCount(1);
    page.advance(2000);
    assert.deepEqual(page.types(), ["MEET_LEFT", "MEET_JOINED"]);
  });

  it("chưa từng có kết nối (màn hình chờ) thì không bao giờ báo rời họp", () => {
    const page = loadContentScript();
    page.pcCount(0);
    page.advance(60000);
    assert.deepEqual(page.types(), []);
  });
});

// ---------------------------------------------------------------------------
// meet-hook.js: đếm RTCPeerConnection còn mở
// ---------------------------------------------------------------------------

describe("meet-hook.js: đếm kết nối cuộc gọi", () => {
  it("báo số kết nối còn mở, về 0 khi pc.close() và không làm hỏng RTCPeerConnection gốc", () => {
    const posted: number[] = [];
    class FakePeerConnection {
      signalingState = "stable";
      connectionState = "new";
      private handlers: Record<string, (() => void)[]> = {};
      static generateCertificate = () => "cert";
      addEventListener(type: string, fn: () => void) {
        (this.handlers[type] ||= []).push(fn);
      }
      close() {
        this.signalingState = "closed";
        this.connectionState = "closed";
      }
    }
    const sandbox: any = {
      RTCPeerConnection: FakePeerConnection,
      location: { origin: "https://meet.google.com" },
      addEventListener: () => undefined,
      postMessage: (msg: any) => posted.push(msg.count),
    };
    sandbox.window = sandbox;
    vm.createContext(sandbox);
    vm.runInContext(readFileSync(path.join(EXTENSION_DIR, "meet-hook.js"), "utf8"), sandbox);

    const Wrapped = vm.runInContext("window.RTCPeerConnection", sandbox);
    assert.notEqual(Wrapped, FakePeerConnection);
    assert.equal(Wrapped.generateCertificate(), "cert");

    const a = new Wrapped();
    const b = new Wrapped();
    assert.ok(a instanceof FakePeerConnection);
    assert.equal(posted.at(-1), 2);
    a.close();
    assert.equal(posted.at(-1), 1);
    b.close();
    assert.equal(posted.at(-1), 0);
  });
});
