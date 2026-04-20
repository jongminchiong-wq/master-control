export default function DisclosuresPage() {
  return (
    <article className="space-y-8">
      <header>
        <h1 className="text-3xl font-medium tracking-tight text-gray-900">
          Disclosures
        </h1>
        <p className="mt-2 text-xs text-gray-500">
          Last updated: 17 April 2026
        </p>
      </header>

      <section className="rounded-xl border border-gray-200 bg-gray-50 p-5 text-sm leading-relaxed text-gray-700">
        <p className="font-semibold uppercase tracking-wide">
          Important — please read
        </p>
        <p className="mt-2">
          BridgeConnect is <strong>not</strong> a licensed capital markets
          intermediary and is <strong>not</strong> regulated by the Securities
          Commission Malaysia. Participation on the platform is{" "}
          <strong>not</strong> an investment in securities, a collective
          investment scheme, a deposit, or a regulated financial product. Your
          capital is at risk. Returns are not guaranteed. There is no deposit
          insurance and no investor compensation scheme that applies to
          activity on BridgeConnect.
        </p>
      </section>

      <section className="space-y-3 text-sm leading-relaxed text-gray-700">
        <h2 className="text-xl font-medium text-gray-900">
          1. What BridgeConnect actually is
        </h2>
        <p>
          BridgeConnect organises short-term contractual financing against
          specific purchase orders (&quot;POs&quot;). When a participant
          deploys capital against a PO, the participant enters into a financing
          arrangement under which they are entitled to a tiered contractual
          return on completion of that PO&apos;s payment cycle.
        </p>
        <p>
          This is a procurement-financing arrangement. It is not the
          subscription of, nor the dealing in, any unit, share, debenture, or
          other security; it is not a fund, scheme, or pooled investment
          vehicle within the meaning of the Capital Markets and Services Act
          2007.
        </p>
      </section>

      <section className="space-y-3 text-sm leading-relaxed text-gray-700">
        <h2 className="text-xl font-medium text-gray-900">2. Risks</h2>
        <ul className="list-disc space-y-2 pl-6">
          <li>
            <strong>Capital risk.</strong> Buyers under a PO may pay late,
            in part, or not at all. Suppliers may fail to deliver. In either
            case, the cycle may not complete and your capital may be returned
            late or only partially.
          </li>
          <li>
            <strong>No guarantee of return.</strong> Tier rates shown in the
            platform are the rates that apply when a cycle completes
            successfully. They are not promises. Historical cycle performance
            is not a reliable indicator of future results.
          </li>
          <li>
            <strong>Liquidity risk.</strong> Capital is locked for the
            duration of the cycle it is deployed against. There is no
            secondary market and no early-withdrawal facility.
          </li>
          <li>
            <strong>Concentration risk.</strong> Where capital is deployed
            against a small number of POs, default by a single buyer can have a
            material effect on returns.
          </li>
          <li>
            <strong>Counterparty risk.</strong> BridgeConnect is not a bank or
            licensed deposit-taking institution. Payments to participants
            depend on BridgeConnect&apos;s receipt of payment from buyers and
            on its continued solvency and operation.
          </li>
          <li>
            <strong>Regulatory risk.</strong> Malaysian regulation of
            procurement-financing arrangements may change. New rules could
            require BridgeConnect to alter, suspend, or wind down activity.
          </li>
        </ul>
      </section>

      <section className="space-y-3 text-sm leading-relaxed text-gray-700">
        <h2 className="text-xl font-medium text-gray-900">
          3. Conflicts of interest
        </h2>
        <p>
          A fixed five percent (5%) of each PO value is deducted in the
          commission waterfall as the participant-cost component. The amount
          actually paid to participants depends on the participant&apos;s tier
          (3%, 4%, or 5%). Where the tier rate is below 5%, BridgeConnect
          retains the difference (the &quot;spread&quot;) as its operating
          margin. This spread is the principal source of BridgeConnect&apos;s
          revenue and is disclosed here so that participants understand the
          economic incentive structure.
        </p>
      </section>

      <section className="space-y-3 text-sm leading-relaxed text-gray-700">
        <h2 className="text-xl font-medium text-gray-900">
          4. No advice
        </h2>
        <p>
          Nothing on the platform is intended as investment, tax, legal,
          accounting, or other professional advice. Estimates and projections
          shown in the dashboards are illustrative only. You should consult
          your own qualified advisors before deciding to participate.
        </p>
      </section>

      <section className="space-y-3 text-sm leading-relaxed text-gray-700">
        <h2 className="text-xl font-medium text-gray-900">
          5. Tax
        </h2>
        <p>
          Returns paid to participants may be subject to Malaysian income tax
          and other taxes depending on the participant&apos;s circumstances.
          BridgeConnect does not withhold tax. Participants are responsible for
          their own tax compliance.
        </p>
      </section>

      <section className="space-y-3 text-sm leading-relaxed text-gray-700">
        <h2 className="text-xl font-medium text-gray-900">
          6. Anti-money-laundering
        </h2>
        <p>
          BridgeConnect operates an invite-only model and may carry out
          identity, source-of-funds, and source-of-wealth checks before
          activating an account or accepting capital. BridgeConnect reserves
          the right to refuse onboarding, freeze an account, or report
          suspicious activity to the Financial Intelligence and Enforcement
          Department of Bank Negara Malaysia where required by law.
        </p>
      </section>

      <section className="space-y-3 text-sm leading-relaxed text-gray-700">
        <h2 className="text-xl font-medium text-gray-900">7. Contact</h2>
        <p>
          Questions about these disclosures or about a specific cycle:{" "}
          info@bridgeconnect.network.
        </p>
      </section>
    </article>
  );
}
