export const SORT_KEYS = [
  "name",
  "last_message_at",
  "msgs_24h",
  "msgs_7d",
  "file_count",
  "created_at",
] as const;

export type SortKey = (typeof SORT_KEYS)[number];
export type Direction = "ASC" | "DESC";

export const DEFAULT_SORT: { column: SortKey; direction: Direction } = {
  column: "last_message_at",
  direction: "DESC",
};

export function resolveSort(
  sort: string | undefined,
  dir: string | undefined
): { column: SortKey; direction: Direction } {
  const column = (SORT_KEYS as readonly string[]).includes(sort ?? "")
    ? (sort as SortKey)
    : DEFAULT_SORT.column;
  const direction: Direction = dir?.toLowerCase() === "asc" ? "ASC" : "DESC";
  return { column, direction };
}
