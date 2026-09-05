import { ApolloServer } from "@apollo/server";
import { createApolloServer } from "../src/server";
import { buildContext, GraphQLContext } from "../src/context";
import { initSchema, resetDb } from "../src/db";

export function freshServer(): ApolloServer<GraphQLContext> {
  initSchema();
  resetDb();
  return createApolloServer();
}

export async function execute(
  server: ApolloServer<GraphQLContext>,
  query: string,
  variables: Record<string, unknown> = {},
  token?: string
) {
  const contextValue = buildContext(token ? `Bearer ${token}` : undefined);
  const response = await server.executeOperation({ query, variables }, { contextValue });
  if (response.body.kind !== "single") {
    throw new Error("Expected a single result");
  }
  return response.body.singleResult;
}
