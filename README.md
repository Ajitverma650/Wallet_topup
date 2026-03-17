# Wallet Top-up Payment System

A production-grade backend service built with NestJS that allows users to add money to their wallet using UPI payment simulation. Built with ACID transactions, idempotent webhook handling, Redis caching, and race condition protection.

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | NestJS (TypeScript) |
| Database | PostgreSQL (Neon.tech) |
| Cache | Redis |
| ORM | TypeORM |
| Validation | class-validator |
| QR Code | qrcode |
| Hosting | Render |

---

## Features

- Create wallet top-up requests with crypto-secure unique IDs
- Initiate UPI payment with real scannable QR code and payment deep-link
- Handle payment webhooks with **idempotent processing** + **pessimistic DB locking** to prevent race conditions
- **ACID transactions** on all multi-table DB operations — full rollback on failure
- **Atomic balance increment** — `balance = balance + X` in SQL, no read-modify-write race condition
- Fetch wallet balance with **Redis caching + cache invalidation**
- Poll top-up status with full lifecycle tracking (`pending → initiated → success/failed`)
- **Transaction expiry** — UPI links expire after 10 minutes, stale webhooks rejected
- **Global exception filter** — consistent JSON error responses, no stack trace leaks
- **DB indexes** on all lookup columns for fast queries at scale
- Input validation on all endpoints via DTOs + ValidationPipe
- Environment-based `synchronize` — auto-sync in dev,will make disabled in production

---

## Project Structure

```
src/
├── wallet/
│   ├── wallet.controller.ts       # Routes for wallet APIs
│   ├── wallet.service.ts          # Business logic + ACID transactions
│   ├── wallet.module.ts           # Feature module
│   └── dto/
│       ├── create-topup.dto.ts
│       └── initiate-topup.dto.ts
├── payments/
│   ├── payments.controller.ts     # Webhook route
│   ├── payments.service.ts        # Webhook logic + pessimistic locking
│   ├── payments.module.ts
│   └── dto/
│       └── webhook.dto.ts
├── database/
│   └── entities/
│       ├── wallet.entity.ts
│       ├── wallet-topup.entity.ts
│       └── transaction.entity.ts
├── filters/
│   └── http-exception.filter.ts   # Global exception filter
├── app.module.ts                  # Root module (DB + Redis config)
└── main.ts                        # Entry point
```

---

## Prerequisites

