const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const axios = require('axios');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(cors());
app.use(bodyParser.json());

// --------------------- Helper Functions ---------------------
function generateInviteCode() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    const nums = '0123456789';
    let code = '';
    for (let i = 0; i < 3; i++) code += chars.charAt(Math.floor(Math.random() * chars.length));
    for (let i = 0; i < 4; i++) code += nums.charAt(Math.floor(Math.random() * nums.length));
    return code;
}

// --------------------- File Persistence ---------------------
const userDataFile = path.join(__dirname, 'userData.json');
const adminDataFile = path.join(__dirname, 'adminData.json');

let userData = { allOrders: {}, users: [] };
let adminData = { pendingPayments: [], withdrawRequests: [] };

if (fs.existsSync(userDataFile)) {
    userData = JSON.parse(fs.readFileSync(userDataFile));
} else {
    userData = {
        allOrders: {
            "L1": [{ id: 101, amount: 101 }, { id: 102, amount: 150 }, { id: 103, amount: 200 }],
            "L2": [{ id: 201, amount: 250 }, { id: 202, amount: 350 }, { id: 203, amount: 400 }],
            "L3": [{ id: 301, amount: 450 }, { id: 302, amount: 550 }, { id: 303, amount: 600 }]
        },
        users: [
            { 
                phone: "1234567890", 
                password: "123", 
                inviteCode: "XYZ5566", 
                wallet: { buyQuantity: 0, buyAmount: 0, sellToday: 0, totalRevenue: 0 },
                paymentDetails: { upiMethod: "", upiId: "" } // ✅ Initialize empty details
            }
        ]
    };
    saveUserData();
}

if (fs.existsSync(adminDataFile)) adminData = JSON.parse(fs.readFileSync(adminDataFile));
else saveAdminData();

function saveUserData() { fs.writeFileSync(userDataFile, JSON.stringify(userData, null, 2)); }
function saveAdminData() { fs.writeFileSync(adminDataFile, JSON.stringify(adminData, null, 2)); }

// --------------------- BIND PAYMENT API (NEW) ---------------------
// ✅ User ki UPI details save karne ke liye
app.post('/api/bind-payment', (req, res) => {
    const { phone, upiMethod, upiId } = req.body;
    const user = userData.users.find(u => u.phone === phone);

    if (!user) {
        return res.json({ success: false, message: "User not found" });
    }

    // Details update karein
    user.paymentDetails = {
        upiMethod: upiMethod,
        upiId: upiId,
        boundAt: new Date().toISOString()
    };

    saveUserData(); // File mein save karein
    console.log(`Payment method ${upiMethod} bound for ${phone}`);
    
    res.json({ success: true, message: "Payment method bound successfully" });
});

// --------------------- ORDERS API ---------------------
app.get('/api/orders', (req, res) => {
    const { level, phone } = req.query;
    const user = userData.users.find(u => u.phone === phone);
    res.json({
        success: true,
        orders: userData.allOrders["L" + level] || [],
        wallet: user ? user.wallet : {}
    });
});

// --------------------- USER WALLET API ---------------------
app.get('/api/wallet/:phone', (req, res) => {
    const { phone } = req.params;
    const user = userData.users.find(u => u.phone === phone);
    if (!user) return res.json({ success: false });
    res.json({ 
        success: true, 
        wallet: user.wallet, 
        inviteCode: user.inviteCode,
        paymentDetails: user.paymentDetails || {} // ✅ Details bhi bhejien
    });
});

// --------------------- LOGIN ---------------------
app.post('/api/login', (req, res) => {
    const { phone, password } = req.body;
    const user = userData.users.find(u => u.phone === phone && u.password === password);
    if (user) res.json({ success: true, phone: user.phone, inviteCode: user.inviteCode });
    else res.json({ success: false });
});

// --------------------- REGISTER ---------------------
app.post('/api/register', (req, res) => {
    const { phone, password } = req.body;
    const exists = userData.users.find(u => u.phone === phone);
    if (exists) return res.json({ success: false, message: "User already exists" });

    const code = generateInviteCode();
    userData.users.push({
        phone,
        password,
        inviteCode: code,
        wallet: { buyQuantity: 0, buyAmount: 0, sellToday: 0, totalRevenue: 0 },
        paymentDetails: { upiMethod: "", upiId: "" } // ✅ Add during register
    });
    saveUserData();
    res.json({ success: true, inviteCode: code });
});

