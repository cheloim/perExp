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
} from "../api/client";
import type { Category, Tag } from "../types";
import { Select } from "../components/ui/Select";
import { ConfirmDialog } from "../components/ConfirmDialog";
import SymbolicIcon from "../components/SymbolicIcon";
import { TAG_PALETTE } from "../utils/palette";
import { useFocusTrap } from "../hooks/useFocusTrap";

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

  const trapRef = useFocusTrap(true, onClose);

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4 animate-modal-backdrop">
      <div ref={trapRef} className="card w-full max-w-md animate-modal-content">
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
            <div className="flex flex-wrap gap-1.5">
              {TAG_PALETTE.map((c) => (
                <button
                  key={c}
                  onClick={() => setForm((p) => ({ ...p, color: c }))}
                  className={`w-6 h-6 rounded-full ${
                    form.color === c
                      ? "scale-125 ring-2 ring-offset-1 ring-offset-surface ring-primary"
                      : ""
                  }`}
                  style={{ backgroundColor: c }}
                />
              ))}
              <input
                type="color"
                value={form.color}
                onChange={(e) => setForm((p) => ({ ...p, color: e.target.value }))}
                className="w-6 h-6 rounded-full cursor-pointer border-0 p-0 bg-transparent"
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

function TagForm({
  initial,
  defaultGroup,
  onClose,
  onSave,
  isSaving,
}: {
  initial?: Tag;
  defaultGroup?: string;
  onClose: () => void;
  onSave: (data: { name: string; color: string; group_name: string }) => void;
  isSaving?: boolean;
}) {
  const [form, setForm] = useState({
    name: initial?.name ?? "",
    color: initial?.color ?? TAG_PALETTE[0],
    group_name: initial?.group_name ?? defaultGroup ?? "otros",
  });

  useEffect(() => {
    if (initial) {
      setForm({
        name: initial.name,
        color: initial.color,
        group_name: initial.group_name ?? "otros",
      });
    }
  }, [initial]);

  const trapRef = useFocusTrap(true, onClose);

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4 animate-modal-backdrop">
      <div ref={trapRef} className="card w-full max-w-md animate-modal-content">
        <div className="flex items-center justify-between px-6 py-4 border-b border-border-color">
          <h2 className="text-base font-semibold text-primary">
            {initial ? "Editar tag" : "Nuevo tag"}
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
            <div className="flex flex-wrap gap-1.5">
              {TAG_PALETTE.map((c) => (
                <button
                  key={c}
                  onClick={() => setForm((p) => ({ ...p, color: c }))}
                  className={`w-6 h-6 rounded-full ${
                    form.color === c
                      ? "scale-125 ring-2 ring-offset-1 ring-offset-surface ring-primary"
                      : ""
                  }`}
                  style={{ backgroundColor: c }}
                />
              ))}
              <input
                type="color"
                value={form.color}
                onChange={(e) => setForm((p) => ({ ...p, color: e.target.value }))}
                className="w-6 h-6 rounded-full cursor-pointer border-0 p-0 bg-transparent"
              />
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-tertiary mb-1.5">Grupo</label>
            <Select
              value={form.group_name}
              onChange={(v) => setForm((p) => ({ ...p, group_name: v }))}
              options={[
                { value: "cuenta", label: "Cuenta" },
                { value: "otros", label: "Otros" },
              ]}
            />
          </div>
        </div>
        <div className="flex justify-end gap-2 px-6 py-4 border-t border-border-color">
          <button onClick={onClose} className="gnome-btn-secondary-round text-sm">
            Cancelar
          </button>
          <button
            onClick={() =>
              onSave({
                name: form.name,
                color: form.color,
                group_name: form.group_name,
              })
            }
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

export default function ClasificacionPage() {
  const qc = useQueryClient();
  const [search, setSearch] = useState("");

  const [editing, setEditing] = useState<{ cat: Category | null; isParent: boolean } | undefined>();
  const [deleteConfirm, setDeleteConfirm] = useState<Category | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [inlineEditId, setInlineEditId] = useState<number | null>(null);
  const [inlineEditName, setInlineEditName] = useState("");
  const [editingTag, setEditingTag] = useState<Tag | undefined>();
  const [tagFormOpen, setTagFormOpen] = useState(false);
  const [tagDefaultGroup, setTagDefaultGroup] = useState<string>("otros");
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
  const { data: tags = [], isLoading: tagsLoading } = useQuery({
    queryKey: ["tags"],
    queryFn: getTags,
  });

  const parentCats = categories.filter((c) => !c.parent_id);
  const childCats = categories.filter((c) => !!c.parent_id);

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
      setEditing(undefined);
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

  const createTagMut = useMutation({
    mutationFn: (p: {
      name: string;
      color: string;
      group_name: string;
      card_id?: number | null;
      account_id?: number | null;
    }) =>
      createTag({
        ...p,
        card_id: p.card_id ?? undefined,
        account_id: p.account_id ?? undefined,
      }),
    onSuccess: () => {
      setEditingTag(undefined);
      setTagFormOpen(false);
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
      setEditingTag(undefined);
      setTagFormOpen(false);
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

  const handleSaveTag = (data: { name: string; color: string; group_name: string }) => {
    if (editingTag?.id) {
      updateTagMut.mutate({ id: editingTag.id, data });
    } else {
      createTagMut.mutate(data);
    }
  };

  const openTagForm = (tag?: Tag, group?: string) => {
    setEditingTag(tag);
    setTagDefaultGroup(group ?? "otros");
    setTagFormOpen(true);
  };

  const q = search.toLowerCase().trim();

  const filteredCats = useMemo(() => {
    if (!q) return flatCategories;
    return flatCategories.filter(({ cat }) => cat.name.toLowerCase().includes(q));
  }, [flatCategories, q]);

  const filteredCuentas = useMemo(() => {
    if (!q) return tagsByGroup.cuenta;
    return tagsByGroup.cuenta.filter((t) => t.name.toLowerCase().includes(q));
  }, [tagsByGroup.cuenta, q]);

  const filteredOtros = useMemo(() => {
    if (!q) return tagsByGroup.otros;
    return tagsByGroup.otros.filter((t) => t.name.toLowerCase().includes(q));
  }, [tagsByGroup.otros, q]);

  const renderChip = (tag: Tag) => {
    return (
      <button
        key={tag.id}
        onClick={() => openTagForm(tag, tag.group_name)}
        className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs hover:ring-1 hover:ring-offset-1 hover:ring-offset-surface transition-all group"
        style={
          {
            backgroundColor: tag.color + "1F",
            "--ring-color": tag.color,
            color: "var(--text-primary)",
          } as React.CSSProperties
        }
        onMouseEnter={(e) => {
          (e.currentTarget as HTMLElement).style.setProperty("--tw-ring-color", tag.color);
        }}
      >
        <span
          className="w-1.5 h-1.5 rounded-full flex-shrink-0"
          style={{ backgroundColor: tag.color }}
        />
        <span className="font-medium">{tag.name}</span>
        <span className="flex gap-0.5 ml-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
          <span className="opacity-60 hover:opacity-100 cursor-pointer">
            <SymbolicIcon name="pencil" size={11} />
          </span>
          <span
            onClick={(e) => {
              e.stopPropagation();
              setDeleteTagTarget(tag);
            }}
            className="opacity-60 hover:opacity-100 cursor-pointer"
          >
            <SymbolicIcon name="trash" size={11} />
          </span>
        </span>
      </button>
    );
  };

  const sectionsVisible = {
    categorias: !q || filteredCats.length > 0,
    cuentas: !q || filteredCuentas.length > 0,
    etiquetas: !q || filteredOtros.length > 0,
  };

  return (
    <div className="space-y-4">
      {successMsg && (
        <div className="px-4 py-2 rounded-lg bg-success/20 text-success text-sm font-medium animate-pulse">
          {successMsg}
        </div>
      )}

      <h1 className="text-2xl font-semibold text-primary">Clasificación</h1>

      {/* Global search */}
      <div className="relative">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Buscar categorías, cuentas y tags…"
          className="input text-sm pl-8"
        />
        <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-tertiary">
          <SymbolicIcon name="search" size={14} />
        </span>
      </div>

      {/* Categorías */}
      {sectionsVisible.categorias && (
        <section className="card p-3">
          <div className="flex items-center justify-between mb-2 px-1">
            <h2 className="text-sm font-semibold text-secondary">
              Categorías
              <span className="text-tertiary font-normal ml-1">({filteredCats.length})</span>
            </h2>
            <button
              onClick={() => setEditing({ cat: null, isParent: true })}
              className="gnome-btn-primary-round text-xs"
            >
              + Nueva
            </button>
          </div>
          {isLoading ? (
            <div className="flex items-center justify-center h-20">
              <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary" />
            </div>
          ) : filteredCats.length === 0 ? (
            <p className="text-tertiary text-xs text-center py-4">
              {q ? "Sin resultados." : "No hay categorías aún."}
            </p>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {filteredCats.map(({ cat, depth }) =>
                inlineEditId === cat.id ? (
                  <div key={cat.id} className="inline-flex items-center">
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
                      className="input text-xs py-0.5 px-2 w-28"
                    />
                  </div>
                ) : (
                  <button
                    key={cat.id}
                    onClick={() => {
                      setInlineEditId(cat.id);
                      setInlineEditName(cat.name);
                    }}
                    className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs hover:ring-1 hover:ring-offset-1 hover:ring-offset-surface transition-all group"
                    style={
                      {
                        backgroundColor: cat.color + "1F",
                        "--ring-color": cat.color,
                        color: "var(--text-primary)",
                      } as React.CSSProperties
                    }
                    onMouseEnter={(e) => {
                      (e.currentTarget as HTMLElement).style.setProperty(
                        "--tw-ring-color",
                        cat.color,
                      );
                    }}
                  >
                    <span
                      className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                      style={{ backgroundColor: cat.color }}
                    />
                    {depth > 0 && <span className="text-tertiary text-[10px] mr-0.5">└</span>}
                    <span className={depth === 0 ? "font-medium" : ""}>{cat.name}</span>
                    <span className="flex gap-0.5 ml-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                      <span
                        onClick={(e) => {
                          e.stopPropagation();
                          setEditing({ cat, isParent: !cat.parent_id });
                        }}
                        className="text-tertiary hover:text-primary cursor-pointer"
                      >
                        <SymbolicIcon name="pencil" size={11} />
                      </span>
                      <span
                        onClick={(e) => {
                          e.stopPropagation();
                          setDeleteConfirm(cat);
                        }}
                        className="text-tertiary hover:text-danger cursor-pointer"
                      >
                        <SymbolicIcon name="trash" size={11} />
                      </span>
                    </span>
                  </button>
                ),
              )}
            </div>
          )}
        </section>
      )}

      {/* Cuentas */}
      {sectionsVisible.cuentas && (
        <section className="card p-3">
          <div className="flex items-center justify-between mb-2 px-1">
            <h2 className="text-sm font-semibold text-secondary">
              Cuentas
              <span className="text-tertiary font-normal ml-1">({filteredCuentas.length})</span>
            </h2>
            <button
              onClick={() => openTagForm(undefined, "cuenta")}
              className="gnome-btn-primary-round text-xs"
            >
              + Nueva cuenta
            </button>
          </div>
          {tagsLoading ? (
            <div className="flex items-center justify-center h-20">
              <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary" />
            </div>
          ) : filteredCuentas.length === 0 ? (
            <p className="text-tertiary text-xs text-center py-4">
              {q ? "Sin resultados." : "No hay cuentas aún. Creá tu primera cuenta."}
            </p>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {filteredCuentas.map((tag) => renderChip(tag))}
            </div>
          )}
        </section>
      )}

      {/* Etiquetas */}
      {sectionsVisible.etiquetas && (
        <section className="card p-3">
          <div className="flex items-center justify-between mb-2 px-1">
            <h2 className="text-sm font-semibold text-secondary">
              Etiquetas
              <span className="text-tertiary font-normal ml-1">({filteredOtros.length})</span>
            </h2>
            <button
              onClick={() => openTagForm(undefined, "otros")}
              className="gnome-btn-primary-round text-xs"
            >
              + Nuevo tag
            </button>
          </div>
          {tagsLoading ? (
            <div className="flex items-center justify-center h-20">
              <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary" />
            </div>
          ) : filteredOtros.length === 0 ? (
            <p className="text-tertiary text-xs text-center py-4">
              {q ? "Sin resultados." : "No hay etiquetas aún. Creá tu primera etiqueta."}
            </p>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {filteredOtros.map((tag) => renderChip(tag))}
            </div>
          )}
        </section>
      )}

      {/* Modals */}
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
      {tagFormOpen && (
        <TagForm
          initial={editingTag}
          defaultGroup={tagDefaultGroup}
          onClose={() => {
            setTagFormOpen(false);
            setEditingTag(undefined);
          }}
          onSave={handleSaveTag}
          isSaving={createTagMut.isPending || updateTagMut.isPending}
        />
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
