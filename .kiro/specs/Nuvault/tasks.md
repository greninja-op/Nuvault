# Implementation Plan: Nuvault

## Overview

This plan converts the Nuvault design into incremental, code-focused steps. It builds the backend first (configuration and startup guard, the Express middleware pipeline and error handler, Mongoose models, authentication and route protection, the shared ownership/isolation helper, then each financial domain), and finally the React client. Each step builds on the previous and ends wired into the running application, so there is no orphaned code.

The stack is fixed by the design: Node.js + Express, MongoDB via Mongoose, JWT auth, and a React (Vite + Tailwind) client. Tests use `fast-check` + Jest with `mongodb-memory-server`; client tests use React Testing Library + jsdom with a mocked Axios layer. Property tests cover Properties 1–36; unit, integration, and smoke tests cover the remaining concrete behaviors.

## Tasks

- [x] 1. Set up backend project structure and tooling
  - [x] 1.1 Initialize the backend project, dependencies, test tooling, and directory layout
    - Create the `server/` workspace with `package.json`; install `express`, `mongoose`, `jsonwebtoken`, `bcryptjs`, `express-validator`, `helmet`, `cors`, `express-rate-limit`, `dotenv`, `axios`
    - Install dev dependencies `jest`, `fast-check`, `mongodb-memory-server`, `supertest` and add a Jest config
    - Create directory structure: `config/`, `models/`, `controllers/`, `routes/`, `middleware/`, `utils/`, `tests/`
    - _Requirements: 22.1_

- [x] 2. Implement configuration loading and startup guard
  - [x] 2.1 Implement environment config loader and required-secret startup guard
    - Load all secrets (`MONGO_URI`, `JWT_SECRET`, `JWT_EXPIRE`, `CLAUDE_API_KEY`, `EXCHANGERATE_API_KEY`, client origin) from environment variables only
    - On boot, validate every required secret is present; log the missing key and halt startup (no request served) when any is absent
    - _Requirements: 22.1, 22.2_

  - [ ]* 2.2 Write property test for the startup guard
    - **Property 31: Startup halts when a required secret is missing**
    - **Validates: Requirements 22.2**

  - [ ]* 2.3 Write smoke test for environment configuration
    - Assert secrets are read from environment variables (absent from source) and the server starts successfully with a complete, valid environment
    - _Requirements: 22.1_

- [x] 3. Build the Express app skeleton: middleware pipeline and error handler
  - [x] 3.1 Assemble the Express app with the middleware pipeline
    - Wire CORS (permit only the configured client origin, reject others), Helmet (content-type-options, frame-options, strict-transport-security), the rate limiter (100 requests / 60s per client identifier → `429`), and `express.json()` in the specified order
    - Pre-mount the protected and public router aggregators and the terminal error handler so domain routers attach without further app edits
    - _Requirements: 22.3, 22.4, 22.5_

  - [x] 3.2 Implement the uniform error handler middleware
    - Return `{ message }` (non-empty) with the error's status or `500` when none is set; include `stack` only when `NODE_ENV !== 'production'`; map Mongoose `ValidationError` to `400`
    - _Requirements: 20.1, 20.2, 20.3, 20.4, 20.5_

  - [ ]* 3.3 Write property test for the uniform error response
    - **Property 29: Error handler produces a uniform response**
    - **Validates: Requirements 20.1, 20.2, 20.5**

  - [ ]* 3.4 Write property test for environment-dependent stack traces
    - **Property 30: Stack trace inclusion depends on environment**
    - **Validates: Requirements 20.3, 20.4**

  - [ ]* 3.5 Write property test for CORS origin admission
    - **Property 32: CORS admits only the configured origin**
    - **Validates: Requirements 22.3**

  - [ ]* 3.6 Write property test for security headers
    - **Property 33: Security headers appear on every response**
    - **Validates: Requirements 22.4**

  - [ ]* 3.7 Write integration test for rate limiting
    - Drive >100 requests in a 60s window against one client identifier, assert `429`, then assert recovery after the window using a controlled clock
    - _Requirements: 22.5_

