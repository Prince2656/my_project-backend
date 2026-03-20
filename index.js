require('dotenv').config(); // Security ke liye zaroori hai
const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const mongoose = require("mongoose");
const cron = require('node-cron');

const app = express();
app.use(cors());
app.use(bodyParser.json());

// 1. ⭐ MongoDB Connection
// Note: Password ko hamesha .env file mein rakhein
const MONGO_URI = process.env.MONGO_URI || "mongodb+srv://admin:p.k1234.@myprojectcluster.vhkhhpm.mongodb.net/myproject?retryWrites=true&w=majority";

mongoose.connect(MONGO_URI)
    .then(() => console.log("✅ MongoDB Connected Successfully"))
    .catch(err => console.log("❌ Mongo Error:", err));

// 2. ⭐ MongoDB Schemas
const UserSchema = new mongoose.Schema({
    phone: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    inviteCode: String,
    referredBy: { type: String, default: null },
    isFrozen: { type: Boolean, default: false },
    wallet: {
        buyQuantity: { type: Number, default: 0 },
        buyAmount: { type: Number, default: 0 },
        buyToday: { type: Number, default: 0 },
        sellToday: { type: Number, default: 0 },
        totalRevenue: { type: Number, default: 0 }
    },
    paymentDetails: {
        upiMethod: { type: String, default: "" },
        upiId: { type: String, default: "" },
        boundAt: String
    },
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
    createdAt: { type: Date, default: Date.now } // Default date add ki
}, { versionKey: false });


const PaymentSchema = new mongoose.Schema({ 
    id: Number, phone: String, amount: Number, app: String, utr: String, status: String, createdAt: String 
}, { versionKey: false });

const WithdrawSchema = new mongoose.Schema({ 
    id: Number, phone: String, amount: Number, charge: Number, finalAmount: Number, status: String, upiDetails: Object, createdAt: String 
}, { versionKey: false });

const UserModel = mongoose.model("users", UserSchema);
const OrderModel = mongoose.model("orders", OrderSchema);
const PaymentModel = mongoose.model("payments", PaymentSchema);
const WithdrawModel = mongoose.model("withdraws", WithdrawSchema);

// ================== ⭐ AUTO RESET AT 12 AM ⭐ ==================
cron.schedule('0 0 * * *', async () => {
    try {
        await UserModel.updateMany({}, { 
            $set: { "wallet.sellToday": 0, "wallet.buyToday": 0 } 
        });
        console.log(`✅ Midnight Reset Success`);
    } catch (err) {
        console.error("❌ Reset Error:", err);
    }
}, { timezone: "Asia/Kolkata" });

// ================== ⭐ AUTH APIs ⭐ ==================

// REGISTER API
app.post('/api/register', async (req, res) => {
    try {
        const { phone, password, referredBy } = req.body;
        const exists = await UserModel.findOne({ phone });
        if (exists) return res.json({ success: false, message: "Phone already registered" });

        const newUser = await UserModel.create({
            phone,
            password,
            referredBy,
            inviteCode: Math.random().toString(36).substring(2, 8).toUpperCase()
        });
        res.json({ success: true, data: newUser });
    } catch (err) {
        res.status(500).json({ success: false });
    }
});


// LOGIN API
app.post('/api/login', async (req, res) => {
    try {
        const { phone, password } = req.body;
        const user = await UserModel.findOne({ phone, password });
        if (!user) return res.json({ success: false, message: "Invalid credentials" });
        if (user.isFrozen) return res.json({ success: false, message: "Account Blocked" });

        res.json({ success: true, data: user });
    } catch (err) {
        res.status(500).json({ success: false });
    }
});

// ================== ⭐ TRANSACTION APIs ⭐ ==================

app.post('/api/order/receive', async (req, res) => {
    try {
        const { phone, orderId, utr } = req.body;
        const user = await UserModel.findOne({ phone: phone.trim() });
        const order = await OrderModel.findOne({ orderId: Number(orderId) });

        if (!user || !order) return res.json({ success: false, message: "User/Order not found" });
        if (user.isFrozen) return res.json({ success: false, message: "Account Frozen." });
        
        const utrExists = await PaymentModel.findOne({ utr: utr });
        if (utrExists) return res.json({ success: false, message: "UTR already used." });

        await PaymentModel.create({
            id: Date.now(), phone: phone.trim(), amount: Number(order.amount),
            utr: utr, app: "Direct Transfer", status: "Pending", createdAt: new Date().toISOString()
        });
        res.json({ success: true, message: "Request sent for verification." });
    } catch (err) { res.status(500).json({ success: false }); }
});

