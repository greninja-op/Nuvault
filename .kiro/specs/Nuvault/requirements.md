# Requirements Document

## Introduction

Nuvault is a personal finance and money management full-stack web application. It enables an authenticated user to track assets and liabilities, compute net worth, record income and expense transactions, set category budgets, manage investments with live market pricing, track savings goals, manage recurring bills, and receive AI-generated financial advice based on a snapshot of their own data.

The system is composed of a React (Vite + Tailwind) client, a Node.js + Express REST API server, a MongoDB database, and integrations with the Claude API (AI advice), Yahoo Finance API (market prices), and ExchangeRate API (currency conversion). Authentication uses JSON Web Tokens (JWT), and every piece of financial data belongs to exactly one user. A foundational rule of the system is strict per-user data isolation: a user can only ever read or modify data that belongs to that user.

This document defines the functional and cross-cutting requirements for Nuvault using EARS patterns.

## Glossary

- **System**: The Nuvault application as a whole (client and server).
- **API_Server**: The Node.js + Express backend that exposes REST endpoints.
- **Client**: The React frontend application.
- **Auth_Service**: The server component responsible for registration, login, token issuance, and profile retrieval.
- **Auth_Middleware**: The server component that validates JWTs and attaches the authenticated user to a request.
- **User**: A registered person who owns financial data within the System. Identified by a unique user identifier (`user_id`).
- **JWT**: A signed JSON Web Token carrying the authenticated user's identifier, used to authorize protected requests.
- **Asset**: A user-owned item of monetary value (cash, bank, stock, crypto, mutual_fund, fd, real_estate, other).
- **Liability**: A user-owned debt or obligation (loan, credit_card, mortgage, other).
- **Net_Worth_Service**: The server component that computes net worth from assets and liabilities.
- **Net_Worth**: The value equal to the sum of a user's asset values minus the sum of that user's liability amounts.
- **Transaction**: A recorded income or expense entry belonging to a user.
- **Transaction_Service**: The server component that manages transactions and their summaries.
- **Budget**: A spending limit for a single category scoped to a specific month and year.
- **Budget_Service**: The server component that manages budgets and computes spending from transactions.
- **Investment**: A user-owned holding (stock, crypto, mutual_fund, fd, other) with quantity and buy price.
- **Investment_Service**: The server component that manages investments and computes profit and loss.
- **Goal**: A savings target with a target amount and a saved amount belonging to a user.
- **Goal_Service**: The server component that manages goals and progress.
- **Bill**: A recurring or one-time payment obligation with a frequency and a next due date.
- **Bill_Service**: The server component that manages bills, payment marking, and due-date advancement.
- **AI_Advisor_Service**: The server component that assembles a user's financial snapshot and requests advice from the Claude API.
- **Claude_API**: The external Anthropic messaging API used to generate financial advice.
- **Yahoo_Finance_API**: The external service used to retrieve live market prices for investments.
- **ExchangeRate_API**: The external service used to convert monetary amounts between currencies.
- **Error_Handler**: The server middleware that formats all thrown errors into a uniform JSON response.
- **Owning_User**: The user whose `user_id` matches the `user` field on a stored record.
- **Protected_Route**: Any API endpoint other than registration and login that requires a valid JWT.

## Requirements

### Requirement 1: User Registration

**User Story:** As a new visitor, I want to register an account with my name, email, and password, so that I can securely store and access my financial data.

#### Acceptance Criteria

1. WHEN a registration request is received with a name of 1 to 100 characters, a syntactically valid email of at most 254 characters, and a password of 6 to 128 characters, THE Auth_Service SHALL create a User record and return a JWT with HTTP status 201.
2. WHEN a User record is created, THE Auth_Service SHALL store the password as a bcrypt hash generated with a salt and SHALL NOT store the plaintext password.
3. IF a registration request contains an email that already belongs to an existing User, THEN THE Auth_Service SHALL reject the request with HTTP status 400, SHALL NOT create a User record, and SHALL return a message indicating the email is already registered.
4. IF a registration request omits, or provides an empty or whitespace-only value for, the name, email, or password, THEN THE Auth_Service SHALL reject the request with HTTP status 400 and a validation message identifying the missing or empty field.
5. IF a registration request contains a password shorter than 6 characters or longer than 128 characters, THEN THE Auth_Service SHALL reject the request with HTTP status 400 and a validation message indicating the password length is out of range.
6. WHEN a registration response is returned, THE Auth_Service SHALL include the user identifier, name, and email, and SHALL exclude the password and the password hash.
7. WHERE a registration request does not specify a currency, THE Auth_Service SHALL assign the default currency INR to the User record.
8. IF a registration request contains an email that is not syntactically valid or exceeds 254 characters, THEN THE Auth_Service SHALL reject the request with HTTP status 400 and a validation message indicating the email format is invalid.
9. IF a registration request contains a name longer than 100 characters, THEN THE Auth_Service SHALL reject the request with HTTP status 400 and a validation message indicating the name length is out of range.

