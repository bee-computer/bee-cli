import type { Command, CommandContext } from "@/commands/types";
import { loadToken } from "@/secureStore";

const SUPPORTED_EVENT_TYPES = [
    // Conversations
    'new-conversation',
    'update-conversation',
    'update-conversation-summary',
    'delete-conversation',
    'update-location',
    // Transcription
    'new-utterance',
    // Todos
    'todo-created',
    'todo-updated',
    'todo-deleted',
    // Journals
    'journal-created',
    'journal-updated',
    'journal-deleted',
    'journal-text',
] as const;

type StreamOptions = {
    types?: string[];
    json: boolean;
};

const USAGE = [
    "bee stream",
    "bee stream --types new-utterance,update-conversation",
    "bee stream --json",
].join("\n");

const DESCRIPTION = "Stream real-time events from the server.";

export const streamCommand: Command = {
    name: "stream",
    description: DESCRIPTION,
    usage: USAGE,
    run: async (args, context) => {
        const options = parseArgs(args);
        await handleStream(options, context);
    },
};

function parseArgs(args: readonly string[]): StreamOptions {
    const options: StreamOptions = { json: false };
    const positionals: string[] = [];

    for (let i = 0; i < args.length; i += 1) {
        const arg = args[i];
        if (arg === undefined) {
            continue;
        }

        if (arg === "--types") {
            const value = args[i + 1];
            if (value === undefined) {
                throw new Error("--types requires a value");
            }
            options.types = value.split(",").map((t) => t.trim()).filter(Boolean);
            i += 1;
            continue;
        }

        if (arg === "--json") {
            options.json = true;
            continue;
        }

        if (arg.startsWith("-")) {
            throw new Error(`Unknown option: ${arg}`);
        }

        positionals.push(arg);
    }

    if (positionals.length > 0) {
        throw new Error(`Unexpected arguments: ${positionals.join(" ")}`);
    }

    return options;
}

async function handleStream(
    options: StreamOptions,
    context: CommandContext
): Promise<void> {
    const token = await loadToken(context.env);
    if (!token) {
        throw new Error('Not logged in. Run "bee login" first.');
    }

    const params = new URLSearchParams();
    if (options.types && options.types.length > 0) {
        params.set("types", options.types.join(","));
    }

    const suffix = params.toString();
    const path = suffix ? `/v1/stream?${suffix}` : "/v1/stream";

    if (!options.json) {
        console.log("Connecting to event stream...");
        console.log(`Supported event types: ${SUPPORTED_EVENT_TYPES.join(", ")}`);
        if (options.types) {
            console.log(`Filtering: ${options.types.join(", ")}`);
        }
        console.log("Press Ctrl+C to stop.\n");
    }

    const abortController = new AbortController();

    process.on("SIGINT", () => {
        if (!options.json) {
            console.log("\nDisconnecting...");
        }
        abortController.abort();
    });

    try {
        const response = await context.client.fetch(path, {
            method: "GET",
            headers: {
                Authorization: `Bearer ${token}`,
                Accept: "text/event-stream",
            },
            signal: abortController.signal,
        });

        if (!response.ok) {
            const text = await response.text();
            throw new Error(`Stream failed: ${response.status} ${text}`);
        }

        if (!response.body) {
            throw new Error("No response body");
        }

        await processSSEStream(response.body, options);
    } catch (error) {
        if (error instanceof Error && error.name === "AbortError") {
            return;
        }
        throw error;
    }
}

async function processSSEStream(
    body: ReadableStream<Uint8Array>,
    options: StreamOptions
): Promise<void> {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done) {
                if (!options.json) {
                    console.log("Stream ended.");
                }
                break;
            }

            buffer += decoder.decode(value, { stream: true });
            const events = parseSSEBuffer(buffer);
            buffer = events.remaining;

            for (const event of events.parsed) {
                handleEvent(event, options);
            }
        }
    } finally {
        reader.releaseLock();
    }
}

type SSEEvent = {
    event: string;
    data: string;
};

type ParsedEvents = {
    parsed: SSEEvent[];
    remaining: string;
};

