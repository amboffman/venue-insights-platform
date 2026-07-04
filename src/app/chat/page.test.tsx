import { render, screen } from "@testing-library/react";
import { expect, test } from "vitest";

import ChatPage from "@/app/chat/page";

// Smoke test: proves the Vitest + React Testing Library + `@/` path-alias
// pipeline is wired. `getByRole` throws if the heading is absent, so this
// asserts the page renders a top-level heading without coupling to its copy.
// (Lives on /chat since the dashboard took over the homepage — the new "/"
// is an async server component with a db dependency, covered by the rollup
// + component tests instead.)
test("Chat page renders a top-level heading", () => {
  render(<ChatPage />);
  expect(screen.getByRole("heading", { level: 1 })).toBeDefined();
});
