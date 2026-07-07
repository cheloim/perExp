import { useMemo, useRef, useState, useCallback, useEffect } from "react";
import { hierarchy, treemap, treemapSquarify } from "d3-hierarchy";
import { formatCurrency, getContrastTextColor } from "../utils/format";
import type { CategorySummary } from "../types";

interface TreemapDatum {
  name: string;
  color: string;
  total: number;
  count: number;
  category_id: number | null;
  children?: TreemapDatum[];
}

interface LayoutRect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  data: TreemapDatum;
  depth: number;
}

// d3 treemap layout adds x0/y0/x1/y1 to hierarchy nodes at runtime
type TreemapNode = ReturnType<typeof hierarchy<TreemapDatum>> & {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
};

interface CategoryTreemapProps {
  categories: CategorySummary[];
  selectedCategoryName: string | null;
  onSelect: (name: string | null) => void;
}

function buildHierarchy(categories: CategorySummary[]): TreemapDatum[] {
  const parentMap = new Map<string, TreemapDatum>();
  const result: TreemapDatum[] = [];

  for (const cat of categories) {
    if (cat.total <= 0) continue;

    if (cat.parent_name) {
      if (!parentMap.has(cat.parent_name)) {
        parentMap.set(cat.parent_name, {
          name: cat.parent_name,
          color: cat.parent_color ?? "#6b7280",
          total: 0,
          count: 0,
          category_id: null,
          children: [],
        });
      }
      const group = parentMap.get(cat.parent_name)!;
      group.total += cat.total;
      group.count += cat.count;
      group.children!.push({
        name: cat.category_name,
        color: cat.category_color,
        total: cat.total,
        count: cat.count,
        category_id: cat.category_id,
      });
    } else {
      result.push({
        name: cat.category_name,
        color: cat.category_color,
        total: cat.total,
        count: cat.count,
        category_id: cat.category_id,
      });
    }
  }

  for (const g of parentMap.values()) {
    g.total = 0;
    g.count = 0;
    g.children!.sort((a, b) => b.total - a.total);
    result.push(g);
  }

  return result.sort((a, b) => b.total - a.total);
}

function flattenLayout(node: TreemapNode): LayoutRect[] {
  const rects: LayoutRect[] = [];

  function walk(n: TreemapNode) {
    rects.push({
      x0: n.x0 ?? 0,
      y0: n.y0 ?? 0,
      x1: n.x1 ?? 0,
      y1: n.y1 ?? 0,
      data: n.data,
      depth: n.depth,
    });

    if (n.children) {
      for (const child of n.children) {
        walk(child as TreemapNode);
      }
    }
  }

  walk(node);
  return rects.filter((r) => r.depth > 0);
}

