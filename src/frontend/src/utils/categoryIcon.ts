import type { IconName } from "../components/SymbolicIcon";

/**
 * Maps category keywords to SymbolicIcon names.
 * Replaces the emoji-based categoryEmoji utility.
 * GNOME HIG: "icons should typically have the symbolic style"
 */
const CATEGORY_ICON: Record<string, IconName> = {
  comida: "cart",
  alimentación: "cart",
  supermercado: "cart",
  mercado: "cart",
  transporte: "car",
  uber: "car",
  taxi: "car",
  nafta: "fuel",
  gasolina: "fuel",
  salud: "heart",
  farmacia: "pill",
  médico: "heart",
  hospital: "heart",
  servicios: "lightbulb",
  luz: "lightbulb",
  gas: "lightbulb",
  internet: "wifi",
  teléfono: "smartphone",
  phone: "smartphone",
  ocio: "film",
  entretenimiento: "film",
  streaming: "film",
  netflix: "film",
  spotify: "music",
  música: "music",
  educación: "book",
  universidad: "book",
  college: "book",
  hogar: "home",
  alquiler: "home",
  expensas: "home",
  ropa: "tshirt",
  vestimenta: "tshirt",
  fitness: "dumbbell",
  gimnasio: "dumbbell",
  deporte: "dumbbell",
  café: "coffee",
  cafe: "coffee",
  suscripciones: "tag",
  regalos: "gift",
  donaciones: "heart",
  viajes: "plane",
  vuelos: "plane",
  hotels: "home",
  hotel: "home",
  restaurantes: "utensils",
  restó: "utensils",
  delivery: "truck",
  rappi: "truck",
  pedidosya: "truck",
  mascotas: "pawprint",
  perro: "pawprint",
  gato: "pawprint",
  bebés: "baby",
  bebes: "baby",
  baby: "baby",
};

/**
 * Returns the SymbolicIcon name for a category, or null if no match.
 * GNOME HIG UI Icons: "icons should typically have the symbolic style"
 */
export function getCategoryIcon(name: string | null): IconName | null {
  if (!name) return null;
  const lower = name.toLowerCase();
  for (const [keyword, icon] of Object.entries(CATEGORY_ICON)) {
    if (lower.includes(keyword)) return icon;
  }
  return null;
}