### Requirement 2: User Login

**User Story:** As a registered user, I want to log in with my email and password, so that I receive a token that authorizes my requests.

#### Acceptance Criteria

1. WHEN a login request is received with a non-empty email and a non-empty password that match an existing User, THE Auth_Service SHALL return a JWT with HTTP status 200 within 2 seconds under nominal load.
2. IF a login request contains an email that matches no User, THEN THE Auth_Service SHALL reject the request with HTTP status 401 and a message indicating invalid credentials, without revealing whether the email or the password was incorrect.
3. IF a login request contains a password that does not match the stored hash for the matching User, THEN THE Auth_Service SHALL reject the request with HTTP status 401 and a message indicating invalid credentials, without revealing whether the email or the password was incorrect.
4. IF a login request is missing the email field, is missing the password field, contains an empty email, or contains an empty password, THEN THE Auth_Service SHALL reject the request with HTTP status 400 and a message indicating the required field that is missing or empty, and SHALL NOT issue a JWT.
5. WHEN matching an email against existing Users, THE Auth_Service SHALL treat the email as case-insensitive, comparing it against stored emails of up to 254 characters.
6. WHEN a JWT is issued, THE Auth_Service SHALL encode the user identifier into the token and SHALL set the token to expire after the configured expiry period of 30 days.
7. WHEN a login response is returned, THE Auth_Service SHALL include the user identifier, name, and email, and SHALL exclude the password and the stored password hash.

### Requirement 3: Authenticated Profile Retrieval

**User Story:** As a logged-in user, I want to retrieve my own profile, so that the application can display my account information.

#### Acceptance Criteria

1. WHEN a profile request is received with a JWT presented as a Bearer token in the Authorization header and the token passes signature verification and is not expired, THE Auth_Service SHALL return the authenticated User's profile, including every stored profile field except the password, within 2 seconds.
2. IF a profile request is received without a JWT, THEN THE Auth_Middleware SHALL reject the request with HTTP status 401, retain all User data unchanged, and return a message indicating the request is not authorized.
3. IF a profile request presents a JWT that fails signature verification or has expired, THEN THE Auth_Middleware SHALL reject the request with HTTP status 401 and return a message indicating the token is invalid.
4. IF a profile request presents a valid JWT but the corresponding User cannot be resolved, THEN THE Auth_Service SHALL reject the request with HTTP status 404 and return a message indicating the User was not found.

### Requirement 4: Route Protection and Authorization

**User Story:** As a user, I want all data endpoints to require authentication, so that no one can access financial data without a valid token.

#### Acceptance Criteria

1. WHERE an endpoint is a Protected_Route, THE Auth_Middleware SHALL require a JWT presented as a Bearer token in the Authorization header before the request reaches a controller.
2. WHEN a request to a Protected_Route presents a JWT that passes signature verification and is not expired, THE Auth_Middleware SHALL resolve the corresponding User, attach the User to the request, and pass control to the next handler within 1 second.
3. IF a request to a Protected_Route presents no token, THEN THE Auth_Middleware SHALL reject the request with HTTP status 401, prevent the request from reaching any controller, and return a message indicating the request is not authorized.
4. IF a request to a Protected_Route presents a token that fails signature verification or has expired, THEN THE Auth_Middleware SHALL reject the request with HTTP status 401, prevent the request from reaching any controller, and return a message indicating the token is invalid.
5. IF a request to a Protected_Route presents a valid JWT but the corresponding User cannot be resolved, THEN THE Auth_Middleware SHALL reject the request with HTTP status 401 and return a message indicating the request is not authorized.
6. THE API_Server SHALL expose only the registration and login endpoints without authentication, and SHALL treat every other endpoint as a Protected_Route.