- [ ] 4. Implement data models
  - [x] 4.1 Implement the User model with bcrypt hashing
    - Define the schema (name, email unique/lowercase/valid, password, currency default `INR`, createdAt); add a `pre('save')` hook hashing the password with a generated salt and a `matchPassword` method
    - _Requirements: 1.2_

  - [ ]* 4.2 Write property test for password hashing
    - **Property 9: Passwords are stored only as a bcrypt hash**
    - **Validates: Requirements 1.2**

  - [x] 4.3 Implement the financial resource models
    - Define Mongoose schemas for Asset, Liability, Transaction, Budget, Investment, Goal, and Bill with their field constraints and `user` references
    - Apply defaults (asset/user currency `INR`, transaction `date` now, goal `savedAmount` 0, bill `autoPay` false) and the Budget compound unique index on `(user, category, month, year)`
    - _Requirements: 6.8, 9.5, 11.5, 15.1, 16.8, 19.1_

- [x] 5. Implement authentication, JWT, and route protection
  - [x] 5.1 Implement token generation and registration
    - Implement `generateToken(userId)` (`jwt.sign` with `JWT_SECRET`, 30-day expiry) and `register`: validate name/email/password bounds, check case-insensitive email uniqueness, create the user, default currency to `INR`, return `201` with `{ token, user: { id, name, email } }`
    - _Requirements: 1.1, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 1.9, 2.6_

  - [x] 5.2 Implement login and profile retrieval
    - Implement `login` (case-insensitive email lookup, `bcrypt.compare`, generic `401` on any mismatch, safe user payload) and `getMe` (return profile minus password, `404` if user unresolved)
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.7, 3.1, 3.4_

  - [x] 5.3 Implement auth middleware and wire auth routes
    - Implement `protect` (extract Bearer token, `401` if absent; `jwt.verify`, `401` on failure/expiry; resolve user via `findById(...).select('-password')`, `401` if unresolved; attach `req.user`) and mount the public auth routes plus apply `protect` to protected routers
    - _Requirements: 3.2, 3.3, 4.1, 4.2, 4.3, 4.4, 4.5, 4.6_

  - [ ]* 5.4 Write property test for duplicate email registration
    - **Property 11: Duplicate email registration is rejected**
    - **Validates: Requirements 1.3**

  - [ ]* 5.5 Write property test for password exclusion in responses
    - **Property 8: Responses never expose the password or its hash**
    - **Validates: Requirements 1.6, 2.7, 3.1, 22.8**

  - [ ]* 5.6 Write property test for login behavior
    - **Property 10: Login is generic on failure and case-insensitive on email**
    - **Validates: Requirements 2.2, 2.3, 2.5**

  - [ ]* 5.7 Write property test for issued JWTs
    - **Property 12: Issued JWT round-trips the user id with the configured expiry**
    - **Validates: Requirements 2.6**

  - [ ]* 5.8 Write property test for protected-route enforcement
    - **Property 6: Protected routes require a valid token**
    - **Validates: Requirements 3.2, 3.3, 4.1, 4.3, 4.4, 4.6, 5.5**

  - [ ]* 5.9 Write unit tests for profile/auth edge cases
    - Profile request without a token → `401`; valid token but deleted/unresolved user → `404`/`401`
    - _Requirements: 3.2, 3.4, 4.2, 4.5_

- [x] 6. Checkpoint - authentication foundation
  - Ensure all tests pass, ask the user if questions arise.

- [x] 7. Implement the shared ownership/isolation helper
  - [x] 7.1 Implement the scoped read/create/update/delete primitives
    - Provide reusable helpers for scoped read (`find`/`findOne` with `user: req.user._id`), scoped create (inject `user`, discard client-supplied `user`), and scoped update/delete (`findOne` by id+user, `404` when null, never reassign `user`) for use by every domain controller
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.6_

- [x] 8. Implement asset management
  - [x] 8.1 Implement the asset controller and router
    - CRUD with validation (name 1–100, type in allowed set, value 0.01–999,999,999.99), `INR` currency default, ownership via the shared helper, `404` for not-owned/missing, status codes `201`/`200`/`400`/`404`
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7, 6.8_

- [x] 9. Implement liability management
  - [x] 9.1 Implement the liability controller and router
    - CRUD with validation (name 1–100, type in {loan, credit_card, mortgage, other}, amount 0.01–999,999,999.99), ownership via the shared helper, `404` for not-owned/missing
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.7_

