module.exports = {
  agentManager: {
    input: "../agent-manager/openapi.json",
    output: {
      mode: "single",
      target: "./src/api/generated/agent-manager.ts",
      client: "react-query",
      httpClient: "fetch",
      override: {
        mutator: {
          path: "./src/api/orval-fetcher.ts",
          name: "orvalFetcher",
        },
      },
    },
  },
  agentRuntime: {
    input: "../agent-go/internal/openapi/openapi.json",
    output: {
      mode: "single",
      target: "./src/api/generated/agent.ts",
      client: "fetch",
      override: {
        mutator: {
          path: "./src/api/orval-agent-fetcher.ts",
          name: "orvalAgentFetcher",
        },
      },
    },
  },
};
