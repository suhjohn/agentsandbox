import { spawn } from "node:child_process";

import { Type, type Static, type TSchema } from "@sinclair/typebox";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

type ClientToolErrorEnvelope = {
	code: string;
	message: string;
	retryable: boolean;
};

type ClientToolCallResult = {
	ok: boolean;
	result?: unknown;
	error?: ClientToolErrorEnvelope;
};

type MCPErrorReply = {
	code: number;
	message: string;
};

type MCPToolCallResponse = {
	jsonrpc?: string;
	id?: string | number;
	result?: {
		content?: Array<{ type?: string; text?: string }>;
		structuredContent?: unknown;
	};
	error?: MCPErrorReply;
};

type ToolRegistration<TParams extends TSchema = TSchema> = {
	name: string;
	label: string;
	description: string;
	parameters: TParams;
};

const toolRegistrations: readonly ToolRegistration[] = [
	{
		name: "ui_get_state",
		label: "UI State Snapshot",
		description:
			"Capture the current browser UI state for the attached workspace client. For the returned state shape and snapshot sources, search `agent-manager-web/src/ui-actions/context.ts` and `agent-manager-web/src/frontend-runtime/bridge.ts`. The repo-root env var used elsewhere in agent-go for repo-relative paths is `AGENT_GO_REPO_DIR`.",
		parameters: Type.Object({}, { additionalProperties: false }),
	},
	{
		name: "ui_run_action",
		label: "Run UI Action",
		description:
			"Execute a named UI action in the attached client context. `actionId` is the UI action identifier. Valid action IDs come from the shared UI action catalog in `shared/ui-actions-contract.ts`. `params` must conform to the selected action's `paramsJsonSchema`, and `actionVersion` should match the selected action's declared version. `timeoutMs` is optional. For the action catalog and execution flow, search `shared/ui-actions-contract.ts`, `agent-manager-web/src/ui-actions/execute.ts`, `agent-manager-web/src/ui-actions/registry.ts`, and `agent-manager-web/src/ui-actions/actions/`. The repo-root env var used elsewhere in agent-go for repo-relative paths is `AGENT_GO_REPO_DIR`.",
		parameters: Type.Object(
			{
				actionId: Type.String(),
				actionVersion: Type.Optional(Type.Number()),
				params: Type.Optional(Type.Unknown()),
				timeoutMs: Type.Optional(Type.Number()),
			},
			{ additionalProperties: false },
		),
	},
];

export default function clientToolsExtension(pi: ExtensionAPI) {
	for (const registration of toolRegistrations) {
		registerClientTool(pi, registration);
	}
}

function registerClientTool<TParams extends TSchema>(
	pi: ExtensionAPI,
	registration: ToolRegistration<TParams>,
): void {
	pi.registerTool({
		name: registration.name,
		label: registration.label,
		description: registration.description,
		parameters: registration.parameters,
		async execute(_toolCallId, params, signal) {
			const result = await callClientToolMCP(registration.name, params, signal);
			return {
				content: [{ type: "text", text: JSON.stringify(result) }],
				details: result,
				isError: !result.ok,
			};
		},
	});
}

async function callClientToolMCP<TParams extends TSchema>(
	toolName: string,
	args: Static<TParams>,
	signal?: AbortSignal,
): Promise<ClientToolCallResult> {
	const command = resolveAgentGoCommand();
	const env = buildMCPEnv();
	const requestID = `client-tool-${toolName}-${Date.now()}`;
	const requestPayload = JSON.stringify({
		jsonrpc: "2.0",
		id: requestID,
		method: "tools/call",
		params: {
			name: "client_tool_request",
			arguments: {
				toolName,
				args,
			},
		},
	});

	return new Promise<ClientToolCallResult>((resolve, reject) => {
		const child = spawn(command, ["client-tool-mcp"], {
			env,
			stdio: ["pipe", "pipe", "pipe"],
		});
		let stdout = "";
		let stderr = "";
		let settled = false;

		const finish = (fn: () => void) => {
			if (settled) {
				return;
			}
			settled = true;
			signal?.removeEventListener("abort", onAbort);
			fn();
		};

		const onAbort = () => {
			child.kill();
			finish(() => reject(new Error("Client tool request aborted")));
		};

		if (signal?.aborted) {
			onAbort();
			return;
		}
		signal?.addEventListener("abort", onAbort, { once: true });

		child.on("error", (error) => {
			finish(() => reject(error));
		});

		child.stdout.on("data", (chunk: Buffer | string) => {
			stdout += chunk.toString();
		});
		child.stderr.on("data", (chunk: Buffer | string) => {
			stderr += chunk.toString();
		});

		child.on("close", (code) => {
			finish(() => {
				if (code !== 0) {
					reject(
						new Error(
							`agent-go client-tool-mcp exited with code ${code}: ${stderr.trim() || "unknown error"}`,
						),
					);
					return;
				}

				const response = parseToolCallResponse(stdout, requestID);
				if (response.error) {
					reject(new Error(response.error.message));
					return;
				}

				const structuredContent = parseStructuredContent(response.result?.structuredContent, response.result?.content);
				if (!structuredContent) {
					reject(new Error("client-tool-mcp returned no structuredContent"));
					return;
				}
				resolve(structuredContent);
			});
		});

		child.stdin.end(requestPayload + "\n");
	});
}

function parseToolCallResponse(stdout: string, requestID: string): MCPToolCallResponse {
	const lines = stdout
		.split(/\r?\n/)
		.map((line) => line.trim())
		.filter(Boolean);
	for (const line of lines) {
		const parsed = JSON.parse(line) as MCPToolCallResponse;
		if (String(parsed.id ?? "") === requestID) {
			return parsed;
		}
	}
	throw new Error("client-tool-mcp did not return a matching response");
}

function parseStructuredContent(
	structuredContent: unknown,
	content: Array<{ type?: string; text?: string }> | undefined,
): ClientToolCallResult | null {
	if (isClientToolCallResult(structuredContent)) {
		return structuredContent;
	}
	const firstText = content?.find((item) => item.type === "text" && typeof item.text === "string")?.text;
	if (!firstText) {
		return null;
	}
	const parsed = JSON.parse(firstText) as unknown;
	return isClientToolCallResult(parsed) ? parsed : null;
}

function isClientToolCallResult(value: unknown): value is ClientToolCallResult {
	if (!value || typeof value !== "object") {
		return false;
	}
	return typeof (value as { ok?: unknown }).ok === "boolean";
}

function buildMCPEnv(): NodeJS.ProcessEnv {
	const env = { ...process.env };
	for (const variable of [
		"AGENT_GO_INTERNAL_BASE_URL",
		"AGENT_GO_INTERNAL_TOKEN",
		"AGENT_GO_CLIENT_TOOL_RUN_ID",
	]) {
		if (!env[variable]?.trim()) {
			throw new Error(`${variable} is required for agent-go PI client tools`);
		}
	}
	return env;
}

function resolveAgentGoCommand(): string {
	return process.env.AGENT_SERVER_BIN?.trim() || "agent-go";
}