- [x] 10. Implement currency utility and net worth
  - [x] 10.1 Implement the currency conversion utility
    - `convert(amount, from, to)` returns the amount unchanged when currencies match; otherwise fetch a rate from ExchangeRate API (≤ 5s), round to 2 dp; on timeout/failure signal unavailability so callers can fall back to the stored-currency amount; default display currency `INR`
    - _Requirements: 19.1, 19.2, 19.3, 19.4_

  - [ ]* 10.2 Write property test for currency conversion
    - **Property 28: Currency conversion formula and fallback**
    - **Validates: Requirements 19.2, 19.3**

  - [x] 10.3 Implement the net worth controller and route
    - Load the user's assets and liabilities, convert each to the display currency when needed, sum each side (empty set → 0), compute `netWorth = totalAssets − totalLiabilities` rounded to 2 dp, return both lists and both totals, never persist the result
    - _Requirements: 8.1, 8.2, 8.3, 8.5, 8.6_

  - [ ]* 10.4 Write property test for net worth computation
    - **Property 13: Net worth equals total assets minus total liabilities**
    - **Validates: Requirements 8.1, 8.2, 8.3, 8.5**

  - [ ]* 10.5 Write property test for mixed-currency aggregation
    - **Property 14: Mixed-currency aggregation converts before summation**
    - **Validates: Requirements 8.6**

  - [ ]* 10.6 Write unit test asserting net worth is not persisted
    - Confirm no derived net worth field is written to the database
    - _Requirements: 8.4_

- [x] 11. Implement transaction management
  - [x] 11.1 Implement the transaction controller CRUD and router
    - CRUD with validation (type in {income, expense}, category 1–100, amount > 0 ≤ 999,999,999.99 with ≤ 2 dp), default `date` to creation time, ownership via the shared helper, `404` for not-owned/missing
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5, 9.6, 9.7, 9.8_

  - [x] 11.2 Implement transaction filtering and summary
    - `list` supports optional month/year (both-or-neither, ranges validated; default returns all sorted by date descending); `summary` returns income and expense totals grouped by category; empty scope → `200` with empty set
    - _Requirements: 10.1, 10.2, 10.3, 10.4, 10.5_

  - [ ]* 11.3 Write property test for transaction listing and filtering
    - **Property 15: Transaction listing order and filtering are correct**
    - **Validates: Requirements 10.1, 10.2**

  - [ ]* 11.4 Write property test for transaction filter validation
    - **Property 16: Transaction filter validation**
    - **Validates: Requirements 10.3**

  - [ ]* 11.5 Write property test for transaction summary grouping
    - **Property 17: Transaction summary equals per-category grouping**
    - **Validates: Requirements 10.4**

- [x] 12. Implement budget management
  - [x] 12.1 Implement the budget controller CRUD and router
    - CRUD with validation (category 1–100, limit > 0 ≤ max, month 1–12, year 1970–2100); duplicate (category, month, year) → `409`; ownership via the shared helper, `404` for not-owned/missing
    - _Requirements: 11.1, 11.2, 11.3, 11.4, 11.5, 11.6, 11.7, 11.8_

  - [x] 12.2 Implement budget listing and spending computation
    - `list` defaults to the current month/year by server clock, else supplied month/year; compute `spent` from the user's matching expense transactions within the inclusive month range; return `{ limit, spent, remaining, overBudget }`; never store spending
    - _Requirements: 12.1, 12.2, 12.3, 12.4, 12.5, 12.6_

  - [ ]* 12.3 Write property test for duplicate budget periods
    - **Property 18: Duplicate budget period is rejected**
    - **Validates: Requirements 11.5**

  - [ ]* 12.4 Write property test for budget spending computation
    - **Property 19: Budget spending computation and flags**
    - **Validates: Requirements 12.2, 12.3, 12.4, 12.5**

  - [ ]* 12.5 Write unit test for the budget list default period
    - Assert the list defaults to the current month/year by server clock, and that spending is never persisted
    - _Requirements: 12.1, 12.6_

- [~] 13. Checkpoint - core financial domains
  - Ensure all tests pass, ask the user if questions arise.

- [x] 14. Implement investment management
  - [x] 14.1 Implement the investment controller CRUD and router
    - CRUD with validation (type in allowed set, name 1–100, quantity > 0 ≤ max, buyPrice > 0 ≤ max), ownership via the shared helper, `404` for not-owned/missing
    - _Requirements: 13.1, 13.2, 13.3, 13.4, 13.5, 13.6, 13.7_

  - [x] 14.2 Implement the investment summary with live pricing and P&L
    - For stock/crypto fetch the live price from Yahoo Finance (≤ 10s, fallback to stored `currentPrice` on error/timeout/missing); for mutual_fund/fd/other use stored price; compute per-investment `gainLoss`, `gainLossPercent` (0 when buyPrice×quantity is 0), and totals (`totalInvested`, `totalCurrentValue`, `totalPnL`); a single symbol failure does not abort the rest
    - _Requirements: 14.1, 14.2, 14.3, 14.4, 14.5, 14.6_

  - [ ]* 14.3 Write property test for the price-source rule
    - **Property 20: Investment price source depends on type**
    - **Validates: Requirements 14.1, 14.2**

  - [ ]* 14.4 Write property test for profit/loss computation
    - **Property 21: Investment profit/loss computation**
    - **Validates: Requirements 14.3, 14.4, 14.5**

  - [ ]* 14.5 Write property test for live-price fallback
    - **Property 22: Live-price failures fall back to stored price without aborting**
    - **Validates: Requirements 14.6**

