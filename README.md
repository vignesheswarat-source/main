# Cutispro Derma Solutions — India-ready e-commerce starter

A complete Node.js + Express storefront for **Cutispro Derma Solutions** using the supplied equipment/product photos.

## Included
- Premium responsive storefront
- 55 supplied image assets in `public/assets/`
- Product catalog with editable INR demo prices
- Categories, product cards and gallery
- Multi-item bag/cart with quantity controls
- Checkout address form with pincode validation
- Razorpay order creation + checkout + server-side signature verification
- Razorpay webhook endpoint
- Shiprocket authentication, order creation, AWB assignment and label generation
- Persistent JSON order store (simple starter; migrate to PostgreSQL/MySQL for high volume)
- Admin API protected by `ADMIN_TOKEN`
- Dockerfile + docker-compose
- `.env.example`

## Important before launch
The catalog contains **demo prices** because no selling prices were provided. Edit `data/products.json` before accepting real orders.

Some photographed devices have uncertain model/specification/branding. Listings intentionally say **Model to be verified** or equivalent. Do not publish regulatory/clearance claims until you verify the exact nameplate, model, serial number, manufacturer documentation and applicable Indian requirements.

The default GST calculation is a simple configurable 18% estimate. **Do not assume 18% is correct for every SKU.** Have your Indian CA/tax advisor configure GST/HSN treatment and invoice rules for each product category.

## 1. Local test
Requirements: Node.js 18+.

```bash
cp .env.example .env
npm install
npm start
```
Open `http://localhost:3000`.

Use Razorpay test keys for testing. Do not put `RAZORPAY_KEY_SECRET` or Shiprocket credentials in frontend code.

## 2. Razorpay setup
Create/configure your Razorpay account and use your API key ID + secret in `.env`.

Configure the Razorpay webhook URL as:
`https://YOUR-DOMAIN/api/webhooks/razorpay`

Set the same webhook secret in `RAZORPAY_WEBHOOK_SECRET`.

The backend verifies the checkout signature before marking the order paid.

## 3. Shiprocket setup
Create a Shiprocket API user and put its email/password in `.env`.

Set a valid Shiprocket pickup location that already exists in your Shiprocket account.

After a successful Razorpay payment, the backend calls Shiprocket to create the order, assign an AWB and generate a label when available.

You should also configure Shiprocket webhooks for shipment status updates and extend `server.js` to persist tracking events as your operations mature.

## 4. India hosting
Recommended simple production setup:
- Ubuntu 22.04/24.04 VPS in an Indian region
- Docker + Docker Compose
- Nginx or Caddy for HTTPS
- A domain such as `cutispro.in`
- Razorpay live credentials
- Shiprocket API credentials

Example:
```bash
git clone YOUR_REPO cutispro
cd cutispro
cp .env.example .env
nano .env
docker compose up -d --build
```

Put Nginx/Caddy in front of port 3000 and enable HTTPS. Point Razorpay and Shiprocket webhook URLs at the HTTPS domain.

## 5. Admin API
The starter exposes:
- `GET /api/admin/orders`
- `GET /api/admin/products`
- `PUT /api/admin/products/:id`

Send `x-admin-token: YOUR_ADMIN_TOKEN`.

For a public production deployment, build a real authenticated admin UI with role-based access, CSRF protection, audit logs and database-backed users.

## 6. Recommended production upgrades
For serious order volume, replace JSON storage with PostgreSQL/MySQL and add:
- authenticated customer accounts
- GST invoice generation with correct HSN/GST rates
- inventory/stock reservations
- coupons and tax-aware pricing
- Razorpay refund workflow
- Shiprocket tracking webhook persistence
- courier/serviceability checks before payment
- order cancellation/returns/refunds
- email/SMS/WhatsApp notifications
- admin dashboard
- image CDN/object storage
- rate limiting and WAF
- automated backups
- privacy policy, terms, shipping, refund and cancellation pages

## Payment/shipping architecture
1. Customer adds multiple items to bag.
2. Server recalculates prices from `data/products.json` — client totals are not trusted.
3. Server creates a Razorpay order in INR.
4. Razorpay Checkout collects payment.
5. Server verifies the Razorpay signature.
6. Server creates the Shiprocket order.
7. Server requests AWB assignment and label generation.
8. Customer sees order confirmation and label link when returned by Shiprocket.

## Sources used for integration design
Razorpay documentation: https://razorpay.com/
Shiprocket API documentation: https://apidocs.shiprocket.in/
