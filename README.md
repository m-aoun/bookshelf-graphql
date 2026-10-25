# Bookshelf GraphQL API

A GraphQL API for tracking books, authors, and personal reading progress —
built to demonstrate GraphQL API engineering (schema design, resolvers,
auth, computed fields, pagination, and proper error handling) rather than
another REST CRUD exercise.

Built with **Apollo Server 4** (standalone) + **TypeScript** on top of
SQLite, with JWT-based authentication exposed through GraphQL mutations.

## Why GraphQL here

- A single `books(filter, limit, offset)` query lets a client ask for exactly
  the shape it needs (`title` only, or `title + author + reviews`), instead
  of a REST client either over-fetching or the server growing a pile of
  `?include=` query params.
- `averageRating` is a **computed resolver field**, not a stored column — it
  aggregates the `reviews` table live on every request, which is the kind of
  thing GraphQL resolvers are good at and REST controllers tend to bolt on
  awkwardly.
- Errors use Apollo's `extensions.code` (`UNAUTHENTICATED`, `BAD_USER_INPUT`,
  `FORBIDDEN`, `NOT_FOUND`) so clients can branch on a stable machine-readable
  code instead of parsing HTTP status + message text.

## Features

- **Auth**: `signup` / `login` mutations issue a JWT (7-day expiry, HS256).
  The token is sent as `Authorization: Bearer <token>` and verified per
  request in the Apollo `context` function.
- **Authors & Books**: create authors and books, list/filter/paginate books,
  fetch a single book or author with its relations.
- **Reviews**: authenticated users can review a book (rating 1–5 + text).
  A user can review a given book **at most once** — a second attempt is
  rejected with a `FORBIDDEN` GraphQL error, not a silent overwrite.
- **`averageRating`**: computed live from the `reviews` table via
  `AVG(rating)`, rounded to 2 decimal places.
- **Personal shelf**: authenticated users can add books to their shelf with a
  reading status (`WANT_TO_READ` / `READING` / `FINISHED`) and update it.
  `myShelf` requires auth and returns a `UNAUTHENTICATED` GraphQL error
  (HTTP-equivalent 401, carried in `extensions.http.status`) when called
  without a token.
