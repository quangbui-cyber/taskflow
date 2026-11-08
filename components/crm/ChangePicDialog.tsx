"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { changeClientPicOrTeamAction } from "@/app/actions/crmClients";
import { useInteraction } from "@/components/InteractionProvider";
import CrmDialog from "./CrmDialog";
import { useClientEditSession } from "./ClientEditSession";

export default function ChangePicDialog({ clientId, version, picAccountId, teamId, accounts, teams }: {
  clientId: string; version: number; picAccountId: string | null; teamId: string | null;
  accounts: { id: string; name: string }[]; teams: { id: string; name: string }[];
}) {
  const [draft, setDraft] = useState<{ pic: string; team: string; version: number } | null>(null);
  const [savedVersion, setSavedVersion] = useState(version);
  const [actionPending, startTransition] = useTransition();
  const session = useClientEditSession();
  const pending = actionPending || !!session?.busy;
  const router = useRouter(); const { notify } = useInteraction();
  return <>
    <button type="button" disabled={pending} className="tf-button-secondary" onClick={() => setDraft({ pic: picAccountId ?? "", team: teamId ?? "", version: Math.max(version, savedVersion, session?.version ?? 0) })}>Đổi PIC hoặc team</button>
    <CrmDialog open={!!draft} title="Đổi PIC hoặc team" pending={pending} onClose={() => setDraft(null)}>
      {draft && <form className="space-y-4" onSubmit={(event) => {
        event.preventDefault(); if (pending) return;
        session?.setBusy(true);
        startTransition(async () => {
          try {
            const result: { error?: string; success?: string; version?: number } = await changeClientPicOrTeamAction({ clientId, expectedVersion: draft.version, picAccountId: draft.pic, responsibleTeamId: draft.team || null });
            if (result.error) { notify({ message: result.error, tone: "error" }); return; }
            if (result.version !== undefined) { setSavedVersion(result.version); session?.saved(result.version); }
            notify({ message: result.success ?? "Đã đổi PIC hoặc team.", tone: "success" }); setDraft(null); router.refresh();
          } catch { notify({ message: "Không lưu được thay đổi. Vui lòng thử lại.", tone: "error" }); }
          finally { session?.setBusy(false); }
        });
      }}><fieldset disabled={pending} className="min-w-0 space-y-4">
        <label className="block text-sm">PIC<select required className="tf-field mt-2" value={draft.pic} onChange={(event) => setDraft({ ...draft, pic: event.target.value })}><option value="">Chọn PIC</option>{accounts.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}</select></label>
        <label className="block text-sm">Team phụ trách<select className="tf-field mt-2" value={draft.team} onChange={(event) => setDraft({ ...draft, team: event.target.value })}><option value="">Theo team của PIC</option>{teams.map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}</select></label>
        <div className="flex justify-end gap-2"><button type="button" className="tf-button-secondary" onClick={() => setDraft(null)}>Hủy</button><button className="tf-button-primary" type="submit" disabled={!draft.pic}>Lưu thay đổi</button></div>
      </fieldset></form>}
    </CrmDialog>
  </>;
}
