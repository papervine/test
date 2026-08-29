/**
 * The page the marketing home's editor demo opens with.
 *
 * Deliberately a REAL docs page rather than lorem ipsum: the point of the demo is that a
 * visitor recognises their own documentation in it, so it carries the things docs actually
 * contain — a callout, tabbed install commands, numbered steps, a parameter table.
 *
 * Constraints, both pinned by tests/unit/home-demo-content.test.ts:
 *  - every component here must be in the converter's COMPONENTS map, or the block degrades to
 *    plain text the moment the demo mounts (packages/mdx-prosemirror/src/components.ts), and
 *  - it must survive a round trip through the converter unchanged, since the demo's whole
 *    argument is "edit visually, it stays a real MDX file" and the source pane shows the proof.
 *
 * That second constraint is why this is written in the converter's ALREADY-NORMALIZED form —
 * padded table pipes, a blank line between sibling <Step>/<Tab> elements. Hand-tidying those
 * makes the source pane visibly reformat itself the instant the editor mounts, which reads as
 * "the editor rewrote my file" on the one page where that impression is most expensive.
 *
 * Kept short on purpose: it has to be legible in a ~520px pane without scrolling to understand.
 */
export const DEMO_MDX = `---
title: "Quickstart"
description: "Send your first request in about five minutes."
---

Every page on your docs site is a file like this one. Edit it here — the MDX on the right updates as you type.

<Note>
  You're editing a real document, in your browser, with nothing installed. Press \`/\` to insert a block.
</Note>

## Install

<Tabs>
  <Tab title="npm">
    \`\`\`bash
    npm install @acme/sdk
    \`\`\`
  </Tab>

  <Tab title="pnpm">
    \`\`\`bash
    pnpm add @acme/sdk
    \`\`\`
  </Tab>
</Tabs>

## Send a request

<Steps>
  <Step title="Create an API key">
    Open your dashboard and generate a key. Keep it on the server — it carries full account access.
  </Step>

  <Step title="Make the call">
    Pass the key as a bearer token and the API answers with JSON.
  </Step>
</Steps>

## Parameters

| Name     | Type   | Description                                    |
| -------- | ------ | ---------------------------------------------- |
| \`query\`  | string | What to search for. Required.                  |
| \`limit\`  | number | How many results to return. Defaults to 10.    |
| \`cursor\` | string | Page through results from a previous response. |
`;
