# Auth Service

Handles account creation, login, and JWT issuance/verification for the
whole platform. This is the only service that knows the JWT signing
secret — every other service trusts identity headers forwarded by the
gateway rather than verifying tokens themselves.

## Structure (MVC)

| Layer | File | Responsibility |
|---|---|---|
| Route | `src/routes/auth.routes.js` | Maps URL + method to a controller function. No logic. |
| Controller | `src/controllers/auth.controller.js` | Reads the HTTP request, calls the service, sends the response. No business logic. |
| Service | `src/services/auth.service.js` | All actual business logic: password hashing, JWT creation/verification. |
| Model | `src/models/user.model.js` | Data access only — real SQL against Postgres via the raw `pg` driver. |
| Config | `src/config/database.js` | Creates the shared Postgres connection pool used by the model layer. |

Request flow for a login: `index.js` → `auth.routes.js` → `auth.controller.js`
→ `auth.service.js` → `user.model.js` (real SQL query against Postgres) →
back up the chain to a JSON response.

## Database

**Engine:** PostgreSQL, accessed via the raw `pg` driver (no ORM, no query
builder — plain SQL, since this service is a single flat `users` table with
no relations to other tables).

**Schema:**

```sql
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email VARCHAR(255) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  role VARCHAR(50) NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  phone VARCHAR(20),
  created_at TIMESTAMP NOT NULL DEFAULT now()
);
```

Notes on the schema:
- `id` is generated automatically by Postgres (`gen_random_uuid()`) — the
  application no longer generates its own UUIDs.
- `email UNIQUE NOT NULL` enforces no-duplicate-emails at the database
  level, even under concurrent registration attempts.
- Column names are `snake_case` (Postgres convention) — code that reads a
  row back uses `user.password_hash`, not `user.passwordHash`.

## Endpoints

- `POST /auth/register` — `{ email, password, role, phone }` → creates an account
- `POST /auth/login` — `{ email, password }` → returns `{ token }`
- `POST /auth/verify` — `{ token }` → returns `{ valid, decoded }`, used by the API gateway
- `GET /health` — liveness/readiness check

## Local development

### 1. Install dependencies

```bash
npm install
```

### 2. Start Postgres (a plain Docker container on your laptop — no Kubernetes needed for this)

```bash
docker run --name gym-postgres \
  -e POSTGRES_PASSWORD=devpass \
  -e POSTGRES_DB=gym_auth \
  -p 5432:5432 \
  -d postgres:16
```

Confirm it's running:
```bash
docker ps
```

If you ever need to stop/restart it later:
```bash
docker stop gym-postgres
docker start gym-postgres
```

### 3. Create the table (one-time, or after a fresh container)

```bash
docker exec -it gym-postgres psql -U postgres -d gym_auth
```

Paste the schema from the **Database** section above, then `\q` to exit.

### 4. Set up environment variables

```bash
cp .env.example .env
```

Confirm `.env` contains:
```
PORT=4000
JWT_SECRET=dev-secret-change-me
JWT_EXPIRY=1h
DATABASE_URL=postgresql://postgres:devpass@localhost:5432/gym_auth
SALT_ROUNDS=10
```

### 5. Start the service

```bash
npm run dev
```

Runs on `http://localhost:4000`.


### 6. Manual test sequence

```bash
curl -X POST http://localhost:4000/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"test@test.com","password":"secret123","role":"customer","phone":"01000000000"}'

curl -X POST http://localhost:4000/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"test@test.com","password":"secret123"}'
# copy the returned token

curl -X POST http://localhost:4000/auth/verify \
  -H "Content-Type: application/json" \
  -d '{"token":"PASTE_TOKEN_HERE"}'
```

### 7. Confirm the data actually landed in Postgres

```bash
docker exec -it gym-postgres psql -U postgres -d gym_auth \
  -c "SELECT id, email, role, phone, is_active, created_at FROM users;"
```

## Running in the local kind cluster

This service uses `ClusterIP` (not `NodePort`) — it is intentionally
**not** reachable directly from your laptop once deployed to the cluster.
Only the gateway talks to it.

```bash
docker build -t gym-auth-service:dev .
kind load docker-image gym-auth-service:dev --name gym-dev
kubectl apply -f k8s/deployment.yaml
```

To test it directly anyway while debugging:
```bash
kubectl port-forward svc/auth-service 4000:4000
```

**Note:** when running inside the cluster, `DATABASE_URL` needs to point at
wherever Postgres is actually reachable from inside Kubernetes — either a
Postgres pod/service running in-cluster, or (once on AWS) an RDS endpoint.
Update the `DATABASE_URL` value in `k8s/deployment.yaml`'s env vars
accordingly; the value in your local `.env` only applies when running
directly on your laptop via `npm run dev`.

## Debugging checklist

If you hit connection or auth errors when starting the service, check in
this order:

1. Is Postgres actually running? `docker ps` should show `gym-postgres`.
2. Is `.env` actually being loaded before anything reads `process.env`?
   `dotenv.config()` must be the very first line executed in `index.js` —
   before any other `require`, since those cascade down into
   `config/database.js`, which reads `DATABASE_URL` the moment it's loaded.
3. Are numeric env values being parsed? Anything from `process.env` is
   always a string — `SALT_ROUNDS` must be converted with
   `parseInt(process.env.SALT_ROUNDS, 10)`, not used as-is.
4. Does the `users` table actually exist? Reconnect with `psql` (step 3
   above) and run `\dt` to list tables.

## Notes / TODO before this is production-shaped

- Move `JWT_SECRET` and `DATABASE_URL` out of the k8s Secret YAML and into
  AWS Secrets Manager / SSM Parameter Store once deployed to EKS, and swap
  the local Postgres container for AWS RDS in production.
- Add refresh tokens if 1-hour access tokens prove too short for the
  mobile app's needs.