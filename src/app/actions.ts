"use server";

import { ask } from "@/lib/ai/client";

export interface AskState {
  prompt: string;
  reply: string | null;
  error: string | null;
}

export async function askAction(_prev: AskState, formData: FormData): Promise<AskState> {
  const prompt = String(formData.get("prompt") ?? "").trim();
  if (!prompt) {
    return { prompt: "", reply: null, error: "Enter a prompt." };
  }
  try {
    const result = await ask(prompt);
    return { prompt, reply: result.text, error: null };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("askAction failed:", err);
    return { prompt, reply: null, error: message };
  }
}
