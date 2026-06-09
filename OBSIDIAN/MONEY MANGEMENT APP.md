
Here's the complete **Nuvault** build plan — everything you need, backend-first.

---

# NUVAULT — Full Scale Web App Build Plan

## Stack Confirmed

- **Frontend:** React + Vite + Tailwind CSS
- **Backend:** Node.js + Express
- **Database:** MongoDB (via MongoDB Compass)
- **AI Layer:** Claude API
- **Auth:** JWT (JSON Web Tokens)
- **Market Data:** Yahoo Finance API
- **Currency:** ExchangeRate API

---

## PHASE 1 — Project Setup (Day 1)

### Folder Structure

```
nuvault/
├── client/                  # React frontend
│   ├── src/
│   │   ├── components/
│   │   ├── pages/
│   │   ├── hooks/
│   │   ├── api/             # Axios calls to backend
│   │   └── main.jsx
│   └── vite.config.js
├── server/                  # Express backend
│   ├── config/
│   │   └── db.js            # MongoDB connection
│   ├── models/              # Mongoose schemas
│   ├── routes/              # API route files
│   ├── controllers/         # Business logic
│   ├── middleware/          # Auth, error handler
│   ├── utils/               # Helpers
│   └── server.js
├── .env
└── package.json
```

### Init Commands

```bash
mkdir nuvault && cd nuvault

# Backend
mkdir server && cd server
npm init -y
npm install express mongoose dotenv bcryptjs jsonwebtoken cors axios express-validator

# Frontend
cd ..
npm create vite@latest client -- --template react
cd client
npm install axios react-router-dom tailwindcss
```

---

## PHASE 2 — Database & Models (Day 2–3)

This is the most critical part. Get every schema right before touching routes.

### MongoDB Compass Setup

- Open Compass → New Connection → `mongodb://localhost:27017`
- Create database: `nuvaultDB`
- Collections will auto-create when Mongoose saves first document

### `config/db.js`

```js
const mongoose = require('mongoose');

const connectDB = async () => {
  try {
    const conn = await mongoose.connect(process.env.MONGO_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
    console.log(`MongoDB Connected: ${conn.connection.host}`);
  } catch (error) {
    console.error(`DB Error: ${error.message}`);
    process.exit(1);
  }
};

module.exports = connectDB;
```

### `.env`

```
MONGO_URI=mongodb://localhost:27017/nuvaultDB
JWT_SECRET=your_super_secret_key
JWT_EXPIRE=30d
PORT=5000
CLAUDE_API_KEY=your_claude_key
EXCHANGERATE_API_KEY=your_key
```

---

### All Mongoose Models

**User model** — `models/User.js`

```js
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const UserSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  email: { type: String, required: true, unique: true, lowercase: true },
  password: { type: String, required: true, minlength: 6 },
  currency: { type: String, default: 'INR' },
  createdAt: { type: Date, default: Date.now }
});

UserSchema.pre('save', async function (next) {
  if (!this.isModified('password')) return next();
  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
  next();
});

UserSchema.methods.matchPassword = async function (entered) {
  return await bcrypt.compare(entered, this.password);
};

module.exports = mongoose.model('User', UserSchema);
```

**Asset model** — `models/Asset.js`

```js
const mongoose = require('mongoose');

const AssetSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  name: { type: String, required: true },
  type: { type: String, enum: ['cash', 'bank', 'stock', 'crypto', 'mutual_fund', 'fd', 'real_estate', 'other'], required: true },
  value: { type: Number, required: true },
  currency: { type: String, default: 'INR' },
  notes: String,
  updatedAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Asset', AssetSchema);
```

**Liability model** — `models/Liability.js`

```js
const mongoose = require('mongoose');

const LiabilitySchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  name: { type: String, required: true },
  type: { type: String, enum: ['loan', 'credit_card', 'mortgage', 'other'], required: true },
  amount: { type: Number, required: true },
  interestRate: { type: Number },
  dueDate: { type: Date },
  notes: String,
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Liability', LiabilitySchema);
```

**Transaction model** — `models/Transaction.js`

