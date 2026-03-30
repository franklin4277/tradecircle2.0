# TradeCircle 2.0

TradeCircle is a secure community-based digital skill and resource exchange platform inspired by platforms like Jiji.
It includes JWT authentication, community verification, listing moderation, fraud reporting, reputation scoring,
admin analytics, moderation logs, and seller-buyer messaging.

## Tech Stack

- Backend: Node.js + Express
- Database: MongoDB Atlas + Mongoose
- Frontend: HTML, CSS, JavaScript (no framework)
- Authentication: JWT + bcrypt password hashing
- Uploads: Multer (local `uploads/` storage)

## Project Structure

- `server.js`
- `models/`
  - `user.js`
  - `listing.js`
  - `report.js`
  - `adminLog.js`
  - `escrow.js`
  - `notification.js`
  - `walletTransaction.js`
  - `refreshToken.js`
- `config/`
  - `storage.js`
- `middleware/`
  - `auth.js`
  - `rateLimit.js`
  - `sanitize.js`
- `routes/`
  - `auth.js`
  - `listings.js`
  - `escrow.js`
  - `admin.js`
  - `notifications.js`
- `services/`
  - `escrowSla.js`
- `scripts/`
  - `migrate-owner-to-seller.js`
- `tests/`
  - `api-flows.test.js`
- `public/`
  - `index.html`
  - `login.html`
  - `register.html`
  - `dashboard.html`
  - `admin.html`
  - `style.css`
  - `script.js`
- `uploads/`

## Features

- Authentication and role-based access (`user`, `moderator`, `admin`)
- JWT auth with secure HttpOnly cookie session rotation (access + refresh tokens)
- Community verification workflow (users must be verified before trading actions)
- Strong password policy for registration (minimum 8 characters with letters and numbers; stricter for admin)
- User reputation system (default 100)
- Listing creation with image uploads
- Listing moderation workflow (`pending`, `approved`, `rejected`)
- Staff listing controls (admin/moderator can remove listings from moderation dashboard)
- Public marketplace shows only approved listings
- Search by listing title and filter by location
- Ranking algorithm for recommended listing order (reputation + freshness + trust signals)
- Fraud reporting system with report count tracking
- Automatic seller reputation penalty after report threshold
- Admin analytics (users, verification, listings, reports, statuses)
- Admin user management (verify users, manage moderator role) + moderation logs
- Messaging on listings
- Offer workflow (buyer sends offer, seller accepts/rejects, accepted offer unlocks secure hold)
- Seller inbox with unread counts + mark-as-read flow
- Notification center (messages, offers, escrow, wallet, moderation updates)
- Escrow secure hold flow:
  - buyer funds hold in-platform from a demo wallet balance
  - escrow requires seller-accepted buyer offer
  - service-category listings are connection-only (no in-app payment)
  - seller marks shipped
  - buyer confirms delivery before funds release
  - dispute + admin/moderator resolution path
- Escrow SLA worker (shipping reminders + auto-refund on timeout)
- Demo wallet ledger (available vs held balance) for realistic escrow simulation
- Wallet transaction history for auditability (topups, holds, releases, refunds)
- Offline payment alignment for first-phase scope (online payment simulation disabled by default)
- Basic in-memory API rate limiting

## 1. Install

```bash
npm install
```

## Available Scripts

```bash
npm start
npm test
npm run migrate:owner-to-seller
```

## 2. Configure Environment

Create a `.env` file in the project root.

```env
NODE_ENV=development
MONGO_URI=your_mongodb_atlas_connection_string
JWT_SECRET=your_strong_jwt_secret
# Recommended dedicated refresh secret (falls back to JWT_SECRET if omitted)
REFRESH_TOKEN_SECRET=your_strong_refresh_secret
# Optional token lifetimes
ACCESS_TOKEN_TTL=15m
REFRESH_TOKEN_DAYS=7
PORT=5000
CORS_ORIGIN=http://localhost:5000

# Optional: auto-create admin at startup
ADMIN_EMAIL=admin@tradecircle.com
ADMIN_PASSWORD=StrongAdminPassword123
ADMIN_NAME=TradeCircle Admin

# Optional: allow admin self-registration via secret (disabled by default)
ALLOW_ADMIN_REGISTRATION=false
ADMIN_REGISTER_SECRET=your_admin_register_secret

# Optional: allow admin role promotion from API (disabled by default)
ALLOW_ADMIN_PROMOTION=false

# Optional tuning
REPORT_THRESHOLD=3
REPORT_PENALTY=10

# Optional: disable/enable simulated payment endpoint (default false)
ENABLE_SIMULATED_PAYMENTS=false

# Optional: escrow fee percent for secure hold flow
ESCROW_FEE_PERCENT=2
# Optional escrow SLA settings
ESCROW_SHIP_WINDOW_HOURS=72
ESCROW_REMINDER_LEAD_HOURS=24
ESCROW_SLA_INTERVAL_MS=300000

# Optional: persistent uploads directory (Render disk mount example)
UPLOADS_DIR=/var/data/uploads
```

Production notes:

- `JWT_SECRET` is required.
- `REFRESH_TOKEN_SECRET` is strongly recommended in production (different from `JWT_SECRET`).
- `CORS_ORIGIN` must be a comma-separated list of valid `http(s)` origins.
- In production, `CORS_ORIGIN` must be set.
- `ALLOW_ADMIN_REGISTRATION` and `ALLOW_ADMIN_PROMOTION` are `false` by default for stronger admin security.
- On hosted environments, use persistent storage path via `UPLOADS_DIR` (otherwise local uploads are ephemeral).

## 3. Run

```bash
node server.js
```

If you have old listings from earlier schema versions, run the migration once:

```bash
npm run migrate:owner-to-seller
```

Open:

- `http://localhost:5000` for marketplace
- `http://localhost:5000/dashboard.html` for user dashboard
- `http://localhost:5000/admin.html` for admin dashboard

## Demo Flow

1. Register a user account.
2. Login as admin, verify user community access, then user can create listings.
3. Approve/reject listings from admin/moderator panel.
4. Browse approved listings on home page.
5. Report listings to trigger fraud logic and reputation penalties.
6. Use messaging and offers between buyers and sellers.
7. Top up buyer wallet, start Secure Hold, then complete shipped -> confirm flow.

## Security Highlights

- JWT-protected routes
- Password hashing with bcrypt
- Password policy validation before account creation
- Server-side validation
- Route protection by role
- `helmet` security headers
- Request key sanitization to block `$` and `.` operator injection patterns
- Basic rate limiting middleware
- Image type/size checks for uploads

## Notes

- This project stores uploaded images in `uploads/` locally.
- For production, use a persistent file store and robust distributed rate limiter.
