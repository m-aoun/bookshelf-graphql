import { TokenPayload, getUserFromAuthHeader } from "./auth";
import { createLoaders, Loaders } from "./loaders";

export interface GraphQLContext {
  user: TokenPayload | null;
  loaders: Loaders;
}

export function buildContext(authHeader?: string): GraphQLContext {
  return {
    user: getUserFromAuthHeader(authHeader),
    loaders: createLoaders(),
  };
}