- **Pagination**: `books` uses simple `limit`/`offset` pagination (capped at
  100 per page) plus a `totalCount` so a client can compute page count. This
  was chosen over cursor-based pagination for simplicity — see
  [Trade-offs](#trade-offs--next-steps) below for what cursor-based paging
  would add.
- **DataLoader** batching for `Book.author` and `Book.reviews` to avoid N+1
  queries when resolving a list of books (see
  [N+1 handling](#n1-query-handling) below — this one *was* implemented, not
  just mentioned as future work).

## Tech stack

| Layer          | Choice                                    |
|----------------|--------------------------------------------|
| Language       | TypeScript                                 |
| API            | GraphQL via `@apollo/server` (standalone)  |
| Database       | SQLite via Node's built-in `node:sqlite`   |
| Auth           | JWT (`jsonwebtoken`) + `bcryptjs` hashing  |
| N+1 mitigation | `dataloader`                               |
| Testing        | Jest + `ts-jest`, executed against the real GraphQL schema via `@apollo/server`'s `executeOperation` |

### A note on the database driver

This project originally targeted `better-sqlite3`. Its native binding needs
a local C++ toolchain to compile when no prebuilt binary matches the
installed Node version — on the Windows machine this was built on, that
install failed with `gyp ERR! find VS` (no Visual Studio Build Tools
installed), and even succeeded only intermittently depending on npm's cache
state. Rather than ship a project that only installs cleanly on some
machines, this project uses Node's built-in **[`node:sqlite`](https://nodejs.org/api/sqlite.html)**
module (`DatabaseSync`) instead. It ships with Node itself — zero native
compilation, zero extra install risk.

**Requirement: Node.js >= 22.5.0.** `node:sqlite` is unflagged (no CLI flag
needed) from Node >= 23.4; on Node 22.5–22.x it's still behind
`--experimental-sqlite`. To make this work on either, every npm script
that touches the database sets `NODE_OPTIONS=--experimental-sqlite` via
`cross-env` — harmless on newer Node, required on older 22.x. You do not
need to pass any flag yourself.

## Schema overview

```graphql
type Author { id: ID! name: String! bio: String books: [Book!]! }

type Book {
  id: ID!
  title: String!
  author: Author!
  genre: String
  publishedYear: Int
  averageRating: Float   # computed from Review rows
  reviews: [Review!]!
}

type Review { id: ID! rating: Int! text: String reviewer: User! book: Book! createdAt: String! }
type User { id: ID! email: String! }
type ShelfEntry { id: ID! book: Book! status: ShelfStatus! updatedAt: String! }
enum ShelfStatus { WANT_TO_READ READING FINISHED }

type Query {
  books(filter: BookFilter, limit: Int = 10, offset: Int = 0): BookConnection!
  book(id: ID!): Book
  authors: [Author!]!
  author(id: ID!): Author
  myShelf: [ShelfEntry!]!      # requires auth
  me: User
}

type Mutation {
  signup(email: String!, password: String!): AuthPayload!
  login(email: String!, password: String!): AuthPayload!
  addAuthor(name: String!, bio: String): Author!
  addBook(title: String!, authorId: ID!, genre: String, publishedYear: Int): Book!
  addReview(bookId: ID!, rating: Int!, text: String): Review!      # requires auth
  addToShelf(bookId: ID!, status: ShelfStatus!): ShelfEntry!       # requires auth
  updateShelfStatus(bookId: ID!, status: ShelfStatus!): ShelfEntry! # requires auth
}
```

Full definition: [`src/schema.ts`](src/schema.ts).

## Setup

```bash
git clone https://github.com/m-aoun/bookshelf-graphql.git
cd bookshelf-graphql
npm install
cp .env.example .env      # edit JWT_SECRET for anything beyond local dev
npm run build
npm start                 # or: npm run dev  (ts-node-dev, auto-restart)
```

The server prints its URL on startup, e.g. `http://localhost:4000/`. Since
this uses `@apollo/server/standalone`, visiting that URL in a browser opens
**Apollo Sandbox**, an interactive GraphQL explorer, with no extra setup.

### Environment variables (`.env`)

| Variable     | Purpose                                  | Example                  |
|--------------|-------------------------------------------|---------------------------|
| `PORT`       | HTTP port for the server                  | `4000`                    |
| `JWT_SECRET` | Secret used to sign/verify JWTs           | a long random string      |
| `DB_FILE`    | Path to the SQLite database file          | `./bookshelf.sqlite`      |

`.env` is gitignored; `.env.example` is committed as the template.

## Running the tests

```bash
npm test
```

Tests run with `NODE_ENV=test`, which points the app at an **in-memory**
SQLite database (`:memory:`) instead of the file in `DB_FILE`, so tests
never touch your local `bookshelf.sqlite` and each test file gets a clean
slate. Tests call `@apollo/server`'s `executeOperation` directly against the
real schema + real resolvers + real (in-memory) SQLite — this is not a
mocked resolver unit test.

**Real output from this repo (`npm test`):**

```
> bookshelf-graphql@1.0.0 test
> cross-env NODE_OPTIONS=--experimental-sqlite jest --runInBand

(node:25400) ExperimentalWarning: SQLite is an experimental feature and might change at any time
(Use `node --trace-warnings ...` to show where the warning was created)
PASS tests/api.test.ts (7.47 s)
  Bookshelf GraphQL API
    √ signup then login returns a working token (795 ms)
    √ login with wrong password returns UNAUTHENTICATED (142 ms)
    √ addAuthor, addBook, addReview work end-to-end and averageRating is computed (133 ms)
    √ a user cannot review the same book twice (71 ms)
    √ books query supports genre/search filters and limit/offset pagination (10 ms)
    √ myShelf requires authentication (6 ms)
    √ addToShelf and updateShelfStatus manage myShelf for the logged-in user (69 ms)

Test Suites: 1 passed, 1 total
Tests:       7 passed, 7 total
Snapshots:   0 total
Time:        8.102 s
Ran all test suites.
```

## Example requests (real, captured against a running local server)

Every response below was captured by starting the server locally
(`npm start`) and sending real `curl` requests — nothing here is
hand-written/fabricated JSON.

### 1. Sign up

```bash
curl -s -X POST http://localhost:4000/ \
  -H "Content-Type: application/json" \
  -d '{"query":"mutation { signup(email: \"demo@bookshelf.dev\", password: \"password123\") { token user { id email } } }"}'
```

```json
{"data":{"signup":{"token":"eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...","user":{"id":"1","email":"demo@bookshelf.dev"}}}}
```

### 2. Add an author, add a book

```bash
curl -s -X POST http://localhost:4000/ -H "Content-Type: application/json" \
  -d '{"query":"mutation { addAuthor(name: \"Frank Herbert\", bio: \"American science fiction author\") { id name bio } }"}'
```
```json
{"data":{"addAuthor":{"id":"1","name":"Frank Herbert","bio":"American science fiction author"}}}
```

```bash
curl -s -X POST http://localhost:4000/ -H "Content-Type: application/json" \
  -d '{"query":"mutation { addBook(title: \"Dune\", authorId: \"1\", genre: \"Sci-Fi\", publishedYear: 1965) { id title genre publishedYear averageRating author { name } } }"}'
```
```json
{"data":{"addBook":{"id":"1","title":"Dune","genre":"Sci-Fi","publishedYear":1965,"averageRating":null,"author":{"name":"Frank Herbert"}}}}
```

Note `averageRating` is `null` — no reviews exist yet, so there is nothing
to average.

### 3. Add a review (authenticated), then try to add a second one

```bash
curl -s -X POST http://localhost:4000/ -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"query":"mutation { addReview(bookId: \"1\", rating: 5, text: \"A masterpiece.\") { id rating text reviewer { email } } }"}'
```
```json
{"data":{"addReview":{"id":"1","rating":5,"text":"A masterpiece.","reviewer":{"email":"demo@bookshelf.dev"}}}}
```

```bash
curl -s -X POST http://localhost:4000/ -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"query":"mutation { addReview(bookId: \"1\", rating: 2, text: \"changed my mind\") { id } }"}'
```
```json
{"errors":[{"message":"You have already reviewed this book.","path":["addReview"],"extensions":{"code":"FORBIDDEN","http":{"status":403}}}],"data":null}
```

### 4. `myShelf` without a token vs. with one

```bash
curl -s -X POST http://localhost:4000/ -H "Content-Type: application/json" \
  -d '{"query":"query { myShelf { status } }"}'
```
```json
{"errors":[{"message":"You must be logged in to perform this action.","path":["myShelf"],"extensions":{"code":"UNAUTHENTICATED","http":{"status":401}}}],"data":null}
```

```bash
curl -s -X POST http://localhost:4000/ -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"query":"mutation { addToShelf(bookId: \"1\", status: WANT_TO_READ) { id status book { title } } }"}'
```
```json
{"data":{"addToShelf":{"id":"1","status":"WANT_TO_READ","book":{"title":"Dune"}}}}
```

```bash
curl -s -X POST http://localhost:4000/ -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"query":"query { myShelf { status book { title averageRating } } }"}'
```
```json
{"data":{"myShelf":[{"status":"WANT_TO_READ","book":{"title":"Dune","averageRating":5}}]}}
```

### 5. Filtering + pagination

```bash
curl -s -X POST http://localhost:4000/ -H "Content-Type: application/json" \
  -d '{"query":"query { books(filter: { genre: \"Sci-Fi\" }, limit: 5, offset: 0) { totalCount limit offset items { title averageRating reviews { rating } } } }"}'
```
```json
{"data":{"books":{"totalCount":1,"limit":5,"offset":0,"items":[{"title":"Dune","averageRating":5,"reviews":[{"rating":5}]}]}}}
```

## N+1 query handling

`DataLoader` **is implemented** for two hot paths:

- `Book.author` — resolving `author` across a list of N books batches into
  a single `SELECT * FROM authors WHERE id IN (...)` instead of N queries.
- `Book.reviews` — same idea for `SELECT * FROM reviews WHERE book_id IN (...)`.

A fresh set of loaders is created per request (see `src/context.ts` /
`src/loaders.ts`), which is the correct DataLoader lifetime — loaders must
not be shared across requests or they'll leak stale cache/data between
users.

**Not batched (left as an honest gap):** `Review.reviewer`, `Review.book`,
and `ShelfEntry.book` still do a per-row `SELECT ... WHERE id = ?`. On a
larger dataset those would get the same DataLoader treatment. They were left
alone here because the assignment only asked for `Book.author` /
`Book.reviews` as the nice-to-have, and because with SQLite (no network
round-trip per query) the practical cost of these is negligible — the value
of DataLoader here is mostly educational/demonstrative of the pattern for an
interviewer, and it's applied in full on the two fields that were called out
in the schema explicitly.

## Trade-offs & next steps

- **Pagination**: `limit`/`offset` was chosen over cursor-based pagination
  for simplicity and because the dataset here doesn't need
  stable-under-mutation cursors. A production version with high write
  volume would switch to a cursor (e.g. base64-encoded `id`) to avoid the
  classic "page 2 skips/repeats a row because something was inserted"
  problem with offset pagination.
- **Scaling further**: extend DataLoader coverage to `Review.reviewer` /
  `Review.book` / `ShelfEntry.book`, add a Redis-backed cache for
  `averageRating` on high-traffic books (currently recomputed every
  request — correct but not free at scale), and move from SQLite to
  Postgres for concurrent-write safety.
- **`node:sqlite` is still an experimental Node API** (see the driver note
  above). It was the pragmatic choice for a portfolio project on a machine
  without a C++ build toolchain; a production deployment might reconsider
  `better-sqlite3` (with prebuilt binaries verified for the target
  environment) or Postgres.

## Project structure

```
src/
  schema.ts       GraphQL type definitions
  resolvers.ts     Query/Mutation/type resolvers
  db.ts            node:sqlite setup + schema migrations
  auth.ts          JWT signing/verification, password hashing
  context.ts       per-request GraphQL context (auth user + DataLoaders)
  loaders.ts       DataLoader batch functions
  server.ts        ApolloServer instance + error formatting
  index.ts         entrypoint (startStandaloneServer)
tests/
  api.test.ts      end-to-end tests against the real GraphQL schema
  helpers.ts       test helpers (fresh in-memory DB + server per test)
```

## License

MIT — see [LICENSE](LICENSE).

## Author

**Muhammad Aoun Shabbir** — [github.com/m-aoun](https://github.com/m-aoun)