```js
const mongoose = require('mongoose');

const TransactionSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  type: { type: String, enum: ['income', 'expense'], required: true },
  category: { type: String, required: true },
  amount: { type: Number, required: true },
  description: String,
  date: { type: Date, default: Date.now },
  tags: [String]
});

module.exports = mongoose.model('Transaction', TransactionSchema);
```

**Budget model** — `models/Budget.js`

```js
const mongoose = require('mongoose');

const BudgetSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  category: { type: String, required: true },
  limit: { type: Number, required: true },
  month: { type: Number, required: true },   // 1–12
  year: { type: Number, required: true },
  spent: { type: Number, default: 0 }
});

module.exports = mongoose.model('Budget', BudgetSchema);
```

**Goal model** — `models/Goal.js`

```js
const mongoose = require('mongoose');

const GoalSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  name: { type: String, required: true },
  targetAmount: { type: Number, required: true },
  savedAmount: { type: Number, default: 0 },
  targetDate: { type: Date },
  category: { type: String },
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Goal', GoalSchema);
```

**Bill model** — `models/Bill.js`

```js
const mongoose = require('mongoose');

const BillSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  name: { type: String, required: true },
  amount: { type: Number, required: true },
  frequency: { type: String, enum: ['monthly', 'weekly', 'yearly', 'one-time'], required: true },
  nextDueDate: { type: Date, required: true },
  category: { type: String },
  isPaid: { type: Boolean, default: false },
  autoPay: { type: Boolean, default: false }
});

module.exports = mongoose.model('Bill', BillSchema);
```

**Investment model** — `models/Investment.js`

```js
const mongoose = require('mongoose');

const InvestmentSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  type: { type: String, enum: ['stock', 'crypto', 'mutual_fund', 'fd', 'other'], required: true },
  symbol: String,
  name: { type: String, required: true },
  quantity: { type: Number, required: true },
  buyPrice: { type: Number, required: true },
  currentPrice: { type: Number },
  buyDate: { type: Date },
  notes: String
});

module.exports = mongoose.model('Investment', InvestmentSchema);
```

---

## PHASE 3 — Backend Routes & Controllers (Day 4–6)

### Middleware

**`middleware/auth.js`** — Protect all private routes

```js
const jwt = require('jsonwebtoken');
const User = require('../models/User');

const protect = async (req, res, next) => {
  let token;
  if (req.headers.authorization?.startsWith('Bearer')) {
    token = req.headers.authorization.split(' ')[1];
  }
  if (!token) return res.status(401).json({ message: 'Not authorized' });
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = await User.findById(decoded.id).select('-password');
    next();
  } catch (err) {
    return res.status(401).json({ message: 'Token invalid' });
  }
};

module.exports = { protect };
```

**`middleware/errorHandler.js`**

```js
const errorHandler = (err, req, res, next) => {
  const statusCode = res.statusCode === 200 ? 500 : res.statusCode;
  res.status(statusCode).json({
    message: err.message,
    stack: process.env.NODE_ENV === 'production' ? null : err.stack,
  });
};

module.exports = errorHandler;
```

---

### Auth Routes — `routes/authRoutes.js`

**Register & Login** (controllers handle the logic, routes just map URLs):

```
POST   /api/auth/register   → create user, return JWT
POST   /api/auth/login      → verify credentials, return JWT
GET    /api/auth/me         → return logged-in user (protected)
```

**`controllers/authController.js`**

```js
const User = require('../models/User');
const jwt = require('jsonwebtoken');

const generateToken = (id) =>
  jwt.sign({ id }, process.env.JWT_SECRET, { expiresIn: process.env.JWT_EXPIRE });

exports.register = async (req, res, next) => {
  try {
    const { name, email, password } = req.body;
    const exists = await User.findOne({ email });
    if (exists) return res.status(400).json({ message: 'Email already registered' });
    const user = await User.create({ name, email, password });
    res.status(201).json({ token: generateToken(user._id), user: { id: user._id, name: user.name, email: user.email } });
  } catch (err) { next(err); }
};

exports.login = async (req, res, next) => {
  try {
    const { email, password } = req.body;
    const user = await User.findOne({ email });
    if (!user || !(await user.matchPassword(password)))
      return res.status(401).json({ message: 'Invalid credentials' });
    res.json({ token: generateToken(user._id), user: { id: user._id, name: user.name, email: user.email } });
  } catch (err) { next(err); }
};

exports.getMe = async (req, res) => {
  res.json(req.user);
};
```

