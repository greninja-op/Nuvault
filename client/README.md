# Nuvault Client

The Nuvault client is a React (Vite + Tailwind) single-page application that
talks to the Nuvault REST API. It owns the JWT, attaches it as a Bearer token
on every protected request, and reacts to `401` responses by clearing the
session and redirecting to the login page.

## Scripts

```bash
npm install        # install dependencies
npm run dev        # start the Vite dev server on http://localhost:5173
npm test           # run the Vitest suite once (jsdom + RTL)
npm run build      # production build into ./dist
npm run preview    # serve the production build locally
```

## Configuration

Set `VITE_API_URL` in a `.env` file (or via the environment) to point at the
running Nuvault API. When unset, the client uses the relative path `/api` so
it can be served from the same origin as the API in production.

```
VITE_API_URL=http://localhost:5000/api
```

## Session model

- The JWT is stored in `localStorage` under the single key `nuvault.token`
  and is the only piece of user data persisted client-side.
- The Axios instance in `src/api/client.js` attaches the token on every
  request and, on a `401` response, clears the token, dispatches a
  `nuvault:session-expired` event, and redirects to `/login` within 2s.
- `ProtectedRoute` in `src/auth/ProtectedRoute.jsx` redirects to `/login`
  whenever no token is present.
