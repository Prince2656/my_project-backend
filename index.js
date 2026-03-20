require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const mongoose = require("mongoose");
const cron = require('node-cron');

const app = express();
app.use(cors());
app.use(bodyParser.json());

// --- MongoDB Connection ---
const MONGO_URI = process.env.MONGO_URI || "mongodb+srv://admin:p.k1234.@myprojectcluster.vhkhhpm.mongodb.net/myproject?retryWrites=true&w=majority";
mongoose.connect(MONGO_URI)
    .then(() => console.log("✅ MongoDB Connected"))
    .catch(err => console.log("❌ Mongo Error:", err));

// --- Schemas & Models (Merged & Fixed Duplicates) ---

const UserSchema = new mongoose.Schema({
    phone: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    inviteCode: { type: String, unique: true },
    referredBy: { type: String, default: null }, // Phone of inviter
    isFrozen: { type: Boolean, default: false },
    wallet: {
        buyQuantity: { type: Number, default: 0 },
        buyAmount: { type: Number, default: 0 },
        buyToday: { type: Number, default: 0 },
        todayRevenue: { type: Number, default: 0 },
        totalRevenue: { type: Number, default: 0 },
        sellToday: { type: Number, default: 0 }
    },
    paymentDetails: { upiMethod: String, upiId: String, boundAt: String },
    myReferrals: { type: Array, default: [] },
    createdAt: { type: Date, default: Date.now }
}, { versionKey: false });

const OrderSchema = new mongoose.Schema({ 
    level: String, 
    orderId: { type: Number, unique: true }, 
    amount: Number, 
    qty: Number, 
    remainingQty: Number, 
    reward: Number, 
    final: Number, 
    createdAt: { type: Date, default: Date.now } 
}, { versionKey: false });

const PaymentRequestSchema = new mongoose.Schema({
    phone: String,
    orderId: Number,
    amount: Number,
    utr: { type: String, unique: true },
    app: String,
    status: { type: String, default: "Pending" },
    createdAt: { type: Date, default: Date.now }
}, { versionKey: false });

const WithdrawSchema = new mongoose.Schema({
    phone: String,
    amount: Number,
    charge: Number,
    finalAmount: Number,
    status: { type: String, default: "Pending" },
    upiDetails: Object,
    createdAt: { type: Date, default: Date.now }
}, { versionKey: false });

const User = mongoose.model("users", UserSchema);
const Order = mongoose.model("orders", OrderSchema);
const PaymentRequest = mongoose.model("payments", PaymentRequestSchema);
const Withdraw = mongoose.model("withdraws", WithdrawSchema);

// --- Auth APIs ---

app.post('/api/register', async (req, res) => {
    try {
        const { phone, password, inviteCode } = req.body;
        const exists = await User.findOne({ phone: phone.trim() });
        if (exists) return res.json({ success: false, message: "Phone already registered" });

        let referredByPhone = null;
        if (inviteCode) {
            const inviter = await User.findOne({ inviteCode: inviteCode.toUpperCase() });
            if (inviter) referredByPhone = inviter.phone;
            else return res.json({ success: false, message: "Invalid Invite Code" });
        }

        const newUser = await User.create({
            phone: phone.trim(),
            password,
            referredBy: referredByPhone,
            inviteCode: Math.random().toString(36).substring(2, 8).toUpperCase()
        });

        if (referredByPhone) {
            await User.updateOne({ phone: referredByPhone }, { $push: { myReferrals: phone.trim() } });
        }
        res.json({ success: true, message: "Registered Successfully" });
    } catch (err) { res.status(500).json({ success: false }); }
});

app.post('/api/login', async (req, res) => {
    try {
        const { phone, password } = req.body;
        const user = await User.findOne({ phone: phone.trim(), password });
        if (!user) return res.json({ success: false, message: "Invalid Phone or Password" });
        if (user.isFrozen) return res.json({ success: false, message: "Account Blocked" });
        res.json({ success: true, data: user });
    } catch (err) { res.status(500).json({ success: false }); }
});

// --- Order & Stock APIs ---

app.post('/api/order/list', async (req, res) => {
    try {
        const { level } = req.body;
        const orders = await Order.find({ level, remainingQty: { $gt: 0 } }).sort({ amount: 1 });
        res.json({ success: true, orders });
    } catch (err) { res.status(500).json({ success: false }); }
});

// ⭐ ADMIN: Naya Order (Product) Add Karne Ke Liye
app.post('/api/admin/add-order', async (req, res) => {
    try {
        const { level, amount, qty, reward } = req.body;

        // Ek unique orderId generate karte hain timestamp se
        const orderId = Math.floor(100000 + Math.random() * 900000);

        const newOrder = new Order({
            level,           // e.g., "L1"
            orderId: orderId,
            amount: Number(amount),
            qty: Number(qty),
            remainingQty: Number(qty), // Shuruat mein full stock rahega
            reward: Number(reward),
            final: Number(amount) + Number(reward) // Total return
        });

        await newOrder.save();
        res.json({ success: true, message: "Order (Product) Added Successfully!", orderId });
    } catch (err) {
        console.error("Add Order Error:", err);
        res.status(500).json({ success: false, message: "Server Error: Order add nahi ho paya" });
    }
});

