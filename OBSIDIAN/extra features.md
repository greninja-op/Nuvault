Here are the updated features first, then the exact prompt to execute:

---

## Added Features

**Finance Calculator Suite — Calculators to include:**

- SIP Calculator (monthly investment, expected return, tenure → maturity amount)
- Lumpsum Calculator (one time investment → future value)
- SWP Calculator (Systematic Withdrawal Plan)
- FD Calculator (principal, interest rate, tenure, compounding frequency → maturity)
- RD Calculator (Recurring Deposit)
- PPF Calculator (15 year lock-in, yearly investment → maturity)
- EMI Calculator (loan amount, rate, tenure → monthly EMI + total interest)
- Loan Prepayment Calculator (how much you save by prepaying)
- Goal SIP Calculator (target amount → how much to invest monthly)
- Inflation Calculator (future value of today's money)
- Tax Calculator (old vs new regime comparison)
- CAGR Calculator (growth rate between two values)

**Each calculator shows:**

- Input fields with sliders
- Result breakdown (invested amount, returns, total value)
- A simple chart (pie or bar) showing invested vs returns visually

---

**Portfolio Page — What to include:**

- Fixed Deposits (bank name, principal, rate, start date, maturity date, maturity amount)
- Bank Accounts (bank name, account type, current balance)
- Mutual Funds (fund name, units, NAV, current value, returns)
- Stocks (symbol, qty, buy price, current price, P&L)
- Crypto (coin, qty, buy price, current price, P&L)
- PPF / EPF (current corpus, yearly contribution)
- Real Estate (property name, purchase value, current value)
- Gold (grams, buy price, current price)
- Summary at top: total portfolio value, total invested, total returns, asset allocation pie chart

---

## Prompt to Execute

Copy and paste this exactly into a new Claude chat:

---

> I am building a full stack personal finance web app called **Nuvault**. The tech stack is React + Vite + Tailwind CSS on the frontend, Node.js + Express on the backend, and MongoDB with Mongoose as the database. I am using MongoDB Compass to manage the database locally.
> 
> The app has the following pages: Dashboard, Transactions, Budget, Net Worth, Portfolio, Finance Calculators, Goals, Bills, and AI Advisor (powered by Claude API).
> 
> I want you to build this app backend first, then frontend. Here is the exact build order I want you to follow:
> 
> **Step 1** — Project scaffold. Create the full folder structure for both client and server. Give me every command to run to initialise both projects and install all dependencies.
> 
> **Step 2** — MongoDB models. Write all Mongoose schemas: User, Transaction, Budget, Asset, Liability, Investment, Goal, Bill, FDAccount, BankAccount, PortfolioItem. Every schema must have a user field referencing the User model so all data is scoped per user.
> 
> **Step 3** — Backend middleware. Write the JWT auth middleware (protect), the global error handler, and the Axios instance setup.
> 
> **Step 4** — Auth routes and controller. Register, Login, GetMe. Passwords hashed with bcrypt. JWT returned on success.
> 
> **Step 5** — All remaining routes and controllers in this order: Transactions, Budget, Net Worth (Assets + Liabilities), Portfolio (FDs, Bank Accounts, Mutual Funds, Stocks, Crypto, PPF, Real Estate, Gold), Investments, Goals, Bills, AI Advisor.
> 
> **Step 6** — Wire everything in server.js. All routes mounted, CORS enabled, error handler last.
> 
> **Step 7** — Frontend scaffold. Set up React Router with all 9 routes, Axios instance with JWT interceptor, AuthContext for global auth state, and a protected route wrapper.
> 
> **Step 8** — Build each frontend page in this order: Login, Register, Dashboard, Transactions, Budget, Net Worth, Portfolio, Finance Calculators, Goals, Bills, AI Advisor.
> 
> **Step 9** — Finance Calculator Suite page. Build the following calculators each as a separate tab or accordion on one page: SIP, Lumpsum, SWP, FD, RD, PPF, EMI, Loan Prepayment, Goal SIP, Inflation, Tax (old vs new regime), CAGR. Each calculator must have input fields with sliders, show a results breakdown (amount invested, returns earned, total value), and display a simple pie or bar chart using Recharts.
> 
> **Step 10** — Portfolio page. Build a unified portfolio view showing: Fixed Deposits, Bank Accounts, Mutual Funds, Stocks, Crypto, PPF/EPF, Real Estate, Gold. Show a summary at the top with total portfolio value, total invested, total returns, and an asset allocation pie chart using Recharts. Each asset type should be in its own section with add, edit, delete functionality.
> 
> **Rules to follow throughout:**
> 
> - Build backend completely and test before starting frontend
> - Every database query must be scoped to req.user._id
> - Every controller must use async/await with try/catch calling next(err)
> - Net worth and portfolio totals are always computed on the fly, never stored
> - All secrets in .env, never hardcoded
> - Finance calculators are fully frontend — no backend calls needed, all math done in React
> - UI can be basic but must be clean and functional
> - Give me one step at a time and wait for me to say "next" before moving to the next step

---


Here's the complete how-to for building each part:

---

## HOW TO BUILD EACH PART

---

### STEP 1 — Project Scaffold

**What you are doing:** Creating the folder structure and installing all dependencies for both backend and frontend.

**How to do it:**

1. Open your terminal
2. Pick a location on your computer (e.g. Desktop)
3. Run these commands one by one:

```bash
# Create root folder
mkdir nuvault && cd nuvault

# Backend setup
mkdir server && cd server
npm init -y
npm install express mongoose dotenv bcryptjs jsonwebtoken cors axios express-validator express-rate-limit helmet
npm install --save-dev nodemon
cd ..

# Frontend setup
npm create vite@latest client -- --template react
cd client
npm install axios react-router-dom recharts
npx tailwindcss init -p
```

4. In `server/package.json` add this under scripts:

```json
"dev": "nodemon server.js"
```

5. Create `.env` inside server folder:

```
MONGO_URI=mongodb://localhost:27017/nuvaultDB
JWT_SECRET=nuvault_secret_key_change_this
JWT_EXPIRE=30d
PORT=5000
CLAUDE_API_KEY=your_claude_key_here
```

**How to verify:**

- `server/` folder exists with `node_modules`
- `client/` folder exists, you can run `npm run dev` and see Vite default page in browser
- MongoDB Compass is open and connected to `localhost:27017`

---

### STEP 2 — MongoDB Models

**What you are doing:** Writing the data blueprints. Every collection in MongoDB gets a schema file. This defines exactly what shape your data takes.

**How to do it:**

1. Inside `server/` create a `models/` folder
2. Create one file per model
3. Every model except User must have this field:

```js
user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true }
```

This links every document to the user who owns it.

**How to verify:**

- Open MongoDB Compass
- In your app, write a small test script or use a REST client to create one document of each type
- Open Compass, click `nuvaultDB`, and confirm each collection appears with the correct fields
- Delete test documents after verifying

**Common mistakes to avoid:**

- Forgetting the `user` field on any model
- Using `String` where you should use `Number` for amounts
- Not setting `required: true` on critical fields

---

### STEP 3 — Middleware

**What you are doing:** Writing two pieces of code that run on every request — one checks if the user is logged in, one catches all errors.

**How to do it:**

1. Create `server/middleware/` folder
2. Create `auth.js` — this file reads the token from the request header, verifies it, and attaches the user to `req.user`
3. Create `errorHandler.js` — this file catches anything thrown with `next(err)` and returns a clean JSON error response

**How to verify:**

- Try hitting a protected route without a token — should get 401
- Try hitting a protected route with a bad token — should get 401
- Try hitting a protected route with a valid token — should get data

---

### STEP 4 — Auth Routes

**What you are doing:** Building register, login, and get-my-profile endpoints. These are the only routes that do NOT need a token.

**How to do it:**

1. Create `server/controllers/authController.js`
2. Write three functions: `register`, `login`, `getMe`
3. Create `server/routes/authRoutes.js`
4. Map the functions to URLs:

```
POST /api/auth/register  → register function
POST /api/auth/login     → login function
GET  /api/auth/me        → protect middleware + getMe function
```

5. Mount in `server.js`:

```js
app.use('/api/auth', require('./routes/authRoutes'));
```

**How to verify using Postman or Thunder Client:**

```
POST localhost:5000/api/auth/register
Body: { "name": "Test", "email": "test@test.com", "password": "123456" }
→ Should return token + user object

POST localhost:5000/api/auth/login
Body: { "email": "test@test.com", "password": "123456" }
→ Should return token

GET localhost:5000/api/auth/me
Header: Authorization: Bearer [paste token here]
→ Should return user object
```

Open Compass → nuvaultDB → users collection → confirm user document exists with hashed password

---

### STEP 5 — All Other Routes & Controllers

**What you are doing:** Building the actual data routes for every feature. Each one follows the exact same pattern.

**The pattern for every single module:**

```
1. Create controller file  →  write async functions with try/catch
2. Create route file       →  map URLs to controller functions
3. Add protect middleware  →  all routes require login
4. Mount in server.js      →  add app.use line
5. Test in Postman         →  test every URL before moving to next module
```

**Build order and what to test for each:**

**Transactions:**

```
POST   /api/transactions        → create one, check Compass
GET    /api/transactions        → get list back
PUT    /api/transactions/:id    → edit it, check Compass updated
DELETE /api/transactions/:id    → delete, check Compass removed
GET    /api/transactions/summary → get totals by category
```

**Budget:**

```
POST /api/budgets               → create budget for Food category
GET  /api/budgets               → confirm spent is calculated from transactions
PUT  /api/budgets/:id           → change the limit
DELETE /api/budgets/:id         → remove it
```

**Net Worth (Assets + Liabilities):**

```
POST /api/assets                → add a bank account asset
POST /api/liabilities           → add a loan liability
GET  /api/networth              → confirm it returns assets[], liabilities[], netWorth number
```

**Portfolio:**

```
POST /api/portfolio/fd          → add an FD
POST /api/portfolio/bank        → add a bank account
POST /api/portfolio/mutualfund  → add a mutual fund
GET  /api/portfolio/summary     → confirm total value, invested, returns all calculate correctly
```

**Goals:**

```
POST /api/goals                 → create a goal
PUT  /api/goals/:id             → add money to it, confirm savedAmount updates
GET  /api/goals                 → confirm progress percentage is correct
```

**Bills:**

```
POST /api/bills                 → add a monthly bill
GET  /api/bills                 → confirm it appears in upcoming
PATCH /api/bills/:id/pay        → mark paid, confirm nextDueDate advances by one month
```

**AI Advisor:**

```
POST /api/ai/chat  { "message": "Am I saving enough?" }
→ Confirm backend fetches user data
→ Confirm Claude API is called
→ Confirm reply comes back
```

---

### STEP 6 — Wire server.js

**What you are doing:** Connecting all your routes into one main file so the server knows where to send each request.

**How to do it:** Open `server.js` and make sure it has this structure in this exact order:

```
1. dotenv.config()
2. connectDB()
3. app = express()
4. app.use(cors())
5. app.use(express.json())
6. app.use(helmet())
7. All app.use('/api/...') route mounts
8. app.use(errorHandler)   ← must be LAST
9. app.listen()
```

**How to verify:** Run `npm run dev` in server folder. Should see:

```
Server running on port 5000
MongoDB Connected: localhost
```

No errors in terminal.

---

### STEP 7 — Frontend Scaffold

**What you are doing:** Setting up the React app's skeleton — routing, global auth state, and the Axios instance that talks to your backend.

**How to do it:**

**Axios instance** — `client/src/api/axios.js`:

```js
import axios from 'axios';
const instance = axios.create({ baseURL: 'http://localhost:5000/api' });
instance.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});
instance.interceptors.response.use(
  res => res,
  err => {
    if (err.response?.status === 401) {
      localStorage.removeItem('token');
      window.location.href = '/login';
    }
    return Promise.reject(err);
  }
);
export default instance;
```

**AuthContext** — `client/src/context/AuthContext.jsx`:

```js
import { createContext, useState, useContext } from 'react';
const AuthContext = createContext();
export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [token, setToken] = useState(localStorage.getItem('token'));
  const login = (userData, tokenData) => {
    setUser(userData);
    setToken(tokenData);
    localStorage.setItem('token', tokenData);
  };
  const logout = () => {
    setUser(null);
    setToken(null);
    localStorage.removeItem('token');
  };
  return (
    <AuthContext.Provider value={{ user, token, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
};
export const useAuth = () => useContext(AuthContext);
```

**Protected Route** — `client/src/components/ProtectedRoute.jsx`:

```js
import { Navigate } from 'react-router-dom';
const ProtectedRoute = ({ children }) => {
  const token = localStorage.getItem('token');
  return token ? children : <Navigate to="/login" />;
};
export default ProtectedRoute;
```

**Router setup in** `main.jsx` — wrap all routes in `AuthProvider`, wrap all private pages in `ProtectedRoute`

**How to verify:**

- Visit `localhost:3000/dashboard` without logging in → should redirect to `/login`
- Login → should redirect to `/dashboard`
- Refresh page → should stay logged in

---

### STEP 8 — Each Frontend Page

**What you are doing for every page:** Same four steps every time:

```
1. Create the page file in client/src/pages/
2. Create a matching API file in client/src/api/ with all Axios calls for that page
3. Use useEffect to fetch data when page loads
4. Use useState to store data, loading state, and error state
```

**Template every page follows:**

```jsx
import { useState, useEffect } from 'react';
import api from '../api/axios';

const PageName = () => {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const res = await api.get('/route-name');
        setData(res.data);
      } catch (err) {
        setError(err.response?.data?.message || 'Something went wrong');
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, []);

  if (loading) return <div>Loading...</div>;
  if (error) return <div>{error}</div>;
  return ( /* your JSX here */ );
};

export default PageName;
```

**For every add/edit form:**

```
1. Keep a formData state object
2. Controlled inputs update formData
3. Submit button calls POST or PUT
4. On success close the form and refresh the list
5. On error show the error message inline
```

**How to verify each page:**

- Data loads on page visit
- Add form creates a new item visible in the list and in Compass
- Edit form pre-fills correctly and saves changes
- Delete removes from list and from Compass
- All loading and error states show correctly

---

### STEP 9 — Finance Calculators Page

**What you are doing:** This entire page is frontend only. No backend. No database. Pure math in React.

**How to build it:**

1. Create one page file `Calculators.jsx`
2. Create one component per calculator inside `client/src/components/calculators/`
3. Each calculator component has:
    - Input fields (number inputs + range sliders side by side)
    - A `calculate()` function that runs the math formula
    - A results section showing the breakdown
    - A Recharts PieChart or BarChart showing invested vs returns

**The math formulas:**

SIP:

```
M = P × ({[1 + r]^n - 1} / r) × (1 + r)
P = monthly investment
r = monthly rate (annual rate / 12 / 100)
n = months
```

Lumpsum:

```
A = P × (1 + r/100)^n
P = principal, r = annual rate, n = years
```

FD (compound interest):

```
A = P × (1 + r/n)^(n×t)
P = principal, r = rate/100, n = compounding per year, t = years
```

EMI:

```
EMI = P × r × (1+r)^n / ((1+r)^n - 1)
P = loan, r = monthly rate, n = months
```

PPF:

```
Year by year loop: balance = (balance + yearly_investment) × (1 + 0.071)
Run for 15 years
```

CAGR:

```
CAGR = (Final Value / Initial Value)^(1/years) - 1
```

Inflation:

```
Future Value = Present Value × (1 + inflation_rate/100)^years
```

**How the calculator UI works:**

```
[ Slider ←————●————→ ]   [ Number input: 5000 ]
Both connected — moving slider updates input, typing in input moves slider
→ Result recalculates instantly on every change (no submit button needed)
```

**How to verify:**

- Cross check SIP result with any online SIP calculator (Groww, ET Money)
- Numbers should match exactly

---

### STEP 10 — Portfolio Page

**What you are doing:** Building a unified view of all wealth across every asset type with a summary at the top.

**How to build it:**

1. Page loads → calls GET `/api/portfolio/summary`
2. Summary section at top renders total value, invested, returns, allocation chart
3. Below that, render each asset type in its own section
4. Each section has its own add button that opens a form specific to that asset type

**Asset type forms — what fields each needs:**

FD form:

```
Bank Name, Principal Amount, Interest Rate, Compounding (monthly/quarterly/yearly),
Start Date, Tenure (months) → auto-calculate maturity date and maturity amount
```

Bank Account form:

```
Bank Name, Account Type (savings/current/salary), Current Balance
```

Mutual Fund form:

```
Fund Name, Units Held, Current NAV, Buy NAV (average)
→ auto-calculate current value and returns
```

Stocks:

```
Stock Symbol, Company Name, Quantity, Buy Price, Current Price
→ auto-calculate P&L
```

Crypto:

```
Coin Name, Symbol, Quantity, Buy Price, Current Price
```

PPF/EPF:

```
Account Type (PPF/EPF), Current Corpus, Yearly Contribution, Start Year
```

Real Estate:

```
Property Name, Purchase Value, Current Estimated Value, Purchase Year
```

Gold:

```
Quantity (grams), Purchase Price per gram, Current Price per gram
```

**Summary calculation logic:**

```
Total Invested = sum of all buy/principal values across every asset type
Current Value  = sum of all current values (FD maturity if held to term, 
                 current balance for bank, current NAV × units for MF etc.)
Total Returns  = Current Value - Total Invested
Allocation     = each asset type as % of total current value → pie chart
```

**How to verify:**

- Add one of each asset type
- Confirm summary numbers add up correctly
- Open Compass and confirm each asset saved to correct collection
- Confirm allocation pie chart percentages add up to 100%

---

## Overall Build Verification Checklist

Before calling the app done, run through this:

```
□ Register a new user
□ Login with that user
□ Add assets and liabilities → net worth shows correctly
□ Add transactions → budget spent updates → dashboard updates
□ Add a bill → mark it paid → next due date advances
□ Add a goal → add money to it → progress bar moves
□ Add investments → P&L shows correctly
□ Add portfolio items of each type → summary calculates correctly
□ Open every calculator → verify results match online calculators
□ Ask the AI advisor a question → get a relevant response based on your real data
□ Logout → try accessing dashboard → redirects to login
□ Login again → all data still there
```

---

That's the complete how-to for every single step. Use the prompt from the previous message to execute it step by step in a new chat. Want me to also write out all the exact math formulas for the remaining calculators (SWP, RD, Goal SIP, Tax)?