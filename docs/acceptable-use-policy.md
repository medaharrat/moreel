# Acceptable Use Policy (DRAFT)

> **⚠️ THIS IS NOT LEGAL ADVICE.** See `docs/terms-of-service.md`'s
> header — the same caveat applies here. A qualified lawyer must review
> this before it governs a real customer relationship.

This policy applies to all use of Moreel (MCP interface and REST API). It
exists both as a customer-facing commitment and as a description of what
Moreel technically enforces where possible — sections are marked
**(enforced)** where the codebase actually blocks the behavior today, and
**(policy only)** where it's a stated rule without a technical control.

## Prohibited uses

You may not use Moreel to:

1. **Abuse third-party platforms.** Use Moreel to circumvent Instagram's
   (or any other platform's) rate limits, access controls, or anti-abuse
   systems. **(policy only — and see `docs/provider-policy.md`: Moreel
   itself is architecturally incapable of this by design, since it
   implements no evasion techniques; this clause binds the customer's
   *use* of Moreel's legitimate output, not Moreel's own behavior.)**

2. **Circumvent access controls.** Submit URLs for private, login-gated,
   or otherwise access-restricted content, or attempt to have Moreel
   retrieve content you are not authorized to access. **(enforced, in
   part** — Moreel returns `AUTHENTICATION_REQUIRED` and does not attempt
   retrieval of detected login-gated content; it cannot detect every case
   of unauthorized access to nominally-public content, so this remains
   also a customer obligation.)

3. **Bypass CAPTCHAs or similar challenges,** or use Moreel in conjunction
   with any tool that does. **(policy only.)**

4. **Steal or misuse credentials** — yours or anyone else's — in
   connection with using the Service. **(policy only.)**

5. **Scrape private content without authorization**, whether or not a
   technical vulnerability would allow it. **(policy only.)**

6. **Harass, defame, or target any individual** using content processed
   through the Service, or use the Service to build tooling for such
   purposes. **(policy only.)**

7. **Process illegal content**, including but not limited to content
   whose possession or transcription is illegal in your jurisdiction.
   **(policy only.)**

8. **Overload or attack the Service**, including automated request floods
   intended to exceed rate limits or exhaust capacity. **(enforced)** —
   multi-layer rate limiting (`src/ratelimit/`, per-IP and per-account),
   per-request cost ceilings (max duration/size/timeout — see
   `docs/security.md`), and a circuit breaker that reduces (never
   increases) load under sustained failure.

9. **Attempt credential-sharing or reselling** of API keys across
   accounts or to unauthorized third parties. **(partially enforced)** —
   API keys are tied to a single account
   (`src/auth/repository.ts`); detecting sharing/reselling in practice is
   a policy matter, not purely technical.

10. **Automate attacks against Moreel's own infrastructure** — attempting
    to discover or exploit vulnerabilities outside of an authorized
    security research/bug-bounty arrangement. **[COUNSEL REVIEW REQUIRED:
    add a responsible-disclosure/safe-harbor clause if a bug bounty is
    ever offered.]**

## Enforcement

Violation of this policy may result in rate-limit reduction, API key
revocation, account suspension, or termination, at Moreel's discretion, in
addition to any remedies available under the Terms of Service.
**[COUNSEL REVIEW REQUIRED: define notice/appeal process, if any.]**

## Reporting abuse

**[COUNSEL REVIEW REQUIRED / PRODUCT DECISION REQUIRED]**: no abuse-report
channel/email has been established yet — add one before this policy is
presented publicly, since a policy that invites reports needs somewhere
for them to go.
