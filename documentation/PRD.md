# Project Requirements Document

## 1. Project Overview

We’re building a lightweight micro-service that answers the question “Has my phone number been flagged as spam?” on demand. When a marketing or sales workflow is about to display or dial a U.S. phone number, this service performs a real-time reputation check via Twilio Lookup (with the Nomorobo Spam Score add-on) and returns a simple Boolean flag (0 = clean, 1 = flagged). Optionally, it can run scheduled overnight re-checks to maintain a historical reputation log.

This service ensures that only “clean” caller IDs are used in campaigns, cutting down on bounces, complaints, or carrier filtering. Key success criteria include sub-second response times under normal load, reliable handling of Twilio rate limits, 24-hour caching to reduce API costs, secure handling of PII, and a minimal integration footprint for internal tooling (e.g., HubSpot workflows).

## 2. In-Scope vs. Out-of-Scope

### In-Scope

*   REST API endpoint (`/api/v1/spam_score`) in a Python micro-service (FastAPI or Flask).
*   Docker container packaging and deployment.
*   Authentication via API token and IP allow-listing for internal network access.
*   E.164 validation of phone numbers.
*   Synchronous Twilio Lookup calls with `AddOns=nomorobo_spamscore`.
*   Exponential back-off and retry logic for HTTP 429 / error 60616.
*   Caching lookup results in Supabase PostgreSQL with 24 h TTL.
*   Nightly archival job to re-check “clean” numbers and purge records older than one year.
*   Logging of request/response metadata to Supabase (masking all but last four digits).
*   HTTPS encryption, env-var or secrets-manager storage of credentials.

### Out-of-Scope (Phase 1)

*   User-facing web UI or dashboard.
*   Integration with additional reputation providers (Marchex, Ekata).
*   Twilio Lookup v2 migration.
*   Advanced monitoring/alerting tool integrations (Datadog, CloudWatch).
*   Multi-region or multi-cloud deployments.
*   Bulk lookup endpoints (beyond basic scheduling job).

## 3. User Flow

A marketing team member visits the internal tool and enters a U.S. phone number (E.164 format) into the “Spam Check” form. The front end (React or similar) attaches an internal API token in the HTTPS header, validates basic formatting, and issues a POST to `/api/v1/spam_score`. If the number fails validation, the service immediately returns a JSON error with a 400 status.

On valid requests, the micro-service checks the Supabase cache:\
– If a cached entry exists and is under 24 hours old, it returns that result.\
– Otherwise, it performs a synchronous GET to `https://lookups.twilio.com/v1/PhoneNumbers/{number}?AddOns=nomorobo_spamscore`, authenticating via `TWILIO_ACCOUNT_SID`/`TWILIO_AUTH_TOKEN`. It parses the JSON to extract `score` (0 or 1), stores the record in PostgreSQL (masked phone, score, timestamp, optional campaign_id), and returns `{ "spam_score": 0|1, "checked_at": "…" }`.

If Twilio replies with a rate-limit error (HTTP 429 or code 60616), the service retries up to three times with exponential back-off. On persistent failures, it returns a 503 with a `"service_unavailable"` error code. In all cases, the front end receives a consistent JSON schema and can disable dialing buttons or flag the number visually.

## 4. Core Features

*   **Authentication & Network Restriction**\
    Token-based header auth + IP allow-list ensures only internal calls from corporate network.
*   **Phone Number Validation**\
    Strict E.164 format check with immediate 400 error on invalid input.
*   **Twilio Lookup Integration**\
    GET call to Twilio Lookup API with `AddOns=nomorobo_spamscore`, parsing `add_ons.results.nomorobo_spamscore.result.score`.
*   **Error Handling & Retries**\
    Detect HTTP 429 / Twilio error 60616 → exponential back-off → up to 3 retries.
*   **Caching Layer**\
    Supabase PostgreSQL table keyed by phone number with 24 h TTL to reduce API cost.
*   **Archival Job**\
    Nightly task re-checks “clean” numbers, archives results older than 30 days into a history table, purges > 1 year.
*   **Logging & Auditing**\
    Store masked phone (last 4 digits), timestamp, score, error codes in Supabase logs for audit.
*   **Security & Compliance**\
    HTTPS-only, credentials in env vars/secrets, PII masking, encryption at rest, TCPA/CRTC awareness.
*   **Deployment Pipeline**\
    GitHub Actions / Netlify CLI to build Docker image, run tests/lint, push to container registry, zero-downtime rollout.

## 5. Tech Stack & Tools

*   **Backend Framework**: Python 3.x with FastAPI (or Flask).

*   **HTTP Client**: `httpx` (async) or `requests` (sync fallback).

*   **Database & Cache**: Supabase (PostgreSQL) for result caching & archival.

*   **Containerization**: Docker for micro-service packaging.

*   **Deployment**:

    *   CI/CD: GitHub Actions or Netlify CLI.
    *   Hosting: Container registry + chosen container platform (e.g. AWS ECS/EKS, self-hosted).

*   **Twilio Integration**: Twilio Lookup API v1 + Nomorobo Spam Score add-on.

*   **Scheduler**: Cron-like job runner (e.g. APScheduler or Cloud-native scheduler).

*   **IDE & Plugins**: Cursor (AI-powered suggestions), Bolt (project scaffolding).

## 6. Non-Functional Requirements

*   **Performance**\
    – Target p95 response time < 500 ms under normal load.\
    – Default throughput 25 req/s; service scales horizontally for higher demands.
*   **Reliability**\
    – Automatic retry on 429/60616 up to 3 times.\
    – Nightly archival ensures data consistency.
*   **Security**\
    – TLS for all in-transit data.\
    – Credentials stored in environment variables or secrets manager.\
    – Role-based access control for admin endpoints.
*   **Compliance & Privacy**\
    – Mask all but last four digits of phone numbers in logs.\
    – Data-at-rest encryption via PostgreSQL native encryption.\
    – Audit log of every request without exposing full PII.
*   **Maintainability**\
    – Clear separation of service, database, and scheduler modules.\
    – Well-documented code and OpenAPI spec.

## 7. Constraints & Assumptions

*   **Twilio Rate-Limits**\
    Baseline ~25 req/s; assume scaling request to Twilio support if needed.
*   **Environment**\
    Docker container runs behind a load balancer; environment variables provide all secrets.
*   **API Consumers**\
    Only internal web tool (HubSpot integration or Make) will call the service.
*   **Data Freshness vs. Cost**\
    24 h TTL balances cost (~$0.013 per lookup) with data accuracy.
*   **Language/Framework**\
    Python preferred but no hard mandate; service structure remains similar.
*   **Monitoring**\
    Basic metrics via Supabase logs; advanced monitoring deferred to later phases.

## 8. Known Issues & Potential Pitfalls

*   **Twilio Outages or API Changes**\
    Monitor Twilio status pages; keep Nomorobo add-on configuration up to date.
*   **Rate Limit Exceeded**\
    Mitigation: exponential back-off, caching, request increased limits.
*   **Data Privacy Risks**\
    Ensure phone masking is never bypassed; secure backups/encryption.
*   **Costs Spiking**\
    Bulk campaigns may exceed cache efficiency; consider pre-warming cache by scheduling batch lookups.
*   **Clock Skew on Scheduler**\
    Host time synchronization to ensure nightly jobs run at expected times.
*   **Schema Evolution**\
    Plan migrations for future Lookup v2 JSON changes.
