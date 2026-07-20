import { streamText, convertToModelMessages, stepCountIs, type UIMessage } from "ai";
import { aiModel, aiModelId, aiProviderOptions, aiProviderStatus } from "@/lib/ai-model";
import { assistantTools } from "@/lib/assistant-tools";
import { authoringTools, draftContentSource } from "@/lib/authoring-tools";
import { contentContext, loadConfig } from "@papervine/renderer/lib/content";
import { findSite } from "@/lib/dashboard-context";
import { getSession, listOrganizations, getMemberRole } from "@/lib/session";
import { canSeeFeature } from "@/lib/features";
import { checkoutBranch } from "@/lib/authoring-core";
import { aiRefusalResponse, authorizeAi, recordAiUsage } from "@/lib/billing/store";

/**
 * The editor's left-panel agent (SPEC §9.2) — a read/WRITE assistant. It shares the read
 * tools with the public assistant but adds the authoring write tools, all scoped to the
 * site + edit branch and run inside the draft content context, so the agent reads and
 * writes the SAME draft buffer the human editor uses. One backend, two front-ends.
 */
export async function POST(req: Request) {
  const provider = aiProviderStatus();
  if (!provider.ok) {
    return Response.json({ error: provider.error }, { status: 503 });
  }

  const { messages, org, site, branch } = (await req.json()) as {
    messages: UIMessage[];
    org: string;
    site: string;
    branch?: string;
  };

  // Authorize: signed-in org member with the editor feature.
  const session = await getSession();
  if (!session) return Response.json({ error: "Signed out." }, { status: 401 });
  const organization = (await listOrganizations())?.find((o) => o.slug === org);
  if (!organization) return Response.json({ error: "Org not found." }, { status: 404 });
  const role = await getMemberRole(organization.id, session.user.id);
  if (!canSeeFeature("editor.workspace", role)) {
    return Response.json({ error: "Editor not enabled." }, { status: 403 });
  }
  const siteRow = await findSite(org, site);
  if (!siteRow) return Response.json({ error: "Site not found." }, { status: 404 });

  // Billing gate (SPEC §10 Billing): the writing agent is a plan feature with credit
  // metering. Fails open on DB errors; only metered results get charged (billing/core.ts).
  const billing = await authorizeAi(organization.id, "writerAgent");
  if (!billing.allowed) return aiRefusalResponse(billing.code);

  // The agent always operates on an open session — auto-checkout if the client didn't
  // pass a branch (or passed one with no open session yet).
  const { branch: editBranch } = await checkoutBranch(siteRow, {
    actorUserId: session.user.id,
    branchName: branch,
  });

  // Scope every read AND write to the draft overlay for this branch.
  return contentContext.run(draftContentSource(siteRow, editBranch), async () => {
    const config = await loadConfig();
    const system =
      `You are the documentation editor agent for "${config.name}". You can read the docs ` +
      `(searchDocs / readPage / listPages) and EDIT them (write_page, edit_page, delete_page). ` +
      `You are editing the draft branch "${editBranch}"; edits buffer there and are not live. ` +
      `Make the smallest change that satisfies the request, and explain what you changed. ` +
      `NEVER publish or open a PR unless the user explicitly asks — only then call publish. ` +
      `Use Markdown in your replies.`;

    const model = aiModelId();
    const result = streamText({
      model: aiModel(model),
      system,
      messages: await convertToModelMessages(messages),
      tools: { ...assistantTools, ...authoringTools(siteRow, editBranch) },
      providerOptions: aiProviderOptions(model),
      stopWhen: stepCountIs(12),
      // Meter the whole run. Fire-and-forget — a metering failure drops the charge,
      // never the edit (billing/store.ts).
      onFinish: ({ totalUsage }) => {
        if (billing.metered) {
          void recordAiUsage({
            organizationId: organization.id,
            siteId: siteRow.id,
            feature: "writerAgent",
            model,
            tokensIn: totalUsage.inputTokens ?? 0,
            tokensOut: totalUsage.outputTokens ?? 0,
          });
        }
      },
    });
    return result.toUIMessageStreamResponse();
  });
}
