export const TAG_PALETTE = [
  "#3584e4",
  "#33d17a",
  "#f5c211",
  "#ff7800",
  "#e01b24",
  "#9141ac",
  "#2190a4",
  "#986a44",
  "#f66151",
  "#8ff0a4",
  "#62a0ea",
  "#c061cb",
];

export function suggestTagColor(existingCount: number): string {
  return TAG_PALETTE[existingCount % TAG_PALETTE.length];
}