---

### All Other Routes (same pattern for each module)

For every module below, the pattern is identical: controller file with async/await + try/catch, protect middleware on all routes, user field always scoped to `req.user._id`.

**Transactions** — `routes/transactionRoutes.js`

```
GET    /api/transactions          → get all for user (with optional ?month=&year= filter)
POST   /api/transactions          → create new
PUT    /api/transactions/:id      → update
DELETE /api/transactions/:id      → delete
GET    /api/transactions/summary  → income vs expense totals per category
```

**Budget** — `routes/budgetRoutes.js`

```
GET    /api/budgets               → get budgets (current month by default)
POST   /api/budgets               → create budget for a category
PUT    /api/budgets/:id           → update limit
DELETE /api/budgets/:id           → delete
POST   /api/budgets/check         → compare spending vs budget (called after each transaction)
```

**Assets & Liabilities** — `routes/netWorthRoutes.js`

```
GET    /api/networth              → returns { assets[], liabilities[], netWorth }
POST   /api/assets                → add asset
PUT    /api/assets/:id            → update
DELETE /api/assets/:id            → delete
POST   /api/liabilities           → add liability
PUT    /api/liabilities/:id       → update
DELETE /api/liabilities/:id       → delete
```

**Investments** — `routes/investmentRoutes.js`

```
GET    /api/investments           → all investments
POST   /api/investments           → add investment
PUT    /api/investments/:id       → update (price, quantity)
DELETE /api/investments/:id       → delete
GET    /api/investments/summary   → total invested, current value, P&L
```

**Goals** — `routes/goalRoutes.js`

```
GET    /api/goals                 → all goals
POST   /api/goals                 → create goal
PUT    /api/goals/:id             → update progress (add money)
DELETE /api/goals/:id             → delete
```

**Bills** — `routes/billRoutes.js`

```
GET    /api/bills                 → all bills
POST   /api/bills                 → add bill
PUT    /api/bills/:id             → update
DELETE /api/bills/:id             → delete
PATCH  /api/bills/:id/pay         → mark as paid, update nextDueDate
```

**AI Advisor** — `routes/aiRoutes.js`

```
POST   /api/ai/chat               → send message + user's financial snapshot, get Claude response
```

---

### `server.js` — Wire Everything Together

```js
const express = require('express');
const dotenv = require('dotenv');
const cors = require('cors');
const connectDB = require('./config/db');
const errorHandler = require('./middleware/errorHandler');

dotenv.config();
connectDB();

const app = express();
app.use(cors());
app.use(express.json());

// Routes
app.use('/api/auth', require('./routes/authRoutes'));
app.use('/api/transactions', require('./routes/transactionRoutes'));
app.use('/api/budgets', require('./routes/budgetRoutes'));
app.use('/api/networth', require('./routes/netWorthRoutes'));
app.use('/api/investments', require('./routes/investmentRoutes'));
app.use('/api/goals', require('./routes/goalRoutes'));
app.use('/api/bills', require('./routes/billRoutes'));
app.use('/api/ai', require('./routes/aiRoutes'));

app.use(errorHandler);

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
```

---

## PHASE 4 — API Testing (Day 7)

Before touching the frontend at all, test every single endpoint using **Postman** or **Thunder Client** (VS Code extension).

Test order:

1. Register user → get token
2. Add that token as Bearer in all subsequent requests
3. Test each route: create → read → update → delete
4. Open MongoDB Compass and visually confirm documents are being created correctly in each collection
5. Test edge cases: wrong password, missing fields, invalid IDs

Only move to frontend after every route returns correct data.

---

## PHASE 5 — Frontend (Day 8–12)

Basic but functional UI. Each page talks to the backend via Axios.

### Pages

