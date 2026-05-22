import { ChatForm } from "./chat-form";

export default function Home() {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-8 px-6 py-16">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">Venue Insights</h1>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Tracer chat — ask Claude something.
        </p>
      </header>
      <ChatForm />
    </main>
  );
}