- [x] 15. Implement goal management
  - [x] 15.1 Implement the goal controller and router
    - `create` (name + target 0.01–max, `savedAmount` initialized to 0), `update` (add a positive amount 0.01–max to `savedAmount`, reject invalid with state unchanged), returned `progress = min(savedAmount / targetAmount, 1)`, `delete`, ownership via the shared helper
    - _Requirements: 15.1, 15.2, 15.3, 15.4, 15.5, 15.6, 15.7_

  - [ ]* 15.2 Write property test for goal savings and progress
    - **Property 23: Goal savings accumulate and progress is capped**
    - **Validates: Requirements 15.4, 15.5, 15.6**

- [x] 16. Implement bill management
  - [x] 16.1 Implement the bill controller CRUD and router
    - CRUD with validation (name 1–100, amount > 0 ≤ max ≤ 2 dp, frequency in {monthly, weekly, yearly, one-time}, valid `nextDueDate`), `autoPay` default false, ownership via the shared helper, `404` for not-owned/missing
    - _Requirements: 16.1, 16.2, 16.3, 16.4, 16.5, 16.6, 16.7, 16.8_

  - [x] 16.2 Implement bill payment and due-date advancement
    - `PATCH /:id/pay`: recurring bills advance `nextDueDate` (+1 month / +7 days / +1 year) and set `isPaid=false`; one-time unpaid → set `isPaid=true` with no date change; one-time already paid → `400`; not-owned/missing → `404`
    - _Requirements: 17.1, 17.2, 17.3, 17.4, 17.5_

  - [ ]* 16.3 Write property test for bill payment advancement
    - **Property 24: Bill payment advances or settles according to frequency**
    - **Validates: Requirements 17.1, 17.2, 17.3**

- [x] 17. Implement the AI financial advisor
  - [x] 17.1 Implement the AI chat controller and route
    - Validate the message (1–4000 chars, non-whitespace); assemble a user-scoped snapshot (assets, liabilities, 50 most recent transactions desc, goals, bills, computed net worth); send snapshot as system context + message to Claude (≤ 30s); return `{ reply }`; on failure/timeout route a generic error through the error handler without exposing the API key; never persist the conversation
    - _Requirements: 18.1, 18.2, 18.3, 18.4, 18.5, 18.6, 18.7_

  - [ ]* 17.2 Write property test for snapshot composition
    - **Property 25: AI snapshot composition is correct and isolated**
    - **Validates: Requirements 18.1, 18.2, 18.7**

  - [ ]* 17.3 Write property test for message validation gating
    - **Property 26: AI message validation gates the Claude call**
    - **Validates: Requirements 18.4, 18.5**

  - [ ]* 17.4 Write property test for API-key protection on failure
    - **Property 27: AI failures never expose the API key**
    - **Validates: Requirements 18.6**

  - [ ]* 17.5 Write unit test for the Claude call wiring
    - With Claude mocked, assert the snapshot is sent and the reply is returned
    - _Requirements: 18.3_

- [ ] 18. Cross-cutting isolation, CRUD, and integration tests
  - [ ]* 18.1 Write property test for resource CRUD round-trips
    - **Property 1: Resource CRUD round-trip**
    - **Validates: Requirements 6.1, 6.5, 6.6, 7.1, 7.5, 7.6, 9.1, 9.6, 9.7, 11.1, 11.6, 11.7, 13.1, 13.5, 13.6, 15.1, 15.7, 16.1, 16.5, 16.6**

  - [ ]* 18.2 Write property test for invalid-input rejection
    - **Property 2: Invalid input is rejected with 400 and never persisted**
    - **Validates: Requirements 1.4, 1.5, 1.8, 1.9, 6.2, 6.3, 6.4, 7.2, 7.3, 7.4, 9.2, 9.3, 9.4, 11.2, 11.3, 11.4, 13.2, 13.3, 13.4, 15.2, 15.3, 15.5, 16.2, 16.3, 16.4, 22.6, 22.7**

  - [ ]* 18.3 Write property test for cross-user read isolation
    - **Property 3: Cross-user read isolation**
    - **Validates: Requirements 5.1, 5.4**

  - [ ]* 18.4 Write property test for cross-user record access
    - **Property 4: Cross-user record access returns 404 and leaves the record unchanged**
    - **Validates: Requirements 5.3, 6.7, 7.7, 9.8, 11.8, 13.7, 16.7, 17.4**

  - [ ]* 18.5 Write property test for ownership enforcement
    - **Property 5: Ownership is forced on create and immutable on update**
    - **Validates: Requirements 5.2, 5.6**

  - [ ]* 18.6 Write property test for default field values
    - **Property 7: Default field values are assigned when omitted**
    - **Validates: Requirements 1.7, 6.8, 9.5, 16.8, 19.1**

  - [ ]* 18.7 Write integration test for the end-to-end auth flow
    - Register → use token → access a protected route → retrieve profile (representative cases)
    - _Requirements: 1.1, 2.1, 3.1, 4.2_

