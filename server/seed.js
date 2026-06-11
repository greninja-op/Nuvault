'use strict';

/**
 * seed.js — wipe the database and populate realistic sample data for a
 * single test user.
 *
 * Run:  node server/seed.js   (or, from server/: node seed.js)
 *
 * - Connects using MONGO_URI from server/.env (no hardcoded connection string).
 * - Clears every existing collection.
 * - Creates the test user through the User model so the password is bcrypt
 *   hashed by the schema's pre('save') hook (same 10 salt rounds as the real
 *   register flow) — so `test@nuvault.com / test123456` can log in afterwards.
 * - Seeds transactions, budgets, assets, liabilities, investments, goals,
 *   bills, and portfolio items (FDs + bank accounts + a mix live here as
 *   PortfolioItem `kind`s — Nuvault has no separate FD/Bank collections).
 *
 * NOTE: FD accounts, bank accounts, and other holdings are all stored in the
 * single `portfolioitems` collection via a `kind` discriminator. There is no
 * `fdaccounts` or `bankaccounts` collection in Nuvault.
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const mongoose = require('mongoose');

const User = require('./models/User');
const Transaction = require('./models/Transaction');
const Budget = require('./models/Budget');
const Asset = require('./models/Asset');
const Liability = require('./models/Liability');
const Investment = require('./models/Investment');
const Goal = require('./models/Goal');
const Bill = require('./models/Bill');
const PortfolioItem = require('./models/PortfolioItem');

const TX_CATEGORIES = {
  income: ['Salary'],
  expense: ['Food', 'Transport', 'Shopping', 'Entertainment', 'Health'],
};

/** Round to 2 decimals. */
const money = (n) => Math.round(n * 100) / 100;

/** A date `monthsAgo` months back from today, on the given day-of-month. */
function dateMonthsAgo(monthsAgo, day = 15) {
  const d = new Date();
  d.setMonth(d.getMonth() - monthsAgo, day);
  d.setHours(12, 0, 0, 0);
  return d;
}

/** A date `daysFromNow` days in the future. */
function dateInDays(daysFromNow) {
  const d = new Date();
  d.setDate(d.getDate() + daysFromNow);
  d.setHours(9, 0, 0, 0);
  return d;
}

/** Build 20 transactions spread across the last 3 months. */
function buildTransactions(userId) {
  const txns = [];

  // 3 monthly salary credits (one per month, last 3 months).
  for (let m = 0; m < 3; m += 1) {
    txns.push({
      user: userId,
      type: 'income',
      category: 'Salary',
      amount: money(85000),
      description: 'Monthly salary',
      date: dateMonthsAgo(m, 1),
    });
  }

  // 17 expenses across categories and months.
  const expensePlan = [
    ['Food', 1200.5, 'Groceries'],
    ['Food', 640, 'Dinner out'],
    ['Food', 320.75, 'Cafe'],
    ['Transport', 2200, 'Fuel'],
    ['Transport', 150, 'Metro card'],
    ['Transport', 480, 'Cab rides'],
    ['Shopping', 3499, 'Clothing'],
    ['Shopping', 1299.99, 'Electronics accessory'],
    ['Shopping', 899, 'Home supplies'],
    ['Entertainment', 599, 'Movie night'],
    ['Entertainment', 1499, 'Concert tickets'],
    ['Entertainment', 249, 'Games'],
    ['Health', 1800, 'Pharmacy'],
    ['Health', 2500, 'Doctor visit'],
    ['Health', 999, 'Gym membership'],
    ['Food', 760.25, 'Weekend groceries'],
    ['Transport', 350, 'Parking + tolls'],
  ];
  expensePlan.forEach((row, i) => {
    const [category, amount, description] = row;
    txns.push({
      user: userId,
      type: 'expense',
      category,
      amount: money(amount),
      description,
      date: dateMonthsAgo(i % 3, ((i * 7) % 27) + 1),
    });
  });

  return txns;
}

function buildBudgets(userId) {
  const now = new Date();
  const month = now.getMonth() + 1;
  const year = now.getFullYear();
  return [
    { user: userId, category: 'Food', limit: 8000, month, year },
    { user: userId, category: 'Transport', limit: 4000, month, year },
    { user: userId, category: 'Shopping', limit: 6000, month, year },
    { user: userId, category: 'Entertainment', limit: 3000, month, year },
    { user: userId, category: 'Health', limit: 5000, month, year },
  ];
}

function buildAssets(userId) {
  return [
    { user: userId, name: 'Savings Account', type: 'bank', value: 250000, currency: 'INR' },
    { user: userId, name: 'Gold', type: 'other', value: 180000, currency: 'INR' },
    { user: userId, name: 'Nifty 50 Index Fund', type: 'mutual_fund', value: 320000, currency: 'INR' },
    { user: userId, name: 'Emergency Cash', type: 'cash', value: 40000, currency: 'INR' },
  ];
}

function buildLiabilities(userId) {
  return [
    {
      user: userId,
      name: 'Home Loan',
      type: 'mortgage',
      amount: 3500000,
      interestRate: 8.5,
      dueDate: dateInDays(20),
    },
    {
      user: userId,
      name: 'Credit Card',
      type: 'credit_card',
      amount: 42000,
      interestRate: 36,
      dueDate: dateInDays(12),
    },
  ];
}

