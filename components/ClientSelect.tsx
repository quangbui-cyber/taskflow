import { ChevronDown } from "lucide-react";

export type ClientOption = {
  id: string;
  name: string;
};

export default function ClientSelect({
  clients,
  defaultValue = "",
  className = "",
}: {
  clients: ClientOption[];
  defaultValue?: string;
  className?: string;
}) {
  return (
    <div className={`relative ${className}`}>
      <select
        name="clientId"
        defaultValue={defaultValue}
        className="tf-field min-w-0 appearance-none !pr-11"
      >
        <option value="">— Chưa chọn —</option>
        {clients.map((client) => (
          <option key={client.id} value={client.id}>
            {client.name}
          </option>
        ))}
      </select>
      <ChevronDown
        size={16}
        className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-zinc-500"
        aria-hidden="true"
      />
    </div>
  );
}