### Requirement 5: Per-User Data Isolation

**User Story:** As a user, I want my financial data to be private, so that no other user can read or modify it.

#### Acceptance Criteria

1. WHEN a controller reads stored financial records on behalf of an authenticated request, THE API_Server SHALL restrict the query to records whose `user` field equals the authenticated user's identifier.
2. WHEN a controller creates a financial record on behalf of an authenticated request, THE API_Server SHALL set the record's `user` field to the authenticated user's identifier, ignoring any `user` value supplied in the request payload.
3. IF a request references a record identifier whose Owning_User is not the authenticated user, THEN THE API_Server SHALL NOT return or modify that record, SHALL leave the referenced record unchanged, and SHALL respond with HTTP status 404.
4. WHEN a controller produces a list or summary response on behalf of an authenticated request, THE API_Server SHALL exclude every record whose `user` field does not match the authenticated user's identifier.
5. IF a request that targets a financial record is not authenticated, THEN THE API_Server SHALL NOT return or modify any record and SHALL respond with HTTP status 401.
6. WHEN a controller updates a financial record on behalf of an authenticated request, THE API_Server SHALL keep the record's `user` field equal to its existing value, ignoring any `user` value supplied in the request payload.

### Requirement 6: Asset Management

**User Story:** As a user, I want to add, update, and delete my assets, so that I can keep an accurate record of what I own.

#### Acceptance Criteria

1. WHEN an asset creation request is received with a name of 1 to 100 characters, a type within the set {cash, bank, stock, crypto, mutual_fund, fd, real_estate, other}, and a numeric value in the range 0.01 to 999,999,999.99, THE API_Server SHALL create an Asset owned by the authenticated user and return it with HTTP status 201.
2. IF an asset creation request omits the name, type, or value, THEN THE API_Server SHALL reject the request with HTTP status 400, a validation message identifying the missing field, and SHALL NOT create the Asset.
3. IF an asset creation or update request contains a type outside the allowed set, THEN THE API_Server SHALL reject the request with HTTP status 400, a validation message, and SHALL NOT persist any change.
4. IF an asset creation or update request contains a value that is non-numeric or outside the range 0.01 to 999,999,999.99, THEN THE API_Server SHALL reject the request with HTTP status 400, a validation message indicating the value is invalid, and SHALL NOT persist any change.
5. WHEN an asset update request is received for an Asset owned by the authenticated user, THE API_Server SHALL apply the changes and return the updated Asset with HTTP status 200.
6. WHEN an asset deletion request is received for an Asset owned by the authenticated user, THE API_Server SHALL remove the Asset and return a success response with HTTP status 200.
7. IF an asset update or deletion request references an Asset that does not exist or is not owned by the authenticated user, THEN THE API_Server SHALL reject the request with HTTP status 404, leave existing records unchanged, and return a message indicating the Asset was not found.
8. WHERE an asset creation request does not specify a currency, THE API_Server SHALL assign the default currency INR to the Asset.

### Requirement 7: Liability Management

**User Story:** As a user, I want to add, update, and delete my liabilities, so that I can keep an accurate record of what I owe.

#### Acceptance Criteria

1. WHEN a liability creation request is received with a name of 1 to 100 characters, a type within the set {loan, credit_card, mortgage, other}, and a numeric amount in the range 0.01 to 999,999,999.99, THE API_Server SHALL create a Liability owned by the authenticated user and return it with HTTP status 201.
2. IF a liability creation request omits the name, type, or amount, THEN THE API_Server SHALL reject the request with HTTP status 400, a validation message identifying the missing field, and SHALL NOT create the Liability.
3. IF a liability creation or update request contains a type outside the allowed set, THEN THE API_Server SHALL reject the request with HTTP status 400, a validation message, and SHALL NOT persist any change.
4. IF a liability creation or update request contains an amount that is non-numeric or outside the range 0.01 to 999,999,999.99, THEN THE API_Server SHALL reject the request with HTTP status 400, a validation message indicating the amount is invalid, and SHALL NOT persist any change.
5. WHEN a liability update request is received for a Liability owned by the authenticated user, THE API_Server SHALL apply the changes and return the updated Liability with HTTP status 200.
6. WHEN a liability deletion request is received for a Liability owned by the authenticated user, THE API_Server SHALL remove the Liability and return a success response with HTTP status 200.
7. IF a liability update or deletion request references a Liability that does not exist or is not owned by the authenticated user, THEN THE API_Server SHALL reject the request with HTTP status 404, leave existing records unchanged, and return a message indicating the Liability was not found.

