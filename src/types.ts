export interface AuthorRow {
  id: number;
  name: string;
  bio: string | null;
}

export interface BookRow {
  id: number;
  title: string;
  author_id: number;
  genre: string | null;
  published_year: number | null;
}

export interface ReviewRow {
  id: number;
  book_id: number;
  reviewer_id: number;
  rating: number;
  text: string | null;
  created_at: string;
}

export interface UserRow {
  id: number;
  email: string;
  password_hash: string;
  created_at: string;
}

export interface ShelfEntryRow {
  id: number;
  user_id: number;
  book_id: number;
  status: "WANT_TO_READ" | "READING" | "FINISHED";
  updated_at: string;
}
