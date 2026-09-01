export default function TrackIndexPage() {
  return (
    <main className="flex min-h-screen items-center justify-center p-8">
      <div className="max-w-sm text-center">
        <h1 className="text-xl font-semibold text-neutral-900">No order to track</h1>
        <p className="mt-2 text-neutral-500">
          Open the tracking link from your confirmation text, or the page you landed
          on right after paying.
        </p>
      </div>
    </main>
  );
}
