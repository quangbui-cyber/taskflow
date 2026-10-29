import type { Metadata } from "next";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import Sidebar from "@/components/Sidebar";
import HubTabs from "@/components/HubTabs";
import SudokuGame from "@/components/sudoku/SudokuGame";

export const metadata: Metadata = {
  title: "Sudoku 9x9 · myCreative",
  description: "Góc giải trí Sudoku 9x9: giải một mình hoặc đua giải với đồng nghiệp",
};

export default async function SudokuPage({
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
      <Sidebar user={user} projects={sidebarProjects} activeSection="sudoku" />

      <main className="tf-main">
        <HubTabs section="sudoku" role={user.role} isHrManager={user.isHrManager} />
        <div className="tf-page">
          <SudokuGame initialRoomCode={room || null} />
        </div>
      </main>
    </div>
  );
}
