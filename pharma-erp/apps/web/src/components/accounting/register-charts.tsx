import type { RegisterSummary, RegisterTrendPoint } from '@pharma-erp/types';

/**
 * The two register charts, drawn as inline SVG.
 *
 * NO CHARTING LIBRARY, deliberately. `apps/web` depends on next, react and the
 * types package and nothing else; a bar chart of three values and a line of
 * one series per day do not justify adding a runtime dependency, a bundle and
 * a second set of theming rules to a project that has neither.
 *
 * EVERY CHART IS ALSO READABLE AS TEXT. Each value is labelled on the chart
 * itself, so the figures survive being printed, read by a screen reader, or
 * looked at by someone who cannot tell the two bar colours apart.
 */

function toNumber(value: string): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function money(value: number): string {
  return value.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/**
 * CGST / SGST / IGST as proportional bars.
 *
 * Where the source records no split — purchases — the caller passes
 * `splitRecorded={false}` and this says so instead of drawing three empty bars,
 * which would read as "no tax was charged" rather than "nobody wrote the split
 * down".
 */
export function TaxSummaryChart({
  summary,
  splitRecorded,
  title,
}: {
  summary: RegisterSummary;
  splitRecorded: boolean;
  title: string;
}) {
  const bars = splitRecorded
    ? [
        { label: 'CGST', value: toNumber(summary.cgst) },
        { label: 'SGST', value: toNumber(summary.sgst) },
        { label: 'IGST', value: toNumber(summary.igst) },
      ]
    : [
        { label: 'Taxable value', value: toNumber(summary.taxableValue) },
        { label: 'Total tax', value: toNumber(summary.totalTax) },
      ];

  const peak = Math.max(...bars.map((bar) => bar.value), 0);

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
      <h3 className="text-sm font-semibold text-slate-900">{title}</h3>

      {!splitRecorded && (
        <p className="mt-1 text-xs text-slate-500">
          Purchase invoices record one combined tax amount, so there is no CGST/SGST/IGST split to
          chart. Taxable value against tax is shown instead.
        </p>
      )}

      {peak === 0 ? (
        <p className="mt-6 text-sm text-slate-500">Nothing to chart for this period.</p>
      ) : (
        <ul className="mt-5 space-y-3">
          {bars.map((bar) => (
            <li key={bar.label}>
              <div className="flex items-baseline justify-between text-xs">
                <span className="font-medium text-slate-700">{bar.label}</span>
                <span className="tabular-nums text-slate-900">{money(bar.value)}</span>
              </div>
              <div className="mt-1 h-2.5 overflow-hidden rounded-full bg-slate-100">
                <div
                  className="h-full rounded-full bg-slate-900"
                  // Widths come from the data, so they cannot be a class.
                  style={{ width: `${peak === 0 ? 0 : (bar.value / peak) * 100}%` }}
                />
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/**
 * Invoice value per day over the period.
 *
 * A LINE, NOT BARS: the x-axis is time, and bars for thirty days of a month
 * would be two pixels wide each. Days with no invoices are absent from the
 * data rather than plotted as zero — see the service — so the line joins the
 * days that were traded on.
 */
export function ValueTrendChart({
  trend,
  title,
}: {
  trend: readonly RegisterTrendPoint[];
  title: string;
}) {
  const points = trend.map((point) => ({
    date: point.date,
    taxable: toNumber(point.taxableValue),
    total: toNumber(point.invoiceValue),
  }));

  const peak = Math.max(...points.map((point) => point.total), 0);

  // A single day cannot be a line. It is drawn as a dot at the midpoint so the
  // chart still shows the value rather than an empty box.
  const width = 720;
  const height = 200;
  const padding = { top: 12, right: 12, bottom: 28, left: 12 };

  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;

  const x = (index: number) =>
    points.length <= 1
      ? padding.left + plotWidth / 2
      : padding.left + (index / (points.length - 1)) * plotWidth;

  const y = (value: number) =>
    padding.top + (peak === 0 ? plotHeight : plotHeight - (value / peak) * plotHeight);

  const line = points.map((point, index) => `${x(index)},${y(point.total)}`).join(' ');

  const area = points.length
    ? `${padding.left},${padding.top + plotHeight} ${line} ${x(points.length - 1)},${
        padding.top + plotHeight
      }`
    : '';

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
        {points.length > 0 && (
          <p className="text-xs text-slate-500">
            {points.length} day{points.length === 1 ? '' : 's'} with invoices · peak {money(peak)}
          </p>
        )}
      </div>

      {points.length === 0 ? (
        <p className="mt-6 text-sm text-slate-500">Nothing to chart for this period.</p>
      ) : (
        <div className="mt-4 overflow-x-auto">
          <svg
            viewBox={`0 0 ${width} ${height}`}
            role="img"
            aria-label={`${title}. ${points
              .map((point) => `${point.date}: ${money(point.total)}`)
              .join('. ')}`}
            className="h-52 w-full min-w-[32rem]"
          >
            <polyline
              points={`${padding.left},${padding.top + plotHeight} ${width - padding.right},${
                padding.top + plotHeight
              }`}
              fill="none"
              stroke="#e2e8f0"
              strokeWidth={1}
            />

            {points.length > 1 && (
              <polygon points={area} fill="#0f172a" fillOpacity={0.06} stroke="none" />
            )}

            <polyline
              points={line}
              fill="none"
              stroke="#0f172a"
              strokeWidth={2}
              strokeLinejoin="round"
              strokeLinecap="round"
            />

            {points.map((point, index) => (
              <circle
                key={point.date}
                cx={x(index)}
                cy={y(point.total)}
                r={points.length > 40 ? 1.5 : 3}
                fill="#0f172a"
              >
                <title>{`${point.date}: ${money(point.total)}`}</title>
              </circle>
            ))}

            {/* Only the ends are labelled: thirty dates along a 720px axis
                would overlap into a grey smear. */}
            <text x={padding.left} y={height - 8} className="fill-slate-500 text-[11px]">
              {points[0]?.date}
            </text>
            {points.length > 1 && (
              <text
                x={width - padding.right}
                y={height - 8}
                textAnchor="end"
                className="fill-slate-500 text-[11px]"
              >
                {points[points.length - 1]?.date}
              </text>
            )}
          </svg>
        </div>
      )}
    </section>
  );
}
