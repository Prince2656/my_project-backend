const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const mongoose = require("mongoose");

const app = express();
app.use(cors());
app.use(bodyParser.json());

// 1. ⭐ MongoDB Connection
mongoose.connect("mongodb+srv://admin:p.k1234.@myprojectcluster.vhkhhpm.mongodb.net/myproject?retryWrites=true&w=majority")
    .then(() => console.log("✅ MongoDB Connected"))
    .catch(err => console.log("❌ Mongo Error", err));

// 2. ⭐ MongoDB Schemas (Sahi Structure)
const UserSchema = new mongoose.Schema({
    phone: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    inviteCode: String,
    referredBy: { type: String, default: null },
    wallet: {
        buyQuantity: { type: Number, default: 0 },
        buyAmount: { type: Number, default: 0 },
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
    level: String, orderId: Number, amount: Number, qty: Number, 
    remainingQty: Number, reward: Number, final: Number, createdAt: Date
}, { versionKey: false });

const PaymentSchema = new mongoose.Schema({ 
    id: Number, phone: String, amount: Number, app: String, status: String, createdAt: String 
}, { versionKey: false });

const WithdrawSchema = new mongoose.Schema({ 
    id: Number, phone: String, amount: Number, status: String, upiDetails: Object, createdAt: String 
}, { versionKey: false });

const UserModel = mongoose.model("users", UserSchema);
const OrderModel = mongoose.model("orders", OrderSchema);
const PaymentModel = mongoose.model("payments", PaymentSchema);
const WithdrawModel = mongoose.model("withdraws", WithdrawSchema);

// 3. ⭐ Persistence (JSON Fallback)
const userDataFile = path.join(__dirname, 'userData.json');
const adminDataFile = path.join(__dirname, 'adminData.json');
let userData = { allOrders: {}, users: [] };
let adminData = { pendingPayments: [], withdrawRequests: [] };

function saveData() {
    fs.writeFileSync(userDataFile, JSON.stringify(userData, null, 2));
    fs.writeFileSync(adminDataFile, JSON.stringify(adminData, null, 2));
}

// 4. ⭐ Helper: Generate Invite Code
function generateInviteCode() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    const nums = '0123456789';
    let code = '';
    for (let i = 0; i < 3; i++) code += chars.charAt(Math.floor(Math.random() * chars.length));
    for (let i = 0; i < 4; i++) code += nums.charAt(Math.floor(Math.random() * nums.length));
    return code;
}

// --------------------- ALL APIs MERGED ---------------------

// 5. ⭐ AUTH (Register & Login)
app.post('/api/register', async (req, res) => {
    try {
        const { phone, password, referredBy } = req.body;
        const exists = await UserModel.findOne({ phone });
        if (exists) return res.json({ success: false, message: "User already exists" });

        const code = generateInviteCode();
        const newUser = {
            phone, password, inviteCode: code, referredBy: referredBy || null,
            wallet: { buyQuantity: 0, buyAmount: 0, sellToday: 0, totalRevenue: 0 },
            paymentDetails: { upiMethod: "", upiId: "" }, myReferrals: []
        };

        if (referredBy) {
            const referrer = await UserModel.findOne({ inviteCode: referredBy });
            if (referrer) {
                referrer.myReferrals.push(phone);
                referrer.wallet.totalRevenue += 10;
                await referrer.save();
            }
        }
        await new UserModel(newUser).save();
        res.json({ success: true, inviteCode: code, message: "Registered Successfully" });
    } catch (err) { res.status(500).json({ success: false, message: "Server Error" }); }
});

app.post('/api/login', async (req, res) => {
    const { phone, password } = req.body;
    const user = await UserModel.findOne({ phone, password });
    if (user) return res.json({ success: true, phone: user.phone, inviteCode: user.inviteCode });
    res.json({ success: false, message: "Invalid credentials" });
});

// 6. ⭐ WALLET & BINDING
app.get('/api/wallet/:phone', async (req, res) => {
    const user = await UserModel.findOne({ phone: req.params.phone });
    if (user) return res.json({ success: true, wallet: user.wallet, inviteCode: user.inviteCode, paymentDetails: user.paymentDetails || {} });
    res.status(404).json({ success: false, message: "User not found" });
});

app.post('/api/bind-payment', async (req, res) => {
    const { phone, upiMethod, upiId } = req.body;
    const paymentData = { upiMethod, upiId, boundAt: new Date().toISOString() };
    const user = await UserModel.findOneAndUpdate({ phone }, { $set: { paymentDetails: paymentData } }, { new: true });
    if (user) res.json({ success: true, message: "Payment method bound", data: paymentData });
    else res.json({ success: false, message: "User not found" });
});

// 7. ⭐ ORDER SYSTEM (Global & Receive)
app.post('/api/order/add', async (req, res) => {
    const { level, amount, qty, customReward } = req.body;
    const levelStr = level.toString().toUpperCase().startsWith("L") ? level : "L" + level;
    const amt = Number(amount);
    const quantity = Number(qty) || 1;
    const reward = customReward ? Number(customReward) : Number((amt * 0.05).toFixed(2));
    
    const newOrder = { orderId: Date.now(), level: levelStr, amount: amt, qty: quantity, remainingQty: quantity, reward, final: amt + reward, createdAt: new Date() };
    await OrderModel.create(newOrder);
    res.json({ success: true, message: "Order added for all users", order: newOrder });
});

