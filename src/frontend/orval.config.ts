import { defineConfig } from "orval";

export default defineConfig({
  oikonomia: {
    input: {
      target: "../../docs/specs/openapi.yaml",
    },
    output: {
      // Generated but untracked: no runtime imports it today. The file is
      // recreated by `npm run generate:api` and by the CI specs job.
      target: "./src/api/client-generated.ts",
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
