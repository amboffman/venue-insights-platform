import Link from "next/link";

// Real 404s on purpose. An earlier draft caught unmatched URLs with a
// [...missing] route and 307'd them one level up the path tree — friendly
// for humans, but a textbook soft 404 for crawlers (every miss eventually
// resolved 200 at "/"), it hijacked well-known files like /robots.txt,
// and each redirect hop was a full dynamic render ending at the 6-query
// dashboard. This page keeps the "not a dead end" goal with links while
// telling crawlers the truth.
export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-[60vh] max-w-md flex-col items-start justify-center gap-3 p-6">
      <h1 className="text-base font-semibold">This page doesn&apos;t exist</h1>
      <p className="text-sm text-muted-foreground">
        The URL may be mistyped, or the page may have moved. Everything in the demo is reachable
        from these three:
      </p>
      <nav className="flex flex-col gap-1 text-sm">
        <Link className="underline underline-offset-4 hover:text-foreground" href="/">
          Dashboard — KPIs, revenue charts, top locations
        </Link>
        <Link className="underline underline-offset-4 hover:text-foreground" href="/chat">
          Chat — ask questions, get tool-grounded answers
        </Link>
        <Link className="underline underline-offset-4 hover:text-foreground" href="/observability">
          Observability — cost and latency per conversation
        </Link>
      </nav>
    </main>
  );
}