function parseSSEBuffer(buffer: string): ParsedEvents {
    const parsed: SSEEvent[] = [];
    const lines = buffer.split("\n");
    let currentEvent: Partial<SSEEvent> = {};
    let lastCompleteIndex = -1;

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i] ?? "";

        // Empty line marks end of event
        if (line === "") {
            if (currentEvent.event && currentEvent.data !== undefined) {
                parsed.push(currentEvent as SSEEvent);
            }
            currentEvent = {};
            lastCompleteIndex = i;
            continue;
        }

        // Comment (ping)
        if (line.startsWith(":")) {
            lastCompleteIndex = i;
            continue;
        }

        // Parse field
        const colonIndex = line.indexOf(":");
        if (colonIndex === -1) {
            continue;
        }

        const field = line.slice(0, colonIndex);
        const value = line.slice(colonIndex + 1).trimStart();

        if (field === "event") {
            currentEvent.event = value;
        } else if (field === "data") {
            currentEvent.data = value;
        } else if (field === "retry") {
            // Ignore retry field
        }
    }

    // Return remaining unprocessed buffer
    const remaining = lastCompleteIndex >= 0
        ? lines.slice(lastCompleteIndex + 1).join("\n")
        : buffer;

    return { parsed, remaining };
}

function handleEvent(event: SSEEvent, options: StreamOptions): void {
    if (options.json) {
        // Raw JSON output for piping
        console.log(event.data);
        return;
    }

    // Formatted output
    const timestamp = new Date().toISOString();

    if (event.event === "connected") {
        console.log(`${dim(timestamp)} ${green("CONNECTED")}`);
        return;
    }

    try {
        const data = JSON.parse(event.data) as Record<string, unknown>;
        const formatted = formatEvent(event.event, data);
        console.log(`${dim(timestamp)} ${colored(event.event)} ${formatted}`);
    } catch {
        console.log(`${dim(timestamp)} ${colored(event.event)} ${event.data}`);
    }
}