```
/login            → Login form
/register         → Register form
/dashboard        → Net worth summary + quick stats
/transactions     → List + add/edit/delete
/budget           → Budget cards per category
/investments      → Portfolio table + P&L
/goals            → Goal cards with progress bars
/bills            → Upcoming bills list
/ai               → Chat interface with AI advisor
```

### Axios Setup — `client/src/api/axios.js`

```js
import axios from 'axios';

const instance = axios.create({ baseURL: 'http://localhost:5000/api' });

instance.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

export default instance;
```

Every page imports this instance and calls its corresponding backend route.

---

## PHASE 6 — AI Advisor Integration (Day 13)

The AI route on the backend assembles the user's full financial snapshot and sends it to Claude:

```js
// controllers/aiController.js
exports.chat = async (req, res, next) => {
  try {
    const { message } = req.body;
    const userId = req.user._id;

    // Pull user's financial data
    const [assets, liabilities, transactions, goals, bills] = await Promise.all([
      Asset.find({ user: userId }),
      Liability.find({ user: userId }),
      Transaction.find({ user: userId }).sort({ date: -1 }).limit(50),
      Goal.find({ user: userId }),
      Bill.find({ user: userId }),
    ]);

    const netWorth = assets.reduce((s, a) => s + a.value, 0)
                   - liabilities.reduce((s, l) => s + l.amount, 0);

    const systemPrompt = `You are a personal finance advisor for this user.
    Their financial snapshot:
    - Net Worth: ₹${netWorth}
    - Assets: ${JSON.stringify(assets)}
    - Liabilities: ${JSON.stringify(liabilities)}
    - Recent Transactions: ${JSON.stringify(transactions)}
    - Goals: ${JSON.stringify(goals)}
    - Bills: ${JSON.stringify(bills)}
    Give concise, actionable advice based on their real numbers.`;

    const response = await axios.post('https://api.anthropic.com/v1/messages', {
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1024,
      system: systemPrompt,
      messages: [{ role: 'user', content: message }],
    }, {
      headers: {
        'x-api-key': process.env.CLAUDE_API_KEY,
        'anthropic-version': '2023-06-01',
      }
    });

    res.json({ reply: response.data.content[0].text });
  } catch (err) { next(err); }
};
```

---

## PHASE 7 — Polish & Launch Prep (Day 14)

- Add input validation using `express-validator` on all POST/PUT routes
- Add rate limiting: `npm install express-rate-limit`
- Add helmet for security headers: `npm install helmet`
- Handle token expiry on frontend (redirect to login on 401)
- Test on mobile screen sizes
- Add loading states and error messages on all frontend pages

---

## Full Timeline Summary

|Day|Task|
|---|---|
|1|Project setup, folder structure, env config|
|2–3|All Mongoose models, test in Compass|
|4–6|All backend routes and controllers|
|7|Full Postman testing of every endpoint|
|8–12|Frontend pages, Axios integration|
|13|AI Advisor integration|
|14|Validation, security, polish|

---

## Key Rules to Follow

- **Never skip the Postman testing phase.** Frontend bugs are 10x harder to debug than backend bugs caught early.
- **Always scope queries to `req.user._id`** — never fetch all documents without a user filter.
- **Every controller must have try/catch** that calls `next(err)` so the error handler catches it.
- **Check MongoDB Compass after every new feature** to visually confirm the data shape is correct.
- **Never store sensitive data in localStorage except the JWT token.**

---

Here's the pure architecture and plan of action.

---

# NUVAULT — Architecture & Plan of Action

---

## System Architecture Overview

```
┌─────────────────────────────────────────────────────────┐
│                        CLIENT                           │
│                   React + Vite (port 3000)              │
│         Pages → Components → Axios API Layer            │
└─────────────────────────┬───────────────────────────────┘
                          │ HTTP / REST
                          ▼
┌─────────────────────────────────────────────────────────┐
│                      SERVER                             │
│                 Node.js + Express (port 5000)           │
│   Routes → Middleware → Controllers → Models            │
└────────┬────────────────────────────────────┬───────────┘
         │                                    │
         ▼                                    ▼
┌─────────────────┐                ┌──────────────────────┐
│    MongoDB      │                │   External APIs       │
│  (Compass GUI)  │                │  Claude API           │
│  nuvaultDB        │                │  ExchangeRate API     │
│  8 Collections  │                │  Yahoo Finance API    │
└─────────────────┘                └──────────────────────┘
```

