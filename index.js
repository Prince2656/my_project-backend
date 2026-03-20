require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const mongoose = require("mongoose");
const cron = require('node-cron');

const app = express();
app.use(cors());
app.use(bodyParser.json());

// MongoDB Connection
const MONGO_URI = process.env.MONGO_URI || "mongodb+srv://admin:p.k1234.@myprojectcluster.vhkhhpm.mongodb.net/myproject?retryWrites=true&w=majority";
mongoose.connect(MONGO_URI)
    .then(() => console.log("✅ MongoDB Connected"))
    .catch(err => console.log("❌ Mongo Error:", err));
    const UserSchema = new mongoose.Schema({
    phone: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    inviteCode: { type: String, unique: true },
    referredBy: { type: String, default: null },
    isFrozen: { type: Boolean, default: false },
    wallet: {
        buyQuantity: { type: Number, default: 0 },   // Today's Order Count
        buyAmount: { type: Number, default: 0 },     // Home Page Total
        buyToday: { type: Number, default: 0 },      // Today's Total Amount
        todayRevenue: { type: Number, default: 0 },  // Today's Profit
        totalRevenue: { type: Number, default: 0 },  // Withdraw-able Balance
        sellToday: { type: Number, default: 0 }
    },
    paymentDetails: { upiMethod: String, upiId: String, boundAt: String },
    myReferrals: { type: Array, default: [] },
    createdAt: { type: Date, default: Date.now }
}, { versionKey: false });

const OrderSchema = new mongoose.Schema({ level: String, orderId: { type: Number, unique: true }, amount: Number, qty: Number, remainingQty: Number, reward: Number, final: Number, createdAt: { type: Date, default: Date.now } }, { versionKey: false });
const PaymentSchema = new mongoose.Schema({ id: Number, phone: String, amount: Number, app: String, utr: String, status: String, createdAt: String }, { versionKey: false });
const WithdrawSchema = new mongoose.Schema({ id: Number, phone: String, amount: Number, charge: Number, finalAmount: Number, status: String, upiDetails: Object, createdAt: String }, { versionKey: false });

const UserModel = mongoose.model("users", UserSchema);
const OrderModel = mongoose.model("orders", OrderSchema);
const PaymentModel = mongoose.model("payments", PaymentSchema);
const WithdrawModel = mongoose.model("withdraws", WithdrawSchema);
// Register API with Invite Logic
app.post('/api/register', async (req, res) => {
    try {
        const { phone, password, inviteCode } = req.body;
        const exists = await UserModel.findOne({ phone: phone.trim() });
        if (exists) return res.json({ success: false, message: "Phone already registered" });

        let referredByPhone = null;
        if (inviteCode) {
            const inviter = await UserModel.findOne({ inviteCode: inviteCode.toUpperCase() });
            if (inviter) referredByPhone = inviter.phone;
            else return res.json({ success: false, message: "Invalid Invite Code" });
        }

        const newUser = await UserModel.create({
            phone: phone.trim(),
            password,
            referredBy: referredByPhone,
            inviteCode: Math.random().toString(36).substring(2, 8).toUpperCase()
        });

        if (referredByPhone) {
            await UserModel.updateOne({ phone: referredByPhone }, { $push: { myReferrals: phone.trim() } });
        }
        res.json({ success: true, message: "Registered Successfully", data: newUser });
    } catch (err) { res.status(500).json({ success: false }); }
});

// Login API
app.post('/api/login', async (req, res) => {
    try {
        const { phone, password } = req.body;
        const user = await UserModel.findOne({ phone: phone.trim(), password });
        if (!user) return res.json({ success: false, message: "Invalid Phone or Password" });
        if (user.isFrozen) return res.json({ success: false, message: "Account Blocked" });
        res.json({ success: true, data: user });
    } catch (err) { res.status(500).json({ success: false }); }
});

// Order Receive - Updates Home Page & Balance
app.post('/api/order/receive', async (req, res) => {
    try {
        const { phone, orderId, utr } = req.body;
        const user = await UserModel.findOne({ phone: phone.trim() });
        const order = await OrderModel.findOne({ orderId: Number(orderId) });
        if (!user || !order) return res.json({ success: false, message: "Not found" });

        user.wallet.buyQuantity += 1;
        user.wallet.buyAmount += Number(order.amount);
        user.wallet.buyToday += Number(order.amount);
        user.wallet.todayRevenue += Number(order.reward);
        user.wallet.totalRevenue += (Number(order.amount) + Number(order.reward));

        user.markModified('wallet');
        await user.save();
        await PaymentModel.create({ id: Date.now(), phone: phone.trim(), amount: Number(order.amount), utr, status: "Pending", createdAt: new Date().toISOString() });
        res.json({ success: true, message: "Order Received!" });
    } catch (err) { res.status(500).json({ success: false }); }
});

// Backend API to send orders based on level
app.post('/api/order/list', async (req, res) => {
    try {
        const { level } = req.body;
        // Level ke orders dhundo (L1, L2, etc.)
        const orders = await OrderModel.find({ level: level }).sort({ amount: 1 });
        res.json({ success: true, orders });
    } catch (err) {
        res.status(500).json({ success: false });
    }
});

// Withdraw - Deducts ONLY from totalRevenue
app.post('/api/withdraw', async (req, res) => {
    try {
        const { phone, amount } = req.body;
        const user = await UserModel.findOne({ phone: phone.trim() });
        if (!user || user.wallet.totalRevenue < Number(amount)) return res.json({ success: false, message: "Insufficient Balance" });

        user.wallet.totalRevenue -= Number(amount);
        user.wallet.sellToday += Number(amount);
        user.markModified('wallet');
        await user.save();

        let charge = Number(amount) < 500 ? Number((Number(amount) * 0.03).toFixed(2)) : 0;
        await WithdrawModel.create({ id: Date.now(), phone, amount: Number(amount), charge, finalAmount: Number(amount)-charge, status: "Pending", upiDetails: user.paymentDetails, createdAt: new Date().toISOString() });
        res.json({ success: true, message: "Withdrawal Sent" });
    } catch (err) { res.status(500).json({ success: false }); }
});

// Midnight Reset Logic
cron.schedule('0 0 * * *', async () => {
    await UserModel.updateMany({}, { $set: { "wallet.sellToday": 0, "wallet.buyToday": 0, "wallet.todayRevenue": 0, "wallet.buyQuantity": 0 } });
    console.log("✅ Daily Reset Complete");
}, { timezone: "Asia/Kolkata" });

// Admin Dashboard Data
app.get('/api/admin/dashboard-data', async (req, res) => {
    const pendingPayments = await PaymentModel.find({ status: "Pending" });
    const withdrawRequests = await WithdrawModel.find({ status: "Pending" });
    const dStats = await PaymentModel.aggregate([{ $match: { status: "Success" } }, { $group: { _id: null, total: { $sum: "$amount" } } }]);
    const pStats = await WithdrawModel.aggregate([{ $match: { status: "Approved" } }, { $group: { _id: null, total: { $sum: "$amount" } } }]);

    res.json({ 
        success: true, pendingPayments, withdrawRequests, 
        stats: { totalDeposit: dStats[0]?.total || 0, totalWithdraw: pStats[0]?.total || 0 }
    });
});

// Port Start
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("🚀 Server running on port " + PORT));

