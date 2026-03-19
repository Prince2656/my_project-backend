const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const mongoose = require("mongoose");
const cron = require('node-cron'); // Cron logic ke liye

const app = express();
app.use(cors());
app.use(bodyParser.json());

// 1. ⭐ MongoDB Connection
mongoose.connect("mongodb+srv://admin:p.k1234.@myprojectcluster.vhkhhpm.mongodb.net/myproject?retryWrites=true&w=majority")
    .then(() => console.log("✅ MongoDB Connected"))
    .catch(err => console.log("❌ Mongo Error", err));

// 2. ⭐ MongoDB Schemas
const UserSchema = new mongoose.Schema({
    phone: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    inviteCode: String,
    referredBy: { type: String, default: null },
    wallet: {
    buyQuantity: { type: Number, default: 0 },
    buyAmount: { type: Number, default: 0 },
    buyToday: { type: Number, default: 0 }, // ⭐ Naya: Aaj ka deposit track karne ke liye
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

// 3. ⭐ Helper: Generate Invite Code
function generateInviteCode() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    const nums = '0123456789';
    let code = '';
    for (let i = 0; i < 3; i++) code += chars.charAt(Math.floor(Math.random() * chars.length));
    for (let i = 0; i < 4; i++) code += nums.charAt(Math.floor(Math.random() * nums.length));
    return code;
}

// ================== ⭐ AUTO RESET AT 12 AM ⭐ ==================
cron.schedule('0 0 * * *', async () => {
    try {
        // ⭐ Dono fields ko 0 kar rahe hain
        await UserModel.updateMany({}, { 
            $set: { "wallet.sellToday": 0, "wallet.buyToday": 0 } 
        });
        console.log(`✅ Midnight Reset (Buy & Sell) Success at ${new Date().toLocaleString()}`);
    } catch (err) {
        console.error("❌ Reset Error:", err);
    }
}, { timezone: "Asia/Kolkata" });


// ================== ⭐ APIs ⭐ ==================

// AUTH
app.post('/api/register', async (req, res) => {
    try {
        const { phone, password, referredBy } = req.body;
        const exists = await UserModel.findOne({ phone });
        if (exists) return res.json({ success: false, message: "User already exists" });

        const code = generateInviteCode();
        const newUser = new UserModel({
            phone, password, inviteCode: code, referredBy: referredBy || null,
            wallet: { buyQuantity: 0, buyAmount: 0, sellToday: 0, totalRevenue: 0 },
            paymentDetails: { upiMethod: "", upiId: "" }, myReferrals: []
        });

        if (referredBy) {
            const referrer = await UserModel.findOne({ inviteCode: referredBy });
            if (referrer) {
                referrer.myReferrals.push(phone);
                referrer.wallet.totalRevenue += 10;
                await referrer.save();
            }
        }
        await newUser.save();
        res.json({ success: true, inviteCode: code, message: "Registered Successfully" });
    } catch (err) { res.status(500).json({ success: false, message: "Server Error" }); }
});

app.post('/api/login', async (req, res) => {
    const { phone, password } = req.body;
    const user = await UserModel.findOne({ phone, password });
    if (user) return res.json({ success: true, phone: user.phone, inviteCode: user.inviteCode });
    res.json({ success: false, message: "Invalid credentials" });
});

// WALLET & BINDING
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

// ORDER SYSTEM
app.post('/api/order/add', async (req, res) => {
    const { level, amount, qty, customReward } = req.body;
    const levelStr = level.toString().toUpperCase().startsWith("L") ? level : "L" + level;
    const amt = Number(amount);
    const quantity = Number(qty) || 1;
    const reward = customReward ? Number(customReward) : Number((amt * 0.05).toFixed(2));
    
    const newOrder = { orderId: Date.now(), level: levelStr, amount: amt, qty: quantity, remainingQty: quantity, reward, final: amt + reward, createdAt: new Date() };
    await OrderModel.create(newOrder);
    res.json({ success: true, message: "Order added", order: newOrder });
});

app.post('/api/order/receive', async (req, res) => {
    try {
        const { phone, orderId } = req.body;
        const user = await UserModel.findOne({ phone: phone.trim() });
        const order = await OrderModel.findOne({ orderId: Number(orderId) });

        if (!user || !order) return res.json({ success: false, message: "User/Order not found" });
        if (order.remainingQty <= 0) return res.json({ success: false, message: "Limit reached" });

        // Update Order
        order.remainingQty -= 1; 
        await order.save();

        // Update Wallet with Force Number conversion
        let currentBalance = Number(user.wallet.buyAmount || 0);
        let orderAmt = Number(order.amount || 0);
        
        user.wallet.buyAmount = currentBalance + orderAmt;
        user.wallet.totalRevenue = Number(user.wallet.totalRevenue || 0) + Number(order.reward || 0);
        user.wallet.buyQuantity = Number(user.wallet.buyQuantity || 0) + 1;

        // Force Save
        user.markModified('wallet'); 
        await user.save();

        console.log(`✅ Balance Updated for ${phone}: New Balance = ${user.wallet.buyAmount}`);

        res.json({ success: true, wallet: user.wallet });
    } catch (err) { 
        console.error("❌ Receive Error:", err);
        res.status(500).json({ success: false }); 
    }
});


// WITHDRAW (FIXED: Added sellToday & Combined)
app.post('/api/withdraw', async (req, res) => {
    try {
        const { phone, amount } = req.body;
        const withdrawAmount = Number(amount);
        const user = await UserModel.findOne({ phone });

        if (!user || user.wallet.buyAmount < withdrawAmount) return res.json({ success: false, message: "Insufficient balance" });
        if (!user.paymentDetails?.upiId) return res.json({ success: false, message: "Bind UPI first" });

        // Deduction & Sell Today tracking
        user.wallet.buyAmount -= withdrawAmount;
        user.wallet.sellToday = (user.wallet.sellToday || 0) + withdrawAmount;
        
        user.markModified('wallet'); await user.save();

        await WithdrawModel.create({ 
            id: Date.now(), phone, amount: withdrawAmount, status: "Pending", 
            upiDetails: user.paymentDetails, createdAt: new Date().toISOString() 
        });

        res.json({ success: true, newBalance: user.wallet.buyAmount, sellToday: user.wallet.sellToday });
    } catch (err) { res.status(500).json({ success: false }); }
});

// PAYMENT REQUEST
app.post('/api/payment-request', async (req, res) => {
    const { phone, amount, app } = req.body;
    await PaymentModel.create({ id: Date.now(), phone, amount: Number(amount), app, status: "Pending", createdAt: new Date().toISOString() });
    res.json({ success: true, message: "Sent" });
});

// ADMIN & TEAM
app.get('/api/admin/dashboard-data', async (req, res) => {
    const pendingPayments = await PaymentModel.find({ status: "Pending" });
    const withdrawRequests = await WithdrawModel.find({ status: "Pending" });
    const totalUsers = await UserModel.countDocuments();
    res.json({ success: true, pendingPayments, withdrawRequests, totalUsers });
});
//================== ⭐ ADMIN PAYMENT APPROVAL (FIXED: Buy Today Update) ⭐ ==================
app.post('/api/admin/approve-payment', async (req, res) => {
    try {
        const { orderId, phone, amount } = req.body;
        const user = await UserModel.findOne({ phone: phone.trim() });

        if (user) {
            const amt = Number(amount);

            // 1. Total Balance mein paisa jodein
            user.wallet.buyAmount = (user.wallet.buyAmount || 0) + amt;

            // 2. ⭐ Today Received (buyToday) mein paisa jodein
            user.wallet.buyToday = (user.wallet.buyToday || 0) + amt;

            // 3. Optional: Referral ya Reward logic (agar aap 5% dena chahte hain)
            user.wallet.totalRevenue = (user.wallet.totalRevenue || 0) + (amt * 0.05);

            // 4. Mongoose ko batayein ki wallet update hua hai aur save karein
            user.markModified('wallet');
            await user.save();

            // 5. Payment request ka status change karein
            await PaymentModel.findOneAndUpdate({ id: orderId }, { status: "Approved" });

            console.log(`✅ Payment Approved: ₹${amt} added to ${phone}`);
            res.json({ success: true, message: "Payment Approved successfully" });
        } else {
            res.json({ success: false, message: "User not found" });
        }
    } catch (err) {
        console.error("❌ Approve Error:", err);
        res.status(500).json({ success: false, message: "Server Error" });
    }
});
// Ye API all users ka data degi stats calculate karne ke liye
app.get('/api/admin/all-users', async (req, res) => {
    try {
        const users = await UserModel.find({});
        res.json({ success: true, users });
    } catch (err) {
        res.status(500).json({ success: false, message: "Server Error" });
    }
});



// ⭐ Withdrawal Approve ya Reject karne ke liye API
app.post('/api/admin/handle-withdrawal', async (req, res) => {
    try {
        const { id, phone, amount, action } = req.body; 
        const withdrawId = Number(id);

        if (action === "Approved") {
            // Status update karein
            const updated = await WithdrawModel.findOneAndUpdate(
                { id: withdrawId }, 
                { status: "Approved" },
                { new: true }
            );
            return res.json({ success: true, message: "Withdrawal Approved" });
        } 
        
        if (action === "Rejected") {
            // Phone number ko trim karein taaki matching sahi ho
            const user = await UserModel.findOne({ phone: phone.trim() });
            
            if (!user) {
                return res.json({ success: false, message: "User not found" });
            }

            // ⭐ PAISE WAPAS USER KE WALLET MEIN DAALEIN
            const currentBalance = Number(user.wallet.buyAmount || 0);
            const refundAmt = Number(amount || 0);
            
            user.wallet.buyAmount = currentBalance + refundAmt;
            
            // Sell Today calculation fix
            user.wallet.sellToday = Math.max(0, (Number(user.wallet.sellToday) || 0) - refundAmt);

            user.markModified('wallet');
            await user.save();

            // Withdraw request status update
            await WithdrawModel.findOneAndUpdate(
                { id: withdrawId }, 
                { status: "Rejected" }
            );

            return res.json({ success: true, message: "Withdrawal Rejected & Refunded" });
        }

        // Agar action missing ho
        res.json({ success: false, message: "Invalid Action" });

    } catch (err) {
        console.error("ADMIN WITHDRAW ERROR:", err);
        res.status(500).json({ success: false, message: "Server Error" });
    }
});


app.get('/api/team/:phone', async (req, res) => {
    const user = await UserModel.findOne({ phone: req.params.phone });
    if (!user) return res.json({ success: false });
    const team = await UserModel.find({ phone: { $in: user.myReferrals } }).select('phone createdAt');
    res.json({ success: true, teamCount: user.myReferrals.length, teamMembers: team });
});

app.get('/api/history/:phone', async (req, res) => {
    const payments = await PaymentModel.find({ phone: req.params.phone }).sort({ id: -1 });
    const withdraws = await WithdrawModel.find({ phone: req.params.phone }).sort({ id: -1 });
    res.json({ success: true, payments, withdraws });
});

app.get('/ping', (req, res) => res.status(200).send('Active'));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log("🚀 Server running on port " + PORT);
    setInterval(() => axios.get(`https://my-project-backend-n7jp.onrender.com/ping`).catch(() => {}), 600000);
});