### Requirement 8: Net Worth Computation

**User Story:** As a user, I want to see my net worth, so that I understand my overall financial position.

#### Acceptance Criteria

1. WHEN a net worth request is received from an authenticated user, THE Net_Worth_Service SHALL compute Net_Worth as the arithmetic sum of that user's asset values minus the arithmetic sum of that user's liability amounts, treating an empty asset set or an empty liability set as a sum of 0, and SHALL round the computed Net_Worth to 2 decimal places.
2. WHEN the authenticated user's total liability amount exceeds the total asset value, THE Net_Worth_Service SHALL return a negative Net_Worth equal to the asset total minus the liability total.
3. WHEN a net worth response is returned, THE Net_Worth_Service SHALL include the list of the authenticated user's assets, the list of that user's liabilities, the total asset value, the total liability amount, and the computed Net_Worth value.
4. THE Net_Worth_Service SHALL compute Net_Worth on each request and SHALL NOT persist the Net_Worth value in the database.
5. WHILE the authenticated user has no assets and no liabilities, THE Net_Worth_Service SHALL return a Net_Worth of 0 with an empty asset list and an empty liability list.
6. WHERE the authenticated user's assets or liabilities are stored in a currency other than the user's display currency, THE Net_Worth_Service SHALL convert each amount to the user's display currency before summation.

### Requirement 9: Transaction Management

**User Story:** As a user, I want to record income and expense transactions, so that I can track my cash flow.

#### Acceptance Criteria

1. WHEN a transaction creation request is received with a type within the set {income, expense}, a category of 1 to 100 characters, and a numeric amount greater than 0 and at most 999,999,999.99 with at most 2 decimal places, THE Transaction_Service SHALL create a Transaction owned by the authenticated user and return it with HTTP status 201.
2. IF a transaction creation request omits the type, category, or amount, THEN THE Transaction_Service SHALL reject the request with HTTP status 400, a validation message identifying the missing field, and SHALL NOT create the Transaction.
3. IF a transaction creation or update request contains a type outside the set {income, expense}, THEN THE Transaction_Service SHALL reject the request with HTTP status 400, a validation message, and SHALL NOT persist any change.
4. IF a transaction creation or update request contains an amount that is non-numeric, less than or equal to 0, exceeds 999,999,999.99, or has more than 2 decimal places, THEN THE Transaction_Service SHALL reject the request with HTTP status 400, a validation message indicating the amount is invalid, and SHALL NOT persist any change.
5. WHEN a transaction creation request omits the date, THE Transaction_Service SHALL set the Transaction date to the time of creation.
6. WHEN a transaction update request is received for a Transaction owned by the authenticated user, THE Transaction_Service SHALL apply the changes and return the updated Transaction with HTTP status 200.
7. WHEN a transaction deletion request is received for a Transaction owned by the authenticated user, THE Transaction_Service SHALL remove the Transaction and return a success response with HTTP status 200.
8. IF a transaction update or deletion request references a Transaction that does not exist or is not owned by the authenticated user, THEN THE Transaction_Service SHALL reject the request with HTTP status 404, leave existing records unchanged, and return a message indicating the Transaction was not found.

### Requirement 10: Transaction Filtering and Summary

**User Story:** As a user, I want to filter my transactions by period and see category summaries, so that I can analyze my spending.

#### Acceptance Criteria

1. WHEN a transaction list request is received without a month or year filter, THE Transaction_Service SHALL return all transactions owned by the authenticated user ordered by date descending.
2. WHERE a transaction list request includes a month in the range 1 to 12 and a year in the range 1970 to 9999, THE Transaction_Service SHALL return only the authenticated user's transactions whose date falls within that month and year.
3. IF a transaction list request includes a month or year that is out of range, or includes only one of month and year, THEN THE Transaction_Service SHALL reject the request with HTTP status 400 and a validation message.
4. WHEN a transaction summary request is received, THE Transaction_Service SHALL return the total income amount grouped by category and the total expense amount grouped by category for the authenticated user.
5. WHILE the authenticated user has no transactions for the requested scope, THE Transaction_Service SHALL return an empty result set with HTTP status 200 and without error.

