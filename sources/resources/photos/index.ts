// photos is the only domain that exercises kind:"parts" (binary/image content)
// and the CLI --output file-write render path.
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { printJson } from "@/client/clientApi";
import { firstText, printToolData } from "@/commands/mcpToolOutput";
import type { ToolResult } from "@/mcp/types";
import { coerceLimit, coerceOptionalString, optionalIdArg, stringOrNumberArg } from "@/resources/coerce";
import { apiGet, fetchAllPages, fetchPhoto } from "@/resources/http";
import { arrayProp, asRecord, jsonString, parseJson } from "@/resources/json";
import { idNumber, limit as limitSchema, numberOrString, objectSchema } from "@/resources/schema";
import type { ActionDefinition, ResourceModule } from "@/resources/types";

const USAGE = [
  "bee photos list [--daily-id N] [--date YYYY-MM-DD] [--limit N] [--json]",
  "bee photos get <id> [--output PATH] [--json]",
].join("\n");

// ---- list (= bee_get_photos) ------------------------------------------------

type PhotosListInput = {
  dailyId: number | null;
  date: string | undefined;
  limit: number;
  includeImages: boolean;
};

const listPhotos: ActionDefinition<PhotosListInput> = {
  mcp: {
    name: "bee_get_photos",
    description:
      "List Bee photos, newest first. Filter by date (YYYY-MM-DD) or scope to one daily summary with dailyId. Set includeImages to return image content.",
    inputSchema: objectSchema({
      properties: {
        dailyId: idNumber("Optional Bee daily summary ID."),
        date: { type: "string", description: "Optional date as YYYY-MM-DD." },
        limit: limitSchema(20),
        includeImages: { type: "boolean", description: "Include image content when possible." },
      },
    }),
  },
  cli: {
    subcommand: "list",
    flags: [
      { name: "--daily-id", kind: "int" },
      { name: "--date", kind: "string" },
      { name: "--limit", kind: "int", max: 20 },
    ],
    // CLI list never sets includeImages, so run() always returns kind:"json".
    render: (result, format) => {
      if (result.kind !== "json") {
        return;
      }
      printToolData("Photos", result.data, format);
    },
  },
  coerceInput: (raw, surface) => {
    const date = coerceOptionalString(raw["date"]);
    // The CLI rejects malformed --date; MCP does not.
    if (surface === "cli" && date !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      throw new Error("--date must be YYYY-MM-DD");
    }
    return {
      // dailyId is lenient on both surfaces (the CLI hands a parsed number;
      // optionalIdArg accepts that number unchanged).
      dailyId: optionalIdArg(raw["dailyId"]),
      date,
      limit: coerceLimit(raw["limit"], surface, { fallback: 10, min: 1, max: 20 }),
      includeImages: raw["includeImages"] === true,
    };
  },
  run: async (ctx, input) => {
    const { dailyId, date, limit, includeImages } = input;
    let photos: unknown[];
    if (dailyId !== null) {
      // Photos attached to one specific daily summary.
      const summary = asRecord(asRecord(parseJson(await apiGet(ctx, `/v1/daily/${dailyId}`))).daily_summary);
      photos = arrayProp(summary, "photos")
        .map((photo) => ({ ...asRecord(photo), daily_summary_id: summary.id ?? null }))
        .slice(0, limit);
    } else {
      // Query the photo index directly, optionally scoped to a single day. The
      // server filters by captured_at and paginates by cursor, so older photos
      // are not missed. Follow next_cursor until limit is reached.
      const range = date ? `&start_date=${date}&end_date=${date}` : "";
      const { items } = await fetchAllPages(
        ctx,
        "photos",
        (cursor) => {
          const base = `/v1/photos?limit=${Math.min(Math.max(limit, 20), 100)}${range}`;
          return cursor ? `${base}&cursor=${encodeURIComponent(cursor)}` : base;
        },
        (acc) => acc.length >= limit
      );
      photos = items.slice(0, limit);
    }

    if (!includeImages) {
      return { kind: "json", data: { photos } };
    }

    const content: ToolResult["content"] = [{
      type: "text",
      text: jsonString({ photos }),
    }];
    for (const photo of photos) {
      const id = asRecord(photo).id;
      if (id === undefined || id === null || !/^\d+$/.test(String(id))) {
        continue;
      }
      try {
        const image = await fetchPhoto(ctx, String(id));
        content.push({ type: "image", data: image.data, mimeType: image.mimeType });
      } catch (error) {
        // Keep returning metadata even if one image cannot be fetched.
        process.stderr.write(`Bee MCP error: ${error instanceof Error ? error.message : "unexpected error"}\n`);
      }
    }
    return { kind: "parts", content };
  },
};

// ---- get (= bee_get_photo) --------------------------------------------------

type PhotoGetInput = { id: string | number };

const getPhoto: ActionDefinition<PhotoGetInput> = {
  mcp: {
    name: "bee_get_photo",
    description: "Download one Bee photo by ID as image content.",
    inputSchema: objectSchema({
      properties: { id: numberOrString("Bee photo ID.") },
      required: ["id"],
    }),
  },
  cli: {
    subcommand: "get",
    positionals: [{
      name: "id",
      required: true,
      label: "Photo id",
      arityMessage: "Provide exactly one photo id.",
    }],
    flags: [{ name: "--output", kind: "string" }],
    render: (result, format, _ctx, raw) => {
      if (result.kind !== "parts") {
        return;
      }
      const id = raw["id"] as string | number;
      const image = result.content.find((item) => item.type === "image");
      if (!image || image.type !== "image") {
        throw new Error("Bee did not return image content for this photo.");
      }

      const bytes = Buffer.from(image.data, "base64");
      const output = typeof raw["output"] === "string" ? raw["output"] : undefined;
      if (output) {
        const outputPath = resolve(output);
        writeFileSync(outputPath, bytes);
        if (format === "json") {
          printJson({
            id,
            output: outputPath,
            mimeType: image.mimeType,
            bytes: bytes.length,
          });
          return;
        }
        console.log(`Photo ${id} written to ${outputPath}`);
        console.log(`- mime_type: ${image.mimeType}`);
        console.log(`- bytes: ${bytes.length}`);
        return;
      }

      if (format === "json") {
        printJson({ id, mimeType: image.mimeType, data: image.data });
        return;
      }

      const text = firstText({ content: result.content });
      console.error("No file written. Use --output PATH to save the image, or --json for base64 data.");
      console.log(text.trim() || `Photo ${id}`);
      console.log(`- mime_type: ${image.mimeType}`);
      console.log(`- bytes: ${bytes.length}`);
    },
  },
  // The CLI parser validates the positional via parseRequiredId before this runs;
  // MCP passes a number|string through stringOrNumberArg.
  coerceInput: (raw) => ({ id: stringOrNumberArg(raw["id"], "id") }),
  run: async (ctx, input) => {
    const image = await fetchPhoto(ctx, String(input.id));
    return {
      kind: "parts",
      content: [
        { type: "text", text: jsonString({ id: input.id }) },
        { type: "image", data: image.data, mimeType: image.mimeType },
      ],
    };
  },
};

export const photosResource: ResourceModule = {
  cliCommand: {
    name: "photos",
    description: "List or download Bee photos.",
    usage: USAGE,
    missingSubcommandMessage: "Missing subcommand. Use list or get.",
    unknownSubcommandPrefix: "Unknown photos subcommand: ",
  },
  actions: [listPhotos, getPhoto],
};
