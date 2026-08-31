# API documentation

Point a navigation division at an OpenAPI (or AsyncAPI) spec and Papervine generates a full,
interactive API reference: one page per operation, request/response schema docs, a runnable
**Try it** playground, and copy-paste code samples.

## Wiring up a spec

The spec lives in the repository alongside the MDX, and is referenced by a path **relative to
the docs root**. There is exactly one way to do it — an `openapi` property on a navigation
division:

```json
{
  "navigation": {
    "tabs": [
      { "tab": "API Reference", "openapi": "openapi.json" }
    ]
  }
}
```

Or on a group, when the API is one section of a larger site:

```json
{ "group": "Widgets", "openapi": "openapi.json" }
```

Papervine accepts **OpenAPI 3.0+** (YAML or JSON) and **AsyncAPI**. More than one spec can be
referenced — every `openapi` value found anywhere in the navigation tree is loaded.

Because the spec is read through the same content layer as every page, it resolves identically
whether the site is previewed locally with `papervine dev` or served from a synced hosted site.

### What does not work

- **A top-level `"openapi"` key in `docs.json`.** Only navigation divisions are scanned.
- **Page frontmatter — `openapi: "GET /users"` or `api: "POST /users"`.** A page cannot declare
  itself an endpoint page. Neither field is read.

For a hand-written API page, write ordinary MDX with `<ParamField>` / `<ResponseField>` and
`<RequestExample>` / `<ResponseExample>` — see below.

## Generated pages

At sync time Papervine parses the spec and generates **one page per operation**, each with:

- A method + path header, the operation description, and its auth requirements.
- Request documentation — params, headers, and body fields, plus a schema explorer.
- Response documentation — response schemas and examples.

Generated pages are just more pages in the site: searchable, themeable, and indexed for the AI
assistant and the `/mcp` endpoint like any other content.

In the sidebar, operations are grouped by their **first OpenAPI tag** — each tag becomes a
collapsible nav group, operations in spec order under it. Untagged operations stay as plain
entries above. Each gets a colored HTTP-method badge.

To select or reorder operations, add `pages` with `"METHOD /path"` selectors; see
`navigation.md`.

## Page layout

- The **center column** documents the operation — method + URL, description, and the parameter
  and request/response schema fields.
- The **right column** is a sticky code panel with language tabs (cURL, JavaScript, Python)
  above a response panel with one tab per documented status code.

## Try it

A **Try it** button on the endpoint bar opens a full-screen playground covering every kind of
input an OpenAPI operation takes:

- **Authorization**, derived from the spec's security schemes. HTTP Basic shows username +
  password, Bearer (and OAuth2) a token field, an API key its header or query value. Credential
  values are masked with an eye toggle, and folded into the request correctly at send time
  (Basic base64, `Bearer …`, or the named header/query).
- **Headers**, **Path**, and **Query** — one input per parameter, pre-filled from the spec's
  examples, with type and description inline. An `Accept` header is added automatically from
  what the operation produces, unless the spec declares its own.
- **Body** — a JSON editor for write operations, seeded from the request schema.

The top bar carries an editable URL and an operation switcher for jumping to sibling endpoints
without closing the playground. The right half shows a live request sample, regenerated as you
type, and the response once you press Send.

An open playground is reflected in the URL as `?playground=open`, so
`…/get-user?playground=open` opens with it ready to run.

### Security requirements

OpenAPI's `security` is a **list of alternatives**: each entry is one way to satisfy the
endpoint, and the keys *within* an entry are all required together.

```yaml
# Either one works (OR)
security:
  - BasicAuth: []
  - BearerAuth: []

# Both are sent (AND)
security:
  - BasicAuth: []
    BearerAuth: []
```

For the first, the playground shows a **picker** and sends only the selected scheme. Credentials
for each alternative are kept independently, and the pick is remembered across endpoints.

For the second, both render together and both are folded into the request — which works when
they target different places (an API key header plus a bearer token). If both want the
`Authorization` header, the playground flags it inline rather than silently sending one.

An empty entry (`- {}`) means the endpoint also works unauthenticated; it appears as **No
auth**, though the playground starts on the first alternative that actually asks for a
credential. A requirement naming a scheme that `components.securitySchemes` never defines is
dropped.

A scheme declared under `components.securitySchemes` but never referenced by any `security`
requirement renders nothing — the first thing to check when a scheme you added doesn't appear.

Alternatives differing only by OAuth2 scope collapse into one entry.

### Credentials persist for the tab

Credentials typed on one endpoint prefill the Authorization section on every other endpoint of
the same spec. They live in `sessionStorage` — gone when the tab closes — and a **Forget**
control clears them immediately. They are scoped to the site and the spec, so one spec's
credentials never prefill another's.

This is a convenience for the reader's own credentials. It is not a way to hand readers access
to your API: whatever a reader types is in page memory and sent from their browser. Prefer a
scoped, revocable credential over a password-equivalent one, and use the request proxy when the
request must carry a real secret.

### CORS

**Try it sends straight from the reader's browser**, so a live call succeeds only against an API
that permits cross-origin requests. Where one doesn't, the response panel shows a notice and the
request sample can be copied instead.

An optional server-side **request proxy** removes that constraint and lets credentials stay
server-side. It is opt-in per tenant, configured in the dashboard.

## Code samples

Every endpoint gets ready-to-run cURL, JavaScript, and Python snippets carrying the endpoint's
auth the way the spec declares it, with the credential as a placeholder — so the snippet beside
the playground and the request the playground sends agree.

## Hand-written API pages

For an API without a spec, or a page documenting something the spec can't express, write
ordinary MDX:

````mdx
---
title: "Create a widget"
description: "Create a widget in the current workspace."
---

<ParamField body="name" type="string" required>
  Display name for the widget.
</ParamField>

<ParamField body="color" type="string" default="gray">
  Any CSS color.
</ParamField>

<ResponseField name="id" type="string" required>
  The created widget's id.
</ResponseField>

<ResponseField name="owner" type="object">
  The account that owns it.

  <Expandable title="properties">
    <ResponseField name="id" type="string">Account id.</ResponseField>
    <ResponseField name="email" type="string">Account email.</ResponseField>
  </Expandable>
</ResponseField>

<RequestExample>
```bash cURL
curl -X POST https://api.example.com/v1/widgets \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"name":"My widget"}'
```
</RequestExample>

<ResponseExample>
```json 201 Created
{ "id": "wgt_123", "name": "My widget" }
```
</ResponseExample>
````

`<RequestExample>` and `<ResponseExample>` render **inline, in document order**, styled as
distinct panels — they don't move into the right column the way a generated endpoint page's
code panel does. Full props are in `components.md`.
