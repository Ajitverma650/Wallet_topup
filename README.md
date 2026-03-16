# Wallet Top-up Payment System

A backend service built with NestJS that allows users to add money to their wallet using UPI payment simulation.

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | NestJS (TypeScript) |
| Database | PostgreSQL (Neon.tech) |
| Cache | Redis (Upstash) |
| ORM | TypeORM |
| Validation | class-validator |
| Hosting | Render |

---

## Features

- Create wallet top-up requests
- Initiate UPI payment with payment link and QR code
- Handle payment webhooks with **idempotent processing**
- Fetch wallet balance with **Redis caching + cache invalidation**
- Poll top-up status
- Input validation on all endpoints via DTOs
- Auto-created PostgreSQL tables via TypeORM sync

---

## Project Structure

```
src/
├── wallet/
│   ├── wallet.controller.ts     # Routes for wallet APIs
│   ├── wallet.service.ts        # Business logic
│   ├── wallet.module.ts         # Feature module
│   └── dto/
│       ├── create-topup.dto.ts
│       └── initiate-topup.dto.ts
├── payments/
│   ├── payments.controller.ts   # Webhook route
│   ├── payments.service.ts      # Webhook logic
│   ├── payments.module.ts
│   └── dto/
│       └── webhook.dto.ts
├── database/
│   └── entities/
│       ├── wallet.entity.ts
│       ├── wallet-topup.entity.ts
│       └── transaction.entity.ts
├── app.module.ts                # Root module (DB + Redis config)
└── main.ts                      # Entry point
```

---

## Prerequisites

