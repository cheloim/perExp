import { useState, useMemo, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  getCategories,
  createCategory,
  updateCategory,
  deleteCategory,
  getTags,
  createTag,
  updateTag,
  deleteTag,
  getExpenses,
  recategorizeExpenses,
  applyBaseHierarchy,
  getCards,
  getAccounts,
} from "../api/client";
import type { Category, Tag } from "../types";
import { Select } from "../components/ui/Select";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { TAG_PALETTE } from "../utils/palette";

function CategoryForm({
  initial,
  parentCategories,
  onClose,
  onSave,
  isSaving,
}: {
  initial?: Category;
  parentCategories: Category[];
  onClose: () => void;
  onSave: (data: Omit<Category, "id">) => void;
  isSaving?: boolean;
}) {
  const [form, setForm] = useState<Omit<Category, "id">>(
    initial
      ? {
          name: initial.name,
          color: initial.color,
          keywords: initial.keywords,
          parent_id: initial.parent_id ?? null,
        }
      : { name: "", color: "#3b82f6", keywords: "", parent_id: parentCategories[0]?.id ?? null },
  );

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4 animate-modal-backdrop">
      <div className="card w-full max-w-md animate-modal-content">
        <div className="flex items-center justify-between px-6 py-4 border-b border-border-color">
          <h2 className="text-base font-semibold text-primary">
            {initial ? "Editar categoría" : "Nueva categoría"}
          </h2>
          <button
            onClick={onClose}
            className="text-tertiary hover:text-primary text-xl leading-none"
          >
            ×
          </button>
        </div>
        <div className="px-6 py-4 space-y-4">
          <div>
            <label className="block text-xs font-medium text-tertiary mb-1.5">
              Categoría padre
            </label>
            <Select
              value={form.parent_id?.toString() ?? ""}
              onChange={(v) => setForm((p) => ({ ...p, parent_id: v ? parseInt(v) : null }))}
              options={[
                { value: "", label: "— Sin padre —" },
                ...parentCategories.map((p) => ({ value: p.id.toString(), label: p.name })),
              ]}
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-tertiary mb-1.5">Nombre</label>
            <input
              type="text"
              value={form.name}
              onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
              className="input"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-tertiary mb-1.5">Color</label>
            <div className="flex flex-wrap gap-2">
              {TAG_PALETTE.map((c) => (
                <button
                  key={c}
                  onClick={() => setForm((p) => ({ ...p, color: c }))}
                  className={`w-7 h-7 rounded-full ${form.color === c ? "scale-125 ring-2 ring-offset-2 ring-offset-surface ring-primary" : ""}`}
                  style={{ backgroundColor: c }}
                />
              ))}
              <input
                type="color"
                value={form.color}
                onChange={(e) => setForm((p) => ({ ...p, color: e.target.value }))}
                className="w-7 h-7 rounded-full cursor-pointer border-0 p-0 bg-transparent"
              />
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-tertiary mb-1.5">
              Palabras clave (separadas por coma)
            </label>
            <textarea
              value={form.keywords}
              onChange={(e) => setForm((p) => ({ ...p, keywords: e.target.value }))}
              rows={3}
              placeholder="coto, carrefour, dia"
              className="input"
            />
          </div>
        </div>
        <div className="flex justify-end gap-2 px-6 py-4 border-t border-border-color">
          <button onClick={onClose} className="gnome-btn-secondary-round text-sm">
            Cancelar
          </button>
          <button
            onClick={() => onSave(form)}
            disabled={!form.name || isSaving}
            className="gnome-btn-primary-round text-sm"
          >
            {isSaving ? "Guardando..." : "Guardar"}
          </button>
        </div>
      </div>
    </div>
  );
}

