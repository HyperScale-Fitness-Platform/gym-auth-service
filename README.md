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
  is_active BOOLEAN NOT NULL DEFAULT false,
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

The database is its own dedicated Postgres instance, defined in
`k8s/dev/database/`, separate from this service's own app manifests in
`k8s/dev/`. 

### Order matters

The database must exist and be reachable **before** the app deployment is
applied, since the app connects to it on startup. Follow this exact order
on a fresh cluster:

```bash
cd gym-auth-service

# 1. bring up the database
kubectl apply -f k8s/dev/database/secret.yaml
kubectl apply -f k8s/dev/database/pvc.yaml
kubectl apply -f k8s/dev/database/deployment.yaml
kubectl apply -f k8s/dev/database/service.yaml

# wait until the postgres pod shows Running before continuing
kubectl get pods -n gym-dev -w
# Ctrl+C once auth-postgres-xxxxxxxx-xxxxx is Running

# 2. create the users table inside the fresh database
kubectl exec -it deployment/auth-postgres -n gym-dev -- \
  psql -U $(kubectl get secret auth-postgres-credentials -n gym-dev -o jsonpath='{.data.POSTGRES_USER}' | base64 -d) \
  -d auth_db
```

Paste this schema once connected, then `\q` to exit:
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

```bash
# 4. build and load the app image
docker build -t gym-auth-service:dev .
kind load docker-image gym-auth-service:dev --name gym-dev

# 5. apply the app's own config, secret, deployment, service
kubectl apply -f k8s/dev/configmap.yaml
kubectl apply -f k8s/dev/secret.yaml
kubectl apply -f k8s/dev/deployment.yaml
kubectl apply -f k8s/dev/service.yaml

# 6. confirm both the app and its database are running
kubectl get pods -n gym-dev
```

### Testing it through the gateway

```bash
curl -X POST http://localhost:8080/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"test@test.com","password":"secret123","role":"customer","phone":"01000000000"}'
```

A successful JSON response confirms the full chain is working: your
laptop → gateway pod (NodePort) → auth-service pod (ClusterIP, internal
DNS) → auth-postgres pod (ClusterIP, internal DNS).

### Applying changes after editing any k8s YAML

Editing a `.yaml` file on disk changes nothing in the cluster by itself.
`kubectl apply -f <file>` is what actually pushes a change in.
`kubectl rollout restart` only restarts a pod using whatever spec was
**already applied** — it does not re-read your files. After any change to
`configmap.yaml`, `secret.yaml`, or `deployment.yaml`:

```bash
kubectl apply -f k8s/dev/configmap.yaml
kubectl apply -f k8s/dev/secret.yaml
kubectl apply -f k8s/dev/deployment.yaml
kubectl rollout restart deployment/auth-service -n gym-dev
```

### Debugging checklist

```bash
kubectl get pods -n gym-dev                                   # is everything Running?
kubectl logs deployment/auth-service -n gym-dev                # app-level errors
kubectl logs deployment/auth-postgres -n gym-dev                # database-level errors
kubectl describe pod <pod-name> -n gym-dev                       # image pull errors, missing secrets, failed probes
kubectl get secrets -n gym-dev                                   # does auth-postgres-credentials actually exist?
kubectl exec -it deployment/auth-service -n gym-dev -- env | grep -E "DB_|JWT"   # are the expected env vars actually set inside the pod?
kubectl get deployment auth-service -n gym-dev -o yaml | grep -A 30 "env:"        # does the LIVE cluster spec match your local file?
```

Common causes, in order of likelihood if something fails after a fresh
setup:
1. `auth-postgres-credentials` secret wasn't generated before the database
   Deployment was applied (fixed by re-running the generator script, then
   deleting the crash-looping pod so it retries).
2. A YAML edit was made locally but never actually `kubectl apply`'d — the
   cluster is still running an older spec.
3. Stale PVC data from an earlier failed attempt — Postgres only runs its
   `POSTGRES_DB` init logic on a genuinely empty data directory. If the
   database name looks wrong, delete both the Deployment and PVC and
   recreate from scratch (this wipes local dev data, which is fine here).

### Notes

- When running inside the cluster, database connection details come from
  `auth-postgres-credentials` (username/password) and
  `auth-service-config` (host/port) — never a single `DATABASE_URL`
  string, so credentials are never duplicated across multiple Secrets.
- Once deployed to AWS/EKS, `auth-postgres` (the in-cluster Postgres pod)
  gets replaced with a real AWS RDS endpoint — only the `DB_HOST` value
  changes; the app code and the shape of these manifests stay the same.