### Requirement 11: Budget Management

**User Story:** As a user, I want to set spending limits per category for a given month, so that I can control my spending.

#### Acceptance Criteria

1. WHEN a budget creation request is received with a category of 1 to 100 characters, a numeric limit greater than 0 and at most 999,999,999.99, a month in the range 1 to 12, and a year in the range 1970 to 2100, THE Budget_Service SHALL create a Budget owned by the authenticated user and return it with HTTP status 201.
2. IF a budget creation request omits the category, limit, month, or year, THEN THE Budget_Service SHALL reject the request with HTTP status 400, a validation message identifying the missing field, and SHALL NOT create the Budget.
3. IF a budget creation or update request contains a month outside the range 1 to 12 or a year outside the range 1970 to 2100, THEN THE Budget_Service SHALL reject the request with HTTP status 400, a validation message, and SHALL NOT persist any change.
4. IF a budget creation or update request contains a limit that is non-numeric, less than or equal to 0, or exceeds 999,999,999.99, THEN THE Budget_Service SHALL reject the request with HTTP status 400, a validation message indicating the limit is invalid, and SHALL NOT persist any change.
5. IF a budget creation request specifies a category, month, and year that already match an existing Budget owned by the authenticated user, THEN THE Budget_Service SHALL reject the request with HTTP status 409 and a message indicating a budget for that category and period already exists.
6. WHEN a budget update request is received for a Budget owned by the authenticated user, THE Budget_Service SHALL apply the changes subject to the same validation rules and return the updated Budget with HTTP status 200.
7. WHEN a budget deletion request is received for a Budget owned by the authenticated user, THE Budget_Service SHALL remove the Budget and return a success response with HTTP status 200.
8. IF a budget update or deletion request references a Budget that does not exist or is not owned by the authenticated user, THEN THE Budget_Service SHALL reject the request with HTTP status 404, leave existing records unchanged, and return a message indicating the Budget was not found.

### Requirement 12: Budget Spending Computation

**User Story:** As a user, I want each budget to show how much I have spent, so that I know whether I am over or under budget.

#### Acceptance Criteria

1. WHEN a budget list request is received without a month or year, THE Budget_Service SHALL return the authenticated user's budgets for the current month and year as determined by the server clock.
2. WHERE a budget list request includes a month in the range 1 to 12 and a year, THE Budget_Service SHALL return the authenticated user's budgets for that month and year.
3. WHEN the spent amount for a Budget is computed, THE Budget_Service SHALL sum the amounts of the authenticated user's expense transactions whose category matches the Budget category and whose date falls within the inclusive range from the first day to the last day of the Budget month and year.
4. WHEN a budget is returned, THE Budget_Service SHALL include the limit, the computed spent amount, the remaining amount equal to the limit minus the spent amount, and a boolean over-budget flag set to true only when the spent amount is strictly greater than the limit.
5. WHILE no matching expense transactions exist for a Budget, THE Budget_Service SHALL report a spent amount of 0 and a remaining amount equal to the limit.
6. THE Budget_Service SHALL derive the spent amount from transactions on each request and SHALL NOT rely on a separately stored spending value.

### Requirement 13: Investment Management

**User Story:** As a user, I want to record my investments, so that I can track my holdings.

#### Acceptance Criteria

