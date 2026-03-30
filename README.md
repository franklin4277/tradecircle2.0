# TradeCircle 2.0

TradeCircle is a secure digital marketplace student project inspired by platforms like Jiji.
It includes JWT authentication, listing moderation, fraud reporting, reputation scoring,
admin analytics, messaging, and a simulated M-Pesa payment action.

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
- `middleware/`
  - `auth.js`
  - `rateLimit.js`
  - `sanitize.js`
- `routes/`
  - `auth.js`
  - `listings.js`
  - `admin.js`
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

- Authentication and role-based access (`user`, `admin`)
- User reputation system (default 100)
- Listing creation with image uploads
- Listing moderation workflow (`pending`, `approved`, `rejected`)
- Public marketplace shows only approved listings
- Search by listing title and filter by location
- Fraud reporting system with report count tracking
- Automatic seller reputation penalty after report threshold
- Admin analytics (users, listings, reports, statuses)
- Messaging on listings
- Seller inbox with unread counts + mark-as-read flow
- Simulated M-Pesa payment action
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
MONGO_URI=your_mongodb_atlas_connection_string
JWT_SECRET=your_strong_jwt_secret
PORT=5000

# Optional: auto-create admin at startup
ADMIN_EMAIL=admin@tradecircle.com
ADMIN_PASSWORD=StrongAdminPassword123
ADMIN_NAME=TradeCircle Admin

# Optional: allow admin registration from register page
ADMIN_REGISTER_SECRET=your_admin_register_secret

# Optional tuning
REPORT_THRESHOLD=3
REPORT_PENALTY=10
CORS_ORIGIN=http://localhost:5000
```

Production notes:

- `JWT_SECRET` is required.
- `CORS_ORIGIN` must be a comma-separated list of valid `http(s)` origins.
- In production, `CORS_ORIGIN` must be set.

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
2. Create a listing from dashboard.
3. Login as admin and approve/reject listings.
4. Browse approved listings on home page.
5. Report listings to trigger fraud logic and reputation penalties.
6. Use message and simulated payment actions on listing cards.

## Security Highlights

- JWT-protected routes
- Password hashing with bcrypt
- Server-side validation
- Route protection by role
- `helmet` security headers
- Request key sanitization to block `$` and `.` operator injection patterns
- Basic rate limiting middleware
- Image type/size checks for uploads

## Notes

- This project stores uploaded images in `uploads/` locally.
- For production, use a persistent file store and robust distributed rate limiter.
