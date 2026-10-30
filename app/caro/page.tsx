import type { Metadata } from "next";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import Sidebar from "@/components/Sidebar";
import HubTabs from "@/components/HubTabs";
import CaroGame from "@/components/caro/CaroGame";

export const metadata: Metadata = {
  title: "Cờ Caro · myCreative",
  description: "Góc giải trí cờ Caro 15x15 xả stress, giao lưu và gắn kết đồng nghiệp",
};

export default async function CaroPage({
  searchParams,
}: {
  searchParams: Promise<{ room?: string }>;
}) {
  const user = await requireUser();
  const { room } = await searchParams;

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
      <Sidebar user={user} projects={sidebarProjects} activeSection="caro" />

      <main className="tf-main">
        <HubTabs section="caro" role={user.role} isHrManager={user.isHrManager} />
        <div className="tf-page">
          <CaroGame initialRoomCode={room || null} currentUserName={user.name || "Kỳ thủ"} />
        </div>
      </main>
    </div>
  );
}