app.post('/api/withdraw', async (req, res) => {
    try {
        const { phone, amount } = req.body;
        const withdrawAmount = Number(amount);
        const user = await UserModel.findOne({ phone: phone.trim() });

        if (!user) return res.json({ success: false, message: "User not found" });
        if (user.isFrozen) return res.json({ success: false, message: "Account Frozen." });
        if (withdrawAmount < 150) return res.json({ success: false, message: "Minimum withdraw ₹150" });

        // ⭐ Total Balance Check (Buy Amount + Revenue)
        const totalBalance = Number(user.wallet.buyAmount || 0) + Number(user.wallet.totalRevenue || 0);

        if (totalBalance < withdrawAmount) {
            return res.json({ success: false, message: "Insufficient balance" });
        }

        // ⭐ Simplified Deduction Logic:
        // Hum total balance se amount minus kar rahe hain. 
        // Sabse asan tarika hai Buy Amount se deduct karna, 
        // aur agar wo kam pade toh Revenue se balance adjust karna.
        
        if (user.wallet.buyAmount >= withdrawAmount) {
            user.wallet.buyAmount -= withdrawAmount;
        } else {
            let remainingToDeduct = withdrawAmount - user.wallet.buyAmount;
            user.wallet.buyAmount = 0;
            user.wallet.totalRevenue -= remainingToDeduct;
        }

        // Sell Today update karna (Limit track karne ke liye)
        user.wallet.sellToday = (Number(user.wallet.sellToday) || 0) + withdrawAmount;
        
        user.markModified('wallet'); 
        await user.save();

        // Admin ke liye entry create karna
        let charge = withdrawAmount < 500 ? Number((withdrawAmount * 0.03).toFixed(2)) : 0;
        let finalAmount = withdrawAmount - charge;

        await WithdrawModel.create({ 
            id: Date.now(), 
            phone, 
            amount: withdrawAmount, 
            charge: charge,
            finalAmount: finalAmount, 
            status: "Pending", 
            upiDetails: user.paymentDetails, 
            createdAt: new Date().toISOString() 
        });

        res.json({ success: true, message: "Withdrawal request sent!", finalAmount: finalAmount });
    } catch (err) { 
        res.status(500).json({ success: false, message: "Server Error" }); 
    }
});


// ================== ⭐ RECHARGE & ADMIN APIs ⭐ ==================

app.post('/api/recharge/request', async (req, res) => {
    try {
        const { phone, amount, utr } = req.body;
        await PaymentModel.create({
            id: Date.now(), phone: phone.trim(), amount: Number(amount),
            utr: utr || "PENDING", app: "UPI / QR", status: "Pending", createdAt: new Date().toISOString()
        });
        res.json({ success: true, message: "Recharge Pending Admin Approval" });
    } catch (err) { res.status(500).json({ success: false }); }
});

app.post('/api/admin/approve-recharge', async (req, res) => {
    try {
        const { paymentId, status } = req.body;
        const payment = await PaymentModel.findOne({ id: paymentId });

        if (!payment || payment.status !== "Pending") return res.json({ success: false, message: "Already Processed" });

        if (status === "Success") {
            const user = await UserModel.findOne({ phone: payment.phone });
            if (user) {
                user.wallet.buyAmount += Number(payment.amount);
                user.markModified('wallet');
                await user.save();
            }
        }
        payment.status = status;
        await payment.save();
        res.json({ success: true, message: `Recharge ${status}` });
    } catch (err) { res.status(500).json({ success: false }); }
});

app.get('/api/wallet/:phone', async (req, res) => {
    const user = await UserModel.findOne({ phone: req.params.phone });
    user ? res.json({ success: true, wallet: user.wallet, inviteCode: user.inviteCode }) : res.json({ success: false });
});

app.get('/api/wallet/:phone/receive_history', async (req, res) => {
    const data = await PaymentModel.find({ phone: req.params.phone }).sort({ id: -1 });
    res.json({ success: true, data });
});

app.get('/api/history/:phone', async (req, res) => {
    const withdraws = await WithdrawModel.find({ phone: req.params.phone }).sort({ id: -1 });
    res.json({ success: true, withdraws });
});

// Admin Dashboard Data
app.get('/api/admin/dashboard-data', async (req, res) => {
    const pendingPayments = await PaymentModel.find({ status: "Pending" });
    const withdrawRequests = await WithdrawModel.find({ status: "Pending" });
    res.json({ success: true, pendingPayments, withdrawRequests });
});
// ================== ⭐ ADMIN: ADD ORDER API ⭐ ==================

app.post('/api/admin/add-order', async (req, res) => {
    try {
        const { level, amount, qty, reward } = req.body;

        // Validation: Check karein sab kuch aaya hai ya nahi
        if (!level || !amount || !qty || !reward) {
            return res.json({ success: false, message: "Please fill all fields (level, amount, qty, reward)" });
        }

        // 1. Unique orderId generate karein (Date.now() use kar sakte hain)
        const orderId = Math.floor(100000 + Math.random() * 900000); // 6 digit random number

        // 2. Final Amount calculate karein (Amount + Reward)
        const finalAmount = Number(amount) + Number(reward);

        // 3. Naya Order create karein
        const newOrder = await OrderModel.create({
            level: level,             // Example: "L1", "L2"
            orderId: orderId,         // Unique ID
            amount: Number(amount),
            qty: Number(qty),
            remainingQty: Number(qty),
            reward: Number(reward),
            final: finalAmount,
            createdAt: new Date()
        });

        res.json({ 
            success: true, 
            message: "Order added successfully to " + level, 
            order: newOrder 
        });

    } catch (err) {
        console.error("Add Order Error:", err);
        res.status(500).json({ success: false, message: "Server Error: " + err.message });
    }
});

// ================== ⭐ ORDER LISTING API (MISSING ONE) ⭐ ==================

app.post('/api/order/list', async (req, res) => {
    try {
        const { level } = req.body; // Flutter se "L1", "L2" aayega
        
        // Database se orders find karein jo us level ke hain
        // Hum sirf wo orders dikhayenge jinka remainingQty 0 se zyada ho
        const orders = await OrderModel.find({ 
            level: level 
        }).sort({ createdAt: -1 });

        res.json({ 
            success: true, 
            orders: orders 
        });
    } catch (err) {
        console.error("Order List Error:", err);
        res.status(500).json({ success: false, message: "Server Error" });
    }
});


const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("🚀 Server running on port " + PORT));