1. WHEN an investment creation request is received with a type within the set {stock, crypto, mutual_fund, fd, other}, a name of 1 to 100 characters, a numeric quantity greater than 0 and at most 999,999,999.99, and a numeric buy price greater than 0 and at most 999,999,999.99, THE Investment_Service SHALL create an Investment owned by the authenticated user and return it with HTTP status 201.
2. IF an investment creation request omits the type, name, quantity, or buy price, THEN THE Investment_Service SHALL reject the request with HTTP status 400, a validation message identifying the missing field, and SHALL NOT create the Investment.
3. IF an investment creation or update request contains a type outside the allowed set, THEN THE Investment_Service SHALL reject the request with HTTP status 400, a validation message, and SHALL NOT persist any change.
4. IF an investment creation or update request contains a quantity or buy price that is non-numeric, less than or equal to 0, or exceeds 999,999,999.99, THEN THE Investment_Service SHALL reject the request with HTTP status 400, a validation message indicating the invalid field, and SHALL NOT persist any change.
5. WHEN an investment update request is received for an Investment owned by the authenticated user, THE Investment_Service SHALL apply the changes and return the updated Investment with HTTP status 200.
6. WHEN an investment deletion request is received for an Investment owned by the authenticated user, THE Investment_Service SHALL remove the Investment and return a success response with HTTP status 200.
7. IF an investment update or deletion request references an Investment that does not exist or is not owned by the authenticated user, THEN THE Investment_Service SHALL reject the request with HTTP status 404, leave existing records unchanged, and return a message indicating the Investment was not found.

### Requirement 14: Investment Pricing and Profit/Loss Summary

**User Story:** As a user, I want to see the current value and profit or loss of my investments, so that I can evaluate performance.

#### Acceptance Criteria

1. WHERE an Investment has a type of stock or crypto, THE Investment_Service SHALL retrieve the current price from the Yahoo_Finance_API using the Investment symbol, allowing at most 10 seconds for the response.
2. WHERE an Investment has a type of mutual_fund, fd, or other, THE Investment_Service SHALL use the stored current price without contacting the Yahoo_Finance_API.
3. WHEN an investment summary is computed, THE Investment_Service SHALL compute per-investment gain or loss as (current price minus buy price) multiplied by the quantity, and the gain or loss percentage as the gain or loss divided by the product of buy price and quantity multiplied by 100.
4. IF the product of buy price and quantity for an Investment equals 0, THEN THE Investment_Service SHALL report the gain or loss percentage for that Investment as 0 rather than performing a division.
5. WHEN an investment summary is returned, THE Investment_Service SHALL include the total invested amount, the total current value, and the total profit and loss equal to the total current value minus the total invested amount.
6. IF the Yahoo_Finance_API does not return a price for a requested symbol, returns an error, or does not respond within 10 seconds, THEN THE Investment_Service SHALL use the stored current price for that Investment and SHALL continue computing the summary for the remaining investments.

### Requirement 15: Goal Management and Progress

**User Story:** As a user, I want to create savings goals and track progress toward them, so that I can reach my targets.

#### Acceptance Criteria

1. WHEN a goal creation request is received with a name of 1 to 100 characters and a numeric target amount in the range 0.01 to 999,999,999.99, THE Goal_Service SHALL create a Goal owned by the authenticated user with a saved amount of 0 and return it with HTTP status 201.
2. IF a goal creation request omits the name or target amount, THEN THE Goal_Service SHALL reject the request with HTTP status 400, return a validation message identifying the missing field, and SHALL NOT create the Goal.
3. IF a goal creation request contains a target amount that is non-numeric or outside the range 0.01 to 999,999,999.99, THEN THE Goal_Service SHALL reject the request with HTTP status 400, return a validation message indicating the target amount is invalid, and SHALL NOT create the Goal.
4. WHEN a goal update request adds a numeric amount in the range 0.01 to 999,999,999.99 to the saved amount of a Goal owned by the authenticated user, THE Goal_Service SHALL increase the saved amount by the supplied amount and return the updated Goal with HTTP status 200.
5. IF a goal update request supplies an amount that is non-numeric, zero, negative, or outside the range 0.01 to 999,999,999.99, THEN THE Goal_Service SHALL reject the request with HTTP status 400, return a validation message indicating the amount is invalid, and SHALL leave the saved amount unchanged.
6. WHEN a Goal is returned, THE Goal_Service SHALL include the progress as the saved amount divided by the target amount, expressed as a decimal ratio capped at a maximum of 1.
7. WHEN a goal deletion request is received for a Goal owned by the authenticated user, THE Goal_Service SHALL remove the Goal and return a success response with HTTP status 200.

### Requirement 16: Bill Management

**User Story:** As a user, I want to record recurring and one-time bills, so that I can keep track of upcoming payments.

#### Acceptance Criteria

