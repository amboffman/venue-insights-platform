import Link from "next/link";

import { Chat } from "@/components/chat/chat";

export default function Home() {
  return (
    <div className="flex h-dvh flex-col">
      <header className="border-b px-4 py-3">
        <div className="mx-auto flex w-full max-w-2xl items-baseline justify-between">
          <h1 className="text-base font-semibold tracking-tight">Venue Insights</h1>
          <nav className="flex items-baseline gap-3 text-xs">
            <span className="hidden text-muted-foreground sm:inline">
              5 brands · 50 locations · tool-grounded answers
            </span>
            <Link className="text-muted-foreground hover:text-foreground" href="/dashboard">
              Dashboard
            </Link>
            <Link className="text-muted-foreground hover:text-foreground" href="/observability">
              Observability
            </Link>
          </nav>
        </div>
      </header>
      <main className="flex min-h-0 flex-1 flex-col">
        <Chat />
      </main>
    </div>
  );
}
