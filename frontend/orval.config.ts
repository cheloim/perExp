import { defineConfig } from "orval";

export default defineConfig({
  oikonomia: {
    input: {
      target: "../specs/openapi.yaml",
    },
    output: {
      target: "./src/api/client.ts",
      schemas: "./src/types/generated",
      client: "react-query",
      httpClient: "axios",
      override: {
        mutator: {
          path: "./src/api/axios-instance.ts",
          name: "customInstance",
        },
      },
    },
  },
});