1. WHEN a bill creation request is received with a name of 1 to 100 characters, a numeric amount greater than 0.00 and less than or equal to 999,999,999.99 with at most 2 decimal places, a frequency within the set {monthly, weekly, yearly, one-time}, and a next due date that is a valid calendar date, THE Bill_Service SHALL create a Bill owned by the authenticated user and return it with HTTP status 201.
2. IF a bill creation request omits the name, amount, frequency, or next due date, THEN THE Bill_Service SHALL reject the request with HTTP status 400 and a validation message identifying the missing field, and SHALL NOT create the Bill.
3. IF a bill creation or update request contains a frequency outside the allowed set, THEN THE Bill_Service SHALL reject the request with HTTP status 400 and a validation message, and SHALL NOT persist any change.
4. IF a bill creation or update request contains an amount that is not numeric, is less than or equal to 0.00, exceeds 999,999,999.99, or has more than 2 decimal places, THEN THE Bill_Service SHALL reject the request with HTTP status 400 and a validation message indicating the invalid amount, and SHALL NOT persist any change.
5. WHEN a bill update request is received for a Bill owned by the authenticated user, THE Bill_Service SHALL apply the changes and return the updated Bill with HTTP status 200.
6. WHEN a bill deletion request is received for a Bill owned by the authenticated user, THE Bill_Service SHALL remove the Bill and return a success response with HTTP status 200.
7. IF a bill update or deletion request references a Bill that does not exist or is not owned by the authenticated user, THEN THE Bill_Service SHALL reject the request with HTTP status 404, SHALL NOT modify or remove any Bill, and SHALL return an error message indicating the Bill was not found.
8. WHERE a bill creation request does not specify the autopay flag, THE Bill_Service SHALL set the autopay flag to false.

### Requirement 17: Bill Payment and Due-Date Advancement

**User Story:** As a user, I want to mark a bill as paid and have its next due date advance automatically, so that recurring bills stay current.

#### Acceptance Criteria

1. WHEN a bill payment request is received for a Bill owned by the authenticated user whose frequency is monthly, weekly, or yearly, THE Bill_Service SHALL advance the next due date by one calendar month for monthly, by 7 days for weekly, or by one calendar year for yearly, and SHALL return the updated Bill with HTTP status 200.
2. WHEN a bill payment request is received for a Bill owned by the authenticated user whose frequency is one-time and whose paid flag is false, THE Bill_Service SHALL set the paid flag to true and SHALL NOT advance the next due date.
3. WHEN a recurring Bill's next due date is advanced after payment, THE Bill_Service SHALL set the paid flag to false to indicate the current cycle is settled and the next cycle is unpaid.
4. IF a bill payment request references a Bill that does not exist or is not owned by the authenticated user, THEN THE Bill_Service SHALL reject the request with HTTP status 404, SHALL NOT change any paid flag or next due date, and SHALL return an error message indicating the Bill was not found.
5. IF a bill payment request references a Bill whose frequency is one-time and whose paid flag is already true, THEN THE Bill_Service SHALL reject the request with HTTP status 400, SHALL NOT change the next due date, and SHALL return an error message indicating the bill is already paid.

### Requirement 18: AI Financial Advisor

**User Story:** As a user, I want to chat with an AI advisor that knows my finances, so that I can get personalized, actionable advice.

#### Acceptance Criteria

1. WHEN an AI chat request is received with a non-empty message of 1 to 4000 characters, THE AI_Advisor_Service SHALL assemble a financial snapshot containing the authenticated user's assets, liabilities, the 50 most recent transactions ordered by date descending, goals, and bills.
2. WHEN the financial snapshot is assembled, THE AI_Advisor_Service SHALL include the computed Net_Worth in the snapshot.
3. WHEN the snapshot is prepared, THE AI_Advisor_Service SHALL send the snapshot as system context and the user message to the Claude_API and SHALL return the Claude_API reply text to the Client.
4. IF an AI chat request omits the message or the message contains only whitespace, THEN THE AI_Advisor_Service SHALL reject the request with HTTP status 400 and a validation message indicating that a non-empty message is required, and SHALL NOT call the Claude_API.
5. IF an AI chat request contains a message exceeding 4000 characters, THEN THE AI_Advisor_Service SHALL reject the request with HTTP status 400 and a validation message indicating the maximum message length, and SHALL NOT call the Claude_API.
6. IF the Claude_API request fails or does not respond within 30 seconds, THEN THE AI_Advisor_Service SHALL return an error response through the Error_Handler indicating that advice could not be generated and SHALL NOT expose the Claude API key in the response.
7. THE AI_Advisor_Service SHALL include in the snapshot only financial data whose Owning_User is the authenticated user and SHALL NOT persist the chat conversation in the database.

