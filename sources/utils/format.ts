export type OutputFormat = "json" | "text" | "minimal";

export function resolveOutputFormat(args: readonly string[]): {
  format: OutputFormat;
  args: string[];
} {
  let format: OutputFormat | null = null;
  const remaining: string[] = [];

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === undefined) continue;

    if (arg === "--json") {
      format = "json";
      continue;
    }
    if (arg === "--pretty") {
      format = "text";
      continue;
    }
    if (arg === "--minimal") {
      format = "minimal";
      continue;
    }
    if (arg === "--format") {
      const value = args[i + 1];
      if (value === "json" || value === "text" || value === "minimal") {
        format = value;
        i += 1;
        continue;
      }
    }

    remaining.push(arg);
  }

  if (format) {
    return { format, args: remaining };
  }

  const envFormat = process.env["BEE_OUTPUT_FORMAT"];
  if (envFormat === "json" || envFormat === "text" || envFormat === "minimal") {
    return { format: envFormat, args: remaining };
  }

  return { format: "text", args: remaining };
}

export function isJsonMode(format: OutputFormat): boolean {
  return format === "json" || format === "minimal";
}
