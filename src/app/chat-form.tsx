"use client";

import { useActionState } from "react";

import { askAction, type AskState } from "./actions";

const initialState: AskState = { prompt: "", reply: null, error: null };

export function ChatForm() {
  const [state, formAction, pending] = useActionState(askAction, initialState);

  return (
    <div className="flex flex-col gap-4">
      <form action={formAction} className="flex flex-col gap-3">
        <label htmlFor="prompt" className="text-sm font-medium">
          Prompt
        </label>
        <textarea
          id="prompt"
          name="prompt"
          rows={4}
          defaultValue={state.prompt}
          placeholder="Ask Claude something..."
          className="rounded border border-zinc-300 bg-transparent p-3 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-zinc-400 dark:border-zinc-700"
        />
        <button
          type="submit"
          disabled={pending}
          className="self-start rounded bg-black px-4 py-2 text-sm font-medium text-white disabled:opacity-50 dark:bg-white dark:text-black"
        >
          {pending ? "Asking..." : "Ask"}
        </button>
      </form>

      {state.error && (
        <div
          role="alert"
          className="rounded border border-red-400 bg-red-50 p-3 text-sm text-red-900 dark:bg-red-950 dark:text-red-100"
        >
          {state.error}
        </div>
      )}

      {state.reply && (
        <div className="rounded border border-zinc-300 p-4 text-sm whitespace-pre-wrap dark:border-zinc-700">
          {state.reply}
        </div>
      )}
    </div>
  );
}
