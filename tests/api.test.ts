import { ApolloServer } from "@apollo/server";
import { freshServer, execute } from "./helpers";
import { GraphQLContext } from "../src/context";

describe("Bookshelf GraphQL API", () => {
  let server: ApolloServer<GraphQLContext>;

  beforeEach(() => {
    server = freshServer();
  });

  async function signup(email: string, password = "hunter22") {
    const result = await execute(
      server,
      `mutation Signup($email: String!, $password: String!) {
        signup(email: $email, password: $password) {
          token
          user { id email }
        }
      }`,
      { email, password }
    );
    expect(result.errors).toBeUndefined();
    return result.data!.signup as { token: string; user: { id: string; email: string } };
  }

  test("signup then login returns a working token", async () => {
    await signup("reader@example.com");

    const loginResult = await execute(
      server,
      `mutation Login($email: String!, $password: String!) {
        login(email: $email, password: $password) {
          token
          user { email }
        }
      }`,
      { email: "reader@example.com", password: "hunter22" }
    );

    expect(loginResult.errors).toBeUndefined();
    const login = loginResult.data!.login as { token: string; user: { email: string } };
    expect(login.token).toEqual(expect.any(String));
    expect(login.user.email).toBe("reader@example.com");
  });

  test("login with wrong password returns UNAUTHENTICATED", async () => {
    await signup("wrongpass@example.com");

    const result = await execute(
      server,
      `mutation Login($email: String!, $password: String!) {
        login(email: $email, password: $password) { token }
      }`,
      { email: "wrongpass@example.com", password: "nope-nope" }
    );

    expect(result.data?.login ?? null).toBeNull();
    expect(result.errors?.[0].extensions?.code).toBe("UNAUTHENTICATED");
  });

  test("addAuthor, addBook, addReview work end-to-end and averageRating is computed", async () => {
    const alice = await signup("alice@example.com");
    const bob = await signup("bob@example.com");

    const authorResult = await execute(
      server,
      `mutation { addAuthor(name: "Ursula K. Le Guin", bio: "Sci-fi & fantasy author") { id name } }`
    );
    expect(authorResult.errors).toBeUndefined();
    const authorId = (authorResult.data!.addAuthor as { id: string }).id;

    const bookResult = await execute(
      server,
      `mutation AddBook($authorId: ID!) {
        addBook(title: "The Left Hand of Darkness", authorId: $authorId, genre: "Sci-Fi", publishedYear: 1969) {
          id
          title
          averageRating
          author { name }
        }
      }`,
      { authorId }
    );
    expect(bookResult.errors).toBeUndefined();
    const book = bookResult.data!.addBook as {
      id: string;
      title: string;
      averageRating: number | null;
      author: { name: string };
    };
    expect(book.title).toBe("The Left Hand of Darkness");
    expect(book.author.name).toBe("Ursula K. Le Guin");
    expect(book.averageRating).toBeNull(); // no reviews yet

    const reviewMutation = `mutation AddReview($bookId: ID!, $rating: Int!, $text: String) {
      addReview(bookId: $bookId, rating: $rating, text: $text) {
        id
        rating
        reviewer { email }
      }
    }`;

    const aliceReview = await execute(
      server,
      reviewMutation,
      { bookId: book.id, rating: 5, text: "Loved it" },
      alice.token
    );
    expect(aliceReview.errors).toBeUndefined();

    const bobReview = await execute(
      server,
      reviewMutation,
      { bookId: book.id, rating: 3, text: "It was fine" },
      bob.token
    );
    expect(bobReview.errors).toBeUndefined();

    const bookAfterReviews = await execute(
      server,
      `query BookById($id: ID!) {
        book(id: $id) {
          averageRating
          reviews { rating text reviewer { email } }
        }
      }`,
      { id: book.id }
    );
    expect(bookAfterReviews.errors).toBeUndefined();
    const refetched = bookAfterReviews.data!.book as {
      averageRating: number;
      reviews: { rating: number }[];
    };
    expect(refetched.averageRating).toBe(4); // (5 + 3) / 2
    expect(refetched.reviews).toHaveLength(2);
  });

  test("a user cannot review the same book twice", async () => {
    const alice = await signup("dupe@example.com");
    const authorResult = await execute(server, `mutation { addAuthor(name: "Author One") { id } }`);
    const authorId = (authorResult.data!.addAuthor as { id: string }).id;
    const bookResult = await execute(
      server,
      `mutation AddBook($authorId: ID!) { addBook(title: "Book One", authorId: $authorId) { id } }`,
      { authorId }
    );
    const bookId = (bookResult.data!.addBook as { id: string }).id;

    const reviewMutation = `mutation AddReview($bookId: ID!, $rating: Int!) {
      addReview(bookId: $bookId, rating: $rating) { id }
    }`;

    const first = await execute(server, reviewMutation, { bookId, rating: 4 }, alice.token);
    expect(first.errors).toBeUndefined();

    const second = await execute(server, reviewMutation, { bookId, rating: 2 }, alice.token);
    expect(second.data?.addReview ?? null).toBeNull();
    expect(second.errors?.[0].extensions?.code).toBe("FORBIDDEN");
    expect(second.errors?.[0].message).toMatch(/already reviewed/i);
  });

  test("books query supports genre/search filters and limit/offset pagination", async () => {
    const authorResult = await execute(server, `mutation { addAuthor(name: "Prolific Writer") { id } }`);
    const authorId = (authorResult.data!.addAuthor as { id: string }).id;

    const titles = [
      { title: "Dragon's Dawn", genre: "Fantasy" },
      { title: "Dragon's Dusk", genre: "Fantasy" },
      { title: "Space Odyssey", genre: "Sci-Fi" },
    ];
    for (const b of titles) {
      await execute(
        server,
        `mutation AddBook($authorId: ID!, $title: String!, $genre: String) {
          addBook(title: $title, authorId: $authorId, genre: $genre) { id }
        }`,
        { authorId, title: b.title, genre: b.genre }
      );
    }

    const filtered = await execute(
      server,
      `query { books(filter: { genre: "Fantasy" }) { totalCount items { title } } }`
    );
    expect(filtered.errors).toBeUndefined();
    const filteredData = filtered.data!.books as { totalCount: number; items: { title: string }[] };
    expect(filteredData.totalCount).toBe(2);
    expect(filteredData.items.map((i) => i.title).sort()).toEqual(
      ["Dragon's Dawn", "Dragon's Dusk"].sort()
    );

    const searched = await execute(
      server,
      `query { books(filter: { search: "Odyssey" }) { totalCount items { title } } }`
    );
    const searchedData = searched.data!.books as { totalCount: number };
    expect(searchedData.totalCount).toBe(1);

    const paged = await execute(server, `query { books(limit: 2, offset: 1) { items { title } limit offset totalCount } }`);
    const pagedData = paged.data!.books as { items: { title: string }[]; limit: number; offset: number; totalCount: number };
    expect(pagedData.items).toHaveLength(2);
    expect(pagedData.limit).toBe(2);
    expect(pagedData.offset).toBe(1);
    expect(pagedData.totalCount).toBe(3);
  });

  test("myShelf requires authentication", async () => {
    const result = await execute(server, `query { myShelf { status } }`);
    expect(result.data?.myShelf ?? null).toBeNull();
    expect(result.errors?.[0].extensions?.code).toBe("UNAUTHENTICATED");
  });

  test("addToShelf and updateShelfStatus manage myShelf for the logged-in user", async () => {
    const alice = await signup("shelf@example.com");
    const authorResult = await execute(server, `mutation { addAuthor(name: "Shelf Author") { id } }`);
    const authorId = (authorResult.data!.addAuthor as { id: string }).id;
    const bookResult = await execute(
      server,
      `mutation AddBook($authorId: ID!) { addBook(title: "Shelf Book", authorId: $authorId) { id } }`,
      { authorId }
    );
    const bookId = (bookResult.data!.addBook as { id: string }).id;

    const addResult = await execute(
      server,
      `mutation AddToShelf($bookId: ID!) {
        addToShelf(bookId: $bookId, status: WANT_TO_READ) { status book { title } }
      }`,
      { bookId },
      alice.token
    );
    expect(addResult.errors).toBeUndefined();
    expect((addResult.data!.addToShelf as { status: string }).status).toBe("WANT_TO_READ");

    const updateResult = await execute(
      server,
      `mutation UpdateShelf($bookId: ID!) {
        updateShelfStatus(bookId: $bookId, status: READING) { status }
      }`,
      { bookId },
      alice.token
    );
    expect(updateResult.errors).toBeUndefined();
    expect((updateResult.data!.updateShelfStatus as { status: string }).status).toBe("READING");

    const shelfResult = await execute(
      server,
      `query { myShelf { status book { title } } }`,
      {},
      alice.token
    );
    expect(shelfResult.errors).toBeUndefined();
    const shelf = shelfResult.data!.myShelf as { status: string; book: { title: string } }[];
    expect(shelf).toHaveLength(1);
    expect(shelf[0].status).toBe("READING");
    expect(shelf[0].book.title).toBe("Shelf Book");
  });
});
