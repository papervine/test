import clsx from "clsx";
import { sampleFromSchema, type Operation, type Schema } from "@/lib/openapi";
import { ApiField, FieldSection } from "@/components/mdx/ApiField";
import { Expandable } from "@/components/mdx/Expandable";

const METHOD_COLORS: Record<string, string> = {
  GET: "bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-300",
  POST: "bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300",
  PUT: "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300",
  PATCH: "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300",
  DELETE: "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300",
};

function typeLabel(schema?: Schema): string | undefined {
  if (!schema) return undefined;
  if (Array.isArray(schema.enum)) return schema.enum.map(String).join(" · ");
  const type = schema.type as string | undefined;
  if (type === "array") {
    const items = schema.items as Schema | undefined;
    return `${typeLabel(items) ?? "any"}[]`;
  }
  if (schema.format) return `${type}<${schema.format}>`;
  return type;
}

function nestedSchema(schema?: Schema): Schema | undefined {
  if (!schema) return undefined;
  if (schema.type === "object" && schema.properties) return schema;
  if (schema.type === "array") {
    const items = schema.items as Schema | undefined;
    if (items?.type === "object" && items.properties) return items;
  }
  return undefined;
}

function SchemaFields({ schema }: { schema?: Schema }) {
  const properties = schema?.properties as Record<string, Schema> | undefined;
  if (!properties) return null;
  const required = new Set((schema?.required as string[]) ?? []);

  return (
    <>
      {Object.entries(properties).map(([name, prop]) => {
        const child = nestedSchema(prop);
        return (
          <ApiField
            key={name}
            name={name}
            type={typeLabel(prop)}
            required={required.has(name)}
            deprecated={prop.deprecated as boolean | undefined}
            defaultValue={prop.default !== undefined ? JSON.stringify(prop.default) : undefined}
          >
            {typeof prop.description === "string" && <p>{prop.description}</p>}
            {child && (
              <Expandable title="child attributes">
                <SchemaFields schema={child} />
              </Expandable>
            )}
          </ApiField>
        );
      })}
    </>
  );
}

/** Dark code panel (request/response example) for the sticky right column. */
function CodePanel({ label, badge, code }: { label: string; badge?: string; code: string }) {
  return (
    <div className="overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900 text-zinc-100">
      <div className="flex items-center justify-between border-b border-zinc-800 px-4 py-2">
        <span className="text-xs font-medium text-zinc-400">{label}</span>
        {badge && (
          <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-[0.65rem] font-medium text-zinc-300">
            {badge}
          </span>
        )}
      </div>
      <pre className="m-0 overflow-x-auto bg-transparent p-4 text-xs leading-relaxed">
        <code>{code}</code>
      </pre>
    </div>
  );
}

function curlSample(op: Operation): string {
  const url = `${op.baseUrl}${op.path}`;
  const lines = [`curl -X ${op.method} ${url}`];
  const auth = op.parameters.find((p) => p.in === "header" && /authorization/i.test(p.name));
  if (auth) lines[lines.length - 1] += " \\";
  if (auth) lines.push(`  -H "Authorization: Bearer $TOKEN"${op.requestBody ? " \\" : ""}`);
  if (op.requestBody) {
    if (!auth) lines[lines.length - 1] += " \\";
    lines.push('  -H "Content-Type: application/json" \\');
    lines.push(`  -d '${JSON.stringify(sampleFromSchema(op.requestBody), null, 2)}'`);
  }
  return lines.join("\n");
}

export function EndpointReference({ op, baseUrl }: { op: Operation; baseUrl: string }) {
  const groups: { title: string; params: typeof op.parameters }[] = [
    { title: "Path parameters", params: op.parameters.filter((p) => p.in === "path") },
    { title: "Query parameters", params: op.parameters.filter((p) => p.in === "query") },
    { title: "Headers", params: op.parameters.filter((p) => p.in === "header") },
  ];
  const ok = op.responses.find((r) => r.status.startsWith("2")) ?? op.responses[0];
  const responseExample = ok?.schema
    ? JSON.stringify(sampleFromSchema(ok.schema), null, 2)
    : "{}";

  return (
    <>
      <article className="prose min-w-0 flex-1">
        {op.tag && <div className="mb-2 text-sm font-semibold text-primary">{op.tag}</div>}
        <h1 className="!mb-3">{op.summary ?? `${op.method} ${op.path}`}</h1>

        {/* Endpoint bar: method + full URL + Try it */}
        <div className="not-prose mb-6 flex flex-wrap items-center gap-2 rounded-xl border border-zinc-200 p-2 dark:border-zinc-800">
          <span
            className={clsx(
              "rounded-md px-2 py-1 text-xs font-bold",
              METHOD_COLORS[op.method] ?? "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
            )}
          >
            {op.method}
          </span>
          <code className="min-w-0 flex-1 truncate text-sm text-zinc-600 dark:text-zinc-300">
            {baseUrl}
            {op.path}
          </code>
          <button
            type="button"
            className="rounded-md bg-primary px-3 py-1 text-sm font-semibold text-white hover:opacity-90"
          >
            Try it
          </button>
        </div>

        {op.description && (
          <p className="text-zinc-600 dark:text-zinc-400">{op.description}</p>
        )}

        {groups.map(
          (g) =>
            g.params.length > 0 && (
              <FieldSection key={g.title} title={g.title}>
                {g.params.map((p) => (
                  <ApiField
                    key={p.name}
                    name={p.name}
                    type={typeLabel(p.schema)}
                    required={p.required}
                  >
                    {p.description && <p>{p.description}</p>}
                  </ApiField>
                ))}
              </FieldSection>
            ),
        )}

        {op.requestBody && (
          <FieldSection title="Body">
            <SchemaFields schema={op.requestBody} />
          </FieldSection>
        )}

        {ok?.schema && (
          <FieldSection title="Response">
            <SchemaFields schema={ok.schema} />
          </FieldSection>
        )}
      </article>

      {/* Sticky right column: request + response code examples (incumbent layout) */}
      <aside className="hidden w-[26rem] shrink-0 lg:block">
        <div className="sticky top-24 space-y-4">
          <CodePanel label="Request" badge="cURL" code={curlSample(op)} />
          <CodePanel label="Response" badge={ok?.status ?? "200"} code={responseExample} />
        </div>
      </aside>
    </>
  );
}
