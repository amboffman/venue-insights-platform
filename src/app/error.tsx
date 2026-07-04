"use client";

// Root error boundary. Production builds mask server-side error messages
// behind a digest, which turns a missing env var into an inscrutable
// "ERROR 2201460989" — this at least says where to look. (Found the hard
// way: preview deployments without DATABASE_URL scoped to them.)

import { Button } from "@/components/ui/button";

export default function GlobalError({
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
        The database-backed pages need <code className="font-mono">DATABASE_URL</code> at request
        time. On a Vercel <em>preview</em> deployment, make sure the environment variables are
        scoped to the Preview environment too, then redeploy.
      </p>
      {error.digest && (
        <p className="text-xs text-muted-foreground">
          Digest <code className="font-mono">{error.digest}</code> — matches the server log entry in
          Vercel → Deployments → Functions.
        </p>
      )}
      <Button variant="outline" size="sm" onClick={reset}>
        Try again
      </Button>
    </main>
  );
}
