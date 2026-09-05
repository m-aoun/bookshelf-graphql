import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { GraphQLError } from "graphql";

const JWT_SECRET = process.env.JWT_SECRET || "insecure-dev-secret-change-me";
const TOKEN_TTL = "7d";

export interface TokenPayload {
  userId: number;
  email: string;
}

export function hashPassword(password: string): string {
  return bcrypt.hashSync(password, 10);
}

export function verifyPassword(password: string, hash: string): boolean {
  return bcrypt.compareSync(password, hash);
}

export function signToken(payload: TokenPayload): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: TOKEN_TTL });
}

export function verifyToken(token: string): TokenPayload | null {
  try {
    return jwt.verify(token, JWT_SECRET) as TokenPayload;
  } catch {
    return null;
  }
}

export function getUserFromAuthHeader(authHeader?: string): TokenPayload | null {
  if (!authHeader) return null;
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  if (!match) return null;
  return verifyToken(match[1]);
}

export function requireAuth(user: TokenPayload | null): TokenPayload {
  if (!user) {
    throw new GraphQLError("You must be logged in to perform this action.", {
      extensions: { code: "UNAUTHENTICATED", http: { status: 401 } },
    });
  }
  return user;
}
