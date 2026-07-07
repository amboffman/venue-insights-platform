"use client";

// Catches errors thrown by the root layout itself (e.g. the font loaders),
// which error.tsx cannot — that boundary renders INSIDE the layout. Must
// supply its own <html>/<body> because the layout that normally provides
// them is the thing that failed. Kept dependency-free on purpose: anything
// imported here (styles, UI kit) becomes a way for this last resort to
// break too.
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body style={{ fontFamily: "system-ui, sans-serif", margin: "4rem auto", maxWidth: "28rem" }}>
        <h1 style={{ fontSize: "1rem" }}>Something went wrong loading the app</h1>
        <p style={{ fontSize: "0.875rem", color: "#666" }}>
          The application shell failed to render. The server log entry
          {error.digest ? ` for digest ${error.digest}` : ""} has the real error.
        </p>
        <button onClick={reset} style={{ fontSize: "0.875rem", padding: "0.25rem 0.75rem" }}>
          Try again
        </button>
      </body>
    </html>
  );
}
