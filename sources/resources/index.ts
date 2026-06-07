// THE LONE REGISTRATION POINT.
// Adding a whole new resource: create one folder under sources/resources/<name>/
// exporting a ResourceModule, then add one line here. Both surfaces pick it up
// automatically (MCP via toolRegistry's flatMap, CLI via commands/registry's
// RESOURCE_COMMANDS + one ordering slot in main.ts).
//
// Order matters: it determines MCP tools/list ordering for migrated tools and
// (via RESOURCE_COMMANDS) the CLI command-help ordering. Keep new resources in
// the layout order from docs/mcp-cli-architecture.md section 8.
import type { ResourceModule } from "@/resources/types";
import { activityResource } from "@/resources/activity";
import { conversationsResource } from "@/resources/conversations";
import { dailyResource } from "@/resources/daily";
import { factsResource } from "@/resources/facts";
import { insightsResource } from "@/resources/insights";
import { journalsResource } from "@/resources/journals";
import { locationsResource } from "@/resources/locations";
import { photosResource } from "@/resources/photos";
import { searchResource } from "@/resources/search";
import { statusResource } from "@/resources/status";
import { todayResource } from "@/resources/today";
import { todosResource } from "@/resources/todos";

export const RESOURCES: readonly ResourceModule[] = [
  statusResource,
  todayResource,
  activityResource,
  conversationsResource,
  dailyResource,
  factsResource,
  insightsResource,
  journalsResource,
  locationsResource,
  photosResource,
  searchResource,
  todosResource,
];
