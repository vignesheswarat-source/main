import 'dotenv/config';
import express from 'express';
import helmet from 'helmet';
import morgan from 'morgan';
import crypto from 'crypto';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import Razorpay from 'razorpay';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = Number(process.env.PORT || 3000);
const DATA_DIR = path.join(__dirname, 'data');
const PRODUCTS_FILE = path.join(DATA_DIR, 'products.json');
const ORDERS_FILE = path.join(DATA_DIR, 'orders.json');

app.set('trust proxy', 1);
app.use(helmet({ contentSecurityPolicy: false }));
app.use(morgan('combined'));

// Razorpay webhook needs the raw request body for HMAC verification.
app.post('/api/webhooks/razorpay', express.raw({ type: 'application/json' }), async (req, res) => {
  try {
    const signature = req.headers['x-razorpay-signature'];
    const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
    if (!signature || !secret) return res.status(400).send('Webhook not configured');
    const expected = crypto.createHmac('sha256', secret).update(req.body).digest('hex');
    if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return res.status(401).send('Invalid signature');
    const event = JSON.parse(req.body.toString('utf8'));
    const payment = event.payload?.payment?.entity;
    if (payment?.order_id) {
      const orders = await readOrders();
      const idx = orders.findIndex(o => o.razorpayOrderId === payment.order_id);
      if (idx >= 0) {
        orders[idx].paymentEvent = event.event;
        orders[idx].updatedAt = new Date().toISOString();
        if (event.event === 'payment.captured') orders[idx].paymentStatus = 'paid';
        await writeOrders(orders);
      }
    }
    res.json({ ok: true });
  } catch (e) { console.error(e); res.status(500).send('Webhook error'); }
});

app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID || 'missing',
  key_secret: process.env.RAZORPAY_KEY_SECRET || 'missing'
});

async function readJson(file, fallback) {
  try { return JSON.parse(await fs.readFile(file, 'utf8')); }
  catch { return fallback; }
}
async function writeJson(file, value) {
  const tmp = file + '.tmp';
  await fs.writeFile(tmp, JSON.stringify(value, null, 2));
  await fs.rename(tmp, file);
}
const readProducts = () => readJson(PRODUCTS_FILE, []);
const readOrders = () => readJson(ORDERS_FILE, []);
const writeOrders = v => writeJson(ORDERS_FILE, v);
const rupees = n => Math.round(Number(n) * 100) / 100;

function cleanItems(items, products) {
  if (!Array.isArray(items) || !items.length) throw new Error('Cart is empty');
  const byId = new Map(products.map(p => [p.id, p]));
  return items.map(i => {
    const p = byId.get(String(i.id));
    const qty = Math.max(1, Math.min(99, Number(i.quantity) || 1));
    if (!p) throw new Error(`Unknown product: ${i.id}`);
    return { id: p.id, sku: p.sku, name: p.name, price: rupees(p.price), quantity: qty, weight: Number(p.weight || 1), dimensions: p.dimensions || '30x30x30' };
  });
}

function requireAdmin(req, res, next) {
  const token = req.headers['x-admin-token'];
  if (!process.env.ADMIN_TOKEN || token !== process.env.ADMIN_TOKEN) return res.status(401).json({ error: 'Unauthorized' });
  next();
}

app.get('/api/products', async (_req, res) => res.json(await readProducts()));
app.get('/api/gallery', async (_req, res) => res.json(await readJson(path.join(DATA_DIR, 'images.json'), [])));

app.post('/api/orders/create', async (req, res) => {
  try {
    const products = await readProducts();
    const items = cleanItems(req.body.items, products);
    const customer = req.body.customer || {};
    for (const k of ['name','email','phone','address','city','state','pincode']) if (!String(customer[k] || '').trim()) throw new Error(`Missing ${k}`);
    if (!/^\d{6}$/.test(String(customer.pincode))) throw new Error('Pincode must be 6 digits');
    const subtotal = rupees(items.reduce((s, i) => s + i.price * i.quantity, 0));
    const shipping = subtotal >= 5000 ? 0 : 199;
    const tax = rupees(subtotal * 0.18); // Edit per your GST classification/CA advice.
    const total = rupees(subtotal + shipping + tax);
    const receipt = `CP-${Date.now()}`;
    const rpOrder = await razorpay.orders.create({ amount: Math.round(total * 100), currency: 'INR', receipt, notes: { store: 'Cutispro Derma Solutions' } });
    const order = {
      id: receipt, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      items, customer, subtotal, shipping, tax, total,
      status: 'payment_pending', paymentStatus: 'created', razorpayOrderId: rpOrder.id,
      shiprocket: null
    };
    const orders = await readOrders(); orders.push(order); await writeOrders(orders);
    res.json({ orderId: order.id, razorpay: { id: rpOrder.id, amount: rpOrder.amount, currency: rpOrder.currency }, keyId: process.env.RAZORPAY_KEY_ID, total });
  } catch (e) { console.error(e); res.status(400).json({ error: e.message || 'Unable to create order' }); }
});

