import { describe, expect, it } from "vitest";

import {
  findDynamicImports,
  inspectEsm,
  isLiteralExpression,
  isServerSafeExpression,
} from "../../packages/renderer/lib/author-code";

// The decision layer for what the SERVER is allowed to execute (SPEC §10.6). Getting this wrong
// is not a cosmetic bug: a non-literal expression wrongly judged server-safe is evaluated in the
// process holding DATABASE_URL, which is exactly how `{process.env.DATABASE_URL}` rendered a live
// connection string into a page. So the tests below lean on the *negative* cases — the allowlist
// must refuse anything it does not positively recognise, including node types nobody has thought
// of yet.
//
// ESTree fragments are written by hand rather than parsed, so a change in the MDX parser can't
// silently alter what these assert.

const lit = (value: unknown) => ({ type: "Literal", value });
const expr = (expression: unknown) => ({ body: [{ type: "ExpressionStatement", expression }] });

describe("isLiteralExpression", () => {
  it("accepts plain literals", () => {
    expect(isLiteralExpression(lit(2))).toBe(true);
    expect(isLiteralExpression(lit("hi"))).toBe(true);
    expect(isLiteralExpression(lit(true))).toBe(true);
    expect(isLiteralExpression(lit(null))).toBe(true);
  });

  it("accepts a template literal with no substitutions", () => {
    expect(isLiteralExpression({ type: "TemplateLiteral", expressions: [], quasis: [] })).toBe(true);
  });

  it("refuses a template literal that interpolates", () => {
    expect(
      isLiteralExpression({
        type: "TemplateLiteral",
        expressions: [{ type: "Identifier", name: "name" }],
        quasis: [],
      }),
    ).toBe(false);
  });

  it("accepts a signed number, which parses as a unary operator over a literal", () => {
    expect(isLiteralExpression({ type: "UnaryExpression", operator: "-", argument: lit(1) })).toBe(true);
  });

  it("refuses other unary operators", () => {
    // `!process` is a unary expression too; only sign operators are inert.
    expect(
      isLiteralExpression({ type: "UnaryExpression", operator: "!", argument: lit(1) }),
    ).toBe(false);
  });

  it("accepts arrays and objects built only from literals", () => {
    expect(isLiteralExpression({ type: "ArrayExpression", elements: [lit("release"), lit(1)] })).toBe(true);
    expect(
      isLiteralExpression({
        type: "ObjectExpression",
        properties: [
          { type: "Property", computed: false, key: { type: "Identifier", name: "light" }, value: lit("#fff") },
          { type: "Property", computed: false, key: { type: "Identifier", name: "dark" }, value: lit("#000") },
        ],
      }),
    ).toBe(true);
  });

  it("refuses a collection with one non-literal element", () => {
    // The whole point of recursing: a single call hidden in an array is still a call.
    expect(
      isLiteralExpression({
        type: "ArrayExpression",
        elements: [lit("ok"), { type: "CallExpression", callee: { type: "Identifier", name: "f" } }],
      }),
    ).toBe(false);
  });

  it("refuses a computed or spread object key", () => {
    expect(
      isLiteralExpression({
        type: "ObjectExpression",
        properties: [
          { type: "Property", computed: true, key: { type: "Identifier", name: "k" }, value: lit(1) },
        ],
      }),
    ).toBe(false);
    expect(
      isLiteralExpression({
        type: "ObjectExpression",
        properties: [{ type: "SpreadElement", argument: { type: "Identifier", name: "rest" } }],
      }),
    ).toBe(false);
  });

  it("refuses identifiers, member access and calls — the shapes that reach secrets", () => {
    expect(isLiteralExpression({ type: "Identifier", name: "someVar" })).toBe(false);
    expect(
      isLiteralExpression({
        type: "MemberExpression",
        object: { type: "Identifier", name: "process" },
        property: { type: "Identifier", name: "env" },
      }),
    ).toBe(false);
    expect(isLiteralExpression({ type: "CallExpression", callee: { type: "Identifier", name: "f" } })).toBe(false);
  });

  it("refuses an unrecognised node type rather than assuming it is safe", () => {
    expect(isLiteralExpression({ type: "SomeFutureSyntax" })).toBe(false);
    expect(isLiteralExpression(null)).toBe(false);
    expect(isLiteralExpression("not a node")).toBe(false);
  });
});

