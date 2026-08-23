import { Inbox } from "lucide-react";

export function EmptyState({ title, description }: { title: string; description: string }) {
  return <div className="empty-state"><Inbox size={30} /><h2>{title}</h2><p>{description}</p></div>;
}
