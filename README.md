# Doctor clinical workspace

The application name and wordmark are intentionally blank. The interface is a responsive doctor-only workspace; patients do not sign in or have accounts.

## Run locally

Requirements: Node.js 22.5 or later (the app uses Node's built-in SQLite module).

```sh
npm install
npm start
```

Open `http://localhost:3000`. SQLite data is stored in `data/clinical.sqlite`; set `DATA_DIR` to an absolute persistent path to move it. The app creates the database and constraints on first start. To run the integration tests, use `npm test`.

New accounts remain **pending** and can sign in only to see their verification status. No patient or clinical data is available until an authorized verifier marks the doctor verified. For local functional testing, configure:

- `VERIFICATION_ADMIN_TOKEN`: a long random credential for the verification endpoint.
- `SESSION_SECRET`: a persistent random value of at least 32 characters. Production startup refuses a missing/short value. Keep both outside source control and use a secret manager.

An authorized verifier can change a doctor's status by sending `POST /api/admin/doctors/{doctor-id}/verify` with JSON `{"status":"verified"}` or `{"status":"rejected"}` and an `X-Verification-Token` header. This endpoint is an integration point, **not** proof of professional credentials: the organization must restrict the token, check authoritative licensing sources, record who performed verification, and establish an appeal/revocation process. Do not distribute the verifier token to doctors or browser clients.

## Functional scope

- Server-side doctor sessions, scrypt password hashing, CSRF checks, sign-out, password change, account duplicate checks, and pending/verified access gates.
- Persistent doctor-scoped patients with mandatory DOB-or-age, phone, emergency contact, address, and explicit history/allergy/medication information; a clinician may record unknown values.
- Appointments, local-time availability and blocked dates, overlap checks, rescheduling/status history, consultations, amendments, prescriptions, versioning, and PDF export.
- Psychiatric record routes are separately restricted to verified psychiatrists and access is audit logged. General medical records and appointments are also scoped to their owner.
- Notifications do not include diagnoses or psychiatric details. External email and SMS delivery are not configured.

## Deployment and privacy prerequisites

This repository is a functional development foundation and is **not production-ready**. Before handling real patient information, have a qualified security/privacy team assess it and complete at least:

- Configure HTTPS at the application boundary, secure secret storage/rotation, backup and restore tests, encrypted disks/backups, OS-level database-file permissions, monitoring, incident response, and tested retention/deletion policies.
- Replace the shared-token credential-review hook with a named, authenticated administrative workflow, authoritative professional registration checks, reviewer audit, revocation and re-verification.
- Implement a verified password-reset channel, account recovery controls, multi-factor authentication, and robust distributed rate limiting. The current recovery screen deliberately does not claim email/SMS recovery is enabled; the in-memory login throttle is per process.
- Review applicable Indian data-protection, medical-record, professional, retention, and breach-notification requirements. Define consent/legal basis, access review, data-subject request handling, and operational audit retention with counsel.
- Validate the application with the target clinical team. Confirm deployment timezone, clinic schedule policy, PDF requirements, and real-world workflows. No clinical recommendations or automatic diagnoses/dosages are produced.

SQLite is a single-server persistent store, not a managed database with row-level security. Ownership and psychiatrist checks are enforced in server routes; privileged database-file access bypasses those controls. There is no patient account, profile-photo upload, external notification provider, or built-in authoritative credential-verification service.
