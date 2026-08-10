import type { Metadata } from "next";

export const metadata: Metadata = { title: "Privacy Policy" };

// STARTER TEMPLATE — review with counsel before relying on it. Fill [BRACKETS].
export default function PrivacyPolicy() {
  return (
    <article>
      <h1>Privacy Policy</h1>
      <p className="lede">Last updated: June 9, 2026</p>

      <p>
        This Privacy Policy explains how <strong>Papervine, LLC</strong> (&ldquo;we,&rdquo;
        &ldquo;us&rdquo;), the company behind <strong>Papervine</strong> (the
        &ldquo;Service&rdquo;), collects, uses, and shares information about you when you use
        papervine.io, our dashboard, and the documentation sites we host on your behalf.
      </p>

      <h2>1. Information we collect</h2>
      <ul>
        <li>
          <strong>Account information.</strong> Name, email address, and authentication
          credentials you provide when you create an account or organization.
        </li>
        <li>
          <strong>Customer content.</strong> The documentation source (MDX, <code>docs.json</code>,
          images, and related assets) you connect from your Git repository so we can render and
          host your docs site. You control this content; we process it to provide the Service.
        </li>
        <li>
          <strong>Payment information.</strong> Billing is handled by Stripe. We do not store your
          full card number — Stripe collects and processes it. We retain a customer identifier,
          plan, and billing status.
        </li>
        <li>
          <strong>Usage &amp; analytics.</strong> Page views, search queries, AI-assistant
          questions, and similar event data for your docs sites and our dashboard, used to provide
          analytics and improve the Service.
        </li>
        <li>
          <strong>Cookies.</strong> We use strictly-necessary cookies for authentication and a
          limited set of analytics cookies. See &ldquo;Cookies&rdquo; below.
        </li>
      </ul>

      <h2>2. How we use information</h2>
      <ul>
        <li>To provide, operate, and maintain the Service and host your documentation sites.</li>
        <li>To authenticate you and secure your account and organization.</li>
        <li>To process payments, manage subscriptions, and prevent fraud.</li>
        <li>To provide analytics and the AI assistant grounded in your content.</li>
        <li>To communicate with you about your account, security, and product updates.</li>
        <li>To comply with legal obligations and enforce our Terms of Service.</li>
      </ul>

      <h2>3. Service providers (subprocessors)</h2>
      <p>
        We share information with vendors who process it on our behalf to run the Service. As of the
        date above, these include:
      </p>
      <ul>
        <li><strong>Vercel</strong> — application hosting.</li>
        <li><strong>Neon</strong> — managed Postgres database.</li>
        <li><strong>Cloudflare R2</strong> — object storage for compiled docs and assets.</li>
        <li><strong>Anthropic</strong> — powers the AI documentation assistant.</li>
        <li><strong>Stripe</strong> — payment processing.</li>
        <li><strong>GitHub</strong> — source of the documentation you connect.</li>
      </ul>
      <p>
        We do not sell your personal information. We share it only as described here or with your
        direction (e.g., the public docs sites you choose to publish).
      </p>

      <h2>4. Data retention</h2>
      <p>
        We retain account and content data for as long as your account is active. After you delete
        your account or a site, we delete or de-identify associated data within a commercially
        reasonable period, except where we must retain it to comply with law, resolve disputes, or
        enforce agreements.
      </p>

      <h2>5. Your rights</h2>
      <p>
        Depending on where you live (for example, under the GDPR or CCPA/CPRA), you may have rights
        to access, correct, delete, or port your personal information, and to object to or restrict
        certain processing. To exercise these rights, contact us at{" "}
        <a href="mailto:privacy@papervine.io">privacy@papervine.io</a>. We will not discriminate
        against you for exercising them.
      </p>

      <h2>6. Cookies</h2>
      <p>
        We use cookies that are strictly necessary for authentication, plus limited first-party
        analytics. You can control cookies through your browser settings; disabling necessary
        cookies may prevent you from signing in.
      </p>

      <h2>7. Security</h2>
      <p>
        We use industry-standard measures (encryption in transit, access controls) to protect your
        information. No method of transmission or storage is completely secure, and we cannot
        guarantee absolute security.
      </p>

      <h2>8. International transfers</h2>
      <p>
        We operate in the United States and may process information in the U.S. and other countries.
        Where required, we rely on appropriate safeguards for cross-border transfers.
      </p>

      <h2>9. Children</h2>
      <p>The Service is not directed to children under 16, and we do not knowingly collect their data.</p>

      <h2>10. Changes</h2>
      <p>
        We may update this policy from time to time. Material changes will be posted here with an
        updated date and, where appropriate, notified to you.
      </p>

      <h2>11. Contact</h2>
      <p>
        Papervine, LLC — [MAILING ADDRESS]
        <br />
        <a href="mailto:privacy@papervine.io">privacy@papervine.io</a>
      </p>
    </article>
  );
}
