import { useState, useMemo, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { ResponsiveContainer, PieChart, Pie, Cell, Tooltip } from "recharts";
import {
  getCategories,
  createCategory,
  updateCategory,
  deleteCategory,
  getTags,
  createTag,
  updateTag,
  deleteTag,
  getTagSummary,
  getExpenses,
  recategorizeExpenses,
  applyBaseHierarchy,
  getCards,
  getAccounts,
} from "../api/client";
import type { Category, Tag, Card, Account } from "../types";
import { Select } from "../components/ui/Select";
import { formatCurrency, toUpperCase, formatDateDMY } from "../utils/format";
import { ConfirmDialog } from "../components/ConfirmDialog";

const COLORS = [
  "#ef4444",
  "#f97316",
  "#eab308",
  "#22c55e",
  "#14b8a6",
  "#3b82f6",
  "#8b5cf6",
  "#ec4899",
  "#64748b",
  "#78716c",
];

const GROUP_LABELS: Record<string, string> = {
  tarjeta: "\uD83D\uDCB3 Tarjetas",
  cuenta: "\uD83C\uDFE6 Cuentas",
  otros: "Otros",
};

const GROUP_OPTIONS = [
  { value: "tarjeta", label: "\uD83D\uDCB3 Tarjeta" },
  { value: "cuenta", label: "\uD83C\uDFE6 Cuenta" },
  { value: "otros", label: "Otros" },
];

type SectionKey = "tarjeta" | "cuenta" | "otros";

interface CategoryFormProps {
  initial?: Category;
  isParentForm: boolean;
  parentCategories: Category[];
  onClose: () => void;
  onSave: (data: Omit<Category, "id">) => void;
  isSaving?: boolean;
}

function CategoryForm({
  initial,
  isParentForm,
  parentCategories,
  onClose,
  onSave,
  isSaving = false,
}: CategoryFormProps) {
  const [form, setForm] = useState<Omit<Category, "id">>(
    initial
      ? {
          name: initial.name,
          color: initial.color,
          keywords: initial.keywords,
          parent_id: initial.parent_id ?? null,
        }
      : {
          name: "",
          color: "#3b82f6",
          keywords: "",
          parent_id: isParentForm ? null : (parentCategories[0]?.id ?? null),
        },
  );

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4 animate-modal-backdrop">
      <div className="card w-full max-w-md animate-modal-content">
        <div className="flex items-center justify-between px-6 py-4 border-b border-border-color">
          <h2 className="text-base font-semibold text-primary">
            {initial ? "Editar" : isParentForm ? "Nueva Categoría Padre" : "Nueva Subcategoría"}
          </h2>
          <button
            onClick={onClose}
            className="text-tertiary hover:text-primary text-xl leading-none"
          >
            ×
          </button>
        </div>
        <div className="px-6 py-4 space-y-4">
          {!isParentForm && (
            <div>
              <label className="block text-xs font-medium text-tertiary mb-1.5">
                Categoría padre
              </label>
              <Select
                value={form.parent_id?.toString() ?? ""}
                onChange={(value) =>
                  setForm((p) => ({
                    ...p,
                    parent_id: value ? parseInt(value) : null,
                  }))
                }
                options={[
                  { value: "", label: "— Sin padre (independiente) —" },
                  ...parentCategories.map((p) => ({
                    value: p.id.toString(),
                    label: p.name,
                  })),
                ]}
                placeholder="Seleccionar categoría padre"
              />
            </div>
          )}

          {isParentForm && (
            <div className="flex items-center gap-2 text-xs text-warning bg-warning/10 border border-warning/20 rounded-lg px-3 py-2">
              <span>ℹ</span>
              <span>
                Las categorías padre son agrupadores. Los gastos se asignan a las subcategorías, no
                a las padres.
              </span>
            </div>
          )}

          <div>
            <label className="block text-xs font-medium text-tertiary mb-1.5">Nombre</label>
            <input
              type="text"
              value={form.name}
              onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
              placeholder={isParentForm ? "Ej: Alimentación" : "Ej: Supermercado"}
              className="input placeholder:text-tertiary"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-tertiary mb-1.5">Color</label>
            <div className="flex flex-wrap gap-2">
              {COLORS.map((c) => (
                <button
                  key={c}
                  onClick={() => setForm((p) => ({ ...p, color: c }))}
                  className={`w-7 h-7 rounded-full transition-transform ${
                    form.color === c
                      ? "scale-125 ring-2 ring-offset-2 ring-offset-surface ring-primary"
                      : ""
                  }`}
                  style={{ backgroundColor: c }}
                />
              ))}
              <input
                type="color"
                value={form.color}
                onChange={(e) => setForm((p) => ({ ...p, color: e.target.value }))}
                className="w-7 h-7 rounded-full cursor-pointer border-0 p-0 overflow-hidden bg-transparent"
                title="Color personalizado"
              />
            </div>
          </div>

          {!isParentForm && (
            <div>
              <label className="block text-xs font-medium text-tertiary mb-1.5">
                Palabras clave (separadas por coma)
              </label>
              <textarea
                value={form.keywords}
                onChange={(e) => setForm((p) => ({ ...p, keywords: e.target.value }))}
                rows={3}
                placeholder="Ej: coto, carrefour, dia, supermercado"
                className="input placeholder:text-tertiary"
              />
              <p className="text-xs text-tertiary mt-1">
                Se usan para categorizar automáticamente los gastos importados.
              </p>
            </div>
          )}
        </div>
        <div className="flex justify-end gap-2 px-6 py-4 border-t border-border-color">
          <button onClick={onClose} className="gnome-btn-secondary">
            Cancelar
          </button>
          <button
            onClick={() => onSave({ ...form, keywords: isParentForm ? "" : form.keywords })}
            disabled={!form.name || isSaving}
            className="gnome-btn-primary"
          >
            {isSaving ? "Guardando..." : "Guardar"}
          </button>
        </div>
      </div>
    </div>
  );
}

