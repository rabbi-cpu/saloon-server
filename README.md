# SalonBook - Backend Server

SalonBook is the RESTful backend API server for the SalonBook Appointment Booking Platform. It handles role-based JWT authentication, salon service management, conflict-free appointment scheduling, user access control, and verified Stripe webhook payment processing.

## Important Features
- **JWT Cookie Authentication & Role Authorization:** HTTP-only cookie verification with separate `verifyToken`, `verifyAdmin`, and `verifyCustomer` middlewares.
- **Salon Service Management:** Public service browsing with search by name, category filtering, and price sorting; full CRUD & status toggling for Admins.
- **Smart Appointment Booking:** Prevents booking inactive services and blocks duplicate active appointments on the same date and time slot.
- **Stripe Checkout & Verified Webhooks:** Creates secure Stripe Checkout sessions for confirmed appointments and updates payment status strictly through verified Stripe webhook events.
- **Admin Controls & Analytics:** User block/unblock enforcement, transaction history tracking, and real-time dashboard statistics.

## Technology Stack
- **Runtime:** Node.js
- **Framework:** Express.js
- **Database:** MongoDB (Native Driver)
- **Authentication:** JSON Web Tokens (JWT) & Cookie Parser
- **Payments:** Stripe API & Webhooks

## Installation & Local Setup

1. Clone the repository:
   ```bash
   git clone <your-server-repo-link>
   cd salonbook-server
   Install dependencies:

Bash
npm install
Create a .env file in the root directory and configure the required variables (see below).

Run the development server:

Bash
npm run dev
Required Environment Variables
Create a .env file with the following variable names (do not commit actual secrets):

PORT

NODE_ENV

MONGODB_URI

ACCESS_TOKEN_SECRET

STRIPE_SECRET_KEY

STRIPE_WEBHOOK_SECRET

CLIENT_URL

Project Links
Live Client Website: <your-live-client-url>

Live Server API: <your-live-server-url>

Client Repository: <your-client-repo-link>

Server Repository: <your-server-repo-link>


---

### ৩. সব API Endpoints-এর সংক্ষিপ্ত তালিকা (ফ্রন্টএন্ডে কল করার জন্য)

| Method | Endpoint | Access | কাজ |
| :--- | :--- | :--- | :--- |
| `POST` | `/api/auth/jwt` | Public | Better Auth লগইনের পর JWT কুকি সেট করা |
| `POST` | `/api/auth/logout` | Public | কুকি ক্লিয়ার করে লগআউট |
| `GET` | `/api/users/me` | Private | কারেন্ট ইউজারের ডাটা ও রোল আনা |
| `PATCH` | `/api/users/profile` | Private | নিজের নাম, ছবি, ফোন আপডেট |
| `GET` | `/api/services` | Public | অ্যাক্টিভ সার্ভিস (`?search=&category=&sort=price_asc&limit=6`) |
| `GET` | `/api/services/:id` | Private | সিঙ্গেল সার্ভিস ডিটেইলস |
| `GET` | `/api/admin/services` | Admin | সব সার্ভিস (Active + Inactive) |
| `POST` | `/api/services` | Admin | নতুন সার্ভিস তৈরি |
| `PATCH` | `/api/services/:id` | Admin | সার্ভিস আপডেট বা Active/Inactive করা |
| `DELETE` | `/api/services/:id` | Admin | সার্ভিস ডিলিট |
| `POST` | `/api/appointments` | Customer | নতুন অ্যাপয়েন্টমেন্ট রিকোয়েস্ট |
| `GET` | `/api/appointments/my` | Customer | নিজের সব অ্যাপয়েন্টমেন্ট দেখা |
| `PATCH` | `/api/appointments/:id/cancel` | Customer | Pending অ্যাপয়েন্টমেন্ট ক্যানসেল |
| `GET` | `/api/admin/appointments` | Admin | সব কাস্টমারের অ্যাপয়েন্টমেন্ট দেখা |
| `PATCH` | `/api/admin/appointments/:id/status` | Admin | অ্যাপয়েন্টমেন্ট `confirmed` বা `cancelled` করা |
| `POST` | `/api/payments/create-checkout-session` | Customer | Confirmed অ্যাপয়েন্টমেন্টের জন্য Stripe পেমেন্ট লিংক তৈরি |
| `GET` | `/api/payments/session/:sessionId` | Customer | পেমেন্ট সাকসেস পেজে ট্রানজেকশন চেক করা |
| `POST` | `/api/webhook/stripe` | Stripe | পেমেন্ট ভেরিফাই করে `paid` ও ট্রানজেকশন সেভ করা |
| `GET` | `/api/admin/transactions` | Admin | সব পেমেন্ট ট্রানজেকশন দেখা |
| `GET` | `/api/admin/users` | Admin | সব কাস্টমার লিস্ট দেখা |
| `PATCH` | `/api/admin/users/:id/block` | Admin | কাস্টমার ব্লক/আনব্লক করা |
| `GET` | `/api/admin/stats` | Admin | অ্যাডমিন ড্যাশবোর্ড স্ট্যাটাস |
| `GET` | `/api/customer/stats` | Customer | কাস্টমার ড্যাশবোর্ড স্ট্যাটাস |