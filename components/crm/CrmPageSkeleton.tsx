export default function CrmPageSkeleton() {
  return <div className="space-y-6 p-6" role="status" aria-label="Đang tải khách hàng">
    <div className="h-8 w-60 rounded-[8px] bg-zinc-100" />
    <div className="space-y-3">{Array.from({ length: 5 }, (_, i) => <div key={i} className="h-14 rounded-[8px] bg-zinc-100" />)}</div>
  </div>;
}
