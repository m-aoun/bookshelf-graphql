import "dotenv/config";
import { startStandaloneServer } from "@apollo/server/standalone";
import { createApolloServer } from "./server";
import { buildContext } from "./context";
import { initSchema } from "./db";

async function main() {
  initSchema();

  const server = createApolloServer();
  const port = Number(process.env.PORT) || 4000;

  const { url } = await startStandaloneServer(server, {
    listen: { port },
    context: async ({ req }) => buildContext(req.headers.authorization),
  });

  console.log(`Bookshelf GraphQL API ready at ${url}`);
}

main().catch((err) => {
  console.error("Failed to start server:", err);
  process.exit(1);
});
