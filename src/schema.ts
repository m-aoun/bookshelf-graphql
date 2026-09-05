export const typeDefs = `#graphql
  scalar Int

  type Author {
    id: ID!
    name: String!
    bio: String
    books: [Book!]!
  }

  enum ShelfStatus {
    WANT_TO_READ
    READING
    FINISHED
  }

  type Book {
    id: ID!
    title: String!
    author: Author!
    genre: String
    publishedYear: Int
    averageRating: Float
    reviews: [Review!]!
  }

  type Review {
    id: ID!
    rating: Int!
    text: String
    reviewer: User!
    book: Book!
    createdAt: String!
  }

  type User {
    id: ID!
    email: String!
  }

  type ShelfEntry {
    id: ID!
    book: Book!
    status: ShelfStatus!
    updatedAt: String!
  }

  type AuthPayload {
    token: String!
    user: User!
  }

  type BookConnection {
    items: [Book!]!
    totalCount: Int!
    limit: Int!
    offset: Int!
  }

  input BookFilter {
    genre: String
    authorId: ID
    search: String
  }

  type Query {
    books(filter: BookFilter, limit: Int = 10, offset: Int = 0): BookConnection!
    book(id: ID!): Book
    authors: [Author!]!
    author(id: ID!): Author
    myShelf: [ShelfEntry!]!
    me: User
  }

  type Mutation {
    signup(email: String!, password: String!): AuthPayload!
    login(email: String!, password: String!): AuthPayload!

    addAuthor(name: String!, bio: String): Author!
    addBook(title: String!, authorId: ID!, genre: String, publishedYear: Int): Book!
    addReview(bookId: ID!, rating: Int!, text: String): Review!

    addToShelf(bookId: ID!, status: ShelfStatus!): ShelfEntry!
    updateShelfStatus(bookId: ID!, status: ShelfStatus!): ShelfEntry!
  }
`;
