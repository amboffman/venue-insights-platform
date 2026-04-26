import Anthropic from "@anthropic-ai/sdk";
import { config } from "dotenv";

config({ path: ".env.local" });

const apiKey = process.env.ANTHROPIC_API_KEY;
if (!apiKey) {
  console.error("ANTHROPIC_API_KEY is not set. Check .env.local.");
  process.exit(1);
}

const client = new Anthropic({ apiKey });

async function main() {
  const response = await client.messages.create({
    model: "claude-haiku-4-5",
    max_tokens: 100,
    messages: [
      {
        role: "user",
        content: "Reply with exactly: 'Smoke test passed.'",
      },
    ],
  });

  console.log("--- Response ---");
  console.log(JSON.stringify(response, null, 2));

  const textBlock = response.content.find((block) => block.type === "text");
  if (!textBlock || textBlock.type !== "text") {
    console.error("No text block in response.");
    process.exit(1);
  }

  console.log("\n--- Reply text ---");
  console.log(textBlock.text);

  console.log("\n--- Token usage ---");
  console.log(`Input:  ${response.usage.input_tokens}`);
  console.log(`Output: ${response.usage.output_tokens}`);
}

main().catch((err) => {
  console.error("Smoke test failed:", err);
  process.exit(1);
});
