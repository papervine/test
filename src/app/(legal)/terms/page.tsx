import type { Metadata } from "next";

export const metadata: Metadata = { title: "Terms of Service" };

// STARTER TEMPLATE — review with counsel before relying on it. Fill [BRACKETS].
export default function TermsOfService() {
  return (
    <article>
      <h1>Terms of Service</h1>
      <p className="lede">Last updated: June 9, 2026</p>

      <p>
        These Terms of Service (&ldquo;Terms&rdquo;) govern your access to and use of{" "}
        <strong>Papervine</strong> (the &ldquo;Service&rdquo;), operated by{" "}
        <strong>Papervine, LLC</strong> (&ldquo;we,&rdquo;
        &ldquo;us&rdquo;). By creating an account or using the Service, you agree to these Terms.
      </p>

      <h2>1. The Service</h2>
      <p>
        Papervine renders and hosts documentation sites from the source files in your Git
        repository, and provides related dashboard, analytics, and AI-assistant features. We may
        update, add, or remove features over time.
      </p>

      <h2>2. Accounts &amp; eligibility</h2>
      <p>
        You must be at least 18 and able to form a binding contract. You are responsible for your
        account credentials and for all activity under your account and organization. Notify us
        promptly of any unauthorized use.
      </p>

      <h2>3. Your content</h2>
      <p>
        You retain all ownership of the documentation and other materials you connect or upload
        (&ldquo;Customer Content&rdquo;). You grant us a worldwide, non-exclusive license to host,
        copy, process, render, and display Customer Content solely to provide and improve the
        Service. You represent that you have the rights to your Customer Content and that it does
        not infringe others&rsquo; rights or violate law.
      </p>

      <h2>4. Acceptable use</h2>
      <p>You agree not to:</p>
      <ul>
        <li>Use the Service to host unlawful, infringing, or malicious content.</li>
        <li>Attempt to disrupt, reverse engineer, or gain unauthorized access to the Service.</li>
        <li>Abuse, overload, or circumvent rate limits or usage controls.</li>
        <li>Use the Service to violate the privacy or rights of others.</li>
      </ul>

      <h2>5. Plans, billing &amp; taxes</h2>
      <p>
        Paid plans are billed in advance on a recurring basis (monthly or annual, as selected)
        through our payment processor, Stripe. Subscriptions <strong>auto-renew</strong> until
        cancelled. Fees are exclusive of taxes, which you are responsible for. We may change pricing
        with notice; changes apply to the next billing cycle.
      </p>

      <h2>6. Cancellation &amp; refunds</h2>
      <p>
        You may cancel at any time from your dashboard or the Stripe customer portal. Cancellation
        takes effect at the end of the current billing period. Refunds are governed by our{" "}
        <a href="/refund">Refund &amp; Cancellation Policy</a>.
      </p>

      <h2>7. Intellectual property</h2>
      <p>
        The Service, including its software, design, and trademarks (including
        &ldquo;Papervine&rdquo;), is owned by Papervine, LLC and protected by law. These Terms
        grant you no rights to our IP except the limited right to use the Service.
      </p>

      <h2>8. Third-party services</h2>
      <p>
        The Service integrates with third parties (e.g., GitHub, Stripe, Anthropic). Your use of
        those services is governed by their terms, and we are not responsible for them.
      </p>

      <h2>9. Disclaimers</h2>
      <p>
        THE SERVICE IS PROVIDED &ldquo;AS IS&rdquo; AND &ldquo;AS AVAILABLE&rdquo; WITHOUT WARRANTIES
        OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE,
        AND NON-INFRINGEMENT. WE DO NOT WARRANT THE SERVICE WILL BE UNINTERRUPTED OR ERROR-FREE.
      </p>

      <h2>10. Limitation of liability</h2>
      <p>
        TO THE MAXIMUM EXTENT PERMITTED BY LAW, PAPERVINE, LLC WILL NOT BE LIABLE FOR ANY INDIRECT,
        INCIDENTAL, SPECIAL, CONSEQUENTIAL, OR PUNITIVE DAMAGES, OR FOR LOST PROFITS OR DATA. OUR
        TOTAL LIABILITY FOR ANY CLAIM WILL NOT EXCEED THE AMOUNTS YOU PAID US IN THE 12 MONTHS BEFORE
        THE CLAIM.
      </p>

      <h2>11. Indemnification</h2>
      <p>
        You will indemnify and hold Papervine, LLC harmless from claims arising out of your Customer
        Content or your breach of these Terms.
      </p>

      <h2>12. Termination</h2>
      <p>
        You may stop using the Service at any time. We may suspend or terminate access for breach of
        these Terms or to comply with law. On termination, your right to use the Service ends and we
        may delete your data as described in the <a href="/privacy">Privacy Policy</a>.
      </p>

      <h2>13. Governing law</h2>
      <p>
        These Terms are governed by the laws of [GOVERNING-LAW STATE/JURISDICTION], without regard
        to conflict-of-laws rules. The exclusive venue for disputes is [VENUE].
      </p>

      <h2>14. Changes</h2>
      <p>
        We may update these Terms from time to time. Material changes will be posted here with an
        updated date; continued use after changes means you accept them.
      </p>

      <h2>15. Contact</h2>
      <p>
        Papervine, LLC — [MAILING ADDRESS]
        <br />
        <a href="mailto:legal@papervine.io">legal@papervine.io</a>
      </p>
    </article>
  );
}
