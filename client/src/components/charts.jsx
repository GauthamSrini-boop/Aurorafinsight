import { useId, useState } from 'react';
import { donutSegments, linePath, niceMax, ticks } from '../lib/chart.js';

const W = 640;

/** Grouped bars, one pair (income / expense) per label. Values are minor units. */
export function BarChart({ data, format, height = 240, ariaLabel }) {
  const [hover, setHover] = useState(null);
  const pad = { l: 52, r: 8, t: 12, b: 28 };
  const max = niceMax(Math.max(0, ...data.flatMap((d) => [d.income ?? 0, d.expense ?? 0])));
  const ih = height - pad.t - pad.b; const iw = W - pad.l - pad.r;
  const slot = iw / Math.max(1, data.length);
  const bw = Math.min(16, slot / 3);
  const y = (v) => pad.t + ih - (v / max) * ih;
  const empty = data.every((d) => !d.income && !d.expense);
  return (
    <div className="chart">
      <svg viewBox={`0 0 ${W} ${height}`} role="img" aria-label={ariaLabel} preserveAspectRatio="xMidYMid meet">
        {ticks(max, 4).map((t) => (
          <g key={t}>
            <line x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} className="grid" />
            <text x={pad.l - 8} y={y(t) + 4} textAnchor="end" className="axis">{format(t, true)}</text>
          </g>
        ))}
        {data.map((d, i) => {
          const cx = pad.l + slot * i + slot / 2;
          return (
            <g key={d.label} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} onFocus={() => setHover(i)} onBlur={() => setHover(null)} tabIndex={0}
              aria-label={`${d.label}: income ${format(d.income ?? 0)}, expenses ${format(d.expense ?? 0)}`}>
              <rect x={cx - slot / 2} y={pad.t} width={slot} height={ih} fill="transparent" />
              {d.income > 0 && <rect x={cx - bw - 1} y={y(d.income)} width={bw} height={Math.max(2, pad.t + ih - y(d.income))} rx="3" className="bar-income" />}
              {d.expense > 0 && <rect x={cx + 1} y={y(d.expense)} width={bw} height={Math.max(2, pad.t + ih - y(d.expense))} rx="3" className="bar-expense" />}
              <text x={cx} y={height - 8} textAnchor="middle" className={`axis ${hover === i ? 'axis-on' : ''}`}>{d.label}</text>
            </g>
          );
        })}
      </svg>
      {hover !== null && (
        <div className="chart-tip" style={{ left: `clamp(80px, ${((pad.l + slot * hover + slot / 2) / W) * 100}%, calc(100% - 80px))` }}>
          <strong>{data[hover].full ?? data[hover].label}</strong>
          <span><i className="swatch bar-income" /> Income {format(data[hover].income ?? 0)}</span>
          <span><i className="swatch bar-expense" /> Expenses {format(data[hover].expense ?? 0)}</span>
        </div>
      )}
      {empty && <p className="chart-empty">No transactions in this period yet.</p>}
      <div className="legend"><span><i className="swatch bar-income" /> Income</span><span><i className="swatch bar-expense" /> Expenses</span></div>
    </div>
  );
}