function CategoryDetail({ cat, onClose }: { cat: Category; onClose: () => void }) {
  const { data: expenses = [], isLoading } = useQuery({
    queryKey: ["expenses", "category", cat.id],
    queryFn: () => getExpenses({ category_id: cat.id, limit: 200 }),
  });
  const total = expenses.reduce((s, e) => s + e.amount, 0);

  return (
    <div className="fixed inset-0 bg-black/40 flex items-end sm:items-center justify-center z-50 p-0 sm:p-4 animate-modal-backdrop">
      <div className="card w-full sm:max-w-2xl flex flex-col max-h-[90vh] animate-modal-content">
        <div className="flex items-center gap-3 px-5 py-4 border-b border-border-color flex-shrink-0">
          <span
            className="w-4 h-4 rounded-full flex-shrink-0"
            style={{ backgroundColor: cat.color }}
          />
          <h2 className="text-base font-semibold text-primary flex-1">{cat.name}</h2>
          <span className="text-sm text-secondary">{expenses.length} gastos</span>
          <button
            onClick={onClose}
            className="text-tertiary hover:text-primary text-xl ml-2 leading-none"
          >
            ×
          </button>
        </div>
        {!isLoading && expenses.length > 0 && (
          <div className="px-5 py-3 bg-base-alt border-b border-border-color flex-shrink-0 flex gap-6 text-sm">
            <div>
              <span className="text-tertiary">Total: </span>
              <span className="font-semibold text-primary">{formatCurrency(total)}</span>
            </div>
            <div>
              <span className="text-tertiary">Promedio: </span>
              <span className="font-semibold text-primary">
                {formatCurrency(expenses.length > 0 ? total / expenses.length : 0)}
              </span>
            </div>
          </div>
        )}
        <div className="overflow-y-auto flex-1">
          {isLoading ? (
            <div className="flex items-center justify-center py-16">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
            </div>
          ) : expenses.length === 0 ? (
            <p className="text-center text-tertiary py-16 text-sm">
              No hay gastos en esta categoría
            </p>
          ) : (
            <div className="divide-y divide-border-color">
              {expenses.map((exp) => (
                <div
                  key={exp.id}
                  className="flex items-center justify-between px-5 py-3 hover:bg-base-alt/50"
                >
                  <div>
                    <p className="text-sm font-medium text-primary">
                      {toUpperCase(exp.description)}
                      {exp.installment_number && exp.installment_total && (
                        <span className="ml-1.5 text-xs bg-primary-subtle text-primary px-1.5 py-0.5 rounded">
                          {exp.installment_number}/{exp.installment_total}
                        </span>
                      )}
                    </p>
                    <p className="text-xs text-tertiary mt-0.5">
                      {formatDateDMY(exp.date)}
                      {exp.bank && ` · ${exp.bank}`}
                      {exp.person && ` · ${exp.person}`}
                    </p>
                  </div>
                  <span
                    className={`text-sm font-semibold ml-4 whitespace-nowrap ${
                      exp.amount < 0 ? "text-success" : "text-primary"
                    }`}
                  >
                    {formatCurrency(exp.amount)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="px-5 py-3 border-t border-border-color flex-shrink-0 flex justify-end">
          <button onClick={onClose} className="gnome-btn-secondary">
            Cerrar
          </button>
        </div>
      </div>
    </div>
  );
}

function TagRow({
  tag,
  cards,
  accounts,
  onEdit,
  onDelete,
  onMoveGroup,
}: {
  tag: Tag;
  cards: Card[];
  accounts: Account[];
  onEdit: () => void;
  onDelete: () => void;
  onMoveGroup: (group: string) => void;
}) {
  const linkedCard = tag.card_id ? cards.find((c) => c.id === tag.card_id) : null;
  const linkedAccount = tag.account_id ? accounts.find((a) => a.id === tag.account_id) : null;

  return (
    <div className="card p-4 flex items-center gap-3 hover:bg-base-alt transition-colors group">
      <span className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: tag.color }} />
      <div className="flex-1 min-w-0">
        <span className="text-sm font-medium text-primary">{tag.name}</span>
        <div className="flex items-center gap-2 mt-0.5">
          {linkedCard ? (
            <span className="text-xs text-secondary">
              💳 {linkedCard.card_name}
              {linkedCard.bank ? ` · ${linkedCard.bank}` : ""}
            </span>
          ) : linkedAccount ? (
            <span className="text-xs text-secondary">🏦 {linkedAccount.name}</span>
          ) : tag.group_name === "tarjeta" || tag.group_name === "cuenta" ? (
            <span className="text-xs text-tertiary italic">sin vínculo</span>
          ) : null}
          {tag.expense_count !== undefined && tag.expense_count > 0 && (
            <span className="text-xs text-tertiary">
              {tag.expense_count} gasto{tag.expense_count !== 1 ? "s" : ""}
            </span>
          )}
        </div>
      </div>
      <div className="flex items-center gap-1 flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
        <Select
          value={tag.group_name || "otros"}
          onChange={onMoveGroup}
          options={GROUP_OPTIONS}
          className="w-28"
        />
        <button
          onClick={onEdit}
          className="text-tertiary hover:text-primary text-xs p-1.5 transition-colors rounded"
        >
          ✏
        </button>
        <button
          onClick={onDelete}
          className="text-tertiary hover:text-danger text-xs p-1.5 transition-colors rounded"
        >
          ✕
        </button>
      </div>
    </div>
  );
}

type CatTab = "parents" | "subcategories";

export default function ClasificacionPage() {
  const qc = useQueryClient();
  const navigate = useNavigate();

  const [catTab, setCatTab] = useState<CatTab>("parents");
  const [editing, setEditing] = useState<{ cat: Category | null; isParent: boolean } | undefined>(
    undefined,
  );
  const [browsing, setBrowsing] = useState<Category | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<Category | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");

  const [newTagName, setNewTagName] = useState("");
  const [newTagColor, setNewTagColor] = useState("#3b82f6");
  const [newTagGroup, setNewTagGroup] = useState<SectionKey>("otros");
  const [editingTagId, setEditingTagId] = useState<number | null>(null);
  const [editingTagName, setEditingTagName] = useState("");
  const [deleteTagTarget, setDeleteTagTarget] = useState<Tag | null>(null);

  useEffect(() => {
    if (successMsg) {
      const t = setTimeout(() => setSuccessMsg(null), 4000);
      return () => clearTimeout(t);
    }
  }, [successMsg]);

  const { data: categories = [], isLoading } = useQuery({
    queryKey: ["categories"],
    queryFn: getCategories,
  });

  const { data: allExpenses = [] } = useQuery({
    queryKey: ["expenses"],
    queryFn: () => getExpenses({ limit: 500 }),
  });

  const { data: tags = [], isLoading: tagsLoading } = useQuery({
    queryKey: ["tags"],
    queryFn: getTags,
  });

  const { data: tagSummary = [] } = useQuery({
    queryKey: ["tag-summary"],
    queryFn: getTagSummary,
    staleTime: 60_000,
  });

  const { data: cards = [] } = useQuery({
    queryKey: ["cards"],
    queryFn: getCards,
  });

  const { data: accounts = [] } = useQuery({
    queryKey: ["accounts"],
    queryFn: getAccounts,
  });

  const countMap = useMemo(
    () =>
      allExpenses.reduce<Record<number, number>>((acc, e) => {
        if (e.category_id != null) acc[e.category_id] = (acc[e.category_id] ?? 0) + 1;
        return acc;
      }, {}),
    [allExpenses],
  );

  const childParentIds = new Set(categories.filter((c) => c.parent_id).map((c) => c.parent_id!));
  const parentCats = categories.filter((c) => !c.parent_id);
  const standaloneLeaves = categories.filter((c) => !c.parent_id && !childParentIds.has(c.id));
  const childCats = categories.filter((c) => !!c.parent_id);
  const hasHierarchy = parentCats.length > 0;

  const filteredParentCats = useMemo(
    () =>
      parentCats.filter(
        (c) => !searchQuery || c.name.toLowerCase().includes(searchQuery.toLowerCase()),
      ),
    [parentCats, searchQuery],
  );
  const filteredChildCats = useMemo(
    () =>
      childCats.filter(
        (c) => !searchQuery || c.name.toLowerCase().includes(searchQuery.toLowerCase()),
      ),
    [childCats, searchQuery],
  );

  const nonCategoriaTags = useMemo(() => tags.filter((t) => t.group_name !== "categoria"), [tags]);

  const tagsByGroup = useMemo(() => {
    const groups: Record<SectionKey, Tag[]> = { tarjeta: [], cuenta: [], otros: [] };
    for (const tag of nonCategoriaTags) {
      const key: SectionKey =
        tag.group_name === "tarjeta" ? "tarjeta" : tag.group_name === "cuenta" ? "cuenta" : "otros";
      groups[key].push(tag);
    }
    return groups;
  }, [nonCategoriaTags]);

  const tagSummaryFiltered = useMemo(
    () => tagSummary.filter((t) => t.group_name !== "categoria"),
    [tagSummary],
  );

  const totalByTag = tagSummaryFiltered.reduce((s, t) => s + t.total_amount, 0);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["categories"] });
    qc.invalidateQueries({ queryKey: ["dashboard"] });
    qc.invalidateQueries({ queryKey: ["expenses"] });
  };

  const invalidateTags = () => {
    qc.invalidateQueries({ queryKey: ["tags"] });
    qc.invalidateQueries({ queryKey: ["tag-summary"] });
    qc.invalidateQueries({ queryKey: ["dashboard"] });
    qc.invalidateQueries({ queryKey: ["expenses"] });
  };

  const createCatMut = useMutation({
    mutationFn: createCategory,
    onSuccess: () => {
      invalidate();
      setEditing(undefined);
      setSuccessMsg("Categoría creada");
    },
  });
  const updateCatMut = useMutation({
    mutationFn: ({ id, data }: { id: number; data: Omit<Category, "id"> }) =>
      updateCategory(id, data),
    onSuccess: () => {
      invalidate();
      setEditing(undefined);
      setSuccessMsg("Categoría actualizada");
    },
  });
  const deleteCatMut = useMutation({
    mutationFn: deleteCategory,
    onSuccess: () => {
      invalidate();
      setDeleteError(null);
    },
    onError: (err: { response?: { data?: { detail?: string } } }) =>
      setDeleteError(err?.response?.data?.detail ?? "Error al eliminar"),
  });

  const [recatResult, setRecatResult] = useState<{
    updated: number;
    total: number;
  } | null>(null);
  const recatMut = useMutation({
    mutationFn: (only: boolean) => recategorizeExpenses(only),
    onSuccess: (data) => {
      setRecatResult(data);
      invalidate();
    },
  });

  const [hierarchyResult, setHierarchyResult] = useState<{
    created: number;
    updated: number;
  } | null>(null);
  const hierarchyMut = useMutation({
    mutationFn: applyBaseHierarchy,
    onSuccess: (data) => {
      setHierarchyResult(data);
      invalidate();
    },
  });

  const createTagMut = useMutation({
    mutationFn: (payload: { name: string; color: string; group_name: string }) =>
      createTag(payload),
    onSuccess: () => {
      setNewTagName("");
      invalidateTags();
      setSuccessMsg("Tag creado");
    },
  });

  const updateTagMut = useMutation({
    mutationFn: ({
      id,
      data,
    }: {
      id: number;
      data: {
        name?: string;
        color?: string;
        group_name?: string;
        card_id?: number | null;
        account_id?: number | null;
      };
    }) => updateTag(id, data),
    onSuccess: () => {
      setEditingTagId(null);
      invalidateTags();
    },
  });

  const deleteTagMut = useMutation({
    mutationFn: deleteTag,
    onSuccess: () => {
      setDeleteTagTarget(null);
      invalidateTags();
    },
  });

  const handleSaveCat = (data: Omit<Category, "id">) => {
    if (editing?.cat?.id) {
      updateCatMut.mutate({ id: editing.cat.id, data });
    } else {
      createCatMut.mutate(data);
    }
  };

  const handleCreateTag = () => {
    if (!newTagName.trim()) return;
    createTagMut.mutate({
      name: newTagName.trim(),
      color: newTagColor,
      group_name: newTagGroup,
    });
  };

  const startEditingTag = (tag: Tag) => {
    setEditingTagId(tag.id);
    setEditingTagName(tag.name);
  };

  const saveTagName = (tag: Tag) => {
    const trimmed = editingTagName.trim();
    if (trimmed && trimmed !== tag.name) {
      updateTagMut.mutate({ id: tag.id, data: { name: trimmed } });
    } else {
      setEditingTagId(null);
    }
  };

  const saveTagColor = (tag: Tag, color: string) => {
    updateTagMut.mutate({ id: tag.id, data: { color } });
  };

  const moveTagGroup = (tag: Tag, group: string) => {
    updateTagMut.mutate({
      id: tag.id,
      data: {
        group_name: group,
        card_id: group === "tarjeta" ? tag.card_id : null,
        account_id: group === "cuenta" ? tag.account_id : null,
      },
    });
  };

  function SubCatRow({ cat }: { cat: Category }) {
    const count = countMap[cat.id] ?? 0;
    const parent = categories.find((c) => c.id === cat.parent_id);
    return (
      <div className="card p-4 flex items-start gap-3 hover:bg-base-alt transition-colors group">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span
              className="w-2.5 h-2.5 rounded-full flex-shrink-0"
              style={{ backgroundColor: cat.color }}
            />
            <button
              onClick={() => setBrowsing(cat)}
              className="text-sm font-semibold text-primary hover:text-primary/80 transition-colors truncate text-left"
            >
              {cat.name}
            </button>
            {count > 0 && (
              <span className="text-xs text-tertiary flex-shrink-0">{count} gastos</span>
            )}
          </div>
          {parent && (
            <div className="flex items-center gap-1 ml-4">
              <span
                className="w-1.5 h-1.5 rounded-full"
                style={{ backgroundColor: parent.color }}
              />
              <span className="text-[11px] text-tertiary">{parent.name}</span>
            </div>
          )}
          {cat.keywords && (
            <p className="text-xs text-secondary truncate ml-4 mt-1" title={cat.keywords}>
              {cat.keywords
                .split(",")
                .slice(0, 4)
                .map((k) => k.trim())
                .filter(Boolean)
                .join(" · ")}
              {cat.keywords.split(",").length > 4 ? " · …" : ""}
            </p>
          )}
        </div>
        <div className="flex gap-1 flex-shrink-0">
          <button
            onClick={() => setEditing({ cat, isParent: false })}
            className="text-tertiary hover:text-primary text-xs p-1.5 transition-colors rounded"
          >
            ✏
          </button>
          <button
            onClick={() => {
              setDeleteConfirm(cat);
            }}
            className="text-tertiary hover:text-danger text-xs p-1.5 transition-colors rounded"
          >
            ✕
          </button>
        </div>
      </div>
    );
  }

  function ParentCard({ cat }: { cat: Category }) {
    const children = categories.filter((c) => c.parent_id === cat.id);
    const totalCount = children.reduce((s, c) => s + (countMap[c.id] ?? 0), 0);

    return (
      <div className="card overflow-hidden">
        <div className="flex items-center gap-2 sm:gap-3 px-3 sm:px-4 py-2.5 sm:py-3 border-b border-border-color/60">
          <span
            className="w-3 h-3 rounded-full flex-shrink-0"
            style={{ backgroundColor: cat.color }}
          />
          <span className="font-semibold text-primary text-sm flex-1 min-w-0 truncate">
            {cat.name}
          </span>
          {totalCount > 0 && (
            <span className="text-xs text-tertiary flex-shrink-0">{totalCount} gastos</span>
          )}
          <div className="flex gap-0.5 sm:gap-1 flex-shrink-0">
            <button
              onClick={() => setEditing({ cat, isParent: true })}
              className="text-tertiary hover:text-primary text-xs p-1.5 transition-colors rounded"
            >
              ✏
            </button>
            <button
              onClick={() => {
                setDeleteConfirm(cat);
              }}
              className="text-tertiary hover:text-danger text-xs p-1.5 transition-colors rounded"
            >
              ✕
            </button>
          </div>
        </div>

        {children.length > 0 ? (
          <div className="divide-y divide-border-color/40">
            {children.map((child) => {
              const count = countMap[child.id] ?? 0;
              return (
                <div
                  key={child.id}
                  className="flex items-center gap-2.5 px-4 py-2.5 hover:bg-base-alt/30 group"
                >
                  <span
                    className="w-2 h-2 rounded-full flex-shrink-0"
                    style={{ backgroundColor: child.color }}
                  />
                  <button
                    onClick={() => setBrowsing(child)}
                    className="text-sm text-secondary hover:text-primary flex-1 text-left truncate"
                  >
                    {child.name}
                  </button>
                  {count > 0 && (
                    <span className="text-xs text-secondary flex-shrink-0">{count}</span>
                  )}
                  {child.keywords && (
                    <span className="text-[11px] text-secondary truncate hidden sm:block max-w-[160px]">
                      {child.keywords
                        .split(",")
                        .slice(0, 3)
                        .map((k) => k.trim())
                        .join(", ")}
                      …
                    </span>
                  )}
                  <div className="flex gap-1 md:opacity-0 md:group-hover:opacity-100 transition-opacity flex-shrink-0">
                    <button
                      onClick={() => setEditing({ cat: child, isParent: false })}
                      className="text-tertiary hover:text-primary text-xs p-1 rounded"
                    >
                      ✏
                    </button>
                    <button
                      onClick={() => {
                        setDeleteConfirm(child);
                      }}
                      className="text-tertiary hover:text-danger text-xs p-1 rounded"
                    >
                      ✕
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <p className="text-xs text-secondary px-4 py-3">Sin subcategorías aún</p>
        )}

        <div className="px-4 py-2 border-t border-border-color/40">
          <button
            onClick={() =>
              setEditing({
                cat: {
                  id: 0,
                  name: "",
                  color: cat.color,
                  keywords: "",
                  parent_id: cat.id,
                },
                isParent: false,
              })
            }
            className="text-xs text-tertiary hover:text-primary transition-colors"
          >
            + Agregar subcategoría
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {successMsg && (
        <div className="px-4 py-2 rounded-lg bg-success/20 text-success text-sm font-medium animate-pulse">
          {successMsg}
        </div>
      )}

      <h1 className="text-2xl font-semibold text-primary">Clasificación</h1>

      {/* Section A — Categorías */}
      <section className="space-y-4">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <h2 className="text-lg font-semibold text-primary">Categorías</h2>
          <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={() => {
                setRecatResult(null);
                recatMut.mutate(true);
              }}
              disabled={recatMut.isPending}
              className="gnome-btn-secondary-round text-sm"
            >
              {recatMut.isPending ? "Recategorizando..." : "↺ Recategorizar sin categoría"}
            </button>
            {recatResult && (
              <span className="text-xs text-tertiary">
                {recatResult.updated} actualizados de {recatResult.total}
              </span>
            )}
          </div>
        </div>

        <p className="text-xs text-tertiary">
          Las categorías se asignan automáticamente a los gastos.
        </p>

        {!hasHierarchy && !hierarchyResult && (
          <div className="card p-4 border border-warning/20 bg-warning/5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm font-medium text-warning">Configurar estructura base</p>
              <p className="text-xs text-tertiary mt-0.5">
                Crea una jerarquía recomendada: Alimentación, Transporte, Entretenimiento, Salud,
                Hogar y más, con sus subcategorías y palabras clave ya configuradas.
              </p>
            </div>
            <button
              onClick={() => hierarchyMut.mutate()}
              disabled={hierarchyMut.isPending}
              className="gnome-btn-primary-round flex-shrink-0 whitespace-nowrap"
            >
              {hierarchyMut.isPending ? "Aplicando..." : "Aplicar estructura base"}
            </button>
          </div>
        )}
        {hierarchyResult && (
          <div className="card p-3 border border-success/20 bg-success/5">
            <p className="text-sm text-success">
              Estructura aplicada: {hierarchyResult.created} categorías creadas,{" "}
              {hierarchyResult.updated} actualizadas.
            </p>
          </div>
        )}

        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex gap-1 p-1 bg-[var(--color-base-alt)] rounded-lg w-fit">
            {(
              [
                {
                  key: "parents",
                  label: "Categorías Padre",
                  count: parentCats.length,
                },
                {
                  key: "subcategories",
                  label: "Subcategorías",
                  count: childCats.length + standaloneLeaves.length,
                },
              ] as { key: CatTab; label: string; count: number }[]
            ).map((t) => (
              <button
                key={t.key}
                onClick={() => setCatTab(t.key)}
                className={`px-4 py-2 text-sm font-medium rounded-md transition-all ${
                  catTab === t.key
                    ? "bg-[var(--color-surface)] text-[var(--text-primary)] shadow-sm"
                    : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                }`}
              >
                {t.label}
                <span
                  className={`ml-2 text-xs px-1.5 py-0.5 rounded-full ${
                    catTab === t.key
                      ? "bg-primary-subtle text-[var(--color-primary)]"
                      : "bg-[var(--color-base)] text-[var(--text-tertiary)]"
                  }`}
                >
                  {t.count}
                </span>
              </button>
            ))}
          </div>
          <div className="flex gap-2">
            {catTab === "parents" && (
              <button
                onClick={() => setEditing({ cat: null, isParent: true })}
                className="gnome-btn-primary-round text-sm"
              >
                + Categoría padre
              </button>
            )}
            {catTab === "subcategories" && (
              <button
                onClick={() => setEditing({ cat: null, isParent: false })}
                className="gnome-btn-primary-round text-sm"
              >
                + Subcategoría
              </button>
            )}
          </div>
        </div>

        <div className="relative">
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Buscar categoría..."
            className="w-full px-4 py-2 pl-9 text-sm rounded-lg border border-[var(--border-color)] bg-[var(--color-base-container)] text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition"
          />
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-tertiary)]">
            🔍
          </span>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center h-40">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
          </div>
        ) : catTab === "parents" ? (
          <div className="space-y-4">
            {parentCats.length === 0 ? (
              <div className="card p-10 text-center">
                <p className="text-tertiary text-sm">No hay categorías padre aún.</p>
                <p className="text-tertiary text-xs mt-1">
                  Aplicá la estructura base o creá una manualmente.
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                {filteredParentCats.map((cat) => (
                  <ParentCard key={cat.id} cat={cat} />
                ))}
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-6">
            {filteredParentCats.map((parent) => {
              const children = filteredChildCats.filter((c) => c.parent_id === parent.id);
              if (children.length === 0) return null;
              return (
                <div key={parent.id} className="space-y-2">
                  <div className="flex items-center gap-2">
                    <span
                      className="w-2.5 h-2.5 rounded-full"
                      style={{ backgroundColor: parent.color }}
                    />
                    <h3 className="text-xs font-semibold text-tertiary uppercase tracking-wider">
                      {parent.name}
                    </h3>
                    <span className="text-xs text-secondary">{children.length}</span>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                    {children.map((cat) => (
                      <SubCatRow key={cat.id} cat={cat} />
                    ))}
                  </div>
                </div>
              );
            })}

            {standaloneLeaves.length > 0 && (
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <h3 className="text-xs font-semibold text-secondary uppercase tracking-wider">
                    Sin categoría padre
                  </h3>
                  <span className="text-xs text-secondary">{standaloneLeaves.length}</span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  {standaloneLeaves.map((cat) => (
                    <SubCatRow key={cat.id} cat={cat} />
                  ))}
                </div>
              </div>
            )}

            {childCats.length === 0 && standaloneLeaves.length === 0 && (
              <div className="card p-10 text-center">
                <p className="text-tertiary text-sm">No hay subcategorías aún.</p>
              </div>
            )}
          </div>
        )}
      </section>

      {/* Sections B/C/D — Tags grouped */}
      <section className="space-y-4">
        <h2 className="text-lg font-semibold text-primary">Tags</h2>

        {/* Create tag form */}
        <div className="card p-4">
          <div className="flex items-end gap-2 flex-wrap">
            <div className="flex-1 min-w-[140px]">
              <label className="block text-xs font-medium text-tertiary mb-1">Nombre</label>
              <input
                type="text"
                value={newTagName}
                onChange={(e) => setNewTagName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleCreateTag()}
                placeholder="Nuevo tag..."
                className="input text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-tertiary mb-1">Color</label>
              <input
                type="color"
                value={newTagColor}
                onChange={(e) => setNewTagColor(e.target.value)}
                className="w-8 h-8 rounded-full cursor-pointer border-0 p-0 overflow-hidden bg-transparent"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-tertiary mb-1">Grupo</label>
              <Select
                value={newTagGroup}
                onChange={(v) => setNewTagGroup(v as SectionKey)}
                options={GROUP_OPTIONS}
                className="w-32"
              />
            </div>
            <button
              onClick={handleCreateTag}
              disabled={!newTagName.trim() || createTagMut.isPending}
              className="gnome-btn-primary-round text-sm"
            >
              + Crear tag
            </button>
          </div>
        </div>

        {/* Donut chart */}
        {tagSummaryFiltered.length > 0 && (
          <div className="card p-4">
            <h3 className="text-sm font-semibold text-primary mb-3">Gastos por Tag</h3>
            <div className="flex flex-col items-center gap-4">
              <ResponsiveContainer width="100%" height={220}>
                <PieChart>
                  <Pie
                    data={tagSummaryFiltered.map((t) => ({
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
                    {tagSummaryFiltered.map((t, i) => (
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
                {tagSummaryFiltered.map((t, i) => (
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
          </div>
        )}

        {/* Tag sections */}
        {(["tarjeta", "cuenta", "otros"] as SectionKey[]).map((section) => (
          <div key={section} className="space-y-2">
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-semibold text-secondary">{GROUP_LABELS[section]}</h3>
              <span className="text-xs text-tertiary">{tagsByGroup[section].length}</span>
            </div>
            {tagsLoading ? (
              <div className="flex items-center justify-center h-20">
                <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary" />
              </div>
            ) : tagsByGroup[section].length === 0 ? (
              <div className="card p-4 text-center">
                <p className="text-tertiary text-xs">No hay tags en esta sección.</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {tagsByGroup[section].map((tag) => (
                  <TagRow
                    key={tag.id}
                    tag={tag}
                    cards={cards}
                    accounts={accounts}
                    onEdit={() => startEditingTag(tag)}
                    onDelete={() => setDeleteTagTarget(tag)}
                    onMoveGroup={(group) => moveTagGroup(tag, group)}
                  />
                ))}
              </div>
            )}
          </div>
        ))}
      </section>

      {/* Modals */}
      {editing !== undefined && (
        <CategoryForm
          initial={editing.cat || undefined}
          isParentForm={editing.isParent}
          parentCategories={parentCats}
          onClose={() => setEditing(undefined)}
          onSave={handleSaveCat}
          isSaving={createCatMut.isPending || updateCatMut.isPending}
        />
      )}

      {browsing && <CategoryDetail cat={browsing} onClose={() => setBrowsing(null)} />}

      {deleteConfirm && (
        <ConfirmDialog
          isOpen={true}
          title="Eliminar categoría"
          message={`¿Eliminar "${deleteConfirm.name}"? Esta acción no se puede deshacer.`}
          confirmLabel="Eliminar"
          onConfirm={() => {
            deleteCatMut.mutate(deleteConfirm.id);
            setDeleteConfirm(null);
          }}
          onCancel={() => setDeleteConfirm(null)}
        />
      )}

      {deleteError && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 flex items-start gap-2 bg-danger/10 border border-danger/30 rounded-lg px-4 py-3 text-sm text-danger shadow-lg">
          <span>{deleteError}</span>
          <button onClick={() => setDeleteError(null)} className="ml-2 hover:opacity-70">
            ✕
          </button>
        </div>
      )}

      {editingTagId !== null && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4 animate-modal-backdrop">
          <div className="card w-full max-w-sm animate-modal-content">
            <div className="flex items-center justify-between px-6 py-4 border-b border-border-color">
              <h2 className="text-base font-semibold text-primary">Editar tag</h2>
              <button
                onClick={() => setEditingTagId(null)}
                className="text-tertiary hover:text-primary text-xl leading-none"
              >
                ×
              </button>
            </div>
            <div className="px-6 py-4 space-y-4">
              <div>
                <label className="block text-xs font-medium text-tertiary mb-1.5">Nombre</label>
                <input
                  type="text"
                  value={editingTagName}
                  onChange={(e) => setEditingTagName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      const tag = nonCategoriaTags.find((t) => t.id === editingTagId);
                      if (tag) saveTagName(tag);
                    }
                    if (e.key === "Escape") setEditingTagId(null);
                  }}
                  autoFocus
                  className="input text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-tertiary mb-1.5">Color</label>
                <div className="flex flex-wrap gap-2">
                  {COLORS.map((c) => (
                    <button
                      key={c}
                      onClick={() => {
                        const tag = nonCategoriaTags.find((t) => t.id === editingTagId);
                        if (tag) saveTagColor(tag, c);
                      }}
                      className="w-7 h-7 rounded-full transition-transform hover:scale-110"
                      style={{ backgroundColor: c }}
                    />
                  ))}
                  <input
                    type="color"
                    value={nonCategoriaTags.find((t) => t.id === editingTagId)?.color || "#3b82f6"}
                    onChange={(e) => {
                      const tag = nonCategoriaTags.find((t) => t.id === editingTagId);
                      if (tag) saveTagColor(tag, e.target.value);
                    }}
                    className="w-7 h-7 rounded-full cursor-pointer border-0 p-0 overflow-hidden bg-transparent"
                  />
                </div>
              </div>
            </div>
            <div className="flex justify-end gap-2 px-6 py-4 border-t border-border-color">
              <button onClick={() => setEditingTagId(null)} className="gnome-btn-secondary">
                Cancelar
              </button>
              <button
                onClick={() => {
                  const tag = nonCategoriaTags.find((t) => t.id === editingTagId);
                  if (tag) saveTagName(tag);
                }}
                disabled={!editingTagName.trim() || updateTagMut.isPending}
                className="gnome-btn-primary"
              >
                {updateTagMut.isPending ? "Guardando..." : "Guardar"}
              </button>
            </div>
          </div>
        </div>
      )}

      {deleteTagTarget && (
        <ConfirmDialog
          isOpen={true}
          title="Eliminar tag"
          message={`¿Eliminar "${deleteTagTarget.name}"? Los gastos perderán esta etiqueta.`}
          confirmLabel="Eliminar"
          onConfirm={() => deleteTagMut.mutate(deleteTagTarget.id)}
          onCancel={() => setDeleteTagTarget(null)}
        />
      )}
    </div>
  );
}
