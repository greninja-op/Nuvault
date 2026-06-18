<div align="center">

# 🏦 Nuvault

### Your money, understood — not just tracked.

**A full-stack personal finance platform that unifies your entire financial life into one place, then layers an AI advisor on top that actually reads your real numbers before it answers.**

[![Stack](https://img.shields.io/badge/stack-MERN-3c873a)](#-tech-stack)
[![Frontend](https://img.shields.io/badge/frontend-React%2018%20%2B%20Vite-61dafb)](#-tech-stack)
[![Backend](https://img.shields.io/badge/backend-Node%20%2B%20Express-339933)](#-tech-stack)
[![Database](https://img.shields.io/badge/database-MongoDB%20%2B%20Mongoose-47a248)](#-tech-stack)
[![AI](https://img.shields.io/badge/AI-Gemini%20(multi--model)-8e75ff)](#-the-ai-advisor-the-part-nobody-else-has)
[![Tests](https://img.shields.io/badge/tests-489%20server%20%2F%2024%20client-brightgreen)](#-testing--quality)

</div>

---

## 📖 Table of Contents

1. [What is Nuvault?](#-what-is-nuvault)
2. [Nuvault vs. a "normal" finance app](#-nuvault-vs-a-normal-finance-app)
3. [Feature tour](#-feature-tour)
4. [The AI Advisor — the part nobody else has](#-the-ai-advisor-the-part-nobody-else-has)
5. [The 12 financial calculators](#-the-12-financial-calculators)
6. [Multi-currency engine](#-multi-currency-engine)
7. [Tech stack](#-tech-stack)
8. [Architecture](#-architecture)
9. [Security](#-security)
10. [API surface](#-api-surface)
11. [Getting started](#-getting-started)
12. [Testing & quality](#-testing--quality)
13. [Project structure](#-project-structure)
14. [Design system](#-design-system)

---

## 🧭 What is Nuvault?

Most people's financial life is scattered across a dozen places — a banking app for the balance, a spreadsheet for the budget, a broker app for stocks, sticky notes for bills, and a vague feeling of dread for "am I actually okay?"

**Nuvault pulls all of it into a single, coherent picture** and then does something the scattered apps can't: it lets you *ask questions about your own money in plain English* and get answers grounded in your actual data — your real net worth, your real spending, your real goals.

It tracks **assets, liabilities, transactions, budgets, investments, a unified portfolio, savings goals, and recurring bills**, computes your **net worth over time**, converts everything into **7 display currencies**, ships **12 interactive financial calculators**, and wraps it all in a clean, fast, light-mode-first interface — served from a **single Node process on a single port**.

> Think of it as: *Mint's tracking + a financial calculator suite + a personal CFO that knows your numbers* — in one self-hostable app.

---

## ⚔️ Nuvault vs. a "normal" finance app

| Capability | Typical budgeting app | Typical broker / banking app | **Nuvault** |
|---|:---:|:---:|:---:|
| Track spending & budgets | ✅ | ❌ | ✅ |
| Track investments & P&L | ❌ | ✅ | ✅ |
| **Unified net worth** (assets − liabilities) | Partial | ❌ | ✅ **computed live, charted over 30 days** |
| Recurring bills with due-date urgency | Partial | ❌ | ✅ overdue / due-soon grouping |
| Savings goals with pace tracking | Partial | ❌ | ✅ **pace-aware progress rings** (ahead / behind / at-risk) |
| Built-in financial calculators | ❌ | ❌ | ✅ **12 of them**, live + charted |
| **AI advisor grounded in *your* data** | ❌ (or generic chatbot) | ❌ | ✅ **reads a real, scoped snapshot of your finances** |
| AI that renders charts in its answers | ❌ | ❌ | ✅ allocation/plan charts inline in chat |
| Multi-currency display | Rarely | Rarely | ✅ **7 currencies, one-lookup conversion** |
| Per-user data isolation enforced centrally | Varies | Varies | ✅ single ownership helper, impossible to leak |
| Self-hostable, single process | ❌ | ❌ | ✅ one `node` process serves API + SPA |
| Test coverage you can see | ❌ (closed) | ❌ (closed) | ✅ **489 backend + 24 frontend tests** |

### Why this matters

A normal app **shows you data**. Nuvault **interprets it**. The difference is the AI advisor: instead of a generic "how do I budget?" chatbot, you ask *"Am I on track for my Emergency Fund goal?"* or *"How should I pay down my ₹35,42,000 debt?"* and the answer uses **your** actual saved amount, **your** actual target date, **your** actual interest-bearing liabilities — because the server assembles a real, strictly user-scoped snapshot and feeds it to the model on every message.

---

## 🗺️ Feature tour

### 📊 Dashboard
The command center. A greeting hero, a **net-worth hero card**, three at-a-glance StatCards, a **net-worth composition breakdown**, a **30-day net-worth trend chart**, an **Assets-vs-Liabilities bar chart**, a spending donut, recent transactions, budget health, and upcoming bills — plus mobile quick-actions.

### 💸 Transactions
Searchable, filterable income/expense ledger with category icons, a summary strip, hover-reveal row actions on desktop, category-colored cards on mobile, and a styled delete-confirmation flow.

### 🎯 Budgets
Per-category budgets with **70% / 90% progress thresholds** (green → amber → red), "% used" and "left / over" readouts, an over-budget visual treatment, and a spending donut.

### 🏛️ Assets & 💳 Liabilities
Typed asset/liability registers (cash, bank, stock, crypto, real estate, loans, credit cards, mortgages…) feeding directly into your live **net worth**.

### 📈 Investments & 💼 Portfolio
Per-holding **invested / current value / gain-loss / %** with live-priced summaries, allocation donuts, and type filters. The **Portfolio** view unifies 8 asset kinds (FDs, bank accounts, mutual funds, stocks, crypto, PPF/EPF, real estate, gold) under one resource with per-kind metric columns.

### 🐖 Goals
Savings goals with **88px pace-aware progress rings** — the ring color reflects whether you're *ahead*, *somewhat behind*, or *at risk* based on elapsed time vs. saved fraction. Full create / **edit** / contribute / delete, plus an overall-progress bar.

### 🧾 Bills
Recurring & one-time bills grouped into **Overdue / Upcoming / Paid**, with urgency-colored accents, recurring-frequency indicators, one-click "Pay", and a clean empty state.

### 🧮 Calculators
Twelve client-side financial calculators (see below) with accent-colored sliders, live recalculation, and projection charts.

### 🤖 AI Advisor
A chat that answers questions about *your* finances (see the deep-dive below).

### ⚙️ Settings
Theme (light/dark), display-currency selector, and account/logout — all in one place.

---

## 🤖 The AI Advisor — the part nobody else has

This is the headline feature, and it's genuinely different from a bolted-on chatbot.

### It reads your real numbers
On every message, the backend builds a **rich, strictly user-scoped financial snapshot** — this-month income/expenses/savings & savings rate, net worth, budgets with spend, goals with progress, bills with days-until-due, investments with P&L, top spending categories, and recent transactions — then folds it into the system prompt.

### It only sends what's relevant
A keyword-driven **question-scoping** layer decides which sections of the snapshot to include, so a question about bills doesn't ship your entire investment history to the model. Tighter context = faster, cheaper, more focused answers. The client mirrors this logic to show a **"Based on: …" data-source tag** under each answer.

### It's resilient by design
The advisor rotates across a **prioritized list of Gemini models** (`gemini-3-flash-preview` → `2.5-flash` → `2.0-flash` → `2.5-flash-lite`) with **per-model overload retries**, **429 quota fallthrough**, and **multi-key rotation with per-key blackout windows** — so a single model's free-tier quota running dry doesn't take the feature down.

### It draws charts in chat
For allocation/investment-plan questions, the AI returns structured chart data that renders **inline inside the chat bubble** (donuts/bars), not just text.

### Quality-of-life touches
- **Data-aware starter prompts** — computed from a lightweight `/api/summary` aggregate, e.g. *"How is my ₹5,76,850 portfolio performing?"* or *"I have 2 bills due this week — which to pay first?"* (with graceful static fallbacks).
- **Copy button** on every AI reply (copies the raw text; charts excluded cleanly).
- **Model badge** in the header, **conversation persistence** across reloads, and a one-click **clear chat**.

### Safety
The API key **never** appears in any response, log, or error message. Conversations are stored per-user and fully isolated. The system prompt enforces concise, plain-text answers grounded only in real figures, with a "not registered financial advice" disclaimer where relevant.

---

## 🧮 The 12 financial calculators

All client-side, instant, and chart-backed:

| # | Calculator | What it answers |
|---|---|---|
| 1 | **SIP** | Future value of a monthly investment plan |
| 2 | **Lumpsum** | Growth of a one-time investment |
| 3 | **SWP** | How long a corpus lasts with monthly withdrawals |
| 4 | **FD** | Fixed-deposit maturity with compounding options |
| 5 | **RD** | Recurring-deposit maturity |
| 6 | **PPF** | 15-year PPF corpus projection |
| 7 | **EMI** | Loan EMI, total interest & outstanding-balance curve |
| 8 | **Loan Prepayment** | Interest saved & tenure reduced from a lump-sum prepayment |
| 9 | **Goal SIP** | Monthly SIP required to hit a target |
| 10 | **Inflation** | Future cost & eroded purchasing power |
| 11 | **Income Tax** | Old vs. new regime comparison (FY 2023-24 estimate) |
| 12 | **CAGR** | Compound annual growth rate of an investment |

Each uses a balanced two-column layout (inputs + results/charts) that collapses cleanly to a single column on mobile.

---

## 💱 Multi-currency engine

Amounts are stored in a base currency (**INR**) and displayed in any of **7 supported currencies** — INR, USD, EUR, GBP, JPY, AUD, CAD. The display currency is persisted per device, synced across tabs, and conversion uses **one FX-rate lookup per currency switch** (not one per value), with a graceful "amounts shown in base currency" fallback if the rate is unavailable.

---

## 🛠️ Tech stack

**Frontend**
- **React 18** + **Vite 5** (fast dev + optimized builds)
- **Tailwind CSS 3** + a custom **CSS-variable design-token system** (light/dark)
- **React Router 6**, **Framer Motion** (animation), **Recharts** (charts)
- **lucide-react** (icons), **Axios** (HTTP), **DOMPurify** (input sanitization)
- **Vitest** + **Testing Library** for tests

**Backend**
- **Node.js (≥18)** + **Express 4**
- **MongoDB** + **Mongoose 8**
- **JWT** auth (`jsonwebtoken`) + **bcryptjs** password hashing
- **Helmet**, **express-rate-limit**, **express-mongo-sanitize**, **hpp**, **CORS** for hardening
- **express-validator** for request validation
- **Google Gemini** API (multi-model rotation) for the AI advisor
- **Jest** + **Supertest** + **fast-check** (property-based) + **mongodb-memory-server** for tests

---

## 🏗️ Architecture

Nuvault runs as a **single Node process on a single port** in production: the Express API serves both the `/api/*` routes **and** the built React SPA (`client/dist`), with an SPA fallback so hard-refreshing any client route (e.g. `/portfolio`, `/calculators`) works instead of 404-ing.

```
┌──────────────────────────────────────────────────────────────┐
│                        Browser (SPA)                           │
│   React 18 · Vite · Tailwind · Recharts · Framer Motion        │
└───────────────┬────────────────────────────────────────────────┘
                │  HTTPS · JWT Bearer token · Axios
                ▼
┌──────────────────────────────────────────────────────────────┐
│                    Express App (single port)                   │
│                                                                │
│  Middleware pipeline (strict order):                           │
│   1. CORS (allow-listed origins)                               │
│   2. Helmet (CSP, HSTS, X-Frame-Options, noSniff)              │
│   3. Rate limiting (100/15min general · 10/15min auth)         │
│   4. JSON parser → mongo-sanitize → hpp                        │
│   5. Routers:  publicRouter  +  protectedRouter(protect JWT)   │
│   5b. Static SPA + non-/api fallback → index.html              │
│   6. Uniform error handler                                     │
│                                                                │
│  Domain routers: auth · assets · liabilities · transactions    │
│   · investments · portfolio · budgets · networth · goals       │
│   · bills · ai · fx · snapshots · summary                      │
└───────────────┬───────────────────────────────┬────────────────┘
                │                                 │
                ▼                                 ▼
        ┌───────────────┐                 ┌────────────────┐
        │  MongoDB       │                 │  Google Gemini  │
        │  (Mongoose)    │                 │  (multi-model)  │
        └───────────────┘                 └────────────────┘
```

**Per-user isolation** is funneled through a single shared **ownership helper** (`scopedFind / scopedFindById / scopedCreate / scopedUpdate / scopedDelete`). Every read/write carries `user: req.user._id`, the `user` field is stripped from all payloads, and cross-user / missing / malformed-id requests collapse to a uniform **404** — so a forgotten filter can't leak another user's data from any controller.

---

## 🔐 Security

Security is baked into the middleware pipeline and the data layer, not sprinkled on:

- **JWT authentication** on every protected route via a single `protect` middleware — controllers never run without a resolved `req.user`.
- **Token blacklisting** on logout (a valid, unexpired token is rejected once invalidated).
- **bcrypt** password hashing (10 salt rounds) via a Mongoose pre-save hook.
- **Helmet** security headers: a tuned **Content-Security-Policy**, **HSTS**, `X-Frame-Options`, `X-Content-Type-Options`, and a disabled `X-Powered-By`.
- **Rate limiting**: 100 requests / 15 min general, **10 / 15 min** on login & register to blunt brute-force/credential-stuffing.
- **NoSQL-injection hardening** (`express-mongo-sanitize`) and **HTTP parameter-pollution** guard (`hpp`).
- **CORS** allow-list (supports multiple origins for prod + dev).
- **Input validation** (`express-validator`) and **client-side sanitization** (DOMPurify) on user-supplied text.
- **HTTPS enforcement** in production (301 redirect on plain HTTP, loopback exempt for local builds).
- **Secrets never leak**: the Gemini API key is excluded from every response, log, and error message.

---

## 🌐 API surface

All routes are mounted under `/api`. Everything except register/login requires a JWT.

| Resource | Endpoints |
|---|---|
| **Auth** | `POST /auth/register` · `POST /auth/login` · `POST /auth/logout` · `GET /auth/me` |
| **Assets** | `GET/POST /assets` · `GET/PUT/DELETE /assets/:id` |
| **Liabilities** | `GET/POST /liabilities` · `GET/PUT/DELETE /liabilities/:id` |
| **Transactions** | `GET/POST /transactions` · `GET /transactions/summary` · `GET/PUT/DELETE /transactions/:id` |
| **Budgets** | `GET/POST /budgets` · `GET/PUT/DELETE /budgets/:id` |
| **Investments** | `GET/POST /investments` · `GET /investments/summary` · `GET/PUT/DELETE /investments/:id` |
| **Portfolio** | `GET/POST /portfolio` · `GET /portfolio/summary` · `PUT/DELETE /portfolio/:id` |
| **Net worth** | `GET /networth` (computed live) · `GET /snapshots` (30-day history) |
| **Goals** | `GET/POST /goals` · `GET /goals/:id` · `PUT /goals/:id` (additive contribute) · `PATCH /goals/:id` (edit fields) · `DELETE /goals/:id` |
| **Bills** | `GET/POST /bills` · `GET/PUT/DELETE /bills/:id` · `PATCH /bills/:id/pay` |
| **FX** | `GET /fx/rate?to=USD` |
| **Summary** | `GET /summary` (lightweight aggregate for AI starter prompts) |
| **AI** | `POST /ai/chat` · `GET /ai/history` · `DELETE /ai/history` |

---

## 🚀 Getting started

### Prerequisites
- **Node.js ≥ 18**
- **MongoDB** (local or Atlas connection string)
- A **Google Gemini API key** (optional — the rest of the app works without it; only the AI advisor needs it)

### 1. Clone & install
```bash
git clone https://github.com/greninja-op/Nuvault.git
cd Nuvault

# install backend deps
cd server && npm install

# install frontend deps
cd ../client && npm install
```

### 2. Configure environment
Create `server/.env` (see `server/.env.example`):
```env
MONGO_URI=mongodb://localhost:27017/nuvault
JWT_SECRET=your-long-random-secret
CLIENT_ORIGIN=http://localhost:5173,http://localhost:5001
GEMINI_API_KEY=your-gemini-key            # optional; supports comma-separated keys for rotation
NODE_ENV=development
PORT=5001
```

### 3. Seed demo data (optional)
```bash
cd server
npm run seed
# creates a demo user → test@nuvault.com / test123456
```

### 4. Run

**Development (two processes, hot reload):**
```bash
# terminal 1 — API
cd server && npm run dev

# terminal 2 — client
cd client && npm run dev      # Vite dev server on http://localhost:5173
```

**Production / single-port (one process serves API + SPA):**
```bash
cd client && npm run build    # outputs client/dist
cd ../server && npm start      # serves API + SPA on http://localhost:5001
```

---

## ✅ Testing & quality

Nuvault is heavily tested on both sides of the stack.

```bash
# Backend — 489 tests (unit + integration + property-based)
cd server && npm test

# Frontend — 24 tests (component + context + page)
cd client && npm test
```

- **Backend (Jest + Supertest + fast-check):** 489 passing tests covering auth, ownership isolation, every domain controller, the AI fallback/quota logic, currency math, and encryption — including **property-based** tests that fuzz failure modes (e.g. "the API key never appears in any failure response").
- **Frontend (Vitest + Testing Library):** 24 passing tests covering auth/currency contexts, protected routes, and every feature page.
- **In-memory MongoDB** (`mongodb-memory-server`) means backend tests run with zero external setup.

---

## 📁 Project structure

```
fino/
├── client/                      # React + Vite SPA
│   └── src/
│       ├── api/                 # Axios client (baseURL = /api)
│       ├── auth/                # AuthContext + ProtectedRoute
│       ├── currency/            # CurrencyContext (display currency + FX)
│       ├── components/
│       │   ├── ui/              # Design-system primitives (Button, Card, Input,
│       │   │                    #   Badge, Toggle, Modal, StatCard)
│       │   ├── charts/          # AreaChartCard, DonutChart
│       │   ├── calculators/     # 12 calculators + shared layout/slider
│       │   └── skeletons/       # Per-page loading skeletons
│       ├── hooks/               # useTheme, useWindowSize, useSnapshots
│       ├── pages/               # Dashboard, Transactions, Budgets, Assets,
│       │                        #   Liabilities, Investments, Portfolio, Goals,
│       │                        #   Bills, Calculators, AiChat, Settings, …
│       └── styles/tokens.css    # Light/dark design tokens
│
└── server/                      # Express + Mongoose API
    ├── app.js                   # App factory + middleware pipeline
    ├── server.js                # Boot + DB connect
    ├── seed.js                  # Demo-data seeder
    ├── models/                  # Mongoose schemas (User, Asset, Liability,
    │                            #   Transaction, Budget, Investment, Goal,
    │                            #   Bill, PortfolioItem, ChatHistory, …)
    ├── controllers/             # One controller per domain (+ co-located tests)
    ├── routes/                  # Sub-routers + the public/protected aggregator
    ├── middleware/              # auth (protect), errorHandler
    └── utils/                   # ownership, currency, encryption, generateToken, …
```

---

## 🎨 Design system

A consistent, token-driven UI keeps every page coherent:

- **Light-mode-first** with a full dark theme — all colors are CSS variables in `tokens.css`, flipped by a `.dark` class on `<html>`.
- **Accent:** indigo-violet `#7c6ee8` · **money-positive:** green `#16a34a` · **negative:** red `#dc2626` · **warning:** amber `#d97706`.
- **Poppins** typography throughout.
- Reusable primitives: `Button` (primary/secondary/ghost/danger/icon), `Card`, `Input`, `Badge`, `Toggle`, `Modal` (portal + Escape + scroll-lock), `StatCard`.
- Consistent patterns app-wide: styled delete-confirmation modals (no native `window.confirm`), hover-reveal table actions, mobile card layouts, and per-page skeleton loaders.

---

<div align="center">

### Built with care — tracked, calculated, and understood.

*Nuvault doesn't just store your numbers. It helps you make sense of them.*

</div>