- Node.js v18+
- npm
- A [Neon.tech](https://neon.tech) account (free PostgreSQL)
- An [Upstash](https://redis.com) account (free Redis)

---

## Local Setup

### 1. Clone the repository

```bash
git clone https://github.com/YOUR_USERNAME/wallet-topup-service.git
cd WALLET_TOPUP
```

### 2. Install dependencies

```bash
npm install
```

### 3. Create environment file

Create a `.env` file in the project root:

```env
DATABASE_URL=postgresql://your-neon-connection-string?sslmode=require
REDIS_URL=rediss://default:your-password@your-endpoint.redis.io:6379
PORT=3000

```

**Getting your credentials:**
- `DATABASE_URL` → [Neon.tech](https://neon.tech) dashboard → Connection Details → copy the connection string
- `REDIS_URL` → [Upstash](https://redis.com) dashboard → your database → copy the Redis URL

### 4. Run the development server

```bash
npm run start:dev
```

The server starts on `http://localhost:3000`

On first run, TypeORM automatically creates these tables in your Neon database:
- `wallets`
- `wallet_topups`
- `transactions`

---

## API Documentation

### Base URL
```
# Local
http://localhost:3000

# Production
https://wallet-topup.onrender.com
```

---

### 1. Create Wallet Top-up Request

Creates a new top-up request and returns a unique `topup_id`. Auto-creates a wallet for the user if one does not exist.

**Endpoint**
```
POST /wallet/topup
```

**Request Body**
```json
{
  "user_id": "U123",
  "amount": 500
}
```

**Success Response** `201`
```json
{
  "topup_id": "TUP-1742142675123-A1B2C3D4",
  "user_id": "U123",
  "amount": "500.00",
  "status": "pending"
}
```

**Validation Error** `400`
```json
{
  "statusCode": 400,
  "message": ["amount must be a positive number"],
  "error": "BAD_REQUEST",
  "timestamp": "2026-03-17T10:00:00.000Z",
  "path": "/wallet/topup"
}
```

---

### 2. Initiate Payment

Takes a `topup_id` and generates a real scannable UPI QR code and payment deep-link. Updates topup status to `initiated`. Sets a 10-minute expiry on the transaction.

**Endpoint**
```
POST /wallet/topup/initiate
```

**Request Body**
```json
{
  "topup_id": "TUP-1742142675123-A1B2C3D4"
}
```

**Success Response** `201`
```json
{
  "transaction_id": "TXN-1742142675456-B2E8A1C9F3D50714",
  "payment_link": "upi://pay?pa=wallet@upi&pn=WalletApp&am=500.00&tn=TXN-...&cu=INR",
  "qr_code": "<..qr image",
  "status": "pending"
}
```

**Notes:**
- `qr_code` is  string 
- Transaction expires after 10 minutes — webhook rejected after expiry
- Both the transaction save and topup status update happen in a single ACID transaction — both succeed or both roll back

**Error Response** `404` — topup_id not found

**Error Response** `400` — topup already initiated

---

### 3. Payment Webhook

Called by the payment provider when payment status changes. Implements **3-layer idempotency** to handle duplicate webhooks and concurrent double-clicks safely.

**Endpoint**
```
POST /payments/webhook
```

**Request Body**
```json
{
  "transaction_id": "TXN-1742142675456-B2E8A1C9F3D50714",
  "payment_status": "success"
}
```

`payment_status` accepts: `"success"` or `"failed"`

**Success Response** `201`
```json
{
  "message": "Payment success — wallet updated",
  "transaction_id": "TXN-1742142675456-B2E8A1C9F3D50714",
  "payment_status": "success"
}
```

**Duplicate Webhook Response** `201`
```json
{
  "message": "Webhook already processed — skipping",
  "transaction_id": "TXN-1742142675456-B2E8A1C9F3D50714",
  "payment_status": "success"
}
```

**Expired Transaction Response** `400`
```json
{
  "statusCode": 400,
  "message": "Payment link expired — please create a new topup request"
}
```

**Idempotency layers:**
1. `processed` boolean flag — sequential duplicate protection
2. Pessimistic DB lock (`SELECT FOR UPDATE`) — concurrent race condition protection
3. Atomic SQL balance increment (`balance = balance + X`) — mathematical safety net

**ACID behaviour:**
- All writes (balance update + topup status + transaction processed flag) commit together or roll back together
- Redis cache invalidated after successful commit — outside transaction so cache failure never affects the payment

---

### 4. Get Wallet Balance

Fetches the current wallet balance for a user. Cached in Redis for 60 seconds.

**Endpoint**
```
GET /wallet/:user_id
```

**Example**
```
GET /wallet/U123
```

**First request** `200` — fetches from PostgreSQL:
```json
{
  "user_id": "U123",
  "wallet_balance": "500.00",
  "source": "database"
}
```

**Subsequent requests within 60s** `200` — served from Redis:
```json
{
  "user_id": "U123",
  "wallet_balance": "500.00",
  "source": "cache"
}
```

**Cache behaviour:**
- First request → queries PostgreSQL, stores in Redis with 60s TTL
- Subsequent requests within 60s → served from Redis (~1ms vs ~100ms)
- After successful webhook → cache key deleted, next request fetches fresh data

**Error Response** `404` — wallet not found for user

---

### 5. Get Top-up Status

Returns the current status of a top-up request. Used by the frontend to poll every 10 seconds.

**Endpoint**
```
GET /wallet/topup/:topup_id
```

**Example**
```
GET /wallet/topup/TUP-1742142675123-A1B2C3D4
```

**Success Response** `200`
```json
{
  "topup_id": "TUP-1742142675123-A1B2C3D4",
  "status": "success",
  "transaction_id": "TXN-1742142675456-B2E8A1C9F3D50714"
}
```

**Status lifecycle:**

| Status | Meaning |
|--------|---------|
| `pending` | Topup created, initiate not called yet |
| `initiated` | Payment link generated, waiting for user to pay |
| `success` | Payment received, wallet credited |
| `failed` | Payment failed or rejected |

`transaction_id` is `null` if initiate has not been called yet.

**Error Response** `404` — topup_id not found

---

## Complete Payment Flow

Run these 7 requests in order to simulate a full payment cycle:

```
1. POST /wallet/topup
   Body: { "user_id": "U123", "amount": 500 }
   → save topup_id from response

2. POST /wallet/topup/initiate
   Body: { "topup_id": "<topup_id from step 1>" }
   → save transaction_id from response
   → topup status is now "initiated"

3. GET /wallet/topup/<topup_id>
   → status: "initiated"

4. POST /payments/webhook
   Body: { "transaction_id": "<txn_id from step 2>", "payment_status": "success" }
   → wallet balance updated, topup status "success"

5. POST /payments/webhook  (same body again)
   → "Webhook already processed — skipping"  ← idempotency confirmed

6. GET /wallet/topup/<topup_id>
   → status: "success"

7. GET /wallet/U123
   → source: "database" on first call, source: "cache" on second call
```

---

## Environment Variables

| Variable | Description | Dev | Prod |
|----------|-------------|-----|------|
| `DATABASE_URL` | Neon PostgreSQL connection string | your neon URL | your neon URL |
| `REDIS_URL` | Upstash Redis URL | your upstash URL | your upstash URL |
| `PORT` | Server port | `3000` | `10000` |
| `DB_SYNC` | Auto-sync DB schema | `true` | `false` |
---

## Database Schema

### wallets
| Column | Type | Description |
|--------|------|-------------|
| id | integer | Primary key |
| user_id | varchar | Unique user identifier — indexed |
| balance | decimal(10,2) | Current wallet balance |
| created_at | timestamp | Auto-generated |
| updated_at | timestamp | Auto-updated |

### wallet_topups
| Column | Type | Description |
|--------|------|-------------|
| id | integer | Primary key |
| topup_id | varchar | Unique topup ID (TUP-timestamp-random) — indexed |
| user_id | varchar | User who initiated the topup — indexed |
| amount | decimal(10,2) | Top-up amount |
| status | varchar | pending / initiated / success / failed |
| created_at | timestamp | Auto-generated |
| updated_at | timestamp | Auto-updated |

### transactions
| Column | Type | Description |
|--------|------|-------------|
| id | integer | Primary key |
| transaction_id | varchar | Unique transaction ID (TXN-timestamp-random) — indexed |
| topup_id | varchar | Linked topup request — indexed |
| payment_link | varchar | UPI deep-link URL |
| payment_status | varchar | pending / success / failed |
| processed | boolean | Idempotency flag — set true after successful processing |
| expires_at | timestamp | Transaction expiry (10 minutes from creation) |
| created_at | timestamp | Auto-generated |
| updated_at | timestamp | Auto-updated |

---

## Postman Collection

Import `wallet-topup-collection.json` from the project root into Postman to get all 5 pre-configured requests with correct URLs and sample request bodies.

---

## Deployment (Render)

1. Push code to GitHub
2. Go to [render.com](https://render.com) → New Web Service → connect your repo
3. Set build command: `npm install && npm run build`
4. Set start command: `npm run start:prod`
5. Add environment variables in the Render dashboard:

| Variable | Value |
|----------|-------|
| `DATABASE_URL` | Your Neon connection string |
| `REDIS_URL` | Your Upstash Redis URL |
| `PORT` | `10000` |
| 

---

## Production Features Implemented

| Feature | How |
|---------|-----|
| **ACID transactions** | TypeORM `queryRunner` — commit together or rollback together on all multi-table writes |
| **Pessimistic row locking** | `SELECT FOR UPDATE` on webhook row — concurrent requests serialised at DB level |
| **Atomic balance increment** | `SET balance = balance + X` in SQL — no read-modify-write race condition |
| **Idempotent webhooks** | `processed` boolean flag — duplicate webhooks skipped, balance never double-credited |
| **Transaction expiry** | `expires_at` timestamp — stale webhooks rejected after 10 minutes |
| **Redis caching** | Balance cached 60s TTL — auto-invalidated after successful payment |
| **Cache outside transaction** | Redis invalidation runs after DB commit — cache failure never rolls back a payment |
| **Crypto-secure IDs** | `timestamp + crypto.randomBytes(8)` — collision-resistant, traceable unique IDs |
| **DB indexes** | `@Index()` on all WHERE clause columns — fast lookups at scale |
| **Global exception filter** | Consistent 5-field JSON error response — no stack traces exposed to clients |
| **Input validation** | DTOs + `class-validator` + global `ValidationPipe` on all endpoints |
| **Real QR code** | qr generated from UPI deep-link — scannable by GPay, PhonePe, Paytm |
| **Topup status lifecycle** | `pending → initiated → success/failed` — granular state tracking |