/** Area + line of daily values (minor units); x labels are day numbers. */
export function AreaChart({ points, format, height = 220, ariaLabel }) {
  const gid = useId().replace(/:/g, '');
  const [hover, setHover] = useState(null);
  const pad = { l: 52, r: 10, t: 12, b: 26 };
  const max = niceMax(Math.max(0, ...points.map((p) => p.value)));
  const ih = height - pad.t - pad.b; const iw = W - pad.l - pad.r;
  const x = (i) => pad.l + (points.length > 1 ? (i / (points.length - 1)) * iw : iw / 2);
  const y = (v) => pad.t + ih - (v / max) * ih;
  const pts = points.map((p, i) => ({ x: x(i), y: y(p.value) }));
  const area = pts.length ? `${linePath(pts)} L${pts[pts.length - 1].x},${pad.t + ih} L${pts[0].x},${pad.t + ih} Z` : '';
  const step = Math.max(1, Math.ceil(points.length / 8));
  return (
    <div className="chart">
      <svg viewBox={`0 0 ${W} ${height}`} role="img" aria-label={ariaLabel}>
        <defs><linearGradient id={gid} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="var(--accent)" stopOpacity=".35" /><stop offset="1" stopColor="var(--accent)" stopOpacity="0" /></linearGradient></defs>
        {ticks(max, 4).map((t) => (
          <g key={t}><line x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} className="grid" /><text x={pad.l - 8} y={y(t) + 4} textAnchor="end" className="axis">{format(t, true)}</text></g>
        ))}
        {pts.length > 0 && <path d={area} fill={`url(#${gid})`} />}
        {pts.length > 0 && <path d={linePath(pts)} className="line" />}
        {points.map((p, i) => (
          <g key={p.label} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
            <rect x={x(i) - iw / points.length / 2} y={pad.t} width={iw / points.length} height={ih} fill="transparent" />
            {hover === i && <><line x1={x(i)} x2={x(i)} y1={pad.t} y2={pad.t + ih} className="grid" /><circle cx={x(i)} cy={y(p.value)} r="4.5" className="dot-on" /></>}
            {i % step === 0 && <text x={x(i)} y={height - 8} textAnchor="middle" className="axis">{p.label}</text>}
          </g>
        ))}
      </svg>
      {hover !== null && (
        <div className="chart-tip" style={{ left: `clamp(80px, ${(x(hover) / W) * 100}%, calc(100% - 80px))` }}>
          <strong>{points[hover].full ?? points[hover].label}</strong><span>{format(points[hover].value)}</span>
        </div>
      )}
    </div>
  );
}

/** Donut with centre label and a legend. items: { id, label, value, color } */
export function Donut({ items, format, centerLabel, centerValue, ariaLabel }) {
  const r = 70; const sw = 24;
  const segs = donutSegments(items, r);
  const total = items.reduce((a, i) => a + i.value, 0);
  return (
    <div className="donut-wrap">
      <svg viewBox="0 0 200 200" className="donut" role="img" aria-label={ariaLabel}>
        <circle cx="100" cy="100" r={r} fill="none" className="donut-track" strokeWidth={sw} />
        {segs.map((s) => (
          <circle key={s.id} cx="100" cy="100" r={r} fill="none" strokeWidth={sw} transform="rotate(-90 100 100)"
            strokeDasharray={`${Math.max(0, s.length - (segs.length > 1 ? 2 : 0))} ${s.circumference}`} strokeDashoffset={-s.offset}
            style={{ stroke: `var(--c-${s.color})` }}><title>{`${s.label}: ${format(s.value)} (${Math.round(s.share * 100)}%)`}</title></circle>
        ))}
        <text x="100" y="94" textAnchor="middle" className="donut-label">{centerLabel}</text>
        <text x="100" y="116" textAnchor="middle" className="donut-value">{centerValue}</text>
      </svg>
      <ul className="donut-legend">
        {items.map((i) => (
          <li key={i.id}>
            <span className="dot" style={{ background: `var(--c-${i.color})` }} aria-hidden="true" />
            <span className="legend-name">{i.label}</span>
            <span className="legend-val">{format(i.value)}</span>
            <span className="legend-pct">{total ? Math.round((i.value / total) * 100) : 0}%</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Circular progress for savings goals. */
export function Ring({ percent, size = 76, stroke = 8, children, tone = 'accent' }) {
  const r = (size - stroke) / 2; const c = 2 * Math.PI * r;
  const p = Math.max(0, Math.min(100, percent));
  return (
    <div className="ring" style={{ width: size, height: size }} role="img" aria-label={`${p}% complete`}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" className="ring-track" strokeWidth={stroke} />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" className={`ring-fill ring-${tone}`} strokeWidth={stroke} strokeLinecap="round"
          strokeDasharray={`${(p / 100) * c} ${c}`} transform={`rotate(-90 ${size / 2} ${size / 2})`} />
      </svg>
      <span className="ring-text">{children ?? `${p}%`}</span>
    </div>
  );
}