function TagSection({
  title,
  tags,
  countMap,
  cards,
  accounts,
  linkType,
  onColorChange,
  onDelete,
  onLink,
}: {
  title: string;
  tags: Tag[];
  countMap: Record<number, number>;
  cards: { id: number; card_name: string; bank: string }[];
  accounts: { id: number; name: string }[];
  linkType: "card" | "account" | null;
  onColorChange: (tag: Tag, color: string) => void;
  onDelete: (tag: Tag) => void;
  onLink: (tag: Tag, id: number) => void;
}) {
  const [linkingId, setLinkingId] = useState<number | null>(null);

  const resolveLinkType = (tag: Tag): "card" | "account" | null => {
    if (linkType !== null) return linkType;
    if (tag.card_id !== null && tag.card_id !== undefined) return "card";
    if (tag.account_id !== null && tag.account_id !== undefined) return "account";
    return "card";
  };

  return (
    <section className="card">
      <div className="px-5 py-4 border-b border-border-color">
        <h2 className="text-lg font-semibold text-primary">{title}</h2>
      </div>
      {tags.length === 0 ? (
        <div className="px-5 py-8 text-center">
          <p className="text-tertiary text-xs">No hay tags.</p>
        </div>
      ) : (
        <div className="divide-y divide-border-color/40">
          {tags.map((tag) => {
            const tagLinkType = resolveLinkType(tag);
            const linked =
              tagLinkType === "card"
                ? tag.card_id
                  ? cards.find((c) => c.id === tag.card_id)
                  : null
                : tag.account_id
                  ? accounts.find((a) => a.id === tag.account_id)
                  : null;
            const count = countMap[tag.id] ?? 0;
            return (
              <div
                key={tag.id}
                className="flex items-center gap-3 px-5 py-2.5 hover:bg-[var(--color-base-alt)] transition-colors group"
              >
                <input
                  type="color"
                  value={tag.color}
                  onChange={(e) => onColorChange(tag, e.target.value)}
                  className="w-7 h-7 rounded-full cursor-pointer border-0 p-0 bg-transparent flex-shrink-0"
                  style={{ backgroundColor: tag.color }}
                />
                <span className="text-sm text-primary flex-1 min-w-0 truncate">{tag.name}</span>
                {linked ? (
                  <span className="text-xs text-secondary flex-shrink-0">
                    {tagLinkType === "card"
                      ? `💳 ${(linked as { card_name: string }).card_name}`
                      : `🏦 ${(linked as { name: string }).name}`}
                  </span>
                ) : (
                  <span className="text-xs text-tertiary italic flex-shrink-0">Sin vínculo</span>
                )}
                {count > 0 && (
                  <span className="text-xs text-tertiary flex-shrink-0">
                    {count} gasto{count !== 1 ? "s" : ""}
                  </span>
                )}
                <div className="flex gap-1 flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity relative">
                  {!linked && (
                    <>
                      <button
                        onClick={() => setLinkingId(linkingId === tag.id ? null : tag.id)}
                        className="text-tertiary hover:text-primary text-xs p-1.5 rounded"
                      >
                        🔗
                      </button>
                      {linkingId === tag.id && (
                        <div className="absolute right-0 top-full mt-1 z-20 bg-surface border border-border-color rounded-lg shadow-lg p-2 min-w-[180px]">
                          {(tagLinkType === "card" ? cards : accounts).map((item) => (
                            <button
                              key={item.id}
                              onClick={() => {
                                onLink(tag, item.id);
                                setLinkingId(null);
                              }}
                              className="block w-full text-left text-sm px-3 py-1.5 rounded hover:bg-[var(--color-base-alt)] text-primary"
                            >
                              {tagLinkType === "card"
                                ? `${(item as { card_name: string }).card_name}${(item as { bank: string }).bank ? ` · ${(item as { bank: string }).bank}` : ""}`
                                : (item as { name: string }).name}
                            </button>
                          ))}
                          {(tagLinkType === "card" ? cards : accounts).length === 0 && (
                            <p className="text-xs text-tertiary px-3 py-1.5">
                              No hay opciones disponibles
                            </p>
                          )}
                        </div>
                      )}
                    </>
                  )}
                  <button
                    onClick={() => onDelete(tag)}
                    className="text-tertiary hover:text-danger text-xs p-1.5 rounded"
                  >
                    🗑
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

export default function ClasificacionPage() {
  const qc = useQueryClient();

  const [editing, setEditing] = useState<{ cat: Category | null; isParent: boolean } | undefined>();
  const [deleteConfirm, setDeleteConfirm] = useState<Category | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [inlineEditId, setInlineEditId] = useState<number | null>(null);
  const [inlineEditName, setInlineEditName] = useState("");
  const [newCatName, setNewCatName] = useState("");
  const [newCatParentId, setNewCatParentId] = useState("");
  const [newTagName, setNewTagName] = useState("");
  const [newTagColor, setNewTagColor] = useState(TAG_PALETTE[0]);
  const [deleteTagTarget, setDeleteTagTarget] = useState<Tag | null>(null);
  const [newCuentaName, setNewCuentaName] = useState("");
  const [newCuentaColor, setNewCuentaColor] = useState(TAG_PALETTE[0]);

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
  const { data: cards = [] } = useQuery({ queryKey: ["cards"], queryFn: getCards });
  const { data: accounts = [] } = useQuery({ queryKey: ["accounts"], queryFn: getAccounts });

  const countMap = useMemo(
    () =>
      allExpenses.reduce<Record<number, number>>((acc, e) => {
        if (e.category_id != null) acc[e.category_id] = (acc[e.category_id] ?? 0) + 1;
        return acc;
      }, {}),
    [allExpenses],
  );

  const tagCountMap = useMemo(
    () =>
      allExpenses.reduce<Record<number, number>>((acc, e) => {
        if (e.tags) for (const t of e.tags) acc[t.id] = (acc[t.id] ?? 0) + 1;
        return acc;
      }, {}),
    [allExpenses],
  );

  const parentCats = categories.filter((c) => !c.parent_id);
  const childCats = categories.filter((c) => !!c.parent_id);
  const hasHierarchy = parentCats.length > 0;

  const flatCategories = useMemo(() => {
    const result: { cat: Category; depth: number }[] = [];
    const seen = new Set<number>();
    for (const parent of parentCats) {
      result.push({ cat: parent, depth: 0 });
      seen.add(parent.id);
      for (const child of childCats.filter((c) => c.parent_id === parent.id)) {
        result.push({ cat: child, depth: 1 });
        seen.add(child.id);
      }
    }
    for (const cat of categories) {
      if (!seen.has(cat.id)) result.push({ cat, depth: cat.parent_id ? 1 : 0 });
    }
    return result;
  }, [parentCats, childCats, categories]);

  const tagsByGroup = useMemo(() => {
    const groups: Record<string, Tag[]> = { cuenta: [], otros: [] };
    for (const tag of tags) {
      if (tag.group_name === "categoria") continue;
      const key = tag.group_name === "cuenta" ? "cuenta" : "otros";
      groups[key].push(tag);
    }
    return groups;
  }, [tags]);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["categories"] });
    qc.invalidateQueries({ queryKey: ["dashboard"] });
    qc.invalidateQueries({ queryKey: ["expenses"] });
  };

  const invalidateTags = () => {
    qc.invalidateQueries({ queryKey: ["tags"] });
    qc.invalidateQueries({ queryKey: ["dashboard"] });
    qc.invalidateQueries({ queryKey: ["expenses"] });
  };

  const createCatMut = useMutation({
    mutationFn: createCategory,
    onSuccess: () => {
      invalidate();
      setNewCatName("");
      setNewCatParentId("");
      setSuccessMsg("Categoría creada");
    },
  });
  const updateCatMut = useMutation({
    mutationFn: ({ id, data }: { id: number; data: Omit<Category, "id"> }) =>
      updateCategory(id, data),
    onSuccess: () => {
      invalidate();
      setInlineEditId(null);
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

  const [recatResult, setRecatResult] = useState<{ updated: number; total: number } | null>(null);
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
    mutationFn: (p: { name: string; color: string; group_name: string }) => createTag(p),
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
    if (editing?.cat?.id) updateCatMut.mutate({ id: editing.cat.id, data });
    else createCatMut.mutate(data);
  };

  const saveInlineName = (cat: Category) => {
    const trimmed = inlineEditName.trim();
    if (trimmed && trimmed !== cat.name)
      updateCatMut.mutate({ id: cat.id, data: { ...cat, name: trimmed } });
    else setInlineEditId(null);
  };

  const saveCatColor = (cat: Category, color: string) =>
    updateCatMut.mutate({ id: cat.id, data: { ...cat, color } });

  const handleCreateCat = () => {
    if (!newCatName.trim()) return;
    createCatMut.mutate({
      name: newCatName.trim(),
      color: "#3b82f6",
      keywords: "",
      parent_id: newCatParentId ? parseInt(newCatParentId) : null,
    });
  };

  const handleCreateTag = () => {
    if (!newTagName.trim()) return;
    createTagMut.mutate({ name: newTagName.trim(), color: newTagColor, group_name: "otros" });
  };

  const handleCreateCuenta = () => {
    if (!newCuentaName.trim()) return;
    createTagMut.mutate({
      name: newCuentaName.trim(),
      color: newCuentaColor,
      group_name: "cuenta",
    });
    setNewCuentaName("");
  };

  return (
    <div className="space-y-6">
      {successMsg && (
        <div className="px-4 py-2 rounded-lg bg-success/20 text-success text-sm font-medium animate-pulse">
          {successMsg}
        </div>
      )}

      <h1 className="text-2xl font-semibold text-primary">Clasificación</h1>

      <section className="card">
        <div className="px-5 py-4 border-b border-border-color flex items-center justify-between gap-3 flex-wrap">
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

        {!hasHierarchy && !hierarchyResult && (
          <div className="px-5 py-4 border-b border-border-color bg-warning/5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
            <div>
              <p className="text-sm font-medium text-warning">Configurar estructura base</p>
              <p className="text-xs text-tertiary mt-0.5">
                Crea una jerarquía recomendada con subcategorías y palabras clave.
              </p>
            </div>
            <button
              onClick={() => hierarchyMut.mutate()}
              disabled={hierarchyMut.isPending}
              className="gnome-btn-primary-round text-sm"
            >
              {hierarchyMut.isPending ? "Aplicando..." : "Aplicar estructura base"}
            </button>
          </div>
        )}
        {hierarchyResult && (
          <div className="px-5 py-3 border-b border-border-color bg-success/5">
            <p className="text-sm text-success">
              Estructura aplicada: {hierarchyResult.created} categorías creadas,{" "}
              {hierarchyResult.updated} actualizadas.
            </p>
          </div>
        )}

        {isLoading ? (
          <div className="flex items-center justify-center h-40">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
          </div>
        ) : flatCategories.length === 0 ? (
          <div className="px-5 py-10 text-center">
            <p className="text-tertiary text-sm">No hay categorías aún.</p>
          </div>
        ) : (
          <div className="divide-y divide-border-color/40">
            {flatCategories.map(({ cat, depth }) => {
              const count = countMap[cat.id] ?? 0;
              return (
                <div
                  key={cat.id}
                  className="flex items-center gap-3 px-5 py-2.5 hover:bg-[var(--color-base-alt)] transition-colors group"
                  style={{ paddingLeft: `${20 + depth * 24}px` }}
                >
                  <input
                    type="color"
                    value={cat.color}
                    onChange={(e) => saveCatColor(cat, e.target.value)}
                    className="w-7 h-7 rounded-full cursor-pointer border-0 p-0 bg-transparent flex-shrink-0"
                    style={{ backgroundColor: cat.color }}
                  />
                  {inlineEditId === cat.id ? (
                    <input
                      type="text"
                      value={inlineEditName}
                      onChange={(e) => setInlineEditName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") saveInlineName(cat);
                        if (e.key === "Escape") setInlineEditId(null);
                      }}
                      onBlur={() => saveInlineName(cat)}
                      autoFocus
                      className="input text-sm py-0.5 px-2 flex-1 min-w-0"
                    />
                  ) : (
                    <button
                      onClick={() => {
                        setInlineEditId(cat.id);
                        setInlineEditName(cat.name);
                      }}
                      className="text-sm text-primary hover:text-primary/80 flex-1 text-left truncate"
                    >
                      {cat.name}
                    </button>
                  )}
                  {count > 0 && (
                    <span className="text-xs text-tertiary flex-shrink-0">
                      {count} gasto{count !== 1 ? "s" : ""}
                    </span>
                  )}
                  <div className="flex gap-1 flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      onClick={() => setEditing({ cat, isParent: !cat.parent_id })}
                      className="text-tertiary hover:text-primary text-xs p-1.5 rounded"
                    >
                      ✏
                    </button>
                    <button
                      onClick={() => setDeleteConfirm(cat)}
                      className="text-tertiary hover:text-danger text-xs p-1.5 rounded"
                    >
                      🗑
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        <div className="px-5 py-3 border-t border-border-color flex items-end gap-2 flex-wrap">
          <div className="flex-1 min-w-[140px]">
            <input
              type="text"
              value={newCatName}
              onChange={(e) => setNewCatName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleCreateCat()}
              placeholder="+ Nueva categoría..."
              className="input text-sm"
            />
          </div>
          <Select
            value={newCatParentId}
            onChange={setNewCatParentId}
            options={[
              { value: "", label: "Sin padre" },
              ...parentCats.map((p) => ({ value: p.id.toString(), label: p.name })),
            ]}
            className="w-40"
          />
          <button
            onClick={handleCreateCat}
            disabled={!newCatName.trim() || createCatMut.isPending}
            className="gnome-btn-primary-round text-sm"
          >
            + Crear
          </button>
        </div>
      </section>

      {tagsLoading ? (
        <div className="flex items-center justify-center h-20">
          <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary" />
        </div>
      ) : (
        <>
          <TagSection
            title="🏦 Cuentas"
            tags={tagsByGroup.cuenta}
            countMap={tagCountMap}
            cards={cards}
            accounts={accounts}
            linkType={null}
            onColorChange={(t, c) => updateTagMut.mutate({ id: t.id, data: { color: c } })}
            onDelete={setDeleteTagTarget}
            onLink={(t, id) => {
              if (t.card_id !== null && t.card_id !== undefined) {
                updateTagMut.mutate({ id: t.id, data: { card_id: id } });
              } else {
                updateTagMut.mutate({ id: t.id, data: { account_id: id } });
              }
            }}
          />
          <div className="card p-4">
            <div className="flex items-end gap-3 flex-wrap">
              <div className="flex-1 min-w-[140px]">
                <label className="block text-xs font-medium text-tertiary mb-1">Nombre</label>
                <input
                  type="text"
                  value={newCuentaName}
                  onChange={(e) => setNewCuentaName(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleCreateCuenta()}
                  placeholder="Ej: Visa Galicia, Efectivo..."
                  className="input text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-tertiary mb-1">Color</label>
                <input
                  type="color"
                  value={newCuentaColor}
                  onChange={(e) => setNewCuentaColor(e.target.value)}
                  className="w-7 h-7 rounded-full cursor-pointer border-0 p-0 bg-transparent"
                />
              </div>
              <button
                onClick={handleCreateCuenta}
                disabled={!newCuentaName.trim() || createTagMut.isPending}
                className="gnome-btn-primary-round text-sm"
              >
                + Nueva cuenta
              </button>
            </div>
          </div>

          <section className="card">
            <div className="px-5 py-4 border-b border-border-color">
              <h2 className="text-lg font-semibold text-primary">Otros</h2>
            </div>
            {tagsByGroup.otros.length === 0 ? (
              <div className="px-5 py-8 text-center">
                <p className="text-tertiary text-xs">No hay tags otros.</p>
              </div>
            ) : (
              <div className="divide-y divide-border-color/40">
                {tagsByGroup.otros.map((tag) => {
                  const count = tagCountMap[tag.id] ?? 0;
                  return (
                    <div
                      key={tag.id}
                      className="flex items-center gap-3 px-5 py-2.5 hover:bg-[var(--color-base-alt)] transition-colors group"
                    >
                      <input
                        type="color"
                        value={tag.color}
                        onChange={(e) =>
                          updateTagMut.mutate({ id: tag.id, data: { color: e.target.value } })
                        }
                        className="w-7 h-7 rounded-full cursor-pointer border-0 p-0 bg-transparent flex-shrink-0"
                        style={{ backgroundColor: tag.color }}
                      />
                      <span className="text-sm text-primary flex-1 min-w-0 truncate">
                        {tag.name}
                      </span>
                      {count > 0 && (
                        <span className="text-xs text-tertiary flex-shrink-0">
                          {count} gasto{count !== 1 ? "s" : ""}
                        </span>
                      )}
                      <div className="flex gap-1 flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button
                          onClick={() =>
                            setEditing({
                              cat: { id: 0, name: tag.name, color: tag.color, keywords: "" },
                              isParent: false,
                            })
                          }
                          className="text-tertiary hover:text-primary text-xs p-1.5 rounded"
                        >
                          ✏
                        </button>
                        <button
                          onClick={() => setDeleteTagTarget(tag)}
                          className="text-tertiary hover:text-danger text-xs p-1.5 rounded"
                        >
                          🗑
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
            <div className="px-5 py-3 border-t border-border-color flex items-end gap-2 flex-wrap">
              <div className="flex-1 min-w-[140px]">
                <input
                  type="text"
                  value={newTagName}
                  onChange={(e) => setNewTagName(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleCreateTag()}
                  placeholder="+ Nuevo tag..."
                  className="input text-sm"
                />
              </div>
              <input
                type="color"
                value={newTagColor}
                onChange={(e) => setNewTagColor(e.target.value)}
                className="w-7 h-7 rounded-full cursor-pointer border-0 p-0 bg-transparent"
              />
              <button
                onClick={handleCreateTag}
                disabled={!newTagName.trim() || createTagMut.isPending}
                className="gnome-btn-primary-round text-sm"
              >
                + Crear
              </button>
            </div>
          </section>
        </>
      )}

      {editing !== undefined && (
        <CategoryForm
          initial={editing.cat || undefined}
          parentCategories={parentCats}
          onClose={() => setEditing(undefined)}
          onSave={handleSaveCat}
          isSaving={createCatMut.isPending || updateCatMut.isPending}
        />
      )}
      {deleteConfirm && (
        <ConfirmDialog
          isOpen={true}
          title="Eliminar categoría"
          message={`¿Eliminar "${deleteConfirm.name}"?`}
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