describe("isServerSafeExpression", () => {
  it("treats a comment-only expression as safe", () => {
    // `{/* … */}` parses to a program with no statements — nothing to execute.
    expect(isServerSafeExpression({ body: [] })).toBe(true);
    expect(isServerSafeExpression(undefined)).toBe(true);
  });

  it("accepts a literal expression", () => {
    expect(isServerSafeExpression(expr(lit(2)))).toBe(true);
  });

  it("refuses a non-literal expression", () => {
    expect(
      isServerSafeExpression(
        expr({
          type: "MemberExpression",
          object: { type: "Identifier", name: "process" },
          property: { type: "Identifier", name: "env" },
        }),
      ),
    ).toBe(false);
  });

  it("refuses anything that is not a single expression statement", () => {
    expect(isServerSafeExpression({ body: [{ type: "VariableDeclaration" }] })).toBe(false);
    expect(
      isServerSafeExpression({
        body: [{ type: "ExpressionStatement", expression: lit(1) }, { type: "ExpressionStatement", expression: lit(2) }],
      }),
    ).toBe(false);
  });
});

describe("inspectEsm", () => {
  const esm = (body: unknown[]) => ({ body });
  const arrow = { type: "ArrowFunctionExpression" };

  it("records a named const export as a binding", () => {
    const { bindings, violations } = inspectEsm(
      esm([
        {
          type: "ExportNamedDeclaration",
          declaration: {
            type: "VariableDeclaration",
            declarations: [{ id: { type: "Identifier", name: "Counter" }, init: arrow }],
          },
        },
      ]),
    );
    expect(bindings).toEqual(["Counter"]);
    expect(violations).toEqual([]);
  });

  it("records a const bound to a literal too — a snippet variable is still author code", () => {
    const { bindings, violations } = inspectEsm(
      esm([
        {
          type: "ExportNamedDeclaration",
          declaration: {
            type: "VariableDeclaration",
            declarations: [{ id: { type: "Identifier", name: "version" }, init: lit("2.0") }],
          },
        },
      ]),
    );
    expect(bindings).toEqual(["version"]);
    expect(violations).toEqual([]);
  });

  it("allows a /snippets/ import", () => {
    const { violations } = inspectEsm(
      esm([{ type: "ImportDeclaration", source: lit("/snippets/prerequisites.mdx") }]),
    );
    expect(violations).toEqual([]);
  });

  it("refuses an npm or relative import, keeping the module graph closed", () => {
    for (const source of ["lodash", "node:child_process", "./local.js", "https://cdn/x.js"]) {
      const { violations } = inspectEsm(esm([{ type: "ImportDeclaration", source: lit(source) }]));
      expect(violations.map((v) => v.kind)).toEqual(["external-import"]);
    }
  });

  it("refuses a default export", () => {
    const { violations } = inspectEsm(esm([{ type: "ExportDefaultDeclaration" }]));
    expect(violations.map((v) => v.kind)).toEqual(["default-export"]);
  });

  it("refuses function declarations, exported or bare", () => {
    expect(
      inspectEsm(esm([{ type: "ExportNamedDeclaration", declaration: { type: "FunctionDeclaration" } }]))
        .violations.map((v) => v.kind),
    ).toEqual(["function-declaration"]);
    expect(
      inspectEsm(esm([{ type: "FunctionDeclaration" }])).violations.map((v) => v.kind),
    ).toEqual(["function-declaration"]);
  });

  it("refuses a bare re-export, which binds nothing it can check", () => {
    const { violations } = inspectEsm(esm([{ type: "ExportNamedDeclaration" }]));
    expect(violations.map((v) => v.kind)).toEqual(["unsupported-statement"]);
  });

  it("reports every violation in a block, not just the first", () => {
    const { violations } = inspectEsm(
      esm([{ type: "ExportDefaultDeclaration" }, { type: "ImportDeclaration", source: lit("axios") }]),
    );
    expect(violations.map((v) => v.kind)).toEqual(["default-export", "external-import"]);
  });
});

describe("findDynamicImports", () => {
  it("finds a dynamic import nested inside an expression", () => {
    // The shape that turned a locked-down worker back into arbitrary code execution.
    const found = findDynamicImports({
      body: [
        {
          type: "ExpressionStatement",
          expression: {
            type: "CallExpression",
            callee: { type: "MemberExpression", object: { type: "ImportExpression" } },
          },
        },
      ],
    });
    expect(found.map((v) => v.kind)).toEqual(["dynamic-import"]);
  });

  it("returns nothing for ordinary code", () => {
    expect(findDynamicImports(expr(lit(1)))).toEqual([]);
  });
});
