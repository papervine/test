import "server-only";
import { cache } from "react";
import { dereference, upgrade } from "@scalar/openapi-parser";
import type { DocsConfig } from "./config";
import { loadRaw } from "./content";

/**
 * OpenAPI → endpoint pages (SPEC §7, incumbent model). A `docs.json` nav division
 * with an `openapi` property auto-generates one in-nav, in-theme page per operation.
 * We use Scalar's MIT parser to load + dereference the spec; rendering is ours.
 *
 * The spec is read through the active `ContentSource` (`loadRaw`), NOT a direct
 * `fs.readFile` — so it resolves the same for a local `papervine dev` preview (fsSource →
 * disk) and a synced tenant (s3Source → storage). Reading the filesystem directly only ever
 * worked for the former, which is why OpenAPI silently failed for connected tenant sites.
 */

// Minimal shapes we read off the dereferenced spec (it's fully resolved JSON).
export type Schema = Record<string, unknown>;
export type Param = {
  name: string;
  in: "path" | "query" | "header" | "cookie";
  required?: boolean;
  description?: string;
  schema?: Schema;
};
export type Operation = {
  slug: string; // URL slug for the generated page
  method: string; // GET, POST, …
  path: string; // /users/{id}
  summary?: string;
  description?: string;
  deprecated?: boolean;
  tag?: string;
  parameters: Param[];
  requestBody?: Schema;
  responses: { status: string; description?: string; schema?: Schema }[];
  baseUrl: string;
  specPath: string;
};

const METHODS = ["get", "post", "put", "patch", "delete", "head", "options"] as const;

function kebab(s: string): string {
  return s
    .replace(/([a-z])([A-Z])/g, "$1-$2")
    .replace(/[^A-Za-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
}

/** Stable, readable slug for an operation: operationId if present, else method+path. */
function operationSlug(method: string, p: string, op: Record<string, unknown>): string {
  if (typeof op.operationId === "string" && op.operationId) return kebab(op.operationId);
  return kebab(`${method}-${p}`);
}

/** Load, upgrade (2.0→3), and dereference a spec. Cached per spec path. Reads through the
 *  active ContentSource so it works for both filesystem previews and synced tenants. */
const loadSpec = cache(async (specPath: string): Promise<Schema | null> => {
  const raw = await loadRaw(specPath);
  if (raw === null) return null;
  const parsed = raw.trimStart().startsWith("{") ? JSON.parse(raw) : raw;
  const upgraded = upgrade(parsed);
  const { schema } = await dereference(upgraded.specification ?? parsed);
  return (schema as Schema) ?? null;
});

/** Extract the ordered list of operations from a spec. Cached per spec path. */
export const apiOperations = cache(async (specPath: string): Promise<Operation[]> => {
  const schema = await loadSpec(specPath);
  const paths = (schema?.paths ?? {}) as Record<string, Record<string, unknown>>;
  const servers = (schema?.servers as { url?: string }[]) ?? [];
  const baseUrl = servers[0]?.url ?? "";
  const ops: Operation[] = [];

  for (const [p, pathItem] of Object.entries(paths)) {
    for (const method of METHODS) {
      const op = pathItem[method] as Record<string, unknown> | undefined;
      if (!op || typeof op !== "object") continue;

      const params: Param[] = [
        ...((pathItem.parameters as Param[]) ?? []),
        ...((op.parameters as Param[]) ?? []),
      ].filter((x) => x && typeof x === "object");

      const content = (op.requestBody as { content?: Record<string, { schema?: Schema }> })
        ?.content;
      const requestBody = content?.["application/json"]?.schema;

      const responses = Object.entries(
        (op.responses ?? {}) as Record<string, { description?: string; content?: Record<string, { schema?: Schema }> }>,
      ).map(([status, r]) => ({
        status,
        description: r?.description,
        schema: r?.content?.["application/json"]?.schema,
      }));

      ops.push({
        slug: operationSlug(method, p, op),
        method: method.toUpperCase(),
        path: p,
        summary: op.summary as string | undefined,
        description: op.description as string | undefined,
        deprecated: op.deprecated as boolean | undefined,
        tag: Array.isArray(op.tags) ? (op.tags[0] as string) : undefined,
        parameters: params,
        requestBody,
        responses,
        baseUrl,
        specPath,
      });
    }
  }
  return ops;
});

/**
 * Build an example value from a JSON schema for the request/response code panels.
 * Prefers explicit `example`/`default`, then enum, then a placeholder by type.
 * Guarded against the cyclic graphs dereferencing can produce.
 */
export function sampleFromSchema(schema?: Schema, seen: Set<Schema> = new Set(), depth = 0): unknown {
  if (!schema || depth > 6) return null;
  if (schema.example !== undefined) return schema.example;
  if (schema.default !== undefined) return schema.default;
  if (Array.isArray(schema.enum) && schema.enum.length) return schema.enum[0];
  if (seen.has(schema)) return null;

  const type = schema.type as string | undefined;
  if (type === "object" || schema.properties) {
    seen.add(schema);
    const props = (schema.properties ?? {}) as Record<string, Schema>;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(props)) out[k] = sampleFromSchema(v, seen, depth + 1);
    seen.delete(schema);
    return out;
  }
  if (type === "array") {
    return [sampleFromSchema(schema.items as Schema | undefined, seen, depth + 1)];
  }
  if (type === "string") {
    const fmt = schema.format as string | undefined;
    if (fmt === "email") return "user@example.com";
    if (fmt === "date-time") return "2023-01-01T00:00:00Z";
    if (fmt === "uri") return "https://example.com";
    return "string";
  }
  if (type === "integer" || type === "number") return 0;
  if (type === "boolean") return true;
  return null;
}

/** Collect every `openapi` spec path referenced anywhere in the navigation tree. */
function collectSpecRefs(value: unknown, out: Set<string> = new Set()): Set<string> {
  if (Array.isArray(value)) {
    for (const v of value) collectSpecRefs(v, out);
  } else if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    if (typeof obj.openapi === "string") out.add(obj.openapi);
    for (const v of Object.values(obj)) collectSpecRefs(v, out);
  }
  return out;
}

/** Map of operation slug → operation, across all specs the docs.json references. */
export const loadApiCatalog = cache(
  async (config: DocsConfig): Promise<Map<string, Operation>> => {
    const specs = collectSpecRefs(config.navigation);
    const map = new Map<string, Operation>();
    for (const specPath of specs) {
      for (const op of await apiOperations(specPath)) map.set(op.slug, op);
    }
    return map;
  },
);
