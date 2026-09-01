export default function Home() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 p-8 text-center">
      <h1 className="text-5xl font-bold text-brand">ZenoEats 🍽️</h1>
      <p className="max-w-md text-lg text-gray-600">
        Scan. Order. Pay. Track your delivery live — from our kitchen to your door.
      </p>
      <div className="flex gap-4">
        <a
          href="/admin"
          className="rounded-lg bg-brand px-6 py-3 font-medium text-white transition hover:bg-brand-dark"
        >
          Admin Dashboard
        </a>
        <a
          href="/driver"
          className="rounded-lg border border-brand px-6 py-3 font-medium text-brand transition hover:bg-orange-50"
        >
          Driver View
        </a>
      </div>
    </main>
  );
}