---

## Data Architecture — All 8 Collections & Their Relationships

```
nuvaultDB
│
├── users               ← Root of everything. Every document in every
│                         other collection references a user _id.
│
├── assets              → belongs to user
├── liabilities         → belongs to user
│
│   (assets - liabilities = net worth, computed on the fly, never stored)
│
├── transactions        → belongs to user
│                         feeds into → budgets (spending check)
│                         feeds into → goals (auto-save tracking)
│
├── budgets             → belongs to user
│                         scoped to month + year
│                         reads from → transactions to calculate spent
│
├── investments         → belongs to user
│                         currentPrice pulled live from Yahoo Finance API
│                         P&L = (currentPrice - buyPrice) × quantity
│
├── goals               → belongs to user
│                         savedAmount updated manually or via transaction tag
│
└── bills               → belongs to user
                          nextDueDate auto-advances after marking paid
```

---

## Request Lifecycle — What Happens on Every API Call

```
Browser
  │
  ├── Axios attaches JWT from localStorage to Authorization header
  │
  ▼
Express Router
  │
  ├── CORS middleware checks origin
  ├── express.json() parses body
  │
  ▼
Auth Middleware (protect)
  │
  ├── Extracts token from header
  ├── Verifies with JWT_SECRET
  ├── Fetches user from DB, attaches to req.user
  │
  ▼
Controller
  │
  ├── All DB queries scoped to req.user._id
  ├── Business logic runs
  ├── Response sent as JSON
  │
  ▼
Error Handler (if anything throws)
  │
  └── Catches all next(err) calls, returns clean error JSON
```

---

## Module Architecture — How Each Feature Is Structured

Every module follows this exact same shape:

```
Feature (e.g. Transactions)
│
├── BACKEND
│   ├── models/Transaction.js          ← Schema + validation
│   ├── controllers/transactionController.js  ← All logic lives here
│   ├── routes/transactionRoutes.js    ← URL mapping + protect middleware
│   └── middleware/auth.js             ← Shared, not per module
│
└── FRONTEND
    ├── pages/Transactions.jsx         ← Full page view
    ├── components/TransactionForm.jsx ← Add/edit form
    ├── components/TransactionList.jsx ← Display list
    └── api/transactions.js            ← All Axios calls for this module
```

---

## Authentication Flow

```
Register
  User fills form → POST /api/auth/register
  → Password hashed with bcrypt (salt 10)
  → User document created in MongoDB
  → JWT generated (contains user _id, expires in 30 days)
  → Token returned to client
  → Stored in localStorage
  → Redirect to /dashboard

Login
  User fills form → POST /api/auth/login
  → Email looked up in DB
  → bcrypt.compare() checks password
  → JWT generated and returned
  → Same flow as above

Every Protected Request
  → JWT pulled from localStorage
  → Attached as Bearer token in Axios interceptor
  → Backend verify → attach req.user → proceed

Logout
  → localStorage.removeItem('token')
  → Redirect to /login
  → No server call needed (stateless JWT)
```

---

## Net Worth Computation Architecture

Net worth is never stored. It is always computed on demand:

```
GET /api/networth
  │
  ├── Query all assets where user = req.user._id
  ├── Query all liabilities where user = req.user._id
  ├── totalAssets = sum of all asset.value
  ├── totalLiabilities = sum of all liability.amount
  └── netWorth = totalAssets - totalLiabilities
      → Return all three values together
```

---

## Budget vs Spending Architecture

Budgets don't store their own spending. They read from transactions:

```
GET /api/budgets
  │
  ├── Fetch all budgets for user (current month/year)
  ├── For each budget category:
  │     Query transactions where:
  │       user = req.user._id
  │       type = 'expense'
  │       category = budget.category
  │       date within current month
  │     Sum all amounts → spent
  └── Return budget with { limit, spent, remaining, isOverBudget }
```

