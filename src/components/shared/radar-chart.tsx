// Pure-SVG radar chart for category scores (institutional, not gamified).
export interface RadarAxis {
  label: string;
  value: number; // 0..max
}

export function RadarChart({
  data,
  max = 10,
  size = 320,
}: {
  data: RadarAxis[];
  max?: number;
  size?: number;
}) {
  const cx = size / 2;
  const cy = size / 2;
  const r = size / 2 - 46; // leave room for labels
  const n = data.length;
  const levels = [0.25, 0.5, 0.75, 1];

  const angleOf = (i: number) => -Math.PI / 2 + (i * 2 * Math.PI) / n;
  const point = (i: number, radius: number) => {
    const a = angleOf(i);
    return [cx + radius * Math.cos(a), cy + radius * Math.sin(a)] as const;
  };

  const valuePoints = data
    .map((d, i) => point(i, (Math.max(0, Math.min(max, d.value)) / max) * r))
    .map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`)
    .join(" ");

  return (
    <svg viewBox={`0 0 ${size} ${size}`} className="w-full" role="img" aria-label="Score radar">
      {/* grid rings */}
      {levels.map((lvl) => (
        <polygon
          key={lvl}
          points={data
            .map((_, i) => point(i, r * lvl))
            .map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`)
            .join(" ")}
          fill="none"
          stroke="#E2DBCD"
          strokeWidth={1}
        />
      ))}

      {/* axes + labels */}
      {data.map((d, i) => {
        const [ex, ey] = point(i, r);
        const [lx, ly] = point(i, r + 16);
        const cos = Math.cos(angleOf(i));
        const anchor = Math.abs(cos) < 0.3 ? "middle" : cos > 0 ? "start" : "end";
        return (
          <g key={d.label}>
            <line x1={cx} y1={cy} x2={ex} y2={ey} stroke="#E2DBCD" strokeWidth={1} />
            <text
              x={lx}
              y={ly}
              textAnchor={anchor}
              dominantBaseline="middle"
              className="fill-ink-muted"
              style={{ fontSize: 9.5, letterSpacing: "0.02em" }}
            >
              {d.label}
            </text>
          </g>
        );
      })}

      {/* value polygon */}
      <polygon points={valuePoints} fill="rgba(194,161,78,0.18)" stroke="#C2A14E" strokeWidth={1.75} />
      {data.map((d, i) => {
        const [x, y] = point(i, (Math.max(0, Math.min(max, d.value)) / max) * r);
        return <circle key={i} cx={x} cy={y} r={2.5} fill="#9C7F36" />;
      })}
    </svg>
  );
}