### Requirement 19: Multi-Currency Support

**User Story:** As a user, I want amounts shown in my chosen currency, so that the figures are meaningful to me.

#### Acceptance Criteria

1. WHERE a User has not selected a display currency, THE System SHALL use INR as the default display currency.
2. WHEN a monetary amount stored in one currency must be displayed in a different currency, THE System SHALL convert the amount using a rate retrieved from the ExchangeRate_API and SHALL round the converted amount to 2 decimal places.
3. IF the ExchangeRate_API does not return a conversion rate within 5 seconds of the request, THEN THE System SHALL display the amount in its stored currency and SHALL display an indication that conversion was unavailable.
4. WHEN a User selects a display currency, THE System SHALL persist the selected currency and SHALL apply it to all subsequently displayed monetary amounts for that User.

### Requirement 20: Uniform Error Handling

**User Story:** As a user, I want errors to be reported clearly, so that I understand what went wrong instead of facing a crash.

#### Acceptance Criteria

1. WHEN a controller passes a thrown error to the Error_Handler, THE Error_Handler SHALL return a JSON response containing a non-empty message field that describes the error.
2. IF a controller passes a thrown error to the Error_Handler and no specific HTTP status code was set on the error, THEN THE Error_Handler SHALL return the response with HTTP status code 500.
3. WHERE the server runs outside production, THE Error_Handler SHALL include the error stack trace in the response.
4. WHERE the server runs in production, THE Error_Handler SHALL exclude the error stack trace from the response.
5. WHEN a Mongoose validation error occurs, THE API_Server SHALL return a JSON response containing a non-empty message field and HTTP status code 400.

### Requirement 21: Client Session and Token Handling

**User Story:** As a user, I want the application to manage my session, so that I stay logged in until my token expires and am redirected to login when it does.

#### Acceptance Criteria

1. WHEN the Client receives a JWT after registration or login, THE Client SHALL store the token in browser local storage under a single designated key, replacing any previously stored token.
2. WHEN the Client issues a request to a Protected_Route AND a stored token exists, THE Client SHALL attach the stored token as a Bearer token in the Authorization header.
3. IF the Client receives an HTTP status 401 from any request, THEN THE Client SHALL remove the stored token, redirect the user to the login page within 2 seconds, and display a message indicating the session has expired.
4. WHEN the user activates the logout control, THE Client SHALL remove the stored token from local storage and redirect the user to the login page within 2 seconds.
5. THE Client SHALL store only the JWT in local storage and SHALL NOT store any other user data, including password, email, or profile fields, in local storage.
6. IF the Client attempts to access a Protected_Route AND no token exists in local storage, THEN THE Client SHALL redirect the user to the login page within 2 seconds without issuing the protected request.

### Requirement 22: API Security Hardening

**User Story:** As a user, I want the backend to apply security best practices, so that the service and my data are protected.

#### Acceptance Criteria

1. THE API_Server SHALL load all secrets, including the database connection string, JWT secret, and external API keys, from environment variables and SHALL NOT embed them in source code.
2. WHEN the API_Server starts AND any required secret is absent from the environment variables, THE API_Server SHALL halt startup and SHALL NOT serve any request.
3. WHEN the API_Server receives a cross-origin request, THE API_Server SHALL permit the request only if its origin matches the configured Client origin, and SHALL reject requests from all other origins.
4. THE API_Server SHALL include security-related HTTP response headers, covering at minimum content-type-options, frame-options, and strict-transport-security, on every response.
5. WHILE a single client identifier exceeds 100 requests within any 60-second window, THE API_Server SHALL reject further requests from that client with HTTP status 429 until the window resets.
6. WHEN any endpoint that creates or updates a record receives input, THE API_Server SHALL validate the input against the defined field types, required fields, and length bounds on the server before writing to the database.
7. IF server-side input validation fails, THEN THE API_Server SHALL reject the request with HTTP status 400, return an error response indicating which fields are invalid, and SHALL NOT write any data to the database.
8. THE API_Server SHALL exclude the password field from every response that includes User data.