app.post('/api/order/list', async (req, res) => {
    const { level } = req.body;
    const levelKey = level.toString().toUpperCase().startsWith("L") ? level : "L" + level;
    const orders = await OrderModel.find({ level: levelKey, remainingQty: { $gt: 0 } }).sort({ orderId: -1 });
    res.json({ success: true, orders });
});

app.post('/api/order/receive', async (req, res) => {
    const { phone, orderId } = req.body;
    const user = await UserModel.findOne({ phone: phone.trim() });
    const order = await OrderModel.findOne({ orderId: Number(orderId) });

    if (!user || !order || order.remainingQty <= 0) return res.json({ success: false, message: "Order limit reached or invalid" });

    order.remainingQty -= 1; await order.save();
    user.wallet.buyAmount += Number(order.amount);
    user.wallet.totalRevenue += Number(order.reward);
    user.wallet.buyQuantity += 1;
    await user.save();
    res.json({ success: true, message: "Order processed", wallet: user.wallet });
});

// 8. ⭐ WITHDRAW & PAYMENTS
app.post('/api/payment-request', async (req, res) => {
    const { phone, amount, app } = req.body;
    const payId = Date.now();
    await PaymentModel.create({ id: payId, phone, amount: Number(amount), app, status: "Pending", createdAt: new Date().toISOString() });
    res.json({ success: true, message: "Payment Request Sent", id: payId });
});

app.post('/api/withdraw', async (req, res) => {
    const { phone, amount } = req.body;
    const user = await UserModel.findOne({ phone });
    if (!user || user.wallet.buyAmount < Number(amount)) return res.json({ success: false, message: "Insufficient balance" });
    if (!user.paymentDetails?.upiId) return res.json({ success: false, message: "Bind UPI first" });

    user.wallet.buyAmount -= Number(amount); // Deduction
    await user.save();
    await WithdrawModel.create({ id: Date.now(), phone, amount: Number(amount), status: "Pending", upiDetails: user.paymentDetails, createdAt: new Date().toISOString() });
    res.json({ success: true, message: "Withdraw Submitted", newBalance: user.wallet.buyAmount });
});

// 9. ⭐ ADMIN DASHBOARD & TEAM
app.get('/api/admin/dashboard-data', async (req, res) => {
    const pendingPayments = await PaymentModel.find({ status: "Pending" });
    const withdrawRequests = await WithdrawModel.find({ status: "Pending" });
    const totalUsers = await UserModel.countDocuments();
    res.json({ success: true, pendingPayments, withdrawRequests, totalUsers });
});

app.post('/api/admin/approve-payment', async (req, res) => {
    const { orderId, phone, amount } = req.body;
    const user = await UserModel.findOne({ phone });
    if (user) {
        user.wallet.buyAmount += Number(amount);
        user.wallet.totalRevenue += (Number(amount) * 0.05);
        await user.save();
        await PaymentModel.findOneAndUpdate({ id: orderId }, { status: "Approved" });
        res.json({ success: true, message: "Payment Approved" });
    } else res.json({ success: false, message: "User not found" });
});

app.get('/api/team/:phone', async (req, res) => {
    const user = await UserModel.findOne({ phone: req.params.phone });
    if (!user) return res.json({ success: false, message: "User not found" });
    const team = await UserModel.find({ phone: { $in: user.myReferrals } }).select('phone createdAt');
    res.json({ success: true, teamCount: user.myReferrals.length, teamMembers: team });
});

app.get('/api/history/:phone', async (req, res) => {
    const payments = await PaymentModel.find({ phone: req.params.phone }).sort({ id: -1 });
    const withdraws = await WithdrawModel.find({ phone: req.params.phone }).sort({ id: -1 });
    res.json({ success: true, payments, withdraws });
});

// 10. ⭐ MAINTENANCE & SYSTEM
app.delete('/api/admin/delete-user/:phone', async (req, res) => {
    await UserModel.findOneAndDelete({ phone: req.params.phone });
    await PaymentModel.deleteMany({ phone: req.params.phone });
    await WithdrawModel.deleteMany({ phone: req.params.phone });
    res.json({ success: true, message: "User deleted" });
});

app.post('/api/change-password', async (req, res) => {
    const { phone, oldPassword, newPassword } = req.body;
    const user = await UserModel.findOne({ phone, password: oldPassword });
    if (user) {
        user.password = newPassword; await user.save();
        res.json({ success: true, message: "Password updated" });
    } else res.json({ success: false, message: "Invalid old password" });
});

app.get('/ping', (req, res) => res.status(200).send('Active'));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log("🚀 Server running on port " + PORT);
    setInterval(() => axios.get(`https://my-project-backend-n7jp.onrender.com/ping`).catch(() => {}), 600000);
});
