import { render, screen } from "@testing-library/react";
import { expect, test } from "vitest";

import Home from "@/app/page";

// Smoke test: proves the Vitest + React Testing Library + `@/` path-alias
// pipeline is wired (note the `@/app/page` import, which only resolves if
// tsconfig path mapping works). `getByRole` throws if the heading is absent,
// so this asserts the page renders a top-level heading without coupling to its
// copy (which the chat UI slice will replace).
test("Home renders a top-level heading", () => {
  render(<Home />);
  expect(screen.getByRole("heading", { level: 1 })).toBeDefined();
});