function formatEvent(eventType: string, data: Record<string, unknown>): string {
    switch (eventType) {
        case "new-utterance": {
            const utterance = data["utterance"] as Record<string, unknown> | undefined;
            const text = utterance?.["text"] ?? "";
            const speaker = utterance?.["speaker"] ?? "unknown";
            const convUuid = data["conversation_uuid"] ?? "";
            return `[${speaker}] "${text}"${convUuid ? ` ${dim(`conv=${convUuid}`)}` : ""}`;
        }
        case "new-conversation": {
            const conv = data["conversation"] as Record<string, unknown> | undefined;
            const id = conv?.["id"] ?? "?";
            const uuid = conv?.["uuid"] ?? "";
            const state = conv?.["state"] ?? "?";
            const title = conv?.["title"];
            let result = `id=${id} state=${state}`;
            if (uuid) result += ` ${dim(`uuid=${uuid}`)}`;
            if (title) result += `\n    title: "${title}"`;
            return result;
        }
        case "update-conversation": {
            const conv = data["conversation"] as Record<string, unknown> | undefined;
            const id = conv?.["id"] ?? "?";
            const state = conv?.["state"] ?? "?";
            const title = conv?.["title"];
            const summary = conv?.["short_summary"];
            let result = `id=${id} state=${state}`;
            if (title) result += `\n    title: "${title}"`;
            if (summary) result += `\n    summary: "${truncate(String(summary), 80)}"`;
            return result;
        }
        case "update-conversation-summary": {
            const id = data["conversation_id"] ?? "?";
            const summary = data["short_summary"] ?? "";
            return `id=${id}\n    "${summary}"`;
        }
        case "delete-conversation": {
            const conv = data["conversation"] as Record<string, unknown> | undefined;
            const id = conv?.["id"] ?? "?";
            const title = conv?.["title"];
            return title ? `id=${id} "${title}"` : `id=${id}`;
        }
        case "update-location": {
            const loc = data["location"] as Record<string, unknown> | undefined;
            const lat = loc?.["latitude"] ?? "?";
            const lng = loc?.["longitude"] ?? "?";
            const name = loc?.["name"];
            const convId = data["conversation_id"];
            let result = `lat=${lat} lng=${lng}`;
            if (name) result += ` "${name}"`;
            if (convId) result += ` ${dim(`conv=${convId}`)}`;
            return result;
        }
        case "todo-created":
        case "todo-updated": {
            const todo = data["todo"] as Record<string, unknown> | undefined;
            const id = todo?.["id"] ?? "?";
            const text = todo?.["text"] ?? "";
            const completed = todo?.["completed"] ?? false;
            const alarmAt = todo?.["alarmAt"] as number | undefined;
            let result = `id=${id} ${completed ? "[x]" : "[ ]"} "${text}"`;
            if (alarmAt) {
                const alarmDate = new Date(alarmAt).toLocaleString();
                result += `\n    alarm: ${alarmDate}`;
            }
            return result;
        }
        case "todo-deleted": {
            const todo = data["todo"] as Record<string, unknown> | undefined;
            const id = todo?.["id"] ?? "?";
            const text = todo?.["text"];
            return text ? `id=${id} "${text}"` : `id=${id}`;
        }
        case "journal-created":
        case "journal-updated": {
            const journal = data["journal"] as Record<string, unknown> | undefined;
            if (!journal) return "null";
            const id = journal["id"] ?? "?";
            const state = journal["state"] ?? "?";
            const text = journal["text"] as string | null | undefined;
            const aiResponse = journal["aiResponse"] as Record<string, unknown> | null | undefined;

            let result = `id=${id} state=${state}`;

            // Show transcribed text
            if (text) {
                result += `\n    text: "${truncate(text, 100)}"`;
            }

            // Show AI response details
            if (aiResponse) {
                const message = aiResponse["message"] as string | null | undefined;
                const cleanedUp = aiResponse["cleanedUpText"] as string | null | undefined;
                const followUp = aiResponse["followUp"] as string | null | undefined;
                const todos = aiResponse["todos"] as string[] | null | undefined;

                if (cleanedUp) {
                    result += `\n    cleaned: "${truncate(cleanedUp, 100)}"`;
                }
                if (message) {
                    result += `\n    message: "${truncate(message, 100)}"`;
                }
                if (followUp) {
                    result += `\n    followUp: "${truncate(followUp, 80)}"`;
                }
                if (todos && todos.length > 0) {
                    result += `\n    todos: ${todos.map(t => `"${truncate(t, 40)}"`).join(", ")}`;
                }
            }
            return result;
        }
        case "journal-deleted": {
            const journalId = data["journalId"] ?? "?";
            const reason = data["reason"];
            return reason ? `id=${journalId} reason=${reason}` : `id=${journalId}`;
        }
        case "journal-text": {
            const journalId = data["journalId"] ?? "?";
            const text = data["text"] as string | undefined;
            return text ? `id=${journalId} "${truncate(text, 100)}"` : `id=${journalId}`;
        }
        default:
            return JSON.stringify(data);
    }
}

function truncate(text: string, maxLength: number): string {
    if (text.length <= maxLength) return text;
    return text.slice(0, maxLength - 3) + "...";
}

// ANSI color helpers
function dim(text: string): string {
    return `\x1b[2m${text}\x1b[0m`;
}

function green(text: string): string {
    return `\x1b[32m${text}\x1b[0m`;
}

function colored(eventType: string): string {
    const colors: Record<string, string> = {
        "new-utterance": "\x1b[36m",      // cyan
        "new-conversation": "\x1b[32m",   // green
        "update-conversation": "\x1b[33m", // yellow
        "update-conversation-summary": "\x1b[33m",
        "delete-conversation": "\x1b[31m", // red
        "update-location": "\x1b[35m",     // magenta
        "todo-created": "\x1b[32m",
        "todo-updated": "\x1b[33m",
        "todo-deleted": "\x1b[31m",
        "journal-created": "\x1b[32m",
        "journal-updated": "\x1b[33m",
        "journal-deleted": "\x1b[31m",
        "journal-text": "\x1b[36m",
    };
    const color = colors[eventType] ?? "\x1b[37m"; // white default
    return `${color}${eventType}\x1b[0m`;
}
