import { GraphQLError } from "graphql";
import { db } from "./db";
import { hashPassword, verifyPassword, signToken, requireAuth } from "./auth";
import { GraphQLContext } from "./context";
import { AuthorRow, BookRow, ReviewRow, ShelfEntryRow, UserRow } from "./types";

function badInput(message: string): never {
  throw new GraphQLError(message, {
    extensions: { code: "BAD_USER_INPUT", http: { status: 400 } },
  });
}

function notFound(message: string): never {
  throw new GraphQLError(message, {
    extensions: { code: "NOT_FOUND", http: { status: 404 } },
  });
}

function toGlobalUser(row: UserRow) {
  return { id: row.id, email: row.email };
}

function computeAverageRating(bookId: number): number | null {
  const row = db
    .prepare(`SELECT AVG(rating) as avg FROM reviews WHERE book_id = ?`)
    .get(bookId) as { avg: number | null };
  return row.avg === null ? null : Math.round(row.avg * 100) / 100;
}

export const resolvers = {
  Query: {
    books: (
      _: unknown,
      args: {
        filter?: { genre?: string; authorId?: string; search?: string };
        limit?: number;
        offset?: number;
      }
    ) => {
      const limit = Math.min(Math.max(args.limit ?? 10, 1), 100);
      const offset = Math.max(args.offset ?? 0, 0);
      const { genre, authorId, search } = args.filter ?? {};

      const clauses: string[] = [];
      const params: (string | number)[] = [];

      if (genre) {
        clauses.push("genre = ?");
        params.push(genre);
      }
      if (authorId) {
        clauses.push("author_id = ?");
        params.push(Number(authorId));
      }
      if (search) {
        clauses.push("title LIKE ?");
        params.push(`%${search}%`);
      }

      const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";

      const totalCount = (
        db.prepare(`SELECT COUNT(*) as count FROM books ${where}`).get(...params) as {
          count: number;
        }
      ).count;

      const items = db
        .prepare(`SELECT * FROM books ${where} ORDER BY id ASC LIMIT ? OFFSET ?`)
        .all(...params, limit, offset) as unknown as BookRow[];

      return { items, totalCount, limit, offset };
    },

    book: (_: unknown, args: { id: string }) => {
      const row = db.prepare(`SELECT * FROM books WHERE id = ?`).get(Number(args.id)) as unknown as
        | BookRow
        | undefined;
      return row ?? null;
    },

    authors: () => db.prepare(`SELECT * FROM authors ORDER BY id ASC`).all() as unknown as AuthorRow[],

    author: (_: unknown, args: { id: string }) => {
      const row = db.prepare(`SELECT * FROM authors WHERE id = ?`).get(Number(args.id)) as unknown as
        | AuthorRow
        | undefined;
      return row ?? null;
    },

    myShelf: (_: unknown, __: unknown, context: GraphQLContext) => {
      const user = requireAuth(context.user);
      return db
        .prepare(`SELECT * FROM shelf_entries WHERE user_id = ? ORDER BY id ASC`)
        .all(user.userId) as unknown as ShelfEntryRow[];
    },

    me: (_: unknown, __: unknown, context: GraphQLContext) => {
      if (!context.user) return null;
      const row = db.prepare(`SELECT * FROM users WHERE id = ?`).get(context.user.userId) as unknown as
        | UserRow
        | undefined;
      return row ? toGlobalUser(row) : null;
    },
  },

  Mutation: {
    signup: (_: unknown, args: { email: string; password: string }) => {
      const email = args.email.trim().toLowerCase();
      if (!email || !email.includes("@")) badInput("A valid email is required.");
      if (!args.password || args.password.length < 6) {
        badInput("Password must be at least 6 characters long.");
      }

      const existing = db.prepare(`SELECT id FROM users WHERE email = ?`).get(email);
      if (existing) badInput("An account with that email already exists.");

      const passwordHash = hashPassword(args.password);
      const result = db
        .prepare(`INSERT INTO users (email, password_hash) VALUES (?, ?)`)
        .run(email, passwordHash);

      const userId = Number(result.lastInsertRowid);
      const token = signToken({ userId, email });
      return { token, user: { id: userId, email } };
    },

    login: (_: unknown, args: { email: string; password: string }) => {
      const email = args.email.trim().toLowerCase();
      const row = db.prepare(`SELECT * FROM users WHERE email = ?`).get(email) as unknown as
        | UserRow
        | undefined;

      if (!row || !verifyPassword(args.password, row.password_hash)) {
        throw new GraphQLError("Invalid email or password.", {
          extensions: { code: "UNAUTHENTICATED", http: { status: 401 } },
        });
      }

      const token = signToken({ userId: row.id, email: row.email });
      return { token, user: toGlobalUser(row) };
    },

    addAuthor: (_: unknown, args: { name: string; bio?: string }) => {
      if (!args.name || !args.name.trim()) badInput("Author name is required.");
      const result = db
        .prepare(`INSERT INTO authors (name, bio) VALUES (?, ?)`)
        .run(args.name.trim(), args.bio ?? null);
      return db.prepare(`SELECT * FROM authors WHERE id = ?`).get(Number(result.lastInsertRowid));
    },

    addBook: (
      _: unknown,
      args: { title: string; authorId: string; genre?: string; publishedYear?: number }
    ) => {
      if (!args.title || !args.title.trim()) badInput("Book title is required.");

      const author = db
        .prepare(`SELECT id FROM authors WHERE id = ?`)
        .get(Number(args.authorId));
      if (!author) notFound(`No author found with id ${args.authorId}.`);

      const result = db
        .prepare(
          `INSERT INTO books (title, author_id, genre, published_year) VALUES (?, ?, ?, ?)`
        )
        .run(
          args.title.trim(),
          Number(args.authorId),
          args.genre ?? null,
          args.publishedYear ?? null
        );
      return db.prepare(`SELECT * FROM books WHERE id = ?`).get(Number(result.lastInsertRowid));
    },

    addReview: (
      _: unknown,
      args: { bookId: string; rating: number; text?: string },
      context: GraphQLContext
    ) => {
      const user = requireAuth(context.user);

      if (args.rating < 1 || args.rating > 5) {
        badInput("Rating must be between 1 and 5.");
      }

      const book = db.prepare(`SELECT id FROM books WHERE id = ?`).get(Number(args.bookId));
      if (!book) notFound(`No book found with id ${args.bookId}.`);

      const existing = db
        .prepare(`SELECT id FROM reviews WHERE book_id = ? AND reviewer_id = ?`)
        .get(Number(args.bookId), user.userId);
      if (existing) {
        throw new GraphQLError("You have already reviewed this book.", {
          extensions: { code: "FORBIDDEN", http: { status: 403 } },
        });
      }

      const result = db
        .prepare(
          `INSERT INTO reviews (book_id, reviewer_id, rating, text) VALUES (?, ?, ?, ?)`
        )
        .run(Number(args.bookId), user.userId, args.rating, args.text ?? null);

      return db.prepare(`SELECT * FROM reviews WHERE id = ?`).get(Number(result.lastInsertRowid));
    },

    addToShelf: (
      _: unknown,
      args: { bookId: string; status: string },
      context: GraphQLContext
    ) => {
      const user = requireAuth(context.user);

      const book = db.prepare(`SELECT id FROM books WHERE id = ?`).get(Number(args.bookId));
      if (!book) notFound(`No book found with id ${args.bookId}.`);

      const existing = db
        .prepare(`SELECT id FROM shelf_entries WHERE user_id = ? AND book_id = ?`)
        .get(user.userId, Number(args.bookId));
      if (existing) {
        badInput("This book is already on your shelf. Use updateShelfStatus instead.");
      }

      const result = db
        .prepare(
          `INSERT INTO shelf_entries (user_id, book_id, status) VALUES (?, ?, ?)`
        )
        .run(user.userId, Number(args.bookId), args.status);

      return db.prepare(`SELECT * FROM shelf_entries WHERE id = ?`).get(Number(result.lastInsertRowid));
    },

    updateShelfStatus: (
      _: unknown,
      args: { bookId: string; status: string },
      context: GraphQLContext
    ) => {
      const user = requireAuth(context.user);

      const existing = db
        .prepare(`SELECT * FROM shelf_entries WHERE user_id = ? AND book_id = ?`)
        .get(user.userId, Number(args.bookId)) as unknown as ShelfEntryRow | undefined;

      if (!existing) {
        notFound("This book is not on your shelf yet. Use addToShelf first.");
      }

      db.prepare(
        `UPDATE shelf_entries SET status = ?, updated_at = datetime('now') WHERE id = ?`
      ).run(args.status, existing!.id);

      return db.prepare(`SELECT * FROM shelf_entries WHERE id = ?`).get(existing!.id);
    },
  },

  Author: {
    books: (parent: AuthorRow) =>
      db.prepare(`SELECT * FROM books WHERE author_id = ?`).all(parent.id) as unknown as BookRow[],
  },

  Book: {
    author: (parent: BookRow, _: unknown, context: GraphQLContext) =>
      context.loaders.authorById.load(parent.author_id),
    publishedYear: (parent: BookRow) => parent.published_year,
    averageRating: (parent: BookRow) => computeAverageRating(parent.id),
    reviews: (parent: BookRow, _: unknown, context: GraphQLContext) =>
      context.loaders.reviewsByBookId.load(parent.id),
  },

  Review: {
    reviewer: (parent: ReviewRow) => {
      const row = db.prepare(`SELECT * FROM users WHERE id = ?`).get(parent.reviewer_id) as unknown as
        | UserRow
        | undefined;
      return row ? toGlobalUser(row) : null;
    },
    book: (parent: ReviewRow) =>
      db.prepare(`SELECT * FROM books WHERE id = ?`).get(parent.book_id) as unknown as BookRow,
    createdAt: (parent: ReviewRow) => parent.created_at,
  },

  ShelfEntry: {
    book: (parent: ShelfEntryRow) =>
      db.prepare(`SELECT * FROM books WHERE id = ?`).get(parent.book_id) as unknown as BookRow,
    updatedAt: (parent: ShelfEntryRow) => parent.updated_at,
  },
};
