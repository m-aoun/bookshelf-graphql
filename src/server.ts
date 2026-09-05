import { ApolloServer } from "@apollo/server";
import { GraphQLError, GraphQLFormattedError } from "graphql";
import { typeDefs } from "./schema";
import { resolvers } from "./resolvers";
import { GraphQLContext } from "./context";

export function createApolloServer(): ApolloServer<GraphQLContext> {
  return new ApolloServer<GraphQLContext>({
    typeDefs,
    resolvers,
    formatError: (formattedError: GraphQLFormattedError, error: unknown): GraphQLFormattedError => {
      // Make sure every error surfaced to clients carries a stable `code`
      // extension instead of the generic `INTERNAL_SERVER_ERROR` default.
      const code = formattedError.extensions?.code ?? "INTERNAL_SERVER_ERROR";
      const original = error instanceof GraphQLError ? error : undefined;
      return {
        message: formattedError.message,
        path: formattedError.path,
        extensions: {
          code,
          ...(original?.extensions?.http ? { http: original.extensions.http } : {}),
        },
      };
    },
  });
}
