"use client";

import { useActionState, useEffect, useRef, useState, useTransition } from "react";
import {
  deleteUser,
  resetPassword,
  setManager,
  setUserActive,
  updateUserProfile,
  type AdminState,
} from "@/app/actions/admin";
import RoleBadge from "@/components/RoleBadge";
import Avatar from "@/components/Avatar";
import AvatarUploader from "@/components/AvatarUploader";
import UserPicker, { type UserPickerOption } from "@/components/UserPicker";
import {
  useActionFeedback,
  useInteraction,
} from "@/components/InteractionProvider";
import {
  AlertTriangle,
  ChevronDown,
  CirclePause,
  KeyRound,
  MoreHorizontal,
  Pencil,
  RotateCcw,
  Save,
  Trash2,
  X,
} from "lucide-react";

export type UserItem = {
  id: string;
  name: string;
  email: string;
  role: string;
  isActive: boolean;
  deactivatedAt: string | null;
  createdAt: string;
  assignedTaskCount: number;
  createdTaskCount: number;
  projectMemberCount: number;
  ownedProjectCount: number;
  isAccount: boolean;
  managerId: string | null;
  avatarUrl: string | null;
};

export default function UserRow({
  user,
  isSelf,
  managers,
}: {
  user: UserItem;
  isSelf: boolean;
  managers: UserPickerOption[];
}) {
  const { notify } = useInteraction();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const [accountMessage, setAccountMessage] = useState<string | null>(null);
  const [accountMessageError, setAccountMessageError] = useState(false);
  const [profileName, setProfileName] = useState(user.name);
  const [profileRole, setProfileRole] = useState(user.role);
  const [profileAvatarUrl, setProfileAvatarUrl] = useState(user.avatarUrl ?? "");
  const [profileMessage, setProfileMessage] = useState("");
  const [profileError, setProfileError] = useState(false);
  const [managerId, setManagerId] = useState(user.managerId ?? "");
  const [savedManagerId, setSavedManagerId] = useState(user.managerId ?? "");
  const [managerMessage, setManagerMessage] = useState("");
  const [managerError, setManagerError] = useState(false);
  const [pendingAction, startTransition] = useTransition();
  const managerChanged = managerId !== savedManagerId;
  const managerOptions = managers.filter((manager) => manager.id !== user.id);
  const relatedTaskCount = user.assignedTaskCount + user.createdTaskCount;
  const relatedProjectCount = user.projectMemberCount + user.ownedProjectCount;
  const deleteBlockReasons = [
    relatedProjectCount > 0 ? "tài khoản vẫn đang thuộc hoặc sở hữu dự án" : null,
    relatedTaskCount > 0 ? "tài khoản vẫn đang có task được giao hoặc đã tạo" : null,
    user.isAccount ? "tài khoản đang được dùng làm Account" : null,
  ].filter(Boolean);
  const canDelete = !isSelf && !user.isActive && deleteBlockReasons.length === 0;
  const [state, formAction, pending] = useActionState<AdminState, FormData>(
    async (prev, formData) => {
      const result = await resetPassword(prev, formData);
      if (result.success) setResetting(false);
      return result;
    },
    {}
  );
  useActionFeedback(state);

  useEffect(() => {
    function closeMenu(event: PointerEvent) {
      if (!menuRef.current?.contains(event.target as Node)) setMenuOpen(false);
    }
    function handleEscape(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      if (menuOpen) setMenuOpen(false);
      else if (drawerOpen) setDrawerOpen(false);
    }
    document.addEventListener("pointerdown", closeMenu);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("pointerdown", closeMenu);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [drawerOpen, menuOpen]);

  useEffect(() => {
    if (!drawerOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [drawerOpen]);

  function openDrawer() {
    setProfileName(user.name);
    setProfileRole(user.role);
    setProfileAvatarUrl(user.avatarUrl ?? "");
    setProfileMessage("");
    setResetting(false);
    setMenuOpen(false);
    setDrawerOpen(true);
  }

  function saveProfile() {
    startTransition(async () => {
      const result = await updateUserProfile(
        user.id,
        profileName,
        profileRole,
        profileAvatarUrl
      );
      setProfileError(Boolean(result.error));
      setProfileMessage(result.error ?? result.success ?? "");
      notify({
        message: result.error ?? result.success ?? "Đã lưu tài khoản.",
        tone: result.error ? "error" : "success",
      });
    });
  }

  function changeAccountStatus(isActive: boolean) {
    if (
      !isActive &&
      !confirm(
        `Vô hiệu hóa tài khoản ${user.name}? Người này sẽ không thể đăng nhập, nhưng toàn bộ lịch sử vẫn được giữ.`
      )
    ) {
      return;
    }
    setMenuOpen(false);
    setAccountMessage(null);
    startTransition(async () => {
      const result = await setUserActive(user.id, isActive);
      setAccountMessageError(Boolean(result.error));
      setAccountMessage(result.error ?? result.success ?? null);
      notify({
        message: result.error ?? result.success ?? "Đã cập nhật trạng thái tài khoản.",
        tone: result.error ? "error" : "success",
      });
    });
  }

  function permanentlyDelete() {
    setMenuOpen(false);
    if (!canDelete) {
      setAccountMessageError(true);
      setAccountMessage(
        `Không thể xoá vĩnh viễn vì ${deleteBlockReasons.join(", ")}. Hãy chuyển dữ liệu liên quan trước.`
      );
      notify({
        message: "Không thể xoá tài khoản khi vẫn còn dữ liệu liên quan.",
        tone: "error",
      });
      return;
    }
    if (!confirm(`Xoá vĩnh viễn tài khoản ${user.name}? Thao tác này không thể hoàn tác.`)) {
      return;
    }
    setAccountMessage(null);
    startTransition(async () => {
      const result = await deleteUser(user.id);
      setAccountMessageError(Boolean(result.error));
      setAccountMessage(result.error ?? result.success ?? null);
      notify({
        message: result.error ?? result.success ?? "Đã xoá tài khoản.",
        tone: result.error ? "error" : "success",
      });
    });
  }

  return (
    <li className={`group relative px-5 py-3.5 transition-colors hover:bg-zinc-50/65 sm:px-6 ${user.isActive ? "" : "bg-zinc-50/80"}`}>
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-3 lg:grid-cols-[minmax(220px,1.35fr)_96px_minmax(240px,1fr)_72px] lg:gap-x-4">
        <div className="col-span-2 flex min-w-0 items-center gap-3 pr-20 lg:col-span-1 lg:pr-0">
          <Avatar
            id={user.id}
            name={profileName || user.name}
            avatarUrl={profileAvatarUrl}
            className="h-9 w-9 shrink-0 text-sm"
          />
          <div className="min-w-0">
            <p className="truncate text-[15px] font-semibold leading-5 text-zinc-950" title={user.name}>
              {user.name}
              {isSelf && <span className="font-normal text-zinc-400"> (bạn)</span>}
            </p>
            <p className="mt-0.5 truncate text-xs text-zinc-400" title={user.email}>
              {user.email}
            </p>
          </div>
        </div>

        <div className="row-start-2 flex items-center lg:row-auto">
          <span className="mr-2 text-[11px] font-medium text-zinc-400 lg:hidden">Vai trò</span>
          <RoleBadge role={user.role} />
        </div>

        <div className="col-span-2 lg:col-span-1">
          <span className="mb-1 block text-[11px] font-medium text-zinc-400 lg:hidden">
            Quản lý
          </span>
          <div className="flex items-center gap-2">
            <UserPicker
              value={managerId}
              onChange={(nextManagerId) => {
                setManagerId(nextManagerId);
                setManagerMessage("");
              }}
              options={managerOptions}
              placeholder="— Không —"
              emptyLabel="— Không —"
              ariaLabel={`Quản lý của ${user.name}`}
              className="min-w-0 flex-1"
              density="quiet"
            />
            {managerChanged && (
              <button
                type="button"
                disabled={pendingAction}
                onClick={() => {
                  startTransition(async () => {
                    const result = await setManager(user.id, managerId || null);
                    setManagerError(Boolean(result.error));
                    setManagerMessage(result.error ?? result.success ?? "");
                    if (!result.error) setSavedManagerId(managerId);
                    notify({
                      message: result.error ?? result.success ?? "Đã cập nhật người quản lý.",
                      tone: result.error ? "error" : "success",
                    });
                  });
                }}
                className="tf-button-primary !min-h-9 shrink-0 !px-3 !py-1.5 text-xs shadow-none"
                aria-busy={pendingAction}
              >
                {pendingAction ? (
                  <span className="tf-spinner" aria-hidden="true" />
                ) : (
                  <Save size={14} aria-hidden="true" />
                )}
                Lưu
              </button>
            )}
          </div>
        </div>

        <div className="absolute right-5 top-3.5 flex items-center gap-1 transition-opacity sm:right-6 lg:static lg:justify-end lg:opacity-60 lg:group-hover:opacity-100 lg:focus-within:opacity-100">
          <button
            type="button"
            onClick={openDrawer}
            className="tf-icon-button !h-8 !min-h-8 !w-8 !border-zinc-200/70 !bg-white/70 hover:!bg-white"
            aria-label={`Sửa tài khoản ${user.name}`}
            title="Sửa tài khoản"
          >
            <Pencil size={16} aria-hidden="true" />
          </button>
          {!isSelf && (
            <div className="relative" ref={menuRef}>
              <button
                type="button"
                onClick={() => setMenuOpen((value) => !value)}
                className="tf-icon-button !h-8 !min-h-8 !w-8 !border-zinc-200/70 !bg-white/70 hover:!bg-white"
                aria-label={`Thao tác khác cho ${user.name}`}
                aria-expanded={menuOpen}
                title="Thao tác khác"
              >
                <MoreHorizontal size={18} aria-hidden="true" />
              </button>
              {menuOpen && (
                <div className="tf-popover-enter absolute right-0 top-11 z-30 w-48 rounded-[8px] border border-zinc-200 bg-white p-1.5 shadow-lg">
                  {user.isActive && (
                    <button
                      type="button"
                      disabled={pendingAction}
                      onClick={() => changeAccountStatus(false)}
                      className="flex min-h-9 w-full items-center gap-2 rounded-[6px] px-2.5 text-left text-xs font-medium text-red-600 hover:bg-red-50"
                    >
                      <CirclePause size={15} aria-hidden="true" />
                      Vô hiệu hóa
                    </button>
                  )}
                  {!user.isActive && (
                    <>
                      <button
                        type="button"
                        disabled={pendingAction}
                        onClick={() => changeAccountStatus(true)}
                        className="flex min-h-9 w-full items-center gap-2 rounded-[6px] px-2.5 text-left text-xs font-medium text-zinc-600 hover:bg-zinc-50 hover:text-zinc-900"
                      >
                        <RotateCcw size={15} aria-hidden="true" />
                        Kích hoạt lại
                      </button>
                      <button
                        type="button"
                        disabled={pendingAction}
                        onClick={permanentlyDelete}
                        className="flex min-h-9 w-full items-center gap-2 rounded-[6px] px-2.5 text-left text-xs font-medium text-red-600 hover:bg-red-50"
                      >
                        <Trash2 size={15} aria-hidden="true" />
                        Xoá vĩnh viễn
                      </button>
                    </>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {managerMessage && managerError && (
        <p className="mt-2 text-xs text-red-600">
          {managerMessage}
        </p>
      )}
      {accountMessage && accountMessageError && (
        <div
          className="mt-3 flex items-start gap-2 rounded-[8px] border border-red-100 bg-red-50 px-3 py-2 text-xs text-red-700"
        >
          <AlertTriangle size={14} className="mt-0.5 shrink-0" aria-hidden="true" />
          <p>{accountMessage}</p>
        </div>
      )}

      {drawerOpen && (
        <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label={`Chỉnh sửa ${user.name}`}>
          <button
            type="button"
            className="tf-overlay-enter absolute inset-0 bg-zinc-950/25 backdrop-blur-[1px]"
            onClick={() => setDrawerOpen(false)}
            aria-label="Đóng bảng chỉnh sửa"
          />
          <aside className="tf-sheet-enter absolute inset-y-0 right-0 flex w-full max-w-md flex-col bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-zinc-100 px-5 py-4">
              <div className="min-w-0">
                <p className="text-xs font-medium text-zinc-400">Chỉnh sửa tài khoản</p>
                <h3 className="truncate text-lg font-semibold">{user.name}</h3>
              </div>
              <button
                type="button"
                onClick={() => setDrawerOpen(false)}
                className="tf-icon-button shrink-0"
                aria-label="Đóng"
                title="Đóng"
              >
                <X size={18} aria-hidden="true" />
              </button>
            </div>

            <div className="flex-1 space-y-6 overflow-y-auto px-5 py-5">
              <section>
                <h4 className="mb-3 text-sm font-semibold">Thông tin tài khoản</h4>
                <div className="space-y-4">
                  <AvatarUploader
                    id={user.id}
                    displayName={profileName || user.name}
                    defaultValue={profileAvatarUrl}
                    onChange={setProfileAvatarUrl}
                  />
                  <label className="block">
                    <span className="tf-label">Họ tên</span>
                    <input
                      type="text"
                      value={profileName}
                      onChange={(event) => {
                        setProfileName(event.target.value);
                        setProfileMessage("");
                      }}
                      className="tf-field"
                    />
                  </label>
                  <label className="block">
                    <span className="tf-label">Vai trò</span>
                    <div className="relative">
                      <select
                        value={profileRole}
                        disabled={isSelf}
                        onChange={(event) => {
                          setProfileRole(event.target.value);
                          setProfileMessage("");
                        }}
                        className="tf-field appearance-none !pr-11 disabled:bg-zinc-50 disabled:text-zinc-500"
                      >
                        <option value="ADMIN">Admin</option>
                        <option value="ACCOUNT">Account</option>
                        <option value="USER">User</option>
                      </select>
                      <ChevronDown
                        size={16}
                        className={`pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 ${
                          isSelf ? "text-zinc-300" : "text-zinc-500"
                        }`}
                        aria-hidden="true"
                      />
                    </div>
                  </label>
                  {isSelf && (
                    <p className="text-xs leading-5 text-zinc-400">
                      Admin có thể tham gia Team trong tab Account mà không cần đổi vai trò.
                    </p>
                  )}
                  <button
                    type="button"
                    onClick={saveProfile}
                    disabled={pendingAction || !profileName.trim()}
                    className="tf-button-primary"
                    aria-busy={pendingAction}
                  >
                    {pendingAction ? (
                      <span className="tf-spinner" aria-hidden="true" />
                    ) : (
                      <Save size={16} aria-hidden="true" />
                    )}
                    Lưu
                  </button>
                  {profileMessage && profileError && (
                    <p className="text-xs text-red-600">
                      {profileMessage}
                    </p>
                  )}
                </div>
              </section>

              <section className="border-t border-zinc-100 pt-5">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <h4 className="text-sm font-semibold">Mật khẩu</h4>
                    <p className="mt-1 text-xs text-zinc-400">Đặt mật khẩu mới cho tài khoản này.</p>
                  </div>
                  {!resetting && (
                    <button
                      type="button"
                      onClick={() => setResetting(true)}
                      className="tf-button-secondary !min-h-9 !px-3 !py-1.5 text-xs"
                    >
                      <KeyRound size={14} aria-hidden="true" />
                      Thay đổi
                    </button>
                  )}
                </div>
                {resetting && (
                  <form action={formAction} className="mt-3 space-y-2">
                    <input type="hidden" name="userId" value={user.id} />
                    <input
                      name="password"
                      type="password"
                      required
                      minLength={6}
                      placeholder="Mật khẩu mới"
                      className="tf-field"
                      autoComplete="new-password"
                      autoFocus
                    />
                    <div className="flex gap-2">
                      <button
                        type="submit"
                        disabled={pending}
                        className="tf-button-primary"
                        aria-busy={pending}
                      >
                        {pending ? (
                          <span className="tf-spinner" aria-hidden="true" />
                        ) : (
                          <Save size={15} aria-hidden="true" />
                        )}
                        Lưu
                      </button>
                      <button
                        type="button"
                        onClick={() => setResetting(false)}
                        className="tf-button-secondary"
                      >
                        Hủy
                      </button>
                    </div>
                  </form>
                )}
                {state.error && <p className="mt-2 text-xs text-red-600">{state.error}</p>}
              </section>

              <section className="border-t border-zinc-100 pt-5">
                <h4 className="text-sm font-semibold">Trạng thái</h4>
                <div className="mt-3 flex items-center gap-2 rounded-[8px] bg-zinc-50 px-3 py-2.5">
                  <span
                    className={`h-2.5 w-2.5 rounded-full ${user.isActive ? "bg-brand-400" : "bg-zinc-300"}`}
                    aria-hidden="true"
                  />
                  <span className="text-sm font-medium">
                    {user.isActive ? "Đang hoạt động" : "Đã vô hiệu hóa"}
                  </span>
                </div>
              </section>
            </div>
          </aside>
        </div>
      )}
    </li>
  );
}