// ⭐ ADMIN: Saare Orders (Products) Dekhne Ke Liye
app.get('/api/admin/all-orders', async (req, res) => {
    try {
        const allOrders = await Order.find().sort({ createdAt: -1 });
        res.json({ success: true, orders: allOrders });
    } catch (err) {
        res.status(500).json({ success: false });
    }
});

app.post('/api/order/receive', async (req, res) => {
    try {
        const { phone, orderId, utr } = req.body;
        const utrExists = await PaymentRequest.findOne({ utr });
        if (utrExists) return res.json({ success: false, message: "UTR already used!" });

        const order = await Order.findOne({ orderId: Number(orderId), remainingQty: { $gt: 0 } });
        if (!order) return res.json({ success: false, message: "Sold Out!" });

        await Order.updateOne({ orderId }, { $inc: { remainingQty: -1 } });
        await PaymentRequest.create({
            phone: phone.trim(),
            orderId,
            amount: order.amount,
            utr,
            status: "Pending"
        });
        res.json({ success: true, message: "Request Sent! Stock reserved." });
    } catch (err) { res.status(500).json({ success: false }); }
});

// --- Admin & Commission Logic ⭐ ---

app.post('/api/admin/approve-recharge', async (req, res) => {
    const { paymentId, status } = req.body;
    try {
        const payment = await PaymentRequest.findById(paymentId);
        if (!payment || payment.status !== "Pending") return res.json({ success: false, message: "Already processed" });

        if (status === "Success") {
            // 1. User ka balance update karein
            const user = await User.findOneAndUpdate(
                { phone: payment.phone },
                { $inc: { "wallet.buyAmount": payment.amount, "wallet.buyToday": payment.amount } },
                { new: true }
            );

            // 2. REFERRAL COMMISSION LOGIC (10% to Inviter)
            if (user && user.referredBy) {
                const commission = payment.amount * 0.10; // 10% commission
                await User.updateOne(
                    { phone: user.referredBy },
                    { $inc: { "wallet.totalRevenue": commission, "wallet.todayRevenue": commission } }
                );
                console.log(`✅ Commission of ₹${commission} sent to ${user.referredBy}`);
            }
        }
        
        payment.status = status;
        await payment.save();
        res.json({ success: true });
    } catch (err) { res.status(500).json({ success: false }); }
});

// --- Baaki APIs (History, Wallet, Team etc.) ---

app.get('/api/history/:phone', async (req, res) => {
    try {
        const { phone } = req.params;
        const payments = await PaymentRequest.find({ phone: phone.trim() }).sort({ createdAt: -1 });
        const withdraws = await Withdraw.find({ phone: phone.trim() }).sort({ createdAt: -1 });
        res.json({ success: true, payments, withdraws });
    } catch (err) { res.status(500).json({ success: false }); }
});

app.get('/api/wallet/:phone', async (req, res) => {
    try {
        const user = await User.findOne({ phone: req.params.phone.trim() });
        if (!user) return res.json({ success: false });
        res.json({ success: true, inviteCode: user.inviteCode, wallet: user.wallet });
    } catch (err) { res.status(500).json({ success: false }); }
});

app.get('/api/team/:phone', async (req, res) => {
    try {
        const user = await User.findOne({ phone: req.params.phone });
        if (!user) return res.json({ success: false });
        const teamMembers = await User.find({ referredBy: user.phone }).select('phone createdAt -_id');
        res.json({ success: true, teamCount: teamMembers.length, teamMembers });
    } catch (err) { res.status(500).json({ success: false }); }
});

app.get('/api/admin/dashboard-data', async (req, res) => {
    try {
        const pendingPayments = await PaymentRequest.find({ status: "Pending" }).sort({ createdAt: -1 });
        const withdrawRequests = await Withdraw.find({ status: "Pending" }).sort({ createdAt: -1 });
        const allPayments = await PaymentRequest.find().limit(50).sort({ createdAt: -1 });
        const allWithdrawals = await Withdraw.find().limit(50).sort({ createdAt: -1 });
        const allUsers = await User.find().limit(100);
        res.json({ success: true, pendingPayments, withdrawRequests, allPayments, allWithdrawals, users: allUsers });
    } catch (err) { res.status(500).json({ success: false }); }
});

// --- Cron & Server Start ---

cron.schedule('0 0 * * *', async () => {
    await User.updateMany({}, { $set: { "wallet.sellToday": 0, "wallet.buyToday": 0, "wallet.todayRevenue": 0, "wallet.buyQuantity": 0 } });
}, { timezone: "Asia/Kolkata" });

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
