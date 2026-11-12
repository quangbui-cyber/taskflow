"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Star } from "lucide-react";
import CrmDialog from "./CrmDialog";
import { useInteraction } from "@/components/InteractionProvider";
import { saveProjectFeedbackAction } from "@/app/actions/crmClientHub";
import { CASE_STUDY_OPTIONS, FEEDBACK_NOTE_MAX, type CaseStudy } from "@/lib/crm/clientHubLabels";

type Feedback = { rating: number; note: string | null; caseStudy: string } | null;

export default function ProjectFeedbackDialog({ clientId, projectId, projectName, feedback }: { clientId: string; projectId: string; projectName: string; feedback: Feedback }) {
  const router = useRouter(); const { notify } = useInteraction();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [rating, setRating] = useState(feedback?.rating ?? 0);
  const [note, setNote] = useState(feedback?.note ?? "");
  const [caseStudy, setCaseStudy] = useState<CaseStudy>((feedback?.caseStudy as CaseStudy) ?? "NOT_ASKED");
  function show() { setRating(feedback?.rating ?? 0); setNote(feedback?.note ?? ""); setCaseStudy((feedback?.caseStudy as CaseStudy) ?? "NOT_ASKED"); setOpen(true); }
  function submit() {
    if (pending) return;
    if (!rating) { notify({ message: "Chọn mức đánh giá từ 1 đến 5.", tone: "error" }); return; }
    startTransition(async () => {
      try {
        const result = await saveProjectFeedbackAction({ clientId, projectId, rating, note: note.trim() || null, caseStudy });
        if ("error" in result && result.error) { notify({ message: result.error, tone: "error" }); return; }
        notify({ message: "Đã lưu đánh giá của khách.", tone: "success" }); setOpen(false); router.refresh();
      } catch { notify({ message: "Không lưu được thay đổi. Vui lòng thử lại.", tone: "error" }); }
    });
  }
  return <>
    <button type="button" className="text-xs font-medium text-zinc-500 underline-offset-2 hover:text-zinc-900 hover:underline" onClick={show} aria-label={`${feedback ? "Sửa" : "Ghi"} đánh giá ${projectName}`}>{feedback ? "Sửa" : "Ghi đánh giá"}</button>
    <CrmDialog open={open} title={`Đánh giá của khách · ${projectName}`} pending={pending} onClose={() => setOpen(false)}>
      <form className="space-y-4" onSubmit={(event) => { event.preventDefault(); submit(); }}><fieldset disabled={pending} className="min-w-0 space-y-4">
        <fieldset>
          <legend className="text-sm">Mức đánh giá</legend>
          <div className="mt-2 flex gap-1" role="radiogroup" aria-label="Mức đánh giá">
            {[1, 2, 3, 4, 5].map((value) => <button key={value} type="button" role="radio" aria-checked={rating === value} aria-label={`${value} sao`} onClick={() => setRating(value)} className="rounded-md p-1 transition-transform duration-150 hover:-translate-y-0.5 motion-reduce:transform-none">
              <Star size={22} aria-hidden="true" className={value <= rating ? "fill-brand-400 text-brand-500" : "text-zinc-300"} />
            </button>)}
          </div>
        </fieldset>
        <label className="block text-sm">Ghi chú (không ghi tên người đánh giá)<textarea className="tf-field mt-2 min-h-24" maxLength={FEEDBACK_NOTE_MAX} value={note} onChange={(event) => setNote(event.target.value)} /></label>
        <label className="block text-sm">Dùng làm case study<select className="tf-field mt-2" value={caseStudy} onChange={(event) => setCaseStudy(event.target.value as CaseStudy)}>{CASE_STUDY_OPTIONS.map((option) => <option key={option.key} value={option.key}>{option.label}</option>)}</select></label>
        <div className="flex justify-end gap-2"><button type="button" className="tf-button-secondary" onClick={() => setOpen(false)}>Hủy</button><button type="submit" className="tf-button-primary">Lưu</button></div>
      </fieldset></form>
    </CrmDialog>
  </>;
}
