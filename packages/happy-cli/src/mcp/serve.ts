/**
 * happy-ai-cli mcp serve — stdio MCP server exposing happy session APIs.
 *
 * Reads credentials from `~/.happy-ai/` (whatever happy-cli already authenticated
 * with) and surfaces 6 tools:
 *   - happy_session_list      (read)
 *   - happy_session_inspect   (read)
 *   - happy_session_messages  (read)
 *   - happy_session_send      (write)
 *   - happy_session_cancel    (write — requires happy-server with the abort HTTP wrapper)
 *   - happy_session_spawn     (write — proxies daemon RPC `spawn-happy-session`)
 *
 * Runs as a stdio MCP server — register in your Claude/Codex config:
 *   { "mcpServers": { "happy": { "command": "happy-ai-cli", "args": ["mcp", "serve"] } } }
 *
 * IMPORTANT: this process must NEVER write to stdout — that channel is reserved
 * for the MCP JSON-RPC framing. All diagnostics go to stderr.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { readCredentials } from '@/persistence';
import { Credentials } from '@/persistence';
import { runSessionList, sessionListInputSchema } from './tools/sessionList';
import { runSessionInspect, sessionInspectInputSchema } from './tools/sessionInspect';
import { runSessionMessages, sessionMessagesInputSchema } from './tools/sessionMessages';
import { runSessionSend, sessionSendInputSchema } from './tools/sessionSend';
import { runSessionCancel, sessionCancelInputSchema } from './tools/sessionCancel';
import { runSessionSpawn, sessionSpawnInputSchema } from './tools/sessionSpawn';

function logStderr(...parts: unknown[]): void {
    process.stderr.write(`[happy-mcp] ${parts.map(String).join(' ')}\n`);
}

/** Wrap a tool handler so thrown errors become MCP error responses with stderr trace. */
function wrap<I, O>(
    name: string,
    credentials: Credentials,
    handler: (creds: Credentials, input: I) => Promise<O>,
): (input: I) => Promise<{ isError?: boolean; content: Array<{ type: 'text'; text: string }> }> {
    return async (input: I) => {
        try {
            const result = await handler(credentials, input);
            return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            logStderr(`${name} failed:`, message);
            return {
                isError: true,
                content: [{ type: 'text', text: `${name} failed: ${message}` }],
            };
        }
    };
}

export async function runMcpServe(): Promise<void> {
    const credentials = await readCredentials();
    if (!credentials) {
        logStderr('No happy credentials found at ~/.happy-ai/. Run "happy-ai-cli auth" first.');
        process.exit(1);
    }

    const server = new McpServer({
        name: 'happy',
        version: '0.1.0',
    });

    server.tool(
        'happy_session_list',
        'List happy sessions with metadata (status, agent, machine, last-active timestamp). ' +
            'Does not include message content — call happy_session_messages or happy_session_inspect for that.',
        sessionListInputSchema,
        wrap('happy_session_list', credentials, runSessionList),
    );

    server.tool(
        'happy_session_inspect',
        'Snapshot one session: status, agent/machine, current agentState, and the last few decrypted messages as 200-char previews. ' +
            'Use when you want a quick "what is this session doing right now" answer.',
        sessionInspectInputSchema,
        wrap('happy_session_inspect', credentials, runSessionInspect),
    );

    server.tool(
        'happy_session_messages',
        'Paginated decrypted message log for a session. Each message has role + structured content (user text, agent output). ' +
            'Use beforeSeq/afterSeq for pagination (mutually exclusive).',
        sessionMessagesInputSchema,
        wrap('happy_session_messages', credentials, runSessionMessages),
    );

    server.tool(
        'happy_session_send',
        'Post a user-text message to a session. The session\'s agent picks it up and responds. ' +
            'Returns immediately with sentSeq — poll happy_session_messages with afterSeq to read the reply.',
        sessionSendInputSchema,
        wrap('happy_session_send', credentials, runSessionSend),
    );

    server.tool(
        'happy_session_cancel',
        'Abort the currently-running agent turn on a session (equivalent to tapping Stop in happy-app). ' +
            'No-op if the session is archived or idle.',
        sessionCancelInputSchema,
        wrap('happy_session_cancel', credentials, runSessionCancel),
    );

    server.tool(
        'happy_session_spawn',
        'Spawn a new agent session on a given machine. Returns the new sessionId. ' +
            'Use happy_session_messages with the returned id to follow its first response. ' +
            'Requires the machine to be online and dispatch-ready.',
        sessionSpawnInputSchema,
        wrap('happy_session_spawn', credentials, runSessionSpawn),
    );

    const transport = new StdioServerTransport();
    await server.connect(transport);
    logStderr('serving on stdio (6 tools registered: list / inspect / messages / send / cancel / spawn)');
}
