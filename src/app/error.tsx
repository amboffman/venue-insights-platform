"use client";

// Root error boundary. Production builds mask server-side error messages
// behind a digest, which turns any server failure into an inscrutable
// "ERROR 2201460989" — the digest→log pointer below is the authoritative
// trail. One likely cause is named as a hint, not THE cause: this boundary
// also catches pooler drops, query timeouts, and anything else page
// rendering throws, and blaming them all on env vars misdirects debugging.

import { Button } from "@/components/ui/button";

export default function RootError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main className="mx-auto flex min-h-[60vh] max-w-md flex-col items-start justify-center gap-3 p-6">
      <h1 className="text-base font-semibold">Something went wrong rendering this page</h1>
      <p className="text-sm text-muted-foreground">
        {error.digest ? (
          <>
            The digest below matches a server log entry — that entry has the real error. In Vercel:
            Deployments → Functions.
          </>
        ) : (
          <>Check the terminal running the dev server for the real error.</>
        )}
      </p>
      <p className="text-sm text-muted-foreground">
        Common cause on a fresh deploy: <code className="font-mono">DATABASE_URL</code> not scoped
        to this environment (Preview deployments need it too). A transient database hiccup looks
        identical from here — &ldquo;Try again&rdquo; often just works.
      </p>
      {error.digest && (
        <p className="text-xs text-muted-foreground">
          Digest <code className="font-mono">{error.digest}</code>
        </p>
      )}
      <Button variant="outline" size="sm" onClick={reset}>
        Try again
      </Button>
    </main>
  );
}
