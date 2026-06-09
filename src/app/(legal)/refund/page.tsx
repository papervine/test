import type { Metadata } from "next";

export const metadata: Metadata = { title: "Refund & Cancellation Policy" };

// STARTER TEMPLATE — review with counsel before relying on it. Fill [BRACKETS].
export default function RefundPolicy() {
  return (
    <article>
      <h1>Refund &amp; Cancellation Policy</h1>
      <p className="lede">Last updated: June 9, 2026</p>

      <p>
        This policy explains how billing, cancellations, and refunds work for paid{" "}
        <strong>Papervine</strong> subscriptions, operated by <strong>NewNewMedia, LLC</strong>.
      </p>

      <h2>1. Subscriptions &amp; renewals</h2>
      <p>
        Paid plans are billed in advance and <strong>renew automatically</strong> each billing
        period (monthly or annual, as selected) until cancelled. Your card is charged through Stripe
        at the start of each period.
      </p>

      <h2>2. How to cancel</h2>
      <p>
        You can cancel anytime from your dashboard billing settings or the Stripe customer portal.
        Cancellation stops future renewals; your plan stays active until the end of the current
        billing period, after which it will not renew.
      </p>

      <h2>3. Refunds</h2>
      <ul>
        <li>
          <strong>Subscriptions are generally non-refundable</strong> for the current period once
          billed, except where required by law. After cancelling, you keep access through the end of
          the period you already paid for.
        </li>
        <li>
          <strong>Annual plans:</strong> we do not provide prorated refunds for unused time unless
          required by law or stated otherwise in writing.
        </li>
        <li>
          <strong>Billing errors:</strong> if you were charged in error or experienced a material
          service failure, contact us within [REFUND WINDOW, e.g. 14] days and we will review and,
          where appropriate, issue a refund or credit.
        </li>
      </ul>

      <h2>4. Free trials</h2>
      <p>
        If a plan includes a free trial, you will not be charged until the trial ends. Cancel before
        the trial ends to avoid being billed.
      </p>

      <h2>5. Chargebacks</h2>
      <p>
        If you believe a charge is incorrect, please contact us first at{" "}
        <a href="mailto:support@papervine.io">support@papervine.io</a> — we will work to resolve it
        quickly. Initiating a chargeback without contacting us may result in suspension of your
        account.
      </p>

      <h2>6. Contact</h2>
      <p>
        Questions about billing or refunds:{" "}
        <a href="mailto:support@papervine.io">support@papervine.io</a>
      </p>
    </article>
  );
}
