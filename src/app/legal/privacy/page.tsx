export default function PrivacyNoticePage() {
  return (
    <article className="space-y-8">
      <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
        <p className="font-medium">
          Draft — pending legal review. Not yet effective.
        </p>
        <p className="mt-1 text-xs text-amber-700">
          This document is a first draft and must be reviewed by qualified
          Malaysian counsel before it is relied upon. Do not treat this as
          final.
        </p>
      </div>

      <header>
        <h1 className="text-3xl font-medium tracking-tight text-gray-900">
          Privacy Notice
        </h1>
        <p className="mt-2 text-xs text-gray-500">
          Last updated: 17 April 2026
        </p>
      </header>

      <section className="space-y-3 text-sm leading-relaxed text-gray-700">
        <h2 className="text-xl font-medium text-gray-900">1. Who we are</h2>
        <p>
          BridgeConnect (&quot;BridgeConnect&quot;, &quot;we&quot;,
          &quot;us&quot;) is an invite-only B2B procurement-financing platform
          operated from Malaysia. This Privacy Notice explains how we collect,
          use, protect, and disclose personal data in accordance with Malaysia&apos;s
          Personal Data Protection Act 2010 (&quot;PDPA&quot;).
        </p>
        <p>
          Our data protection contact is{" "}
          <span className="font-mono">[TODO: email]</span>.
        </p>
      </section>

      <section className="space-y-3 text-sm leading-relaxed text-gray-700">
        <h2 className="text-xl font-medium text-gray-900">
          2. Personal data we collect
        </h2>
        <ul className="list-disc space-y-1 pl-6">
          <li>
            <strong>Account data</strong>: name, email address, role, and the
            admin-issued invite identifier.
          </li>
          <li>
            <strong>Commercial data</strong>: purchase-order references,
            delivery-order details, supplier information, buyer payment dates,
            commission and tier history.
          </li>
          <li>
            <strong>Financial data</strong> (for participants providing
            capital): bank-account details for disbursement of returns, capital
            amounts, deployment history.
          </li>
          <li>
            <strong>Technical data</strong>: IP address, device type, session
            timestamps, and authentication logs.
          </li>
        </ul>
      </section>

      <section className="space-y-3 text-sm leading-relaxed text-gray-700">
        <h2 className="text-xl font-medium text-gray-900">
          3. Why we collect it
        </h2>
        <p>
          We process personal data for the following purposes, relying on the
          following lawful bases under the PDPA:
        </p>
        <ul className="list-disc space-y-1 pl-6">
          <li>
            <strong>Performance of contract</strong>: to operate your account,
            calculate commissions, deploy capital, and pay returns.
          </li>
          <li>
            <strong>Legitimate interest</strong>: to secure the platform,
            prevent fraud, and improve our service.
          </li>
          <li>
            <strong>Legal obligation</strong>: to comply with Malaysian tax,
            anti-money-laundering, and record-keeping requirements.
          </li>
          <li>
            <strong>Consent</strong>: for any marketing communications (if
            applicable; you may withdraw this at any time).
          </li>
        </ul>
      </section>

      <section className="space-y-3 text-sm leading-relaxed text-gray-700">
        <h2 className="text-xl font-medium text-gray-900">
          4. Third-party processors
        </h2>
        <p>
          We share personal data with the following sub-processors strictly for
          the purposes above:
        </p>
        <ul className="list-disc space-y-1 pl-6">
          <li>
            <strong>Supabase</strong> — authentication and database hosting.
          </li>
          <li>
            <strong>Vercel</strong> — application hosting and delivery.
          </li>
        </ul>
        <p>
          These providers process data outside Malaysia (including in the
          United States and the European Union). By using BridgeConnect, you
          consent to such cross-border transfer in accordance with section 129
          of the PDPA. We require these processors to maintain security
          standards at least equivalent to those under the PDPA.
        </p>
      </section>

      <section className="space-y-3 text-sm leading-relaxed text-gray-700">
        <h2 className="text-xl font-medium text-gray-900">
          5. How long we keep it
        </h2>
        <p>
          We retain personal data for as long as your account is active, and
          thereafter for the period required by Malaysian tax and
          record-keeping laws (generally seven years from the date of the last
          relevant transaction). After this period the data is deleted or
          anonymised.
        </p>
      </section>

      <section className="space-y-3 text-sm leading-relaxed text-gray-700">
        <h2 className="text-xl font-medium text-gray-900">
          6. How we protect it
        </h2>
        <ul className="list-disc space-y-1 pl-6">
          <li>
            Data is encrypted in transit using HTTPS/TLS and at rest at our
            sub-processors.
          </li>
          <li>
            Database access is gated by Supabase row-level security; each
            account can only see its own data.
          </li>
          <li>Administrative access is limited to authorised personnel.</li>
        </ul>
      </section>

      <section className="space-y-3 text-sm leading-relaxed text-gray-700">
        <h2 className="text-xl font-medium text-gray-900">
          7. Your rights under the PDPA
        </h2>
        <p>You may, at any time and without charge:</p>
        <ul className="list-disc space-y-1 pl-6">
          <li>Access the personal data we hold about you;</li>
          <li>Correct data that is inaccurate or incomplete;</li>
          <li>Limit the processing of your data for direct marketing;</li>
          <li>Withdraw consent you have previously given; and</li>
          <li>
            Lodge a complaint with the Personal Data Protection Commissioner of
            Malaysia.
          </li>
        </ul>
        <p>
          To exercise any of these rights, contact us at{" "}
          <span className="font-mono">[TODO: email]</span>.
        </p>
      </section>

      <section className="space-y-3 text-sm leading-relaxed text-gray-700">
        <h2 className="text-xl font-medium text-gray-900">8. Cookies</h2>
        <p>
          We use only strictly-necessary authentication cookies provided by
          Supabase to keep you signed in. We do not use analytics, advertising,
          or tracking cookies and do not share cookie data with any third party
          for those purposes.
        </p>
      </section>

      <section className="space-y-3 text-sm leading-relaxed text-gray-700">
        <h2 className="text-xl font-medium text-gray-900">
          9. Changes to this notice
        </h2>
        <p>
          We will post material changes to this notice on this page at least 30
          days before they take effect and notify active users by email.
        </p>
      </section>
    </article>
  );
}
