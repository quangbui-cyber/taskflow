"use client";

import { useActionState, useEffect, useRef } from "react";
import { KeyRound, Save } from "lucide-react";
import {
  changeOwnPassword,
  updateOwnProfile,
  type ProfileState,
} from "@/app/actions/profile";
import AvatarUploader from "@/components/AvatarUploader";
import { useActionFeedback } from "@/components/InteractionProvider";
import { MIN_PASSWORD_LENGTH } from "@/lib/password";

function SubmitButton({
  pending,
  label,
  icon: Icon,
}: {
  pending: boolean;
  label: string;
  icon: typeof Save;
}) {
  return (
    <button
      type="submit"
      disabled={pending}
      aria-busy={pending}
      className="tf-button-primary"
    >
      {pending ? (
        <span className="tf-spinner" aria-hidden="true" />
      ) : (
        <Icon size={16} aria-hidden="true" />
      )}
      {pending ? "Đang lưu..." : label}
    </button>
  );
}

export function ProfileInfoForm({
  userId,
  name,
  avatarUrl,
}: {
  userId: string;
  name: string;
  avatarUrl: string | null;
}) {
  const [state, formAction, pending] = useActionState<ProfileState, FormData>(
    updateOwnProfile,
    {}
  );
  useActionFeedback(state);

  return (
    <section className="tf-panel overflow-hidden">
      <div className="border-b border-zinc-100 px-5 py-3">
        <h2 className="font-semibold">Thông tin cá nhân</h2>
      </div>
      <form action={formAction} className="space-y-4 p-5">
        <AvatarUploader id={userId} displayName={name} defaultValue={avatarUrl} />
        <label className="block">
          <span className="text-xs font-medium text-zinc-500">Tên</span>
          <input
            name="name"
            required
            maxLength={80}
            defaultValue={name}
            autoComplete="name"
            className="tf-field mt-1.5"
          />
        </label>
        {state.error && <p className="text-xs text-red-600">{state.error}</p>}
        <div className="flex justify-end">
          <SubmitButton pending={pending} label="Lưu thông tin" icon={Save} />
        </div>
      </form>
    </section>
  );
}

export function ProfilePasswordForm() {
  const formRef = useRef<HTMLFormElement>(null);
  const [state, formAction, pending] = useActionState<ProfileState, FormData>(
    changeOwnPassword,
    {}
  );
  useActionFeedback(state);

  useEffect(() => {
    if (state.success) formRef.current?.reset();
  }, [state.success]);

  return (
    <section className="tf-panel overflow-hidden">
      <div className="border-b border-zinc-100 px-5 py-3">
        <h2 className="font-semibold">Đổi mật khẩu</h2>
      </div>
      <form ref={formRef} action={formAction} className="space-y-4 p-5">
        <label className="block">
          <span className="text-xs font-medium text-zinc-500">
            Mật khẩu hiện tại
          </span>
          <input
            name="currentPassword"
            type="password"
            required
            autoComplete="current-password"
            className="tf-field mt-1.5"
          />
        </label>
        <label className="block">
          <span className="text-xs font-medium text-zinc-500">
            Mật khẩu mới (ít nhất {MIN_PASSWORD_LENGTH} ký tự)
          </span>
          <input
            name="newPassword"
            type="password"
            required
            minLength={MIN_PASSWORD_LENGTH}
            autoComplete="new-password"
            className="tf-field mt-1.5"
          />
        </label>
        <label className="block">
          <span className="text-xs font-medium text-zinc-500">
            Nhập lại mật khẩu mới
          </span>
          <input
            name="confirmPassword"
            type="password"
            required
            minLength={MIN_PASSWORD_LENGTH}
            autoComplete="new-password"
            className="tf-field mt-1.5"
          />
        </label>
        {state.error && <p className="text-xs text-red-600">{state.error}</p>}
        <div className="flex justify-end">
          <SubmitButton pending={pending} label="Đổi mật khẩu" icon={KeyRound} />
        </div>
      </form>
    </section>
  );
}