export default function CategoryTreemap({
  categories,
  selectedCategoryName,
  onSelect,
}: CategoryTreemapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [hovered, setHovered] = useState<string | null>(null);
  const [tooltip, setTooltip] = useState<{
    x: number;
    y: number;
    name: string;
    total: number;
    count: number;
    pct: number;
  } | null>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    let timeout: ReturnType<typeof setTimeout>;
    const ro = new ResizeObserver((entries) => {
      const { width, height } = entries[0].contentRect;
      clearTimeout(timeout);
      timeout = setTimeout(() => setSize({ width, height }), 100);
    });
    ro.observe(el);
    return () => {
      ro.disconnect();
      clearTimeout(timeout);
    };
  }, []);

  const data = useMemo(() => buildHierarchy(categories), [categories]);
  const grandTotal = useMemo(() => {
    function sumLeaves(items: TreemapDatum[]): number {
      return items.reduce((s, d) => {
        if (d.children && d.children.length > 0) return s + sumLeaves(d.children);
        return s + d.total;
      }, 0);
    }
    return sumLeaves(data);
  }, [data]);

  const rects = useMemo(() => {
    if (size.width === 0 || size.height === 0 || data.length === 0) return [];

    const rootData: TreemapDatum = {
      name: "root",
      color: "",
      total: 0,
      count: 0,
      category_id: null,
      children: data,
    };

    const root = hierarchy(rootData)
      .sum((d) => d.total)
      .sort((a, b) => (b.value ?? 0) - (a.value ?? 0));

    const treemapLayout = treemap<TreemapDatum>()
      .size([size.width, size.height])
      .paddingOuter(3)
      .paddingInner(2)
      .round(true)
      .tile(treemapSquarify);

    treemapLayout(root);

    return flattenLayout(root as TreemapNode);
  }, [data, size]);

  const leaves = useMemo(
    () => rects.filter((r) => r.depth === 2 || (r.depth === 1 && !r.data.children?.length)),
    [rects],
  );
  const parentGroups = useMemo(
    () => rects.filter((r) => r.data.children && r.data.children.length > 0),
    [rects],
  );

  const handleMouseMove = useCallback(
    (e: React.MouseEvent, name: string, total: number, count: number) => {
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return;
      setTooltip({
        x: e.clientX - rect.left,
        y: e.clientY - rect.top,
        name,
        total,
        count,
        pct: grandTotal > 0 ? (total / grandTotal) * 100 : 0,
      });
    },
    [grandTotal],
  );

  const handleMouseLeave = useCallback(() => {
    setHovered(null);
    setTooltip(null);
  }, []);

  const handleClick = useCallback(
    (name: string) => {
      onSelect(selectedCategoryName === name ? null : name);
    },
    [selectedCategoryName, onSelect],
  );

  if (data.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-[var(--text-secondary)] text-sm">
        Sin datos
      </div>
    );
  }

  return (
    <div ref={containerRef} className="relative w-full h-full min-h-[300px]">
      <svg width={size.width} height={size.height} className="block">
        <defs>
          {leaves.map((r) => {
            const clipId = `clip-${
              r.data.category_id ?? r.data.name.replace(/[^a-zA-Z0-9]/g, "-")
            }`;
            return (
              <clipPath key={clipId} id={clipId}>
                <rect x={r.x0} y={r.y0} width={r.x1 - r.x0} height={r.y1 - r.y0} rx={4} />
              </clipPath>
            );
          })}
        </defs>
        {/* Pass 1: Parent group borders (bottom layer) */}
        {parentGroups.map((r) => {
          const w = r.x1 - r.x0;
          const h = r.y1 - r.y0;
          if (w < 2 || h < 2) return null;

          const parentColor = r.data.color || "#6b7280";
          const isSelected = selectedCategoryName === r.data.name;
          const isHovered = hovered === r.data.name;
          const isFaded = selectedCategoryName !== null && !isSelected && !isHovered;

          return (
            <rect
              key={`parent-${r.data.name}`}
              x={r.x0}
              y={r.y0}
              width={w}
              height={h}
              rx={6}
              fill={parentColor}
              fillOpacity={isFaded ? 0.06 : 0.1}
              stroke={
                isSelected
                  ? parentColor
                  : isHovered
                  ? "rgba(255,255,255,0.2)"
                  : "rgba(255,255,255,0.08)"
              }
              strokeWidth={isSelected ? 2 : 1}
              className="cursor-pointer transition-all duration-200"
              onClick={() => handleClick(r.data.name)}
              onMouseEnter={() => setHovered(r.data.name)}
              onMouseLeave={handleMouseLeave}
            />
          );
        })}

        {/* Pass 2: Leaf cells (top layer) */}
        {leaves.map((r) => {
          const w = r.x1 - r.x0;
          const h = r.y1 - r.y0;
          if (w < 2 || h < 2) return null;

          const isSelected = selectedCategoryName === r.data.name;
          const isHovered = hovered === r.data.name;
          const isFaded = selectedCategoryName !== null && !isSelected && !isHovered;
          const textColor = getContrastTextColor(r.data.color);
          const showLabel = w >= 24 && h >= 12;
          const clipId = `clip-${r.data.category_id ?? r.data.name.replace(/[^a-zA-Z0-9]/g, "-")}`;
          const maxChars = Math.floor(w / 6);
          const amountStr = formatCurrency(r.data.total);

          return (
            <g
              key={`leaf-${r.data.name}`}
              role="button"
              tabIndex={0}
              aria-label={`${r.data.name}: ${formatCurrency(r.data.total)}`}
              onClick={() => handleClick(r.data.name)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  handleClick(r.data.name);
                }
              }}
            >
              <rect
                x={r.x0}
                y={r.y0}
                width={w}
                height={h}
                rx={4}
                fill={r.data.color}
                opacity={isFaded ? 0.3 : 1}
                stroke={isSelected ? "#fff" : isHovered ? "rgba(255,255,255,0.5)" : "transparent"}
                strokeWidth={isSelected ? 2 : 1}
                className="cursor-pointer transition-all duration-200"
                onMouseEnter={() => setHovered(r.data.name)}
                onMouseMove={(e) => handleMouseMove(e, r.data.name, r.data.total, r.data.count)}
                onMouseLeave={handleMouseLeave}
              />
              {showLabel && (
                <text
                  x={r.x0 + 6}
                  y={r.y0 + h / 2}
                  dy="0.35em"
                  fill={textColor}
                  fontSize={h > 40 ? 12 : 10}
                  fontWeight={600}
                  className="pointer-events-none select-none"
                  opacity={isFaded ? 0.3 : 1}
                  clipPath={`url(#${clipId})`}
                >
                  {r.data.name.length > maxChars
                    ? r.data.name.slice(0, maxChars) + "…"
                    : r.data.name}
                </text>
              )}
              {showLabel && h >= 26 && w >= 40 && (
                <text
                  x={r.x0 + 6}
                  y={r.y0 + h / 2 + 14}
                  fill={textColor}
                  fontSize={10}
                  fontWeight={400}
                  className="pointer-events-none select-none"
                  opacity={isFaded ? 0.3 : 0.8}
                  clipPath={`url(#${clipId})`}
                >
                  {amountStr.length > maxChars ? amountStr.slice(0, maxChars) + "…" : amountStr}
                </text>
              )}
            </g>
          );
        })}
      </svg>

      {tooltip && (
        <div
          className="absolute pointer-events-none z-50 px-3 py-2 rounded-lg bg-[var(--color-surface)] border border-[var(--border-color)] shadow-lg"
          style={{
            left: tooltip.x + 12,
            top: tooltip.y - 8,
            transform:
              `${tooltip.x > size.width * 0.7 ? "translateX(-110%)" : ""} ${
                tooltip.y > size.height * 0.8 ? "translateY(-100%)" : ""
              }`.trim() || undefined,
          }}
        >
          <p className="text-xs font-semibold text-[var(--text-primary)]">{tooltip.name}</p>
          <p className="text-xs text-[var(--text-secondary)]">
            {formatCurrency(tooltip.total)} · {tooltip.count}× · {tooltip.pct.toFixed(1)}%
          </p>
        </div>
      )}
    </div>
  );
}
