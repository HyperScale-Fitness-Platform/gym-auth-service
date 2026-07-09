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
| Model | `src/models/user.model.js` | Data access only. Currently an in-memory array — swap for real Postgres queries later without changing its function signatures. |

Request flow for a login: `index.js` → `auth.routes.js` → `auth.controller.js`
→ `auth.service.js` → `user.model.js` (to look up the user) → back up the
chain to a JSON response.

## Endpoints

- `POST /auth/register` — `{ email, password, role }` → creates an account
- `POST /auth/login` — `{ email, password }` → returns `{ token }`
- `POST /auth/verify` — `{ token }` → returns `{ valid, decoded }`, used by the API gateway
- `GET /health` — liveness/readiness check

## Local development

```bash
npm install
cp .env.example .env
npm run dev
```

Runs on `http://localhost:4000`.

### Manual test sequence

```bash
curl -X POST http://localhost:4000/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"test@test.com","password":"secret123","role":"customer"}'

curl -X POST http://localhost:4000/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"test@test.com","password":"secret123"}'
# copy the returned token

curl -X POST http://localhost:4000/auth/verify \
  -H "Content-Type: application/json" \
  -d '{"token":"PASTE_TOKEN_HERE"}'
```

## Running in the local kind cluster

```bash
docker build -t gym-auth-service:dev .
kind load docker-image gym-auth-service:dev --name gym-dev
kubectl apply -f k8s/deployment.yaml
```

This service uses `ClusterIP` (not `NodePort`) — it is intentionally
**not** reachable directly from your laptop once deployed to the cluster.
Only the gateway talks to it. To test it directly anyway while debugging:

```bash
kubectl port-forward svc/auth-service 4000:4000
```

## Notes / TODO before this is production-shaped

- Replace `src/models/user.model.js`'s in-memory array with real
  Postgres-backed queries. Keep the same function names
  (`findByEmail`, `findById`, `create`) so nothing else needs to change.
- Move `JWT_SECRET` out of the k8s Secret YAML and into AWS Secrets
  Manager / SSM Parameter Store once deployed to EKS.
- Add refresh tokens if 1-hour access tokens prove too short for the
  mobile app's needs.
