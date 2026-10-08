import { UserRound } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import Sidebar from "@/components/Sidebar";
import { ProfileInfoForm, ProfilePasswordForm } from "@/components/ProfileForms";

const PROFILE_BLUE_DARK = "#1d4ed8";
const PROFILE_BLUE_SOFT = "#eff6ff";

export default async function ProfilePage() {
  const user = await requireUser();
  const sidebarProjects = await prisma.project.findMany({
    where: { members: { some: { userId: user.id } } },
    select: {
      id: true,
      name: true,
      color: true,
      status: true,
      category: true,
      responsibleTeam: { select: { id: true, name: true } },
      responsibleGroup: { select: { id: true, name: true } },
      account: { select: { team: { select: { id: true, name: true } } } },
    },
    orderBy: { createdAt: "desc" },
  });

  return (
    <div className="tf-shell">
      <Sidebar user={user} projects={sidebarProjects} activeSection="profile" />

      <main className="tf-main">
        <div className="tf-page-narrow space-y-6">
          <div>
            <div className="flex items-center gap-3">
              <span
                className="flex h-10 w-10 items-center justify-center rounded-[8px]"
                style={{
                  backgroundColor: PROFILE_BLUE_SOFT,
                  color: PROFILE_BLUE_DARK,
                }}
              >
                <UserRound size={20} aria-hidden="true" />
              </span>
              <h1
                className="tf-page-title"
                style={{ color: PROFILE_BLUE_DARK }}
              >
                Tài khoản của tôi
              </h1>
            </div>
            <p className="tf-page-subtitle">
              Email đăng nhập: {user.email}. Email và vai trò do Admin quản lý.
            </p>
          </div>

          {/* key theo dữ liệu đã lưu: sau khi lưu, form nhận lại giá trị mới từ server */}
          <ProfileInfoForm
            key={`${user.name}:${user.avatarUrl?.length ?? 0}:${user.avatarUrl?.slice(-24) ?? ""}`}
            userId={user.id}
            name={user.name}
            avatarUrl={user.avatarUrl ?? null}
          />
          <ProfilePasswordForm />
        </div>
      </main>
    </div>
  );
}