app.post('/api/orders/verify-payment', async (req, res) => {
  try {
    const { orderId, razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;
    const orders = await readOrders();
    const idx = orders.findIndex(o => o.id === orderId && o.razorpayOrderId === razorpay_order_id);
    if (idx < 0) return res.status(404).json({ error: 'Order not found' });
    const payload = `${razorpay_order_id}|${razorpay_payment_id}`;
    const expected = crypto.createHmac('sha256', process.env.RAZORPAY_KEY_SECRET).update(payload).digest('hex');
    if (!razorpay_signature || !crypto.timingSafeEqual(Buffer.from(razorpay_signature), Buffer.from(expected))) return res.status(400).json({ error: 'Payment signature verification failed' });
    orders[idx].paymentStatus = 'paid'; orders[idx].paymentId = razorpay_payment_id; orders[idx].status = 'paid'; orders[idx].updatedAt = new Date().toISOString();
    await writeOrders(orders);
    let shipping = null;
    try { shipping = await createShiprocketShipment(orders[idx]); orders[idx].shiprocket = shipping; orders[idx].status = shipping?.labelUrl ? 'label_ready' : 'paid'; orders[idx].updatedAt = new Date().toISOString(); await writeOrders(orders); }
    catch (shipErr) { console.error('Shiprocket error:', shipErr); orders[idx].shippingError = shipErr.message; await writeOrders(orders); }
    res.json({ ok: true, order: orders[idx] });
  } catch (e) { console.error(e); res.status(500).json({ error: e.message || 'Payment verification failed' }); }
});

async function shiprocketToken() {
  const r = await fetch('https://apiv2.shiprocket.in/v1/external/auth/login', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ email: process.env.SHIPROCKET_EMAIL, password: process.env.SHIPROCKET_PASSWORD }) });
  if (!r.ok) throw new Error(`Shiprocket auth failed: ${r.status}`);
  const j = await r.json(); return j.token;
}

async function createShiprocketShipment(order) {
  const token = await shiprocketToken();
  const address = order.customer;
  const body = {
    order_id: order.id,
    order_date: new Date(order.createdAt).toISOString().slice(0,19).replace('T',' '),
    pickup_location: process.env.SHIPROCKET_PICKUP_LOCATION,
    channel_id: process.env.SHIPROCKET_CHANNEL_ID || undefined,
    billing_customer_name: address.name,
    billing_last_name: '', billing_address: address.address, billing_address_2: address.address2 || '',
    billing_city: address.city, billing_pincode: address.pincode, billing_state: address.state, billing_country: 'India',
    billing_email: address.email, billing_phone: address.phone,
    shipping_is_billing: true,
    order_items: order.items.map(i => ({ name: i.name, sku: i.sku, units: i.quantity, selling_price: i.price })),
    payment_method: 'Prepaid', sub_total: order.subtotal,
    length: 30, breadth: 30, height: 30,
    weight: Math.max(0.5, order.items.reduce((s,i)=>s+i.weight*i.quantity,0))
  };
  Object.keys(body).forEach(k => body[k] === undefined && delete body[k]);
  const create = await fetch('https://apiv2.shiprocket.in/v1/external/orders/create/adhoc', { method:'POST', headers:{'Content-Type':'application/json',Authorization:`Bearer ${token}`}, body:JSON.stringify(body) });
  const cj = await create.json(); if (!create.ok) throw new Error(`Shiprocket create order failed: ${JSON.stringify(cj)}`);
  const shipmentId = cj.shipment_id;
  const awbR = await fetch('https://apiv2.shiprocket.in/v1/external/courier/assign/awb', { method:'POST', headers:{'Content-Type':'application/json',Authorization:`Bearer ${token}`}, body:JSON.stringify({ shipment_id: shipmentId }) });
  const awbJ = await awbR.json();
  let labelUrl = null;
  if (awbR.ok) {
    const labelR = await fetch('https://apiv2.shiprocket.in/v1/external/courier/generate/label', { method:'POST', headers:{'Content-Type':'application/json',Authorization:`Bearer ${token}`}, body:JSON.stringify({ shipment_id:[shipmentId]}) });
    const labelJ = await labelR.json(); labelUrl = labelJ.label_url || labelJ.label_url?.[0] || null;
  }
  return { orderId: cj.order_id, shipmentId, awb: awbJ.response?.data?.awb_code || awbJ.awb_code || null, courier: awbJ.response?.data?.courier_name || null, labelUrl, raw: { create:cj, awb:awbJ } };
}

app.get('/api/orders/:id', async (req,res)=>{
  const orders=await readOrders(); const o=orders.find(x=>x.id===req.params.id); if(!o) return res.status(404).json({error:'Not found'}); res.json({id:o.id,createdAt:o.createdAt,status:o.status,paymentStatus:o.paymentStatus,total:o.total,items:o.items,shiprocket:o.shiprocket});
});
app.get('/api/admin/orders', requireAdmin, async (_req,res)=>res.json(await readOrders()));
app.get('/api/admin/products', requireAdmin, async (_req,res)=>res.json(await readProducts()));
app.put('/api/admin/products/:id', requireAdmin, async (req,res)=>{
  const products=await readProducts(); const i=products.findIndex(p=>p.id===req.params.id); if(i<0)return res.status(404).json({error:'Not found'}); products[i]={...products[i],...req.body}; await writeJson(PRODUCTS_FILE,products); res.json(products[i]);
});

app.get('*', (_req,res)=>res.sendFile(path.join(__dirname,'public','index.html')));

await fs.mkdir(DATA_DIR,{recursive:true});
if (!(await fs.stat(ORDERS_FILE).catch(()=>null))) await writeOrders([]);
app.listen(PORT,()=>console.log(`Cutispro Derma Solutions running on http://localhost:${PORT}`));
