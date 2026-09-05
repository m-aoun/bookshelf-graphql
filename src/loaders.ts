import DataLoader from "dataloader";
import { db } from "./db";
import { AuthorRow, BookRow, ReviewRow } from "./types";

/**
 * N+1 mitigation: without these, resolving `author` on a list of N books
 * (or `reviews` on a list of N books) would issue N separate SQL queries.
 * DataLoader batches the per-request lookups issued during one GraphQL
 * "tick" into a single SQL query with an IN (...) clause, and caches the
 * result for the lifetime of the request.
 */
export interface Loaders {
  authorById: DataLoader<number, AuthorRow | null>;
  reviewsByBookId: DataLoader<number, ReviewRow[]>;
}

export function createLoaders(): Loaders {
  const authorById = new DataLoader<number, AuthorRow | null>(async (ids) => {
    const placeholders = ids.map(() => "?").join(",");
    const rows = db
      .prepare(`SELECT * FROM authors WHERE id IN (${placeholders})`)
      .all(...ids) as unknown as AuthorRow[];
    const byId = new Map(rows.map((r) => [r.id, r]));
    return ids.map((id) => byId.get(id) ?? null);
  });

  const reviewsByBookId = new DataLoader<number, ReviewRow[]>(async (bookIds) => {
    const placeholders = bookIds.map(() => "?").join(",");
    const rows = db
      .prepare(`SELECT * FROM reviews WHERE book_id IN (${placeholders})`)
      .all(...bookIds) as unknown as ReviewRow[];
    const byBook = new Map<number, ReviewRow[]>();
    for (const row of rows) {
      const list = byBook.get(row.book_id) ?? [];
      list.push(row);
      byBook.set(row.book_id, list);
    }
    return bookIds.map((id) => byBook.get(id) ?? []);
  });

  return { authorById, reviewsByBookId };
}