- [x] 19. Checkpoint - backend complete
  - Ensure all tests pass, ask the user if questions arise.

- [x] 20. Implement the React client
  - [x] 20.1 Scaffold the client and session handling
    - Create the React (Vite + Tailwind) app with `AuthContext` (user/token/login/logout), an Axios instance whose request interceptor attaches the Bearer token and whose response interceptor handles `401` (clear token, redirect to login within 2s, "session expired"), and a protected-route wrapper that redirects to login within 2s when no token exists; store only the JWT under a single local-storage key
    - _Requirements: 21.1, 21.2, 21.3, 21.4, 21.5, 21.6_

  - [x] 20.2 Implement feature views wired to the API
    - Build the auth, dashboard/net worth, assets, liabilities, transactions, budgets, investments, goals, bills, AI chat, and currency-selection views, each calling the corresponding API endpoints and rendering computed values; persist the selected display currency and apply it thereafter
    - _Requirements: 19.4_

  - [ ]* 20.3 Write property test for token storage
    - **Property 34: Client stores only the JWT under a single key**
    - **Validates: Requirements 21.1, 21.5**

  - [ ]* 20.4 Write property test for token attachment
    - **Property 35: Client attaches the token to protected requests**
    - **Validates: Requirements 21.2**

  - [ ]* 20.5 Write property test for session clearing on 401
    - **Property 36: Client clears session on 401**
    - **Validates: Requirements 21.3**

  - [ ]* 20.6 Write unit tests for logout, no-token access, and currency persistence
    - Logout clears the token and redirects; no-token access redirects without issuing the request; display-currency selection persists and applies thereafter
    - _Requirements: 21.4, 21.6, 19.4_

- [x] 21. Final checkpoint
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional test tasks and can be skipped for a faster MVP.
- Each task references specific requirements (granular sub-clauses) for traceability.
- Property test tasks map directly to the design's Correctness Properties (1–36); each property is its own sub-task placed close to the implementation it validates.
- Net worth and budget spending are always computed per request and never persisted, per the design.
- External integrations (Yahoo Finance, ExchangeRate, Claude) are mocked in tests; property tests run against in-memory MongoDB with a minimum of 100 generated cases.
- Checkpoints provide incremental validation points across the backend and client.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["2.1", "3.2", "4.1", "4.3"] },
    { "id": 2, "tasks": ["3.1", "7.1", "5.1", "2.2", "2.3", "4.2"] },
    { "id": 3, "tasks": ["5.2", "3.3", "3.4", "3.5", "3.6", "3.7"] },
    { "id": 4, "tasks": ["5.3", "8.1", "9.1", "10.1", "11.1", "12.1", "14.1", "15.1", "16.1"] },
    { "id": 5, "tasks": ["5.4", "5.5", "5.6", "5.7", "5.8", "5.9", "10.2", "10.3", "11.2", "12.2", "14.2", "16.2"] },
    { "id": 6, "tasks": ["10.4", "10.5", "10.6", "11.3", "11.4", "11.5", "12.3", "12.4", "12.5", "14.3", "14.4", "14.5", "15.2", "16.3", "17.1"] },
    { "id": 7, "tasks": ["17.2", "17.3", "17.4", "17.5", "18.1", "18.2", "18.3", "18.4", "18.5", "18.6", "18.7"] },
    { "id": 8, "tasks": ["20.1"] },
    { "id": 9, "tasks": ["20.2"] },
    { "id": 10, "tasks": ["20.3", "20.4", "20.5", "20.6"] }
  ]
}
```
