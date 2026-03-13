const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(bodyParser.json());

// Unique Mixed Invite Code Banane ka Function (ABCD123 style)
function generateInviteCode() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    const nums = '0123456789';
    let code = '';
    // 3 Alphabets
    for (let i = 0; i < 3; i++) code += chars.charAt(Math.floor(Math.random() * chars.length));
    // 4 Digits
    for (let i = 0; i < 4; i++) code += nums.charAt(Math.floor(Math.random() * nums.length));
    return code; // Example: KJT5829
}

let userData = {
    wallet: { buyQuantity: 0, buyAmount: 0.0, sellToday: 0.0, totalRevenue: 0.0 },
    allOrders: {
        "L1": [{ id: 101, amount: 101.0, reward: 5.05 }, { id: 102, amount: 150.0, reward: 7.50 }, { id: 103, amount: 200.0, reward: 10.0 }],
        "L2": [{ id: 201, amount: 250.0, reward: 12.50 }, { id: 202, amount: 350.0, reward: 17.50 }, { id: 203, amount: 400.0, reward: 20.0 }],
        "L3": [{ id: 301, amount: 450.0, reward: 22.50 }, { id: 302, amount: 550.0, reward: 27.50 }, { id: 303, amount: 600.0, reward: 30.0 }],
        "L4": [{ id: 401, amount: 1000.0, reward: 50.0 }, { id: 402, amount: 2500.0, reward: 125.0 }, { id: 403, amount: 4000.0, reward: 200.0 }],
        "L5": [{ id: 501, amount: 4500.0, reward: 225.0 }, { id: 502, amount: 5500.0, reward: 275.0 }, { id: 503, amount: 600.0, reward: 300.0 }],
        "L6": [{ id: 601, amount: 7000.0, reward: 350.0 }, { id: 602, amount: 10000.0, reward: 500.0 }, { id: 603, amount: 12000.0, reward: 600.0 }],
        "L7": [{ id: 701, amount: 15000.0, reward: 750.0 }, { id: 702, amount: 18000.0, reward: 900.0 }, { id: 703, amount: 20000.0, reward: 1000.0 }]
    },
    // Shuruat mein ek user rakha hai
    users: [{ phone: "1234567890", password: "123", inviteCode: "XYZ5566" }]
};

app.get('/api/orders/:level', (req, res) => {
    const level = req.params.level;
    res.json({ success: true, orders: userData.allOrders[level] || [], wallet: userData.wallet });
});

app.get('/api/all-data', (req, res) => {
    res.json({ wallet: userData.wallet, orders: userData.allOrders["L1"] });
});

app.post('/api/pay', (req, res) => {
    const { amount } = req.body;
    const buyValue = parseFloat(amount);
    userData.wallet.buyAmount = parseFloat((userData.wallet.buyAmount + buyValue).toFixed(2));
    userData.wallet.buyQuantity += 1;
    const profit = buyValue * 0.05;
    userData.wallet.totalRevenue = parseFloat((userData.wallet.totalRevenue + profit).toFixed(2));
    res.json({ success: true, newWallet: userData.wallet });
});

// --- LOGIN ---
app.post('/api/login', (req, res) => {
    const { phone, password } = req.body;
    const user = userData.users.find(u => u.phone === phone && u.password === password);
    if (user) {
        res.json({ success: true, phone: user.phone, inviteCode: user.inviteCode });
    } else {
        res.json({ success: false, message: "Details match nahi hui! Pehle Register karein." });
    }
});

// --- REGISTER (Unique Mixed Invite Code Logic) ---
app.post('/api/register', (req, res) => {
    const { phone, password } = req.body;
    const exists = userData.users.find(u => u.phone === phone);
    if (exists) return res.json({ success: false, message: "Number pehle se registered hai!" });

    const mixedCode = generateInviteCode(); // Naya Mixed Code
    
    userData.users.push({ 
        phone, 
        password, 
        inviteCode: mixedCode 
    });
    
    console.log(`Naya User: ${phone}, Code: ${mixedCode}`);
    res.json({ success: true, message: "Registration Success!", inviteCode: mixedCode });
});
// --- OWNER ACCESS: Saare users ka data dekhne ke liye ---
// --- OWNER ACCESS API ---
app.get('/api/admin/all-users', (req, res) => {
    // Saare users ki details array se map karke nikal rahe hain
    const adminData = userData.users.map(u => ({
        phone: u.phone,
        inviteCode: u.inviteCode || "N/A",
        buyAmount: u.wallet ? u.wallet.buyAmount : 0,
        totalRevenue: u.wallet ? u.wallet.totalRevenue : 0,
        withdrawal: u.wallet ? u.wallet.sellToday : 0
    }));
    
    res.json({
        success: true,
        users: adminData
    });
});
// Database mein ye arrays add karein
let adminData = {
    pendingPayments: [], // { phone, amount, app, status }
    withdrawRequests: [] // { phone, amount, walletId, status }
};

// --- USER SIDE: Payment Approval ke liye request bhejna ---
app.post('/api/request-buy', (req, res) => {
    const { phone, amount, app } = req.body;
    adminData.pendingPayments.push({ phone, amount, app, status: 'Pending', id: Date.now() });
    res.json({ success: true, message: "Sent to Owner for verification" });
});

// --- OWNER SIDE: Saare pending data fetch karna ---
app.get('/api/admin/dashboard-data', (req, res) => {
    res.json({ 
        success: true, 
        pendingPayments: adminData.pendingPayments,
        withdrawRequests: adminData.withdrawRequests,
        totalUsers: userData.users.length
    });
});

// --- OWNER SIDE: Approve Payment Logic ---
app.post('/api/admin/approve-payment', (req, res) => {
    const { orderId, phone, amount } = req.body;
    
    // 1. User ka wallet update karein
    const user = userData.users.find(u => u.phone === phone);
    if (user) {
        user.wallet.buyAmount += parseFloat(amount);
        user.wallet.buyQuantity += 1;
        user.wallet.totalRevenue += (parseFloat(amount) * 0.05); // 5% Profit
    }
    
    // 2. Pending list se hatayein
    adminData.pendingPayments = adminData.pendingPayments.filter(p => p.id !== orderId);
    
    res.json({ success: true });
});
// --- OWNER LOGIC: Payment ko verify karke balance badhana ---
app.post('/api/admin/approve-payment', (req, res) => {
    const { orderId, phone, amount } = req.body;
    
    // 1. User ko database mein dhoondhein
    const user = userData.users.find(u => u.phone === phone);
    
    if (user) {
        // 2. User ka balance update karein
        user.wallet.buyAmount += parseFloat(amount);
        user.wallet.buyQuantity += 1;
        // 5% Profit bhi add karein
        user.wallet.totalRevenue += (parseFloat(amount) * 0.05);
        
        // 3. Pending list se ye request hata dein
        adminData.pendingPayments = adminData.pendingPayments.filter(p => p.id !== orderId);
        
        res.json({ success: true, message: "Balance updated successfully" });
    } else {
        res.status(404).json({ success: false, message: "User not found" });
    }
});

const PORT = 3000;
app.listen(PORT, () => console.log(`Backend Live on http://localhost:${PORT}`));