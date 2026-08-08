// Transactional email bodies (SPEC §10.1) — pure functions, no I/O and no provider types, so
// every template unit-tests by asserting on the returned strings.
//
// Deliberately hand-written HTML rather than a template library: these are three short,
// structurally identical messages, and email clients are hostile to anything modern (no
// external CSS, no flexbox/grid in Outlook, no <style> in Gmail's clipped view). Inline styles
// on a centered table is the shape that survives. Every message also carries a `text` part —
// a missing plaintext alternative is itself a spam signal, and some clients show nothing else.

export type EmailBody = { subject: string; html: string; text: string };

const BRAND = "Papervine";

// Escape anything interpolated into the HTML part. These strings come from user-controlled
// places — a display name, an organization name someone typed — and an unescaped `<` would
// let a signup name inject markup into an email we send on their behalf.
function esc(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * The shared chrome: a heading, a paragraph, one big call-to-action button, and the raw URL
 * repeated as text (clients that strip the anchor, or a user forwarding to a different device,
 * still need something copy-pasteable).
 */
function layout(opts: {
  heading: string;
  body: string;
  ctaLabel: string;
  url: string;
  footer: string;
}): string {
  const url = esc(opts.url);
  return `<!doctype html>
<html><body style="margin:0;padding:0;background:#f6f7f9;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f6f7f9;padding:32px 12px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border-radius:12px;padding:32px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#1a1a1a;">
        <tr><td style="font-size:20px;font-weight:600;padding-bottom:12px;">${esc(opts.heading)}</td></tr>
        <tr><td style="font-size:15px;line-height:1.6;color:#444;padding-bottom:24px;">${opts.body}</td></tr>
        <tr><td align="center" style="padding-bottom:24px;">
          <a href="${url}" style="display:inline-block;background:#4f46e5;color:#ffffff;text-decoration:none;font-size:15px;font-weight:600;padding:12px 24px;border-radius:8px;">${esc(opts.ctaLabel)}</a>
        </td></tr>
        <tr><td style="font-size:13px;line-height:1.6;color:#777;padding-bottom:8px;">Or paste this link into your browser:</td></tr>
        <tr><td style="font-size:13px;line-height:1.6;word-break:break-all;"><a href="${url}" style="color:#4f46e5;">${url}</a></td></tr>
        <tr><td style="font-size:13px;line-height:1.6;color:#777;padding-top:24px;border-top:1px solid #eee;margin-top:24px;">${esc(opts.footer)}</td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
}

export function verifyEmailBody(opts: { url: string; name?: string | null }): EmailBody {
  const greeting = opts.name ? `Hi ${esc(opts.name)}, confirm` : "Confirm";
  return {
    subject: `Confirm your ${BRAND} email address`,
    html: layout({
      heading: `${greeting} your email address`,
      body: `Confirming your address finishes setting up your ${BRAND} account and lets you sign in with Google on the same email.`,
      ctaLabel: "Confirm email address",
      url: opts.url,
      footer: `If you didn't create a ${BRAND} account, you can ignore this email — no account is active until this link is used.`,
    }),
    text: [
      `${opts.name ? `Hi ${opts.name},` : "Hi,"}`,
      ``,
      `Confirm your email address to finish setting up your ${BRAND} account:`,
      opts.url,
      ``,
      `If you didn't create a ${BRAND} account, you can ignore this email.`,
    ].join("\n"),
  };
}

export function resetPasswordBody(opts: {
  url: string;
  name?: string | null;
  expiresInMinutes: number;
}): EmailBody {
  return {
    subject: `Reset your ${BRAND} password`,
    html: layout({
      heading: "Reset your password",
      body: `Someone asked to reset the password for this ${BRAND} account. This link expires in ${opts.expiresInMinutes} minutes and can only be used once.`,
      ctaLabel: "Choose a new password",
      url: opts.url,
      footer: `If you didn't ask for this, ignore this email — your password hasn't changed and nobody can use this link without your inbox.`,
    }),
    text: [
      `${opts.name ? `Hi ${opts.name},` : "Hi,"}`,
      ``,
      `Someone asked to reset the password for this ${BRAND} account. Choose a new one here:`,
      opts.url,
      ``,
      `The link expires in ${opts.expiresInMinutes} minutes and can only be used once.`,
      `If you didn't ask for this, ignore this email — your password hasn't changed.`,
    ].join("\n"),
  };
}

export function invitationBody(opts: {
  url: string;
  organization: string;
  role: string;
  inviterName?: string | null;
}): EmailBody {
  const who = opts.inviterName ? `${esc(opts.inviterName)} invited you` : "You've been invited";
  const whoText = opts.inviterName ? `${opts.inviterName} invited you` : "You've been invited";
  return {
    subject: `Join ${opts.organization} on ${BRAND}`,
    html: layout({
      heading: `Join ${esc(opts.organization)} on ${BRAND}`,
      body: `${who} to join <strong>${esc(opts.organization)}</strong> as ${esc(opts.role)}. Accept the invitation to get access to their documentation.`,
      ctaLabel: "Accept invitation",
      url: opts.url,
      footer: `If you weren't expecting this invitation, you can ignore it.`,
    }),
    text: [
      `${whoText} to join ${opts.organization} on ${BRAND} as ${opts.role}.`,
      ``,
      `Accept the invitation:`,
      opts.url,
      ``,
      `If you weren't expecting this invitation, you can ignore it.`,
    ].join("\n"),
  };
}