- Node.js v18+
- npm
- A [Neon.tech](https://neon.tech) account (free PostgreSQL)
- An [redis](https://redis.com) account (free Redis)

---

## Local Setup

### 1. Clone the repository

```bash
git clone https://github.com/YOUR_USERNAME/wallet-topup-service.git
cd wallet-topup-service
```

### 2. Install dependencies

```bash
npm install
```

### 3. Create environment file

Create a `.env` file in the project root:

```env
DATABASE_URL=postgresql://your-neon-connection-string?sslmode=require
REDIS_URL=rediss://default:your-password@your-endpoint.upstash.io:6379
PORT=3000
```

**Getting your credentials:**
- `DATABASE_URL` → [Neon.tech](https://neon.tech) dashboard → Connection Details → copy the connection string
- `REDIS_URL` → [redis](https://redis.com) dashboard → your database → copy the Redis URL

### 4. Run the development server

```bash
npm run start:dev
```

The server starts on `http://localhost:3000`

On first run, TypeORM automatically creates these tables in your database:
- `wallets`
- `wallet_topups`
- `transactions`

---

## API Documentation

### Base URL
```
http://localhost:3000
```

---

### 1. Create Wallet Top-up Request

Creates a new top-up request and returns a unique `topup_id`.

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
  "topup_id": "TUPA1B2C3D4E5",
  "user_id": "U123",
  "amount": "500.00",
  "status": "pending"
}
```

**Validation Errors** `400`
```json
{
  "message": ["amount must be a positive number"],
  "error": "Bad Request",
  "statusCode": 400
}
```

---

### 2. Initiate Payment

Takes a `topup_id` and generates a UPI payment link and QR code.

**Endpoint**
```
POST /wallet/topup/initiate
```

**Request Body**
```json
{
  "topup_id": "TUPA1B2C3D4E5"
}
```

**Success Response** `201`
```json
{
  "transaction_id": "TXNB3C4D5E6F7",
  "payment_link": "upi://pay?pa=wallet@upi&pn=WalletApp&am=500.00&tn=TXNB3C4D5E6F7&cu=INR",
  "qr_code": "dXBpOi8vcGF5P3BhPXdhbGxldEB1cGk...",
  "status": "pending"
}
```

**Error Response** `404` — topup_id not found

**Error Response** `400` — topup already initiated

---

### 3. Payment Webhook

Called by the payment provider when payment status changes. Implements **idempotent processing** — duplicate webhooks are safely ignored.

**Endpoint**
```
POST /payments/webhook
```

**Request Body**
```json
{
  "transaction_id": "TXNB3C4D5E6F7",
  "payment_status": "success"
}
```

`payment_status` accepts: `"success"` or `"failed"`

**Success Response** `201`
```json
{
  "message": "Payment success — wallet updated",
  "transaction_id": "TXNB3C4D5E6F7",
  "payment_status": "success"
}
```

**Duplicate Webhook Response** `201`
```json
{
  "message": "Webhook already processed — skipping",
  "transaction_id": "TXNB3C4D5E6F7",
  "payment_status": "success"
}
```

**Behaviour:**
- `success` → adds amount to wallet balance, updates topup status to `success`, invalidates Redis cache
- `failed` → updates topup status to `failed`, no balance change
- Duplicate webhooks → returns early without any DB changes

---

### 4. Get Wallet Balance

Fetches the current wallet balance for a user. **Cached in Redis for 60 seconds.**

**Endpoint**
```
GET /wallet/:user_id
```

**Example**
```
GET /wallet/U123
```

**Success Response** `200`
```json
{
  "user_id": "U123",
  "wallet_balance": "500.00",
  "source": "database"
}
```

On subsequent requests within 60 seconds:
```json
{
  "user_id": "U123",
  "wallet_balance": "500.00",
  "source": "cache"
}
```

**Cache Behaviour:**
- First request → queries PostgreSQL, stores result in Redis with 60s TTL
- Subsequent requests → served from Redis (faster)
- After successful payment webhook → cache is invalidated, next request fetches fresh data

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
GET /wallet/topup/TUPA1B2C3D4E5
```

**Success Response** `200`
```json
{
  "topup_id": "TUPA1B2C3D4E5",
  "status": "success",
  "transaction_id": "TXNB3C4D5E6F7"
}
```

**Status values:** `pending` | `success` | `failed`

`transaction_id` is `null` if payment has not been initiated yet.

**Error Response** `404` — topup_id not found

---

## Complete Payment Flow

Run these requests in order to simulate a full payment cycle:

```
1. POST /wallet/topup
   → get topup_id

2. POST /wallet/topup/initiate  (use topup_id from step 1)
   → get transaction_id + payment_link + qr_code

3. GET  /wallet/topup/:topup_id
   → status: "pending"

4. POST /payments/webhook  (use transaction_id from step 2)
   → payment processed, wallet balance updated

5. GET  /wallet/topup/:topup_id
   → status: "success"

6. GET  /wallet/U123
   → wallet_balance updated
```

---

## Environment Variables

| Variable | Description | Example |
|----------|-------------|---------|
| `DATABASE_URL` | Neon PostgreSQL connection string | `postgresql://user:pass@host/db?sslmode=require` |
| `REDIS_URL` |  Redis connection URL | `rediss://default:pass@host:6379` |
| `PORT` | Server port | `3000` |

---

## Database Schema

### wallets
| Column | Type | Description |
|--------|------|-------------|
| id | integer | Primary key |
| user_id | varchar | Unique user identifier |
| balance | decimal(10,2) | Current wallet balance |
| created_at | timestamp | Auto-generated |
| updated_at | timestamp | Auto-updated |

### wallet_topups
| Column | Type | Description |
|--------|------|-------------|
| id | integer | Primary key |
| topup_id | varchar | Unique topup identifier (TUP prefix) |
| user_id | varchar | User who initiated the topup |
| amount | decimal(10,2) | Top-up amount |
| status | varchar | pending / success / failed |
| created_at | timestamp | Auto-generated |
| updated_at | timestamp | Auto-updated |

### transactions
| Column | Type | Description |
|--------|------|-------------|
| id | integer | Primary key |
| transaction_id | varchar | Unique transaction identifier (TXN prefix) |
| topup_id | varchar | Linked topup request |
| payment_link | varchar | UPI deep-link URL |
| qr_code | varchar | Base64 encoded QR |
| payment_status | varchar | pending / success / failed |
| processed | boolean | Idempotency flag |
| created_at | timestamp | Auto-generated |
| updated_at | timestamp | Auto-updated |

---

## Postman Collection

Import `wallet-topup-collection.json` from the project root into Postman to get all 5 pre-configured requests.

---

## Deployment (Render)

1. Push code to GitHub
2. Go to [render.com](https://render.com) → New Web Service → connect your repo
3. Set build command: `npm install && npm run build`
4. Set start command: `npm run start:prod`
5. Add environment variables in the Render dashboard:
   - `DATABASE_URL`
   - `REDIS_URL`
   - `PORT` = `10000`

---

## Bonus Features Implemented

- **Idempotent webhook handling** — duplicate webhooks are safely skipped using a `processed` boolean flag
- **Redis caching** — wallet balance cached with 60s TTL and auto-invalidated on payment success
- **Database indexes** — unique constraints on `user_id`, `topup_id`, `transaction_id`
- **Proper error handling** — 400 Bad Request, 404 Not Found with descriptive messages
- **Input validation** — all endpoints validate request bodies via DTOs and class-validator