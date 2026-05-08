import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  getCategories, createCategory, updateCategory, deleteCategory,
  getExpenses, recategorizeExpenses, applyBaseHierarchy,
} from '../api/client'
import type { Category } from '../types'

const COLORS = [
  '#ef4444', '#f97316', '#eab308', '#22c55e', '#14b8a6',
  '#3b82f6', '#8b5cf6', '#ec4899', '#64748b', '#78716c',
]

function formatCurrency(amount: number) {
  return new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', minimumFractionDigits: 0 }).format(amount)
}

function formatDate(dateStr: string) {
  if (!dateStr) return ''
  if (dateStr.match(/^\d{4}-\d{2}-\d{2}$/)) {
    const [y, m, d] = dateStr.split('-')
    return `${d}-${m}-${y}`
  }
  return dateStr
}

/* ─── Category Form modal ─── */
interface CategoryFormProps {
  initial?: Category
  isParentForm: boolean   // true = creating/editing a parent category
  parentCategories: Category[]
  onClose: () => void
  onSave: (data: Omit<Category, 'id'>) => void
}

function CategoryForm({ initial, isParentForm, parentCategories, onClose, onSave }: CategoryFormProps) {
  const [form, setForm] = useState<Omit<Category, 'id'>>(
    initial
      ? { name: initial.name, color: initial.color, keywords: initial.keywords, parent_id: initial.parent_id ?? null }
      : {
          name: '',
          color: '#3b82f6',
          keywords: '',
          parent_id: isParentForm ? null : (parentCategories[0]?.id ?? null),
        }
  )

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
      <div className="card w-full max-w-md">
        <div className="flex items-center justify-between px-6 py-4 border-b border-border-color">
          <h2 className="text-base font-semibold text-primary">
            {initial ? 'Editar' : (isParentForm ? 'Nueva Categoría Padre' : 'Nueva Subcategoría')}
          </h2>
          <button onClick={onClose} className="text-tertiary hover:text-primary text-xl leading-none">×</button>
        </div>
        <div className="px-6 py-4 space-y-4">

          {/* Parent selector — only shown for subcategories */}
          {!isParentForm && (
            <div>
              <label className="block text-xs font-medium text-tertiary mb-1.5">Categoría padre</label>
              <select
                value={form.parent_id ?? ''}
                onChange={(e) => setForm(p => ({ ...p, parent_id: e.target.value ? parseInt(e.target.value) : null }))}
                className="input"
              >
                <option value="">— Sin padre (independiente) —</option>
                {parentCategories.map(p => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </div>
          )}

          {isParentForm && (
            <div className="flex items-center gap-2 text-xs text-warning bg-warning/10 border border-warning/20 rounded-lg px-3 py-2">
              <span>ℹ</span>
              <span>Las categorías padre son agrupadores. Los gastos se asignan a las subcategorías, no a las padres.</span>
            </div>
          )}

          <div>
            <label className="block text-xs font-medium text-tertiary mb-1.5">Nombre</label>
            <input
              type="text"
              value={form.name}
              onChange={(e) => setForm(p => ({ ...p, name: e.target.value }))}
              placeholder={isParentForm ? 'Ej: Alimentación' : 'Ej: Supermercado'}
              className="input placeholder:text-tertiary"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-tertiary mb-1.5">Color</label>
            <div className="flex flex-wrap gap-2">
              {COLORS.map((c) => (
                <button
                  key={c}
                  onClick={() => setForm(p => ({ ...p, color: c }))}
                  className={`w-7 h-7 rounded-full transition-transform ${form.color === c ? 'scale-125 ring-2 ring-offset-2 ring-offset-surface ring-primary' : ''}`}
                  style={{ backgroundColor: c }}
                />
              ))}
              <input
                type="color"
                value={form.color}
                onChange={(e) => setForm(p => ({ ...p, color: e.target.value }))}
                className="w-7 h-7 rounded-full cursor-pointer border-0 p-0 overflow-hidden bg-transparent"
                title="Color personalizado"
              />
            </div>
          </div>

          {/* Keywords only for subcategories (leaves) */}
          {!isParentForm && (
            <div>
              <label className="block text-xs font-medium text-tertiary mb-1.5">Palabras clave (separadas por coma)</label>
              <textarea
                value={form.keywords}
                onChange={(e) => setForm(p => ({ ...p, keywords: e.target.value }))}
                rows={3}
                placeholder="Ej: coto, carrefour, dia, supermercado"
                className="input placeholder:text-tertiary"
              />
              <p className="text-xs text-tertiary mt-1">Se usan para categorizar automáticamente los gastos importados.</p>
            </div>
          )}
        </div>
        <div className="flex justify-end gap-2 px-6 py-4 border-t border-border-color">
          <button onClick={onClose} className="btn-secondary">
            Cancelar
          </button>
          <button
            onClick={() => onSave({ ...form, keywords: isParentForm ? '' : form.keywords })}
            disabled={!form.name}
            className="btn-primary"
          >
            Guardar
          </button>
        </div>
      </div>
    </div>
  )
}

/* ─── Category detail drawer ─── */
function CategoryDetail({ cat, onClose }: { cat: Category; onClose: () => void }) {
  const { data: expenses = [], isLoading } = useQuery({
    queryKey: ['expenses', 'category', cat.id],
    queryFn: () => getExpenses({ category_id: cat.id, limit: 200 }),
  })
  const total = expenses.reduce((s, e) => s + e.amount, 0)

  return (
    <div className="fixed inset-0 bg-black/60 flex items-end sm:items-center justify-center z-50 p-0 sm:p-4">
      <div className="card w-full sm:max-w-2xl flex flex-col max-h-[90vh]">
        <div className="flex items-center gap-3 px-5 py-4 border-b border-border-color flex-shrink-0">
          <span className="w-4 h-4 rounded-full flex-shrink-0" style={{ backgroundColor: cat.color }} />
          <h2 className="text-base font-semibold text-primary flex-1">{cat.name}</h2>
          <span className="text-sm text-secondary">{expenses.length} gastos</span>
          <button onClick={onClose} className="text-tertiary hover:text-primary text-xl ml-2 leading-none">×</button>
        </div>
        {!isLoading && expenses.length > 0 && (
          <div className="px-5 py-3 bg-base-alt border-b border-border-color flex-shrink-0 flex gap-6 text-sm">
            <div><span className="text-tertiary">Total: </span><span className="font-semibold text-primary">{formatCurrency(total)}</span></div>
            <div><span className="text-tertiary">Promedio: </span><span className="font-semibold text-primary">{formatCurrency(expenses.length > 0 ? total / expenses.length : 0)}</span></div>
          </div>
        )}
        <div className="overflow-y-auto flex-1">
          {isLoading ? (
            <div className="flex items-center justify-center py-16">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
            </div>
          ) : expenses.length === 0 ? (
            <p className="text-center text-tertiary py-16 text-sm">No hay gastos en esta categoría</p>
          ) : (
            <div className="divide-y divide-border-color">
              {expenses.map((exp) => (
                <div key={exp.id} className="flex items-center justify-between px-5 py-3 hover:bg-base-alt/50">
                  <div>
                    <p className="text-sm font-medium text-primary">
                      {exp.description}
                      {exp.installment_number && exp.installment_total && (
                        <span className="ml-1.5 text-xs bg-primary-subtle text-primary px-1.5 py-0.5 rounded">
                          {exp.installment_number}/{exp.installment_total}
                        </span>
                      )}
                    </p>
                    <p className="text-xs text-tertiary mt-0.5">
                      {formatDate(exp.date)}{exp.bank && ` · ${exp.bank}`}{exp.person && ` · ${exp.person}`}
                    </p>
                  </div>
                  <span className={`text-sm font-semibold ml-4 whitespace-nowrap ${exp.amount < 0 ? 'text-success' : 'text-primary'}`}>
                    {formatCurrency(exp.amount)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="px-5 py-3 border-t border-border-color flex-shrink-0 flex justify-end">
          <button onClick={onClose} className="btn-secondary">Cerrar</button>
        </div>
      </div>
    </div>
  )
}

/* ─── Main page ─── */
type Tab = 'parents' | 'subcategories'

export default function CategoriesPage() {
  const qc = useQueryClient()
  const [tab, setTab] = useState<Tab>('parents')
  const [editing, setEditing] = useState<{ cat: Category | null; isParent: boolean } | undefined>(undefined)
  const [browsing, setBrowsing] = useState<Category | null>(null)

  const { data: categories = [], isLoading } = useQuery({
    queryKey: ['categories'],
    queryFn: getCategories,
  })

  const { data: allExpenses = [] } = useQuery({
    queryKey: ['expenses'],
    queryFn: () => getExpenses({ limit: 500 }),
  })

  const countMap = allExpenses.reduce<Record<number, number>>((acc, e) => {
    if (e.category_id != null) acc[e.category_id] = (acc[e.category_id] ?? 0) + 1
    return acc
  }, {})

  // Classify categories
  const childParentIds = new Set(categories.filter(c => c.parent_id).map(c => c.parent_id!))
  const parentCats = categories.filter(c => !c.parent_id && childParentIds.has(c.id))
  const standaloneLeaves = categories.filter(c => !c.parent_id && !childParentIds.has(c.id))
  const childCats = categories.filter(c => !!c.parent_id)
  const hasHierarchy = parentCats.length > 0

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['categories'] })
    qc.invalidateQueries({ queryKey: ['dashboard'] })
    qc.invalidateQueries({ queryKey: ['expenses'] })
  }

  const createMut = useMutation({
    mutationFn: createCategory,
    onSuccess: () => { invalidate(); setEditing(undefined) },
  })
  const updateMut = useMutation({
    mutationFn: ({ id, data }: { id: number; data: Omit<Category, 'id'> }) => updateCategory(id, data),
    onSuccess: () => { invalidate(); setEditing(undefined) },
  })
  const deleteMut = useMutation({
    mutationFn: deleteCategory,
    onSuccess: invalidate,
    onError: (err: any) => alert(err?.response?.data?.detail ?? 'Error al eliminar'),
  })

  const [recatResult, setRecatResult] = useState<{ updated: number; total: number } | null>(null)
  const recatMut = useMutation({
    mutationFn: (only: boolean) => recategorizeExpenses(only),
    onSuccess: (data) => { setRecatResult(data); invalidate() },
  })

  const [hierarchyResult, setHierarchyResult] = useState<{ created: number; updated: number } | null>(null)
  const hierarchyMut = useMutation({
    mutationFn: applyBaseHierarchy,
    onSuccess: (data) => { setHierarchyResult(data); invalidate() },
  })

  const handleSave = (data: Omit<Category, 'id'>) => {
    if (editing?.cat?.id) {
      updateMut.mutate({ id: editing.cat.id, data })
    } else {
      createMut.mutate(data)
    }
  }

  const handleDelete = (cat: Category) => {
    if (confirm(`¿Eliminar "${cat.name}"?`)) deleteMut.mutate(cat.id)
  }

  /* ─── Subcategory card ─── */
  function SubCatRow({ cat }: { cat: Category }) {
    const count = countMap[cat.id] ?? 0
    const parent = categories.find(c => c.id === cat.parent_id)
    return (
      <div className="card p-4 flex items-start gap-3 hover:bg-base-alt transition-colors group">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: cat.color }} />
            <button
              onClick={() => setBrowsing(cat)}
              className="text-sm font-semibold text-primary hover:text-primary/80 transition-colors truncate text-left"
            >
              {cat.name}
            </button>
            {count > 0 && <span className="text-xs text-tertiary flex-shrink-0">{count} gastos</span>}
          </div>
          {parent && (
            <div className="flex items-center gap-1 ml-4">
              <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: parent.color }} />
              <span className="text-[11px] text-tertiary">{parent.name}</span>
            </div>
          )}
          {cat.keywords && (
            <p className="text-xs text-secondary truncate ml-4 mt-1" title={cat.keywords}>
              {cat.keywords.split(',').slice(0, 4).map(k => k.trim()).filter(Boolean).join(' · ')}
              {cat.keywords.split(',').length > 4 ? ' · …' : ''}
            </p>
          )}
        </div>
        <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
          <button
            onClick={() => setEditing({ cat, isParent: false })}
            className="text-tertiary hover:text-primary text-xs p-1.5 transition-colors rounded"
          >✏</button>
          <button
            onClick={() => handleDelete(cat)}
            className="text-tertiary hover:text-danger text-xs p-1.5 transition-colors rounded"
          >✕</button>
        </div>
      </div>
    )
  }

  /* ─── Parent category card ─── */
  function ParentCard({ cat }: { cat: Category }) {
    const children = categories.filter(c => c.parent_id === cat.id)
    const totalCount = children.reduce((s, c) => s + (countMap[c.id] ?? 0), 0)

    return (
      <div className="card overflow-hidden">
        {/* Header */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-border-color/60">
          <span className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: cat.color }} />
          <span className="font-semibold text-primary text-sm flex-1">{cat.name}</span>
          {totalCount > 0 && (
            <span className="text-xs text-tertiary">{totalCount} gastos</span>
          )}
          <div className="flex gap-1 flex-shrink-0">
            <button
              onClick={() => setEditing({ cat, isParent: true })}
              className="text-tertiary hover:text-primary text-xs p-1.5 transition-colors rounded"
            >✏</button>
            <button
              onClick={() => handleDelete(cat)}
              className="text-tertiary hover:text-danger text-xs p-1.5 transition-colors rounded"
            >✕</button>
          </div>
        </div>

        {/* Children list */}
        {children.length > 0 ? (
          <div className="divide-y divide-border-color/40">
            {children.map(child => {
              const count = countMap[child.id] ?? 0
              return (
                <div key={child.id} className="flex items-center gap-2.5 px-4 py-2.5 hover:bg-base-alt/30 group">
                  <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: child.color }} />
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
                      {child.keywords.split(',').slice(0, 3).map(k => k.trim()).join(', ')}…
                    </span>
                  )}
                  <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
                    <button onClick={() => setEditing({ cat: child, isParent: false })} className="text-tertiary hover:text-primary text-xs p-1 rounded">✏</button>
                    <button onClick={() => handleDelete(child)} className="text-tertiary hover:text-danger text-xs p-1 rounded">✕</button>
                  </div>
                </div>
              )
            })}
          </div>
        ) : (
          <p className="text-xs text-secondary px-4 py-3">Sin subcategorías aún</p>
        )}

        {/* Add child shortcut */}
        <div className="px-4 py-2 border-t border-border-color/40">
          <button
            onClick={() => setEditing({ cat: { id: 0, name: '', color: cat.color, keywords: '', parent_id: cat.id }, isParent: false })}
            className="text-xs text-tertiary hover:text-primary transition-colors"
          >
            + Agregar subcategoría
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Top bar */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={() => { setRecatResult(null); recatMut.mutate(true) }}
            disabled={recatMut.isPending}
            className="btn-secondary text-sm"
          >
            {recatMut.isPending ? 'Recategorizando...' : '↺ Recategorizar sin categoría'}
          </button>
          {recatResult && (
            <span className="text-xs text-tertiary">{recatResult.updated} actualizados de {recatResult.total}</span>
          )}
        </div>
        <div className="flex gap-2">
          {tab === 'parents' && (
            <button
              onClick={() => setEditing({ cat: null, isParent: true })}
              className="btn-primary text-sm"
            >
              + Categoría padre
            </button>
          )}
          {tab === 'subcategories' && (
            <button
              onClick={() => setEditing({ cat: null, isParent: false })}
              className="btn-primary text-sm"
            >
              + Subcategoría
            </button>
          )}
        </div>
      </div>

      {/* Apply base hierarchy banner */}
      {!hasHierarchy && !hierarchyResult && (
        <div className="card p-4 border border-warning/20 bg-warning/5 flex items-center justify-between gap-4">
          <div>
            <p className="text-sm font-medium text-warning">Configurar estructura base</p>
            <p className="text-xs text-tertiary mt-0.5">
              Crea una jerarquía recomendada: Alimentación, Transporte, Entretenimiento, Salud, Hogar y más, con sus subcategorías y palabras clave ya configuradas.
            </p>
          </div>
          <button
            onClick={() => hierarchyMut.mutate()}
            disabled={hierarchyMut.isPending}
            className="flex-shrink-0 btn-primary"
          >
            {hierarchyMut.isPending ? 'Aplicando...' : 'Aplicar estructura base'}
          </button>
        </div>
      )}
      {hierarchyResult && (
        <div className="card p-3 border border-success/20 bg-success/5">
          <p className="text-sm text-success">
            Estructura aplicada: {hierarchyResult.created} categorías creadas, {hierarchyResult.updated} actualizadas.
          </p>
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-0.5 bg-surface border border-border-color rounded-xl p-1 w-fit">
        {([
          { key: 'parents', label: 'Categorías Padre', count: parentCats.length },
          { key: 'subcategories', label: 'Subcategorías', count: childCats.length + standaloneLeaves.length },
        ] as { key: Tab; label: string; count: number }[]).map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`px-4 py-2 text-sm font-medium rounded-lg transition-all ${
              tab === t.key
                ? 'bg-base-alt text-primary'
                : 'text-tertiary hover:text-primary'
            }`}
          >
            {t.label}
            <span className={`ml-2 text-xs px-1.5 py-0.5 rounded-full ${tab === t.key ? 'bg-primary-subtle text-primary' : 'bg-base-alt text-secondary'}`}>
              {t.count}
            </span>
          </button>
        ))}
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center h-40">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
        </div>
      ) : tab === 'parents' ? (
        /* ── Parents tab ── */
        <div className="space-y-4">
          {parentCats.length === 0 ? (
            <div className="card p-10 text-center">
              <p className="text-tertiary text-sm">No hay categorías padre aún.</p>
              <p className="text-tertiary text-xs mt-1">Aplicá la estructura base o creá una manualmente.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {parentCats.map(cat => <ParentCard key={cat.id} cat={cat} />)}
            </div>
          )}
        </div>
      ) : (
        /* ── Subcategories tab ── */
        <div className="space-y-6">
          {/* Children grouped by parent */}
          {parentCats.map(parent => {
            const children = categories.filter(c => c.parent_id === parent.id)
            if (children.length === 0) return null
            return (
              <div key={parent.id} className="space-y-2">
                <div className="flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: parent.color }} />
                  <h3 className="text-xs font-semibold text-tertiary uppercase tracking-wider">{parent.name}</h3>
                  <span className="text-xs text-secondary">{children.length}</span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  {children.map(cat => <SubCatRow key={cat.id} cat={cat} />)}
                </div>
              </div>
            )
          })}

          {/* Standalone leaves (no parent) */}
          {standaloneLeaves.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <h3 className="text-xs font-semibold text-secondary uppercase tracking-wider">Sin categoría padre</h3>
                <span className="text-xs text-secondary">{standaloneLeaves.length}</span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {standaloneLeaves.map(cat => <SubCatRow key={cat.id} cat={cat} />)}
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

      {/* Modals */}
      {editing !== undefined && (
        <CategoryForm
          initial={editing.cat?.id ? editing.cat : undefined}
          isParentForm={editing.isParent}
          parentCategories={parentCats}
          onClose={() => setEditing(undefined)}
          onSave={handleSave}
        />
      )}

      {browsing && (
        <CategoryDetail cat={browsing} onClose={() => setBrowsing(null)} />
      )}
    </div>
  )
}