---

## Investment P&L Architecture

```
GET /api/investments/summary
  │
  ├── Fetch all investments for user
  ├── For each investment:
  │     If type is stock/crypto → call Yahoo Finance API for currentPrice
  │     If type is FD/other    → use stored value (no live price)
  │     gainLoss = (currentPrice - buyPrice) × quantity
  │     gainLossPercent = (gainLoss / (buyPrice × quantity)) × 100
  ├── totalInvested = sum of (buyPrice × quantity) for all
  ├── currentValue  = sum of (currentPrice × quantity) for all
  └── totalPnL = currentValue - totalInvested
```

---

## AI Advisor Architecture

```
POST /api/ai/chat  { message: "..." }
  │
  ├── Fetch user's complete financial picture in parallel:
  │     Promise.all([assets, liabilities, transactions(50), goals, bills])
  │
  ├── Compute netWorth, monthly income, monthly expenses
  │
  ├── Build system prompt with all of this as context
  │
  ├── Call Claude API with:
  │     system = financial context
  │     user   = the message
  │
  └── Return Claude's response as { reply: "..." }

Frontend Chat Component:
  ├── Messages stored in React state (array)
  ├── Each send appends user message, calls API, appends AI reply
  └── No chat history stored in MongoDB (session only)
```

---

## Frontend Page → API Mapping

```
/dashboard        ← GET /api/networth
                  ← GET /api/transactions?limit=5
                  ← GET /api/bills (upcoming only)
                  ← GET /api/goals

/transactions     ← GET /api/transactions (paginated, filterable)
                  ← POST /api/transactions
                  ← PUT /api/transactions/:id
                  ← DELETE /api/transactions/:id

/budget           ← GET /api/budgets
                  ← POST /api/budgets
                  ← PUT /api/budgets/:id

/networth         ← GET /api/networth (assets + liabilities)
                  ← POST /api/assets
                  ← POST /api/liabilities

/investments      ← GET /api/investments
                  ← GET /api/investments/summary
                  ← POST /api/investments

/goals            ← GET /api/goals
                  ← POST /api/goals
                  ← PUT /api/goals/:id (update savedAmount)

/bills            ← GET /api/bills
                  ← POST /api/bills
                  ← PATCH /api/bills/:id/pay

/ai               ← POST /api/ai/chat
```

---

## State Management Architecture (Frontend)

No Redux needed. Keep it simple:

```
Global State (React Context)
  └── AuthContext
        ├── user object
        ├── token
        ├── login() function
        └── logout() function

Local State (per page, useState)
  ├── data[] → fetched from API on mount
  ├── loading → show spinner
  ├── error → show error message
  └── form values → controlled inputs
```

---

## Error Handling Architecture

```
Backend
  ├── Every controller wrapped in try/catch → next(err)
  ├── Mongoose validation errors caught and returned as 400
  ├── JWT errors caught in middleware and returned as 401
  └── Global errorHandler middleware formats all errors uniformly:
        { message: "...", stack: "..." (dev only) }

Frontend
  ├── Axios response interceptor catches 401 → clears token → redirects to login
  ├── Every API call has try/catch → sets error state
  └── Error state displayed inline in UI (not console)
```

---

## Security Architecture

```
Passwords     → bcrypt hashed, never stored plain, never returned in responses
JWT           → signed with secret, short-lived (30d), stateless
API Routes    → all protected except /register and /login
DB Queries    → always filtered by req.user._id (users can never see others' data)
CORS          → configured to only allow requests from client origin
Env Variables → all secrets in .env, never in code
Input         → validated server-side with express-validator before DB write
```

---

## Plan of Action — Build Order

