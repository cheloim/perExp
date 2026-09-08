import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { ResponsiveContainer, PieChart, Pie, Cell, Tooltip } from "recharts";
import { getTags, createTag, updateTag, deleteTag, getTagSummary } from "../api/client";
import type { Tag } from "../types";
import { formatCurrency } from "../utils/format";
import { ConfirmDialog } from "../components/ConfirmDialog";

export default function TagsPage() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [newName, setNewName] = useState("");
  const [newColor, setNewColor] = useState("#3b82f6");
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editingName, setEditingName] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<Tag | null>(null);

  const { data: tags = [], isLoading } = useQuery({
    queryKey: ["tags"],
    queryFn: getTags,
  });

  const { data: tagSummary = [] } = useQuery({
    queryKey: ["tag-summary"],
    queryFn: getTagSummary,
    staleTime: 60_000,
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["tags"] });
    qc.invalidateQueries({ queryKey: ["tag-summary"] });
    qc.invalidateQueries({ queryKey: ["dashboard"] });
    qc.invalidateQueries({ queryKey: ["expenses"] });
  };

  const createMut = useMutation({
    mutationFn: (payload: { name: string; color: string }) => createTag(payload),
    onSuccess: () => {
      setNewName("");
      invalidate();
    },
  });

  const updateMut = useMutation({
    mutationFn: ({ id, data }: { id: number; data: { name?: string; color?: string } }) =>
      updateTag(id, data),
    onSuccess: () => {
      setEditingId(null);
      invalidate();
    },
  });

  const deleteMut = useMutation({
    mutationFn: deleteTag,
    onSuccess: () => {
      setDeleteTarget(null);
      invalidate();
    },
  });

  const handleCreate = () => {
    if (!newName.trim()) return;
    createMut.mutate({ name: newName.trim(), color: newColor });
  };

  const startEditing = (tag: Tag) => {
    setEditingId(tag.id);
    setEditingName(tag.name);
  };

  const saveName = (tag: Tag) => {
    const trimmed = editingName.trim();
    if (trimmed && trimmed !== tag.name) {
      updateMut.mutate({ id: tag.id, data: { name: trimmed } });
    } else {
      setEditingId(null);
    }
  };

  const saveColor = (tag: Tag, color: string) => {
    updateMut.mutate({ id: tag.id, data: { color } });
  };

  const totalByTag = tagSummary.reduce((s, t) => s + t.total_amount, 0);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h1 className="text-2xl font-semibold text-primary">Tags</h1>
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleCreate()}
            placeholder="Nuevo tag..."
            className="input text-sm w-40"
          />
          <div className="relative">
            <input
              type="color"
              value={newColor}
              onChange={(e) => setNewColor(e.target.value)}
              className="w-8 h-8 rounded-full cursor-pointer border-0 p-0 overflow-hidden bg-transparent"
            />
          </div>
          <button
            onClick={handleCreate}
            disabled={!newName.trim() || createMut.isPending}
            className="gnome-btn-primary-round text-sm"
          >
            + Crear tag
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="space-y-3">
          {isLoading ? (
            <div className="flex items-center justify-center h-40">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
            </div>
          ) : tags.length === 0 ? (
            <div className="card p-10 text-center">
              <p className="text-tertiary text-sm">No hay tags creados aún.</p>
            </div>
          ) : (
            tags.map((tag) => (
              <div
                key={tag.id}
                className="card p-4 flex items-center gap-3 hover:bg-base-alt transition-colors cursor-pointer group"
                onClick={() => navigate(`/expenses?tag_id=${tag.id}`)}
              >
                <input
                  type="color"
                  value={tag.color}
                  onChange={(e) => {
                    e.stopPropagation();
                    saveColor(tag, e.target.value);
                  }}
                  onClick={(e) => e.stopPropagation()}
                  className="w-6 h-6 rounded-full cursor-pointer border-0 p-0 overflow-hidden bg-transparent flex-shrink-0"
                />
                <div className="flex-1 min-w-0">
                  {editingId === tag.id ? (
                    <input
                      type="text"
                      value={editingName}
                      onChange={(e) => setEditingName(e.target.value)}
                      onBlur={() => saveName(tag)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") saveName(tag);
                        if (e.key === "Escape") setEditingId(null);
                      }}
                      onClick={(e) => e.stopPropagation()}
                      autoFocus
                      className="input text-sm py-0.5 px-1"
                    />
                  ) : (
                    <span
                      className="text-sm font-medium text-primary cursor-text"
                      onClick={(e) => {
                        e.stopPropagation();
                        startEditing(tag);
                      }}
                    >
                      {tag.name}
                    </span>
                  )}
                </div>
                <span className="text-xs text-tertiary flex-shrink-0">
                  {tag.expense_count ?? 0} gasto{(tag.expense_count ?? 0) !== 1 ? "s" : ""}
                </span>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setDeleteTarget(tag);
                  }}
                  className="text-tertiary hover:text-danger text-xs p-1.5 transition-colors rounded opacity-0 group-hover:opacity-100 flex-shrink-0"
                >
                  ✕
                </button>
              </div>
            ))
          )}
        </div>

        <div className="card p-4">
          <h2 className="text-sm font-semibold text-primary mb-3">Gastos por Tag</h2>
          {tagSummary.length === 0 ? (
            <div className="flex items-center justify-center h-40">
              <p className="text-tertiary text-sm">Sin datos de gastos por tag</p>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-4">
              <ResponsiveContainer width="100%" height={220}>
                <PieChart>
                  <Pie
                    data={tagSummary.map((t) => ({
                      name: t.tag_name,
                      value: t.total_amount,
                      color: t.tag_color,
                      tag_id: t.tag_id,
                    }))}
                    dataKey="value"
                    nameKey="name"
                    cx="50%"
                    cy="50%"
                    innerRadius={45}
                    outerRadius={85}
                    paddingAngle={1}
                    onClick={(entry) => {
                      if (entry.tag_id != null) {
                        navigate(`/expenses?tag_id=${entry.tag_id}`);
                      } else {
                        navigate("/expenses?untagged=1");
                      }
                    }}
                    style={{ cursor: "pointer" }}
                  >
                    {tagSummary.map((t, i) => (
                      <Cell key={i} fill={t.tag_color} />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={{
                      backgroundColor: "var(--chart-tooltip-bg)",
                      borderColor: "var(--chart-tooltip-border)",
                      color: "var(--chart-tooltip-text)",
                      borderRadius: 10,
                      fontSize: 12,
                      padding: "8px 12px",
                      boxShadow: "var(--shadow-md)",
                    }}
                    formatter={(v: number, name: string) => {
                      const pct = totalByTag > 0 ? ((v / totalByTag) * 100).toFixed(1) : "0";
                      return [`${formatCurrency(v)} (${pct}%)`, name];
                    }}
                  />
                </PieChart>
              </ResponsiveContainer>
              <div className="w-full space-y-2">
                {tagSummary.map((t, i) => (
                  <div
                    key={i}
                    className="flex items-center justify-between text-xs cursor-pointer hover:bg-base-alt rounded px-2 py-1.5 transition-colors"
                    onClick={() => {
                      if (t.tag_id != null) {
                        navigate(`/expenses?tag_id=${t.tag_id}`);
                      } else {
                        navigate("/expenses?untagged=1");
                      }
                    }}
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <span
                        className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                        style={{ backgroundColor: t.tag_color }}
                      />
                      <span className="text-secondary font-medium truncate">{t.tag_name}</span>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0 ml-2">
                      <span className="text-tertiary">{t.count}x</span>
                      <span className="font-semibold text-primary">
                        {formatCurrency(t.total_amount)}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {deleteTarget && (
        <ConfirmDialog
          isOpen={true}
          title="Eliminar tag"
          message={`¿Eliminar "${deleteTarget.name}"? Los gastos perderán esta etiqueta.`}
          confirmLabel="Eliminar"
          onConfirm={() => deleteMut.mutate(deleteTarget.id)}
          onCancel={() => setDeleteTarget(null)}
        />
      )}
    </div>
  );
}