function buildInvestments(userId) {
  return [
    {
      user: userId,
      type: 'stock',
      symbol: 'RELIANCE.NS',
      name: 'Reliance Industries',
      quantity: 25,
      buyPrice: 2450,
      currentPrice: 2890,
      buyDate: dateMonthsAgo(8, 10),
    },
    {
      user: userId,
      type: 'crypto',
      symbol: 'BTC-USD',
      name: 'Bitcoin',
      quantity: 0.05,
      buyPrice: 4200000,
      currentPrice: 5100000,
      buyDate: dateMonthsAgo(5, 3),
    },
    {
      user: userId,
      type: 'mutual_fund',
      name: 'Parag Parikh Flexi Cap',
      quantity: 500,
      buyPrice: 62.5,
      currentPrice: 71.2,
      buyDate: dateMonthsAgo(12, 1),
    },
    {
      user: userId,
      type: 'fd',
      name: 'HDFC Fixed Deposit',
      quantity: 1,
      buyPrice: 200000,
      currentPrice: 214000,
      buyDate: dateMonthsAgo(10, 5),
    },
  ];
}

function buildGoals(userId) {
  return [
    {
      user: userId,
      name: 'Emergency Fund',
      targetAmount: 300000,
      savedAmount: 150000, // 50%
      category: 'Safety',
      targetDate: dateInDays(180),
    },
    {
      user: userId,
      name: 'Europe Trip',
      targetAmount: 400000,
      savedAmount: 100000, // 25%
      category: 'Travel',
      targetDate: dateInDays(300),
    },
    {
      user: userId,
      name: 'New Laptop',
      targetAmount: 150000,
      savedAmount: 120000, // 80%
      category: 'Tech',
      targetDate: dateInDays(60),
    },
  ];
}

function buildBills(userId) {
  return [
    { user: userId, name: 'Netflix', amount: 649, frequency: 'monthly', nextDueDate: dateInDays(8), category: 'Entertainment' },
    { user: userId, name: 'Rent', amount: 25000, frequency: 'monthly', nextDueDate: dateInDays(3), category: 'Housing' },
    { user: userId, name: 'Electricity', amount: 1850.5, frequency: 'monthly', nextDueDate: dateInDays(15), category: 'Utilities' },
    { user: userId, name: 'Spotify', amount: 119, frequency: 'monthly', nextDueDate: dateInDays(22), category: 'Entertainment' },
    { user: userId, name: 'Internet', amount: 999, frequency: 'monthly', nextDueDate: dateInDays(10), category: 'Utilities' },
  ];
}

/**
 * Portfolio items: 3 FDs + 2 bank accounts + 3 mixed holdings, all stored in
 * the single `portfolioitems` collection via `kind`.
 */
function buildPortfolioItems(userId) {
  return [
    // 3 FD accounts
    { user: userId, kind: 'fd', name: 'HDFC Bank FD', principal: 200000, interestRate: 7.1, compounding: 'quarterly', startDate: dateMonthsAgo(10, 1), tenureMonths: 24, currentValue: 214000 },
    { user: userId, kind: 'fd', name: 'SBI Tax Saver FD', principal: 150000, interestRate: 6.8, compounding: 'yearly', startDate: dateMonthsAgo(6, 1), tenureMonths: 60, currentValue: 156000 },
    { user: userId, kind: 'fd', name: 'ICICI Short-Term FD', principal: 100000, interestRate: 7.4, compounding: 'monthly', startDate: dateMonthsAgo(3, 1), tenureMonths: 12, currentValue: 102200 },
    // 2 bank accounts
    { user: userId, kind: 'bank', name: 'HDFC Savings', accountType: 'savings', currentBalance: 250000 },
    { user: userId, kind: 'bank', name: 'Axis Current', accountType: 'current', currentBalance: 90000 },
    // 3 mixed holdings
    { user: userId, kind: 'stock', name: 'Infosys', symbol: 'INFY.NS', units: 30, buyPrice: 1350, currentPrice: 1560 },
    { user: userId, kind: 'crypto', name: 'Ethereum', symbol: 'ETH-USD', units: 0.8, buyPrice: 210000, currentPrice: 245000 },
    { user: userId, kind: 'gold', name: 'Sovereign Gold Bond', units: 20, buyPrice: 5800, currentPrice: 6450 },
  ];
}

async function clearAllCollections() {
  const collections = await mongoose.connection.db.collections();
  for (const col of collections) {
    await col.deleteMany({});
  }
}

async function main() {
  const uri = process.env.MONGO_URI;
  if (!uri) {
    throw new Error('MONGO_URI is not set in server/.env');
  }

  await mongoose.connect(uri);
  console.log('Connected to MongoDB.');

  await clearAllCollections();
  console.log('Cleared all existing collections.');

  // Create the test user via the model so the pre-save hook hashes the
  // password (bcrypt, 10 salt rounds — identical to the register flow).
  const user = await User.create({
    name: 'Test User',
    email: 'test@nuvault.com',
    password: 'test123456',
    currency: 'INR',
  });
  console.log('✓ Seeded users: 1 documents');

  const seeds = [
    ['transactions', Transaction, buildTransactions(user._id)],
    ['budgets', Budget, buildBudgets(user._id)],
    ['assets', Asset, buildAssets(user._id)],
    ['liabilities', Liability, buildLiabilities(user._id)],
    ['investments', Investment, buildInvestments(user._id)],
    ['goals', Goal, buildGoals(user._id)],
    ['bills', Bill, buildBills(user._id)],
    ['portfolioitems', PortfolioItem, buildPortfolioItems(user._id)],
  ];

  for (const [label, Model, docs] of seeds) {
    const created = await Model.insertMany(docs);
    console.log(`✓ Seeded ${label}: ${created.length} documents`);
  }

  console.log('\nLogin with:  test@nuvault.com  /  test123456');
}

main()
  .catch((err) => {
    console.error('✗ Seed failed:', err.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect();
    console.log('Disconnected.');
  });