```
Week 1 — Backend Complete
  Day 1    Project scaffolding, folder structure, .env, db connection
  Day 2    All 8 Mongoose models written and verified in Compass
  Day 3    Auth routes + controllers (register, login, getMe)
  Day 4    Transactions, Budget, Net Worth routes + controllers
  Day 5    Investments, Goals, Bills routes + controllers
  Day 6    AI Advisor route + Claude API integration
  Day 7    Full backend testing in Postman — every route, every edge case

Week 2 — Frontend Complete
  Day 8    Vite setup, Tailwind, React Router, Axios instance, AuthContext
  Day 9    Login + Register pages, protected route wrapper
  Day 10   Dashboard + Net Worth page
  Day 11   Transactions + Budget pages
  Day 12   Investments + Goals pages
  Day 13   Bills + AI Advisor chat page
  Day 14   Final testing end-to-end, error handling, polish
```

---

## Non-Negotiable Rules

- Backend must be 100% tested before any frontend is written
- Every DB query must be scoped to `req.user._id` without exception
- Net worth is never stored, always computed
- Budget spending is always read from transactions, never stored separately
- All errors must surface to the user in the UI, never silently fail
- Environment variables for every secret, no exceptions

---

That's the full architecture. Combine this with the code from the previous response and you have everything needed to build Nuvault end to end. 

## Plan of Action — Nuvault Build

---

### Week 1 — Backend

**Day 1 — Scaffold**

- Create folder structure (`server/`, `client/`)
- Init Node project, install all backend dependencies
- Set up `.env` with all keys
- Write `db.js`, connect to MongoDB
- Write `server.js` with all middleware wired up
- Open Compass, confirm connection to `nuvaultDB`

**Day 2 — Models**

- Write all 8 Mongoose schemas: User, Asset, Liability, Transaction, Budget, Investment, Goal, Bill
- Open Compass after each one, insert a test document manually, confirm shape is correct
- Fix any schema issues before moving on

**Day 3 — Auth**

- Write auth controller: register, login, getMe
- Write auth routes
- Write protect middleware
- Write error handler middleware
- Test in Postman: register → get token → use token → get user profile

**Day 4 — Core Transactions & Budget**

- Write Transaction controller and routes (CRUD + summary)
- Write Budget controller and routes (CRUD + spending check against transactions)
- Test both fully in Postman before moving on

**Day 5 — Net Worth & Investments**

- Write Assets + Liabilities controller (net worth computed on the fly)
- Write Investment controller (CRUD + P&L summary with live price call)
- Test both in Postman, confirm Compass shows correct documents

**Day 6 — Goals, Bills & AI**

- Write Goals controller and routes
- Write Bills controller and routes (including mark as paid + nextDueDate logic)
- Write AI advisor route (assemble financial snapshot → call Claude API → return reply)
- Test all three in Postman

**Day 7 — Full Backend Audit**

- Test every single endpoint in Postman from scratch
- Check every collection in Compass visually
- Confirm no route returns another user's data
- Confirm all errors return clean JSON, not crashes
- Fix everything before touching frontend

---

### Week 2 — Frontend

**Day 8 — Foundation**

- Scaffold React + Vite, install Tailwind + React Router + Axios
- Set up Axios instance with JWT interceptor
- Set up AuthContext (user, token, login, logout)
- Set up protected route wrapper
- Set up basic app shell with sidebar navigation

**Day 9 — Auth Pages**

- Build Login page
- Build Register page
- Connect both to backend auth routes
- Test full login/logout flow, confirm token stored in localStorage

**Day 10 — Dashboard + Net Worth**

- Build Dashboard page (net worth summary, recent transactions, upcoming bills)
- Build Net Worth page (assets list, liabilities list, add/edit/delete both)
- Connect to backend

**Day 11 — Transactions + Budget**

- Build Transactions page (list, filters, add/edit/delete)
- Build Budget page (cards per category, spent vs limit, add/edit)
- Connect to backend

**Day 12 — Investments + Goals**

- Build Investments page (portfolio table, P&L summary)
- Build Goals page (goal cards with progress bars, add/update)
- Connect to backend

**Day 13 — Bills + AI Advisor**

- Build Bills page (upcoming list, mark as paid)
- Build AI Advisor chat page (message input, conversation display)
- Connect both to backend

**Day 14 — Final Pass**

- Test every page end to end
- Handle all loading and error states visually
- Handle 401 token expiry → redirect to login
- Fix any broken flows
- App is ready