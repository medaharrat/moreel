# Terms of Service (DRAFT)

> **⚠️ THIS IS NOT LEGAL ADVICE AND IS NOT A FINAL TERMS OF SERVICE.**
> This is a starting draft for a developer/API product, written to cover
> the topics a real ToS needs to address. Every section marked
> **[COUNSEL REVIEW REQUIRED]** contains placeholders, assumptions, or
> jurisdiction-dependent language that a qualified lawyer must review,
> correct, and finalize before this is presented to any real customer or
> used to govern a real commercial relationship. Do not deploy this
> document as-is.

## 1. Acceptance of terms

By accessing or using Moreel (the "Service"), including via its MCP
interface or REST API, you ("you," "Customer") agree to these Terms of
Service ("Terms"). **[COUNSEL REVIEW REQUIRED: confirm this
clickwrap/browsewrap formation is enforceable in your target
jurisdictions.]**

## 2. The Service

Moreel provides automated transcription of publicly available video
content, currently limited to public Instagram Reels, accessed via an MCP
tool and/or REST API. The Service's scope, supported sources, and output
format may change; material reductions in functionality will be
communicated with reasonable notice where practicable.

## 3. Acceptable use

Use of the Service is governed by the Acceptable Use Policy
(`docs/acceptable-use-policy.md`), incorporated into these Terms by
reference.

## 4. Your responsibility for submitted content

You are solely responsible for the URLs and content you submit to the
Service, including:
- Having the legal right to request a transcript of that content (e.g.
  it is your own content, publicly available content you're authorized to
  process, or otherwise lawful for your use case).
- Compliance with the intellectual-property rights of the content's
  owner. Moreel does not grant you any license to the underlying video
  content or any rights beyond the transcript output itself.
- Ensuring your use of transcripts complies with applicable law
  (copyright, privacy, etc.) in your jurisdiction.

**[COUNSEL REVIEW REQUIRED: confirm indemnification language for
third-party IP claims arising from customer-submitted URLs.]**

## 5. Third-party platform dependency

The Service retrieves content from Instagram, a third-party platform
Moreel does not control or operate. Moreel:
- Does not guarantee Instagram's continued availability, API stability,
  or that any specific content will remain retrievable.
- May be temporarily or permanently unable to retrieve content due to
  Instagram-side changes, rate limiting, or access restrictions, without
  liability for resulting Service unavailability.
- Is not affiliated with, endorsed by, or sponsored by Instagram or Meta.

## 6. Rate limits

Access is subject to rate limits (see `docs/architecture.md`). Moreel
reserves the right to adjust these limits with notice, and to enforce
them technically (including rejecting requests that exceed them) without
separate notice for each rejection.

## 7. Prohibited automated abuse

In addition to the Acceptable Use Policy: you may not attempt to
circumvent rate limits, quotas, or access controls through multiple
accounts, credential sharing, or automated workarounds. Moreel may suspend
accounts engaged in such behavior without prior notice.

## 8. Service availability

The Service is provided on an "as available" basis. **[COUNSEL REVIEW
REQUIRED: insert actual SLA commitments, if any, matching
`docs/slos.md`'s targets — do not overstate uptime guarantees beyond what
`docs/slos.md` actually commits to.]**

## 9. Suspension and termination

Moreel may suspend or terminate access for violation of these Terms or the
Acceptable Use Policy, or suspected fraudulent/abusive activity.
**[COUNSEL REVIEW REQUIRED: define notice periods, cure periods if any,
and data-retention-on-termination behavior — see `docs/privacy.md`'s
deletion section.]**

## 10. Limitation of liability

**[COUNSEL REVIEW REQUIRED: standard limitation-of-liability and
disclaimer-of-warranties language, tailored to your jurisdiction and risk
tolerance. Do not launch without this section properly drafted.]**

## 11. Privacy

Use of the Service is also governed by the Privacy Policy
(`docs/privacy.md`).

## 12. Changes to these Terms

Moreel may update these Terms from time to time. **[COUNSEL REVIEW
REQUIRED: define notice mechanism and effective-date rules for changes.]**

## 13. Governing law

**[COUNSEL REVIEW REQUIRED: not yet specified. Depends on where the
operating entity is incorporated and where customers are located.]**

---

**Before this document governs any real customer relationship:** a
qualified lawyer must review and complete every `[COUNSEL REVIEW
REQUIRED]` section above, confirm consistency with actual implemented
behavior (this draft was written to match the current codebase's actual
behavior where it makes factual claims — e.g. section 5's third-party
dependency language reflects `docs/provider-policy.md`'s real technical
constraints), and sign off before launch.