// --------------------- PAYMENT REQUEST ---------------------
app.post('/api/payment-request', (req, res) => {
    const { phone, amount, app } = req.body;
    adminData.pendingPayments.push({ id: Date.now(), phone, amount, app, status: "Pending" });
    saveAdminData();
    res.json({ success: true });
});

// --------------------- WITHDRAW REQUEST ---------------------
app.post('/api/withdraw', (req, res) => {
    const { phone, amount } = req.body;
    // Withdrawal ke waqt check karein ki UPI bind hai ya nahi
    const user = userData.users.find(u => u.phone === phone);
    if (!user || !user.paymentDetails || !user.paymentDetails.upiId) {
        return res.json({ success: false, message: "Please bind payment app first" });
    }

    adminData.withdrawRequests.push({ 
        id: Date.now(), 
        phone, 
        amount, 
        status: "Pending",
        upiDetails: user.paymentDetails // Admin ko dikhane ke liye
    });
    saveAdminData();
    res.json({ success: true });
});

// --------------------- ADMIN DASHBOARD ---------------------
app.get('/api/admin/dashboard-data', (req, res) => {
    res.json({
        success: true,
        pendingPayments: adminData.pendingPayments,
        withdrawRequests: adminData.withdrawRequests,
        totalUsers: userData.users.length
    });
});

// --------------------- ADMIN APPROVE PAYMENT ---------------------
app.post('/api/admin/approve-payment', (req, res) => {
    const { orderId, phone, amount } = req.body;
    const user = userData.users.find(u => u.phone === phone);
    if (!user) return res.json({ success: false });

    user.wallet.buyAmount += Number(amount);
    user.wallet.buyQuantity += 1;
    user.wallet.totalRevenue += Number(amount) * 0.05;

    adminData.pendingPayments = adminData.pendingPayments.filter(p => p.id !== orderId);

    saveUserData();
    saveAdminData();
    res.json({ success: true });
});

// --------------------- ADMIN APPROVE WITHDRAW ---------------------
app.post('/api/admin/approve-withdraw', (req, res) => {
    const { withdrawId, phone, amount } = req.body;
    const user = userData.users.find(u => u.phone === phone);
    if (!user) return res.json({ success: false });

    user.wallet.buyAmount -= Number(amount);
    user.wallet.sellToday += Number(amount);

    adminData.withdrawRequests = adminData.withdrawRequests.filter(w => w.id !== withdrawId);

    saveUserData();
    saveAdminData();
    res.json({ success: true });
});

// --------------------- USER HISTORY ---------------------
app.get('/api/history/:phone', (req, res) => {
    const { phone } = req.params;
    const payments = adminData.pendingPayments.filter(p => p.phone === phone);
    const withdraws = adminData.withdrawRequests.filter(w => w.phone === phone);
    res.json({ success: true, payments, withdraws });
});

// --------------------- DELETE USER ---------------------
app.delete('/api/admin/delete-user/:phone', (req, res) => {
    const { phone } = req.params;
    const userIndex = userData.users.findIndex(u => u.phone === phone);
    if (userIndex === -1) return res.json({ success: false, message: "User not found" });

    userData.users.splice(userIndex, 1);
    adminData.pendingPayments = adminData.pendingPayments.filter(p => p.phone !== phone);
    adminData.withdrawRequests = adminData.withdrawRequests.filter(w => w.phone !== phone);

    saveUserData();
    saveAdminData();
    res.json({ success: true, message: `User ${phone} deleted successfully` });
});

// --------------------- SELF-PING ---------------------
const backendUrl = `https://my-project-backend-n7jp.onrender.com/ping`;
setInterval(async () => {
    try { const response = await axios.get(backendUrl); console.log(`Self-ping successful: ${response.status}`); }
    catch (error) { console.error(`Self-ping failed: ${error.message}`); }
}, 10 * 60 * 1000);

app.get('/ping', (req, res) => res.status(200).send('I am awake!'));
// --------------------- CHANGE PASSWORD API ---------------------
app.post('/api/change-password', (req, res) => {
    const { phone, oldPassword, newPassword } = req.body;
    const user = userData.users.find(u => u.phone === phone);

    if (!user) {
        return res.json({ success: false, message: "User not found" });
    }

    if (user.password !== oldPassword) {
        return res.json({ success: false, message: "Old password is incorrect" });
    }

    user.password = newPassword;
    saveUserData();
    res.json({ success: true, message: "Password updated successfully" });
});


// --------------------- START SERVER ---------------------
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("Server Running on Port " + PORT));
