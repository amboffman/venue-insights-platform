import { Chat } from "@/components/chat/chat";

export default function Home() {
  return (
    <div className="flex h-dvh flex-col">
      <header className="border-b px-4 py-3">
        <div className="mx-auto flex w-full max-w-2xl items-baseline justify-between">
          <h1 className="text-base font-semibold tracking-tight">Venue Insights</h1>
          <p className="text-xs text-muted-foreground">
            5 brands · 50 locations · tool-grounded answers
          </p>
        </div>
      </header>
      <Chat />
    </div>
  );
}
