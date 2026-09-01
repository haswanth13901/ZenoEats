import Link from "next/link";
import SignOutButton from "@/components/SignOutButton";

/** Shown to a signed-in user who lacks the role a staff area requires. */
export default function NoAccess({
  title,
  body,
}: {
  title: string;
  body: string;
}) {
  return (
    <main className="flex min-h-screen items-center justify-center p-8">
      <div className="max-w-sm text-center">
        <h1 className="text-xl font-semibold text-neutral-900">{title}</h1>
        <p className="mt-2 text-neutral-500">{body}</p>
        <div className="mt-6 flex justify-center gap-3 text-sm">
          <Link
            href="/"
            className="rounded-lg border border-neutral-300 px-3 py-1.5 text-neutral-700 transition hover:bg-neutral-100"
          >
            Go home
          </Link>
          <SignOutButton />
        </div>
      </div>
    </main>
  );
}
