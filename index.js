const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(bodyParser.json());

function generateInviteCode() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    const nums = '0123456789';
    let code = '';
    for (let i = 0; i < 3; i++)
        code += chars.charAt(Math.floor(Math.random() * chars.length));
    for (let i = 0; i < 4; i++)
        code += nums.charAt(Math.floor(Math.random() * nums.length));
    return code;
}

// DATABASE MEMORY
let userData = {
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
            wallet: {
                buyQuantity: 0,
                buyAmount: 0,
                sellToday: 0,
                totalRevenue: 0
            }
        }
    ]
};

let adminData = {
    pendingPayments: [],
    withdrawRequests: []
};

// ⭐⭐⭐ ORDERS API (WITH USER WALLET, query params)
app.get('/api/orders', (req, res) => {
    const { level, phone } = req.query;
    const user = userData.users.find(u => u.phone === phone);

    res.json({
        success: true,
        orders: userData.allOrders["L" + level] || [],
        wallet: user ? user.wallet : {}
    });
});

// ⭐⭐⭐ USER WALLET API
app.get('/api/wallet/:phone', (req, res) => {
    const { phone } = req.params;
    const user = userData.users.find(u => u.phone === phone);

    if (!user) return res.json({ success: false });

    res.json({
        success: true,
        wallet: user.wallet,
        inviteCode: user.inviteCode
    });
});

// LOGIN
app.post('/api/login', (req, res) => {
    const { phone, password } = req.body;
    const user = userData.users.find(u => u.phone === phone && u.password === password);

    if (user)
        res.json({ success: true, phone: user.phone, inviteCode: user.inviteCode });
    else
        res.json({ success: false });
});

// REGISTER
app.post('/api/register', (req, res) => {
    const { phone, password } = req.body;
    const exists = userData.users.find(u => u.phone === phone);
    if (exists) return res.json({ success: false });

    const code = generateInviteCode();
    userData.users.push({
        phone,
        password,
        inviteCode: code,
        wallet: { buyQuantity: 0, buyAmount: 0, sellToday: 0, totalRevenue: 0 }
    });

    res.json({ success: true, inviteCode: code });
});

// ⭐⭐⭐ PAYMENT REQUEST
app.post('/api/payment-request', (req, res) => {
    const { phone, amount, app } = req.body;
    adminData.pendingPayments.push({ id: Date.now(), phone, amount, app, status: "Pending" });
    res.json({ success: true });
});

// ⭐⭐⭐ WITHDRAW REQUEST
app.post('/api/withdraw', (req, res) => {
    const { phone, amount } = req.body;
    adminData.withdrawRequests.push({ id: Date.now(), phone, amount, status: "Pending" });
    res.json({ success: true });
});

// ADMIN DASHBOARD
app.get('/api/admin/dashboard-data', (req, res) => {
    res.json({
        success: true,
        pendingPayments: adminData.pendingPayments,
        withdrawRequests: adminData.withdrawRequests,
        totalUsers: userData.users.length
    });
});

// ⭐⭐⭐ ADMIN APPROVE PAYMENT
app.post('/api/admin/approve-payment', (req, res) => {
    const { orderId, phone, amount } = req.body;
    const user = userData.users.find(u => u.phone === phone);
    if (!user) return res.json({ success: false });

    user.wallet.buyAmount += Number(amount);
    user.wallet.buyQuantity += 1;
    user.wallet.totalRevenue += Number(amount) * 0.05;

    adminData.pendingPayments = adminData.pendingPayments.filter(p => p.id !== orderId);
    res.json({ success: true });
});

// ⭐⭐⭐ ADMIN APPROVE WITHDRAW
app.post('/api/admin/approve-withdraw', (req, res) => {
    const { withdrawId, phone, amount } = req.body;
    const user = userData.users.find(u => u.phone === phone);
    if (!user) return res.json({ success: false });

    user.wallet.buyAmount -= Number(amount);
    user.wallet.sellToday += Number(amount);

    adminData.withdrawRequests = adminData.withdrawRequests.filter(w => w.id !== withdrawId);
    res.json({ success: true });
});

// ⭐⭐⭐ USER HISTORY API
app.get('/api/history/:phone', (req, res) => {
    const { phone } = req.params;
    const payments = adminData.pendingPayments.filter(p => p.phone === phone);
    const withdraws = adminData.withdrawRequests.filter(w => w.phone === phone);

    res.json({ success: true, payments, withdraws });
});

const axios = require('axios'); // अगर axios नहीं है, तो 'npm install axios' करें

// अपनी बैकएंड का URL यहाँ डालें (Render वाला URL)
const url = `https://my-project-backend-n7jp.onrender.com/ping`; 

// हर 14 मिनट में खुद को कॉल करने वाला फंक्शन
setInterval(async () => {
  try {
    const response = await axios.get(url);
    console.log(`Self-ping successful: ${response.status}`);
  } catch (error) {
    console.error(`Self-ping failed: ${error.message}`);
  }
}, 14 * 60 * 1000); // 14 minutes in milliseconds

// एक छोटा सा 'ping' रूट भी बना लें
app.get('/ping', (req, res) => {
  res.status(200).send('I am awake!');
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("Server Running on Port " + PORT));