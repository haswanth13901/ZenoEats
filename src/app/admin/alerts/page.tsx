import { createServerSupabase } from "@/lib/supabase-server";
import { acknowledgeAlert } from "@/app/admin/actions";
import { ALERT_EXPLANATION, ALERT_LABEL, type AlertKind } from "@/lib/alerts";

export const dynamic = "force-dynamic";

interface AlertRow {
  id: string;
  kind: string;
  order_id: string | null;
  stripe_event_id: string | null;
  detail: Record<string, unknown>;
  acknowledged_at: string | null;
  created_at: string;
}

/**
 * Anomalies raised by the Stripe webhook. These are things the webhook
 * deliberately refused to act on — an order is never marked paid on a
 * mismatched amount — so nothing here is an emergency in the sense of money
 * having already moved wrongly. They are signals that something tried.
 */
export default async function AdminAlertsPage() {
  const supabase = await createServerSupabase();

  const { data, error } = await supabase
    .from("security_alerts")
    .select("id, kind, order_id, stripe_event_id, detail, acknowledged_at, created_at")
    .order("created_at", { ascending: false })
    .limit(100);

  if (error) {
    return (
      <p className="rounded-xl border border-red-200 bg-red-50 p-6 text-sm text-red-700">
        Could not load alerts. {error.message}
      </p>
    );
  }

  const alerts = (data ?? []) as AlertRow[];
  const open = alerts.filter((a) => !a.acknowledged_at);
  const closed = alerts.filter((a) => a.acknowledged_at);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold text-neutral-900">Security alerts</h1>
        <p className="mt-1 text-neutral-500">
          Raised by the payment webhook when something didn&apos;t add up. In every
          case the order was left unpaid — the webhook refuses rather than guesses.
        </p>
      </div>

      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-neutral-400">
          Open ({open.length})
        </h2>
        {open.length === 0 ? (
          <p className="rounded-xl border border-dashed border-neutral-300 p-8 text-center text-sm text-neutral-500">
            Nothing outstanding. This is the normal state.
          </p>
        ) : (
          <ul className="space-y-3">
            {open.map((alert) => (
              <li key={alert.id}>
                <AlertCard alert={alert} />
              </li>
            ))}
          </ul>
        )}
      </section>

      {closed.length > 0 && (
        <section>
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-neutral-400">
            Acknowledged ({closed.length})
          </h2>
          <ul className="divide-y divide-neutral-200 rounded-xl border border-neutral-200 bg-white text-sm">
            {closed.map((alert) => (
              <li
                key={alert.id}
                className="flex items-center justify-between px-4 py-3 text-neutral-500"
              >
                <span>{labelFor(alert.kind)}</span>
                <span className="text-xs">
                  {new Date(alert.created_at).toLocaleString()}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function labelFor(kind: string): string {
  return ALERT_LABEL[kind as AlertKind] ?? kind;
}

function AlertCard({ alert }: { alert: AlertRow }) {
  const explanation = ALERT_EXPLANATION[alert.kind as AlertKind];

  return (
    <div className="rounded-xl border border-red-200 bg-red-50 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="font-medium text-red-900">{labelFor(alert.kind)}</h3>
          <p className="mt-0.5 text-xs text-red-700">
            {new Date(alert.created_at).toLocaleString()}
            {alert.order_id ? ` · order #${alert.order_id.slice(0, 8)}` : ""}
          </p>
        </div>
        <form action={acknowledgeAlert}>
          <input type="hidden" name="id" value={alert.id} />
          <button className="rounded-lg border border-red-300 bg-white px-3 py-1.5 text-sm text-red-700 transition hover:bg-red-100">
            Acknowledge
          </button>
        </form>
      </div>

      {explanation && (
        <p className="mt-3 text-sm text-red-800">{explanation}</p>
      )}

      <dl className="mt-3 grid grid-cols-[auto,1fr] gap-x-4 gap-y-1 border-t border-red-200 pt-3 text-xs text-red-800">
        {alert.stripe_event_id && (
          <>
            <dt className="font-medium">Stripe event</dt>
            <dd className="font-mono">{alert.stripe_event_id}</dd>
          </>
        )}
        {Object.entries(alert.detail ?? {}).map(([key, value]) => (
          <div key={key} className="contents">
            <dt className="font-medium">{key.replace(/_/g, " ")}</dt>
            <dd className="font-mono break-all">{String(value)}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
