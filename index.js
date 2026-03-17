const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const axios = require('axios');
const fs = require('fs');
const path = require('path');

const mongoose = require("mongoose");

// ⭐⭐⭐ MongoDB Schemas (SAFE)
const UserSchema = new mongoose.Schema({
    phone: String,
    password: String,
    inviteCode: String,
    referredBy: String,
    wallet: Object,
    paymentDetails: Object,
    myReferrals: Array
},{ versionKey:false });

const OrderSchema = new mongoose.Schema({
    level: String,
    orderId: Number,
    amount: Number,
    qty: Number,
    remainingQty: Number,
    reward: Number,
    final: Number
},{ versionKey:false });

const PaymentSchema = new mongoose.Schema({
    id:Number,
    phone:String,
    amount:Number,
    app:String,
    status:String
},{ versionKey:false });

const WithdrawSchema = new mongoose.Schema({
    id:Number,
    phone:String,
    amount:Number,
    status:String,
    upiDetails:Object
},{ versionKey:false });

const UserModel = mongoose.model("users",UserSchema);
const OrderModel = mongoose.model("orders",OrderSchema);
const PaymentModel = mongoose.model("payments",PaymentSchema);
const WithdrawModel = mongoose.model("withdraws",WithdrawSchema);

// ⭐⭐⭐ MongoDB Connection ADD
mongoose.connect(
"mongodb+srv://admin:p.k1234.@myprojectcluster.vhkhhpm.mongodb.net/myproject?retryWrites=true&w=majority"
)
.then(()=>console.log("✅ MongoDB Connected"))
.catch(err=>console.log("❌ Mongo Error", err));

const app = express();
app.use(cors());
app.use(bodyParser.json());

// --------------------- Helper Functions ---------------------

/**
 * Unique Invite Code Generate karne ke liye.
 * Logic: 3 Letters + 4 Numbers (e.g., ABC1234)
 */
function generateInviteCode() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    const nums = '0123456789';
    let code = '';
    
    // Pehle 3 characters random letters honge
    for (let i = 0; i < 3; i++) {
        code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    
    // Baaki ke 4 characters random numbers honge
    for (let i = 0; i < 4; i++) {
        code += nums.charAt(Math.floor(Math.random() * nums.length));
    }
    
    return code;
}

// ------------------------------------------------------------


// --------------------- Persistence & Sync Logic ---------------------

const userDataFile = path.join(__dirname, 'userData.json');
const adminDataFile = path.join(__dirname, 'adminData.json');

// Memory mein data maintain rakhne ke liye
let userData = { allOrders: {}, users: [] };
let adminData = { pendingPayments: [], withdrawRequests: [] };

// ⭐ Ye function JSON aur Mongo dono mein save karega (Double Safety)
function saveUserData() { 
    try {
        fs.writeFileSync(userDataFile, JSON.stringify(userData, null, 2)); 
    } catch (err) {
        console.error("JSON Save Error:", err);
    }
}

function saveAdminData() { 
    try {
        fs.writeFileSync(adminDataFile, JSON.stringify(adminData, null, 2)); 
    } catch (err) {
        console.error("Admin JSON Save Error:", err);
    }
}

// ⭐ File Loading Logic
if (fs.existsSync(userDataFile)) {
    userData = JSON.parse(fs.readFileSync(userDataFile));
} else {
    // Default Data
    userData = {
        allOrders: {
            "L1": [{ id: 101, amount: 101 }, { id: 102, amount: 150 }, { id: 103, amount: 200 }],
            "L2": [{ id: 201, amount: 250 }, { id: 202, amount: 350 }, { id: 203, amount: 400 }],
            "L3": [{ id: 301, amount: 450 }, { id: 302, amount: 550 }, { id: 303, amount: 600 }],
            "L4": [{ id: 401, amount: 650 }, { id: 402, amount: 750 }, { id: 403, amount: 800 }],
            "L5": [{ id: 501, amount: 850 }, { id: 502, amount: 950 }, { id: 503, amount: 1000 }],
            "L6": [{ id: 601, amount: 1050 }, { id: 602, amount: 1150 }, { id: 603, amount: 1200 }],
            "L7": [{ id: 701, amount: 1250 }, { id: 702, amount: 1350 }, { id: 703, amount: 1400 }],
        },
        users: [] // Initial users list empty rakhenge, Mongo se load hogi
    };
    saveUserData();
}

if (fs.existsSync(adminDataFile)) {
    adminData = JSON.parse(fs.readFileSync(adminDataFile));
} else {
    saveAdminData();
}
// --------------------- BIND PAYMENT API (UPDATED) ---------------------

// ✅ User ki UPI details save karne ke liye (Mongo + JSON Sync)
app.post('/api/bind-payment', async (req, res) => {
    try {
        const { phone, upiMethod, upiId } = req.body;

        // 1. JSON file mein update karein (for immediate local sync)
        const userInJson = userData.users.find(u => u.phone === phone);
        
        const paymentData = {
            upiMethod: upiMethod,
            upiId: upiId,
            boundAt: new Date().toISOString()
        };

        if (userInJson) {
            userInJson.paymentDetails = paymentData;
            saveUserData(); // File mein save karein
        }

        // 2. MongoDB mein update karein (Permanent Storage)
        // Isse Render restart hone par bhi data safe rahega
        const updatedUser = await UserModel.findOneAndUpdate(
            { phone: phone },
            { $set: { paymentDetails: paymentData } },
            { new: true }
        );

        if (!updatedUser) {
            return res.json({ success: false, message: "User not found in Database" });
        }

        console.log(`✅ Payment method ${upiMethod} bound for ${phone}`);
        res.json({ 
            success: true, 
            message: "Payment method bound successfully",
            data: paymentData 
        });

    } catch (err) {
        console.error("Bind Payment Error:", err);
        res.json({ success: false, message: "Server Error during binding" });
    }
});

// --------------------- ORDERS API (UPDATED) ---------------------

app.get('/api/orders', async (req, res) => {
    try {
        const { level, phone } = req.query;

        // 1. Wallet balance hamesha Live Database (Mongo) se lein
        // Isse agar Render restart bhi ho jaye, user ka paisa sahi dikhega
        const user = await UserModel.findOne({ phone: phone });

        // 2. Agar user nahi milta (Optional check)
        if (!user && phone) {
            console.log(`User ${phone} not found in DB for Orders API`);
        }

        // 3. Response bhejien
        res.json({
            success: true,
            // Orders aapki JSON file (userData.allOrders) se aa rahe hain
            orders: userData.allOrders["L" + level] || [],
            // Wallet hamesha MongoDB wala (Live) dikhayenge
            wallet: user ? user.wallet : (userData.users.find(u => u.phone === phone)?.wallet || {})
        });

    } catch (err) {
        console.error("Orders API Error:", err);
        res.json({ 
            success: false, 
            message: "Server Error",
            orders: [],
            wallet: {} 
        });
    }
});


// --------------------- USER WALLET API (UPDATED) ---------------------

app.get('/api/wallet/:phone', async (req, res) => {
    try {
        const { phone } = req.params;

        // 1. MongoDB se user ka live data nikalenge
        const user = await UserModel.findOne({ phone: phone });

        // 2. Agar user DB mein nahi mila, toh JSON fallback check karenge
        if (!user) {
            const jsonUser = userData.users.find(u => u.phone === phone);
            if (!jsonUser) {
                return res.json({ success: false, message: "User not found" });
            }
            
            // JSON se return karein (Sirf backup ke liye)
            return res.json({ 
                success: true, 
                wallet: jsonUser.wallet, 
                inviteCode: jsonUser.inviteCode,
                paymentDetails: jsonUser.paymentDetails || {}
            });
        }

        // 3. Success Response (Live Data)
        res.json({ 
            success: true, 
            wallet: user.wallet, 
            inviteCode: user.inviteCode,
            paymentDetails: user.paymentDetails || {} // ✅ Live details
        });

    } catch (err) {
        console.error("Wallet API Error:", err);
        res.status(500).json({ success: false, message: "Server Error" });
    }
});

// --------------------- LOGIN (UPDATED) ---------------------

app.post('/api/login', async (req, res) => {
    try {
        const { phone, password } = req.body;

        // 1. Pehle MongoDB mein user ko dhundhein (Live & Secure)
        const user = await UserModel.findOne({ phone: phone, password: password });

        if (user) {
            // Agar user mil gaya, toh success response bhejien
            return res.json({ 
                success: true, 
                phone: user.phone, 
                inviteCode: user.inviteCode 
            });
        } 

        // 2. Fallback: Agar naya user DB mein nahi hai, toh purane JSON mein check karein (Sirf migration ke liye)
        const legacyUser = userData.users.find(u => u.phone === phone && u.password === password);
        
        if (legacyUser) {
            return res.json({ 
                success: true, 
                phone: legacyUser.phone, 
                inviteCode: legacyUser.inviteCode 
            });
        }

        // 3. Agar kahin nahi mila toh Login Fail
        res.json({ success: false, message: "Invalid phone or password" });

    } catch (err) {
        console.error("Login Error:", err);
        res.status(500).json({ success: false, message: "Server Error" });
    }
});

// --------------------- REGISTER (UPDATED & SYNCED) ---------------------

app.post('/api/register', async (req, res) => {
    try {
        const { phone, password, referredBy } = req.body; // referredBy (Invite Code) include kiya

        // 1. Double Check: JSON aur MongoDB dono mein check karein
        const existsInJson = userData.users.find(u => u.phone === phone);
        const existsInDb = await UserModel.findOne({ phone: phone });

        if (existsInJson || existsInDb) {
            return res.json({ success: false, message: "User already exists" });
        }

        const code = generateInviteCode();

        const newUser = {
            phone,
            password,
            inviteCode: code,
            referredBy: referredBy || null,
            wallet: {
                buyQuantity: 0,
                buyAmount: 0,
                sellToday: 0,
                totalRevenue: 0
            },
            paymentDetails: {
                upiMethod: "",
                upiId: ""
            },
            myReferrals: []
        };

        // 2. Referral Logic (Bina logic delete kiye)
        if (referredBy) {
            // MongoDB mein Referrer ko dhundhein
            const referrer = await UserModel.findOne({ inviteCode: referredBy });
            if (referrer) {
                referrer.myReferrals.push(phone);
                referrer.wallet.totalRevenue += 10; // Bonus logic
                await referrer.save();
                
                // JSON mein bhi update karein sync rakhne ke liye
                const referrerJson = userData.users.find(u => u.inviteCode === referredBy);
                if (referrerJson) {
                    referrerJson.myReferrals.push(phone);
                    referrerJson.wallet.totalRevenue += 10;
                }
            }
        }

        // 3. ⭐ Mongo SAVE (Permanent)
        await new UserModel(newUser).save();

        // 4. ⭐ JSON SAVE (Local Memory)
        userData.users.push(newUser);
        saveUserData();

        res.json({
            success: true,
            inviteCode: code,
            message: "User Registered Successfully"
        });

    } catch (err) {
        console.log("Register Error:", err);
        res.status(500).json({
            success: false,
            message: "Server Error"
        });
    }
});

// --------------------- PAYMENT REQUEST (UPDATED) ---------------------

app.post('/api/payment-request', async (req, res) => {
    try {
        const { phone, amount, app } = req.body;

        // 1. Basic validation aur Number check
        if (!phone || !amount || !app || isNaN(amount)) {
            return res.json({
                success: false,
                message: "Invalid or missing fields"
            });
        }

        const paymentId = Date.now();

        const paymentData = {
            id: paymentId,
            phone,
            amount: Number(amount),
            app,
            status: "Pending",
            createdAt: new Date().toISOString() // Track karne ke liye date zaroori hai
        };

        // 2. ⭐ JSON SAVE (Local Backup)
        adminData.pendingPayments.push(paymentData);
        saveAdminData();

        // 3. ⭐ Mongo SAVE (Permanent)
        // Ensure PaymentModel exists and is connected
        const newPayment = new PaymentModel(paymentData);
        await newPayment.save();

        res.json({
            success: true,
            message: "Payment Request Submitted Successfully",
            id: paymentId
        });

    } catch (err) {
        console.error("❌ Payment Request Error:", err);
        res.status(500).json({
            success: false,
            message: "Server Error. Please try again later."
        });
    }
});

// --------------------- WITHDRAW REQUEST (UPDATED WITH AUTO-DEDUCT) ---------------------

app.post('/api/withdraw', async (req, res) => {
    try {
        const { phone, amount } = req.body;
        const withdrawAmount = Number(amount);

        // 1. Basic validation (⭐ FIXED: Added || operators)
        if (!phone || !withdrawAmount || withdrawAmount <= 0) {
            return res.json({
                success: false,
                message: "Invalid or missing fields"
            });
        }

        // 2. MongoDB se Live User Data nikalna
        const user = await UserModel.findOne({ phone: phone });

        if (!user) {
            return res.json({ success: false, message: "User not found" });
        }

        // 3. UPI Bind Check (⭐ FIXED: Added || operator)
        if (!user.paymentDetails || !user.paymentDetails.upiId) {
            return res.json({
                success: false,
                message: "Please bind payment app first"
            });
        }

        // 4. ⭐️ BALANCE CHECK (Logic Addition)
        if (user.wallet.buyAmount < withdrawAmount) {
            return res.json({
                success: false,
                message: "Insufficient balance in wallet"
            });
        }

        // ⭐️ NEW LOGIC: BALANCE DEDUCTION (Paisa katna)
        user.wallet.buyAmount -= withdrawAmount;
        
        // Agar aap JSON backup bhi use kar rahe hain toh wahan bhi update karein
        if (typeof userData !== 'undefined' && userData.users) {
            const jsonUser = userData.users.find(u => u.phone === phone);
            if (jsonUser) {
                jsonUser.wallet.buyAmount -= withdrawAmount;
            }
        }

        const withdrawId = Date.now();

        const withdrawData = {
            id: withdrawId,
            phone,
            amount: withdrawAmount,
            status: "Pending",
            upiDetails: user.paymentDetails,
            createdAt: new Date().toISOString()
        };

        // 5. ⭐️ JSON SAVE (Local Backup)
        if (typeof adminData !== 'undefined') {
            adminData.withdrawRequests.push(withdrawData);
            if (typeof saveAdminData === 'function') saveAdminData(); 
            if (typeof saveUserData === 'function') saveUserData();
        }

        // 6. ⭐️ Mongo SAVE (Permanent)
        await user.save(); 
        await new WithdrawModel(withdrawData).save(); 

        res.json({
            success: true,
            message: "Withdraw Request Submitted & Balance Deducted",
            id: withdrawId,
            newBalance: user.wallet.buyAmount
        });

    } catch (err) {
        console.error("❌ Withdraw Error:", err);
        if (!res.headersSent) {
            res.status(500).json({
                success: false,
                message: "Server Error"
            });
        }
    }
}); // 👈 Ye bracket ab ekdum sahi hai
// --------------------- ADMIN DASHBOARD (UPDATED) ---------------------

app.get('/api/admin/dashboard-data', async (req, res) => {
    try {
        let pendingPayments = [];
        let withdrawRequests = [];
        let totalUsers = 0;

        try {
            // ⭐ MongoDB se Live Data (Sirf "Pending" waale requests)
            // .lean() fast execution ke liye achha hai
            pendingPayments = await PaymentModel.find({ status: "Pending" }).lean();
            withdrawRequests = await WithdrawModel.find({ status: "Pending" }).lean();
            totalUsers = await UserModel.countDocuments();

            console.log("✅ Dashboard data fetched from MongoDB");

        } catch (mongoError) {
            console.error("⚠️ Mongo Dashboard Fetch Error (Using JSON Fallback):", mongoError);

            // ⭐ Mongo fail → JSON fallback (Yahan bhi pending filter laga diya)
            pendingPayments = adminData.pendingPayments.filter(p => p.status === "Pending");
            withdrawRequests = adminData.withdrawRequests.filter(w => w.status === "Pending");
            totalUsers = userData.users.length;
        }

        res.json({
            success: true,
            pendingPayments,
            withdrawRequests,
            totalUsers
        });

    } catch (err) {
        console.error("❌ Dashboard API Error:", err);
        res.status(500).json({
            success: false,
            message: "Server Error"
        });
    }
});


// --------------------- ADMIN APPROVE PAYMENT (UPDATED) ---------------------

app.post('/api/admin/approve-payment', async (req, res) => {
    try {
        const { orderId, phone, amount } = req.body;
        const depositAmount = Number(amount);

        // 1. Live Database (Mongo) mein user ko dhundhein
        const user = await UserModel.findOne({ phone: phone });
        if (!user) return res.json({ success: false, message: "User not found in DB" });

        // 2. ⭐ WALLET UPDATE (MongoDB)
        // Hum $inc (increment) ka use karenge taaki calculations exact rahein
        const reward = depositAmount * 0.05;
        
        user.wallet.buyAmount += depositAmount;
        user.wallet.buyQuantity += 1;
        user.wallet.totalRevenue += reward;

        // User data save karein
        await user.save();

        // 3. Payment Status "Approved" karein MongoDB mein
        await PaymentModel.findOneAndUpdate(
            { id: orderId },
            { $set: { status: "Approved" } }
        );

        // 4. ⭐ JSON SYNC (Backup ke liye)
        const jsonUser = userData.users.find(u => u.phone === phone);
        if (jsonUser) {
            jsonUser.wallet.buyAmount += depositAmount;
            jsonUser.wallet.buyQuantity += 1;
            jsonUser.wallet.totalRevenue += reward;
            saveUserData();
        }

        // Pending list se hatayein (JSON memory se bhi)
        adminData.pendingPayments = adminData.pendingPayments.filter(p => p.id !== orderId);
        saveAdminData();

        console.log(`✅ Payment Approved: ₹${depositAmount} added to ${phone}`);
        res.json({ success: true, message: "Payment Approved and Wallet Updated" });

    } catch (err) {
        console.error("❌ Approve Payment Error:", err);
        res.status(500).json({ success: false, message: "Server Error during approval" });
    }
});

// ⭐️ Ye API missing hai, ise add karein:

app.get('/api/user/:phone', async (req, res) => {
    try {
        const { phone } = req.params;
        // MongoDB mein user dhoondna
        const user = await UserModel.findOne({ phone: phone });

        if (user) {
            res.json(user); // User mil gaya toh data bhej do
        } else {
            res.status(404).json({ success: false, message: "User not found" });
        }
    } catch (err) {
        console.error("❌ Fetch User Error:", err);
        res.status(500).json({ success: false, message: "Server Error" });
    }
});

// --------------------- ADMIN APPROVE WITHDRAW (UPDATED) ---------------------

app.post('/api/admin/approve-withdraw', async (req, res) => {
    try {
        const { withdrawId, phone, amount } = req.body;
        const withdrawAmount = Number(amount);

        // 1. Live Database (Mongo) mein user ko dhundhein
        const user = await UserModel.findOne({ phone: phone });
        if (!user) return res.json({ success: false, message: "User not found in Database" });

        // 2. ⭐ WALLET DEDUCTION (MongoDB)
        // Check karein ki approve karte waqt bhi balance paryapt hai ya nahi
        if (user.wallet.buyAmount < withdrawAmount) {
            return res.json({ success: false, message: "Insufficient balance to approve" });
        }

        user.wallet.buyAmount -= withdrawAmount;
        user.wallet.sellToday += withdrawAmount;

        // DB mein update save karein
        await user.save();

        // 3. Withdraw Status "Approved" karein MongoDB mein
        await WithdrawModel.findOneAndUpdate(
            { id: withdrawId },
            { $set: { status: "Approved" } }
        );

        // 4. ⭐ JSON SYNC (Backup)
        const jsonUser = userData.users.find(u => u.phone === phone);
        if (jsonUser) {
            jsonUser.wallet.buyAmount -= withdrawAmount;
            jsonUser.wallet.sellToday += withdrawAmount;
            saveUserData();
        }

        // Pending list se hatayein
        adminData.withdrawRequests = adminData.withdrawRequests.filter(w => w.id !== withdrawId);
        saveAdminData();

        console.log(`✅ Withdraw Approved: ₹${withdrawAmount} deducted from ${phone}`);
        res.json({ success: true, message: "Withdrawal Approved successfully" });

    } catch (err) {
        console.error("❌ Approve Withdraw Error:", err);
        res.status(500).json({ success: false, message: "Server Error during withdrawal approval" });
    }
});

// --------------------- USER HISTORY (UPDATED) ---------------------

app.get('/api/history/:phone', async (req, res) => {
    try {
        const { phone } = req.params;

        // 1. MongoDB se User ki saari Payment history nikalna
        // Isme Pending aur Approved dono milenge
        const payments = await PaymentModel.find({ phone: phone }).sort({ id: -1 });

        // 2. MongoDB se User ki saari Withdraw history nikalna
        const withdraws = await WithdrawModel.find({ phone: phone }).sort({ id: -1 });

        // 3. Response bhejien
        res.json({ 
            success: true, 
            payments: payments, 
            withdraws: withdraws 
        });

    } catch (err) {
        console.error("❌ History API Error:", err);
        
        // Fallback: Agar Mongo fail ho jaye toh JSON se dikha do (Sirf Pending waale)
        const pendingPayments = adminData.pendingPayments.filter(p => p.phone === phone);
        const pendingWithdraws = adminData.withdrawRequests.filter(w => w.phone === phone);
        
        res.json({ 
            success: true, 
            payments: pendingPayments, 
            withdraws: pendingWithdraws,
            note: "Showing pending only (Fallback)"
        });
    }
});

// --------------------- DELETE USER (UPDATED) ---------------------

app.delete('/api/admin/delete-user/:phone', async (req, res) => {
    try {
        const { phone } = req.params;

        // 1. MongoDB se User ko Delete karein
        const deletedUser = await UserModel.findOneAndDelete({ phone: phone });

        // User ke saare payments aur withdraws bhi DB se hatayein (Optional but recommended)
        await PaymentModel.deleteMany({ phone: phone });
        await WithdrawModel.deleteMany({ phone: phone });

        // 2. JSON Fallback cleanup
        const userIndex = userData.users.findIndex(u => u.phone === phone);
        if (userIndex !== -1) {
            userData.users.splice(userIndex, 1);
            saveUserData();
        }

        // 3. Admin Lists (Pending) ko bhi clean karein
        adminData.pendingPayments = adminData.pendingPayments.filter(p => p.phone !== phone);
        adminData.withdrawRequests = adminData.withdrawRequests.filter(w => w.phone !== phone);
        saveAdminData();

        if (!deletedUser && userIndex === -1) {
            return res.json({ success: false, message: "User not found in DB or JSON" });
        }

        console.log(`🗑️ User ${phone} and their records deleted permanently.`);
        res.json({ 
            success: true, 
            message: `User ${phone} deleted successfully from Database and JSON` 
        });

    } catch (err) {
        console.error("❌ Delete User Error:", err);
        res.status(500).json({ success: false, message: "Server Error during deletion" });
    }
});

// --------------------- SELF-PING (OPTIMIZED) ---------------------

// Render par 'ping' route taaki server active rahe
app.get('/ping', (req, res) => {
    res.status(200).send('I am awake!');
});

// Self-ping logic to keep Render instance alive
const keepAlive = () => {
    // Aap apna dynamic URL bhi use kar sakte hain agar environment variable set hai
    const backendUrl = `https://my-project-backend-n7jp.onrender.com/ping`;

    setInterval(async () => {
        try {
            const response = await axios.get(backendUrl);
            console.log(`🚀 Self-ping status: ${response.status} - Server is active`);
        } catch (error) {
            console.error(`⚠️ Self-ping failed: ${error.message}`);
        }
    }, 10 * 60 * 1000); // Har 10 minute mein
};

// Server start hone ke baad ping shuru karein
keepAlive();

// --------------------- CHANGE PASSWORD API (UPDATED) ---------------------

app.post('/api/change-password', async (req, res) => {
    try {
        const { phone, oldPassword, newPassword } = req.body;

        // 1. Live Database (Mongo) mein user check karein
        const user = await UserModel.findOne({ phone: phone });

        if (!user) {
            // Agar Mongo mein nahi mila, toh check karein JSON mein hai kya (Migration support)
            const jsonUser = userData.users.find(u => u.phone === phone);
            if (!jsonUser) {
                return res.json({ success: false, message: "User not found" });
            }
            
            // JSON wale user ka check (Temporary)
            if (jsonUser.password !== oldPassword) {
                return res.json({ success: false, message: "Old password is incorrect" });
            }
            jsonUser.password = newPassword;
            saveUserData();
            return res.json({ success: true, message: "Password updated in JSON backup" });
        }

        // 2. Database password check
        if (user.password !== oldPassword) {
            return res.json({ success: false, message: "Old password is incorrect" });
        }

        // 3. ⭐ UPDATE IN MONGODB (Permanent Storage)
        user.password = newPassword;
        await user.save();

        // 4. ⭐ SYNC IN JSON (Local Cache Sync)
        const jsonUserIndex = userData.users.findIndex(u => u.phone === phone);
        if (jsonUserIndex !== -1) {
            userData.users[jsonUserIndex].password = newPassword;
            saveUserData();
        }

        console.log(`🔐 Password updated successfully for: ${phone}`);
        res.json({ success: true, message: "Password updated successfully in DB and JSON" });

    } catch (err) {
        console.error("❌ Change Password Error:", err);
        res.status(500).json({ success: false, message: "Server Error" });
    }
});


// --------------------- REGISTER WITH REFERRAL (MERGED & UPDATED) ---------------------

app.post('/api/register', async (req, res) => {
    try {
        const { phone, password, referredBy } = req.body;

        // 1. Check if user already exists (Mongo + JSON)
        const existsInDb = await UserModel.findOne({ phone: phone });
        const existsInJson = userData.users.find(u => u.phone === phone);

        if (existsInDb || existsInJson) {
            return res.json({ success: false, message: "User already exists" });
        }

        const code = generateInviteCode();
        const newUser = {
            phone,
            password,
            inviteCode: code,
            referredBy: referredBy || null,
            wallet: { buyQuantity: 0, buyAmount: 0, sellToday: 0, totalRevenue: 0 },
            paymentDetails: { upiMethod: "", upiId: "" },
            myReferrals: []
        };

        // 2. ⭐ REFERRAL LOGIC (MongoDB + JSON Sync)
        if (referredBy) {
            // MongoDB mein referrer ko dhundhein
            const referrer = await UserModel.findOne({ inviteCode: referredBy });
            if (referrer) {
                // Referrer ki list mein naya phone number add karein
                referrer.myReferrals.push(phone);
                // Referral Bonus (₹10) add karein
                referrer.wallet.totalRevenue += 10;
                await referrer.save();

                // JSON Backup mein bhi update karein (Sync ke liye)
                const referrerJson = userData.users.find(u => u.inviteCode === referredBy);
                if (referrerJson) {
                    if (!referrerJson.myReferrals) referrerJson.myReferrals = [];
                    referrerJson.myReferrals.push(phone);
                    referrerJson.wallet.totalRevenue += 10;
                }
            }
        }

        // 3. ⭐ SAVE NEW USER (Mongo + JSON)
        await new UserModel(newUser).save(); // Permanent Save
        
        userData.users.push(newUser);
        saveUserData(); // File Backup

        console.log(`👤 New User Registered: ${phone} | Referrer: ${referredBy || 'None'}`);
        res.json({ 
            success: true, 
            inviteCode: code, 
            message: "User Registered with Referral Bonus" 
        });

    } catch (err) {
        console.error("❌ Registration Error:", err);
        res.status(500).json({ success: false, message: "Server Error" });
    }
});

// --------------------- GET TEAM DATA (UPDATED) ---------------------

app.get('/api/team/:phone', async (req, res) => {
    try {
        const { phone } = req.params;

        // 1. Live Database (Mongo) se user nikalna
        const user = await UserModel.findOne({ phone: phone });


        if (!user) {
            // Fallback for JSON users (Optional)
            const jsonUser = userData.users.find(u => u.phone === phone);
            if (!jsonUser) return res.json({ success: false, message: "User not found" });
            
            return res.json({
                success: true,
                teamCount: jsonUser.myReferrals ? jsonUser.myReferrals.length : 0,
                teamMembers: [] // JSON mein details save nahi hain
            });
        }

        // 2. ⭐ TEAM MEMBERS KI DETAILS FETCH KARNA
        // Hum un users ko database mein dhundhenge jinka phone number myReferrals array mein hai
        const teamDetails = await UserModel.find({
            phone: { $in: user.myReferrals }
        }).select('phone createdAt'); // Sirf phone aur date nikalenge security ke liye

        // 3. Response Format
        const formattedTeam = teamDetails.map(member => ({
            phone: member.phone,
            joinedAt: member.createdAt ? new Date(member.createdAt).toLocaleDateString() : new Date().toLocaleDateString()
        }));

        res.json({
            success: true,
            teamCount: user.myReferrals.length,
            teamMembers: formattedTeam
        });

    } catch (err) {
        console.error("❌ Get Team API Error:", err);
        res.status(500).json({ success: false, message: "Server Error" });
    }
});


// ================= BUY RP ORDER SYSTEM (MONGO SYNCED) =================

// ⭐ Order Add (Admin use karega)
app.post('/api/order/add', async (req, res) => {
    try {
        const { level, amount, qty } = req.body;
        const quantity = Number(qty) || 1;
        const reward = Number((Number(amount) * 0.05).toFixed(2));
        const final = Number((Number(amount) + reward).toFixed(2));

        const newOrder = {
            id: Date.now(),
            level: "L" + level,
            amount: Number(amount),
            qty: quantity,
            remainingQty: quantity,
            reward,
            final
        };

        // 1. MongoDB mein save karein (Permanent)
        await OrderModel.create(newOrder);

        // 2. JSON Backup mein add karein
        const levelKey = "L" + level;
        if (!userData.allOrders[levelKey]) userData.allOrders[levelKey] = [];
        userData.allOrders[levelKey].push(newOrder);
        saveUserData();

        res.json({ success: true, message: "Order Added Successfully", order: newOrder });
    } catch (err) {
        console.error("Add Order Error:", err);
        res.status(500).json({ success: false, message: "Server Error" });
    }
});

// ⭐ Order List (Buy RP screen)
app.post('/api/order/list', async (req, res) => {
    try {
        const { level, phone } = req.body;

        // 1. Live Wallet balance Mongo se lein
        const user = await UserModel.findOne({ phone });
        if (!user) return res.json({ success: false, message: "User not found" });

        const levelKey = "L" + level;
        
        // 2. MongoDB se orders fetch karein (Sirf wahi jinme quantity bachi ho)
        let orders = await OrderModel.find({ level: levelKey, remainingQty: { $gt: 0 } }).lean();

        // Agar Mongo mein nahi milte (Migration check), toh JSON fallback
        if (orders.length === 0) {
            orders = (userData.allOrders[levelKey] || []).filter(o => o.remainingQty > 0);
        }

        res.json({
            success: true,
            orders: orders,
            wallet: user.wallet
        });
    } catch (err) {
        res.status(500).json({ success: false, message: "Server Error" });
    }
});

// ⭐ Receive Order (User click karega)
app.post('/api/order/receive', async (req, res) => {
    try {
        const { phone, orderId, level } = req.body;

        // 1. Live User aur Order dhundhein
        const user = await UserModel.findOne({ phone });
        const order = await OrderModel.findOne({ id: orderId });

        if (!user || !order) return res.json({ success: false, message: "User or Order not found" });

        // 2. LOCK CHECK (Quantity check)
        if (order.remainingQty <= 0) {
            return res.json({ success: false, message: "Order already full" });
        }

        // 3. ⭐ UPDATE ORDER (Mongo)
        order.remainingQty -= 1;
        await order.save();

        // 4. ⭐ UPDATE USER WALLET (Mongo - Permanent)
        user.wallet.buyQuantity += 1;
        user.wallet.buyAmount += Number(order.amount);
        user.wallet.totalRevenue += Number(order.reward);
        await user.save();

        // 5. JSON SYNC (Backup)
        const levelKey = "L" + level;
        if (userData.allOrders[levelKey]) {
            const jsonOrder = userData.allOrders[levelKey].find(o => o.id == orderId);
            if (jsonOrder) {
                jsonOrder.remainingQty -= 1;
                if (jsonOrder.remainingQty <= 0) {
                    userData.allOrders[levelKey] = userData.allOrders[levelKey].filter(o => o.id != orderId);
                }
            }
        }
        
        // JSON User Sync
        const jsonUser = userData.users.find(u => u.phone === phone);
        if (jsonUser) {
            jsonUser.wallet = user.wallet;
        }
        saveUserData();

        res.json({
            success: true,
            message: "Order Received",
            remainingQty: order.remainingQty,
            wallet: user.wallet
        });

    } catch (err) {
        console.error("Receive Order Error:", err);
        res.status(500).json({ success: false, message: "Server Error" });
    }
});


// ================= AUTO FIX ALL ORDERS (SYNCED) =================

// ⭐ Server start hote hi sab order auto fix (Mongo + JSON Sync)
async function fixAllOrders() {
    try {
        // 1. JSON Data Fix karein
        for (let level in userData.allOrders) {
            userData.allOrders[level] = userData.allOrders[level].map(order => {
                const amount = Number(order.amount) || 0;
                const reward = Number((amount * 0.05).toFixed(2));
                const final = Number((amount + reward).toFixed(2));

                return {
                    ...order,
                    qty: order.qty || 1, // Agar qty pehle se hai toh wahi rahe, warna 1
                    reward: reward,
                    final: final
                };
            });
        }
        saveUserData();

        // 2. ⭐ MONGODB Data Fix karein
        // Hum saare orders fetch karenge aur unhe update karenge
        const allMongoOrders = await OrderModel.find({});
        
        for (let order of allMongoOrders) {
            const amount = Number(order.amount) || 0;
            order.reward = Number((amount * 0.05).toFixed(2));
            order.final = Number((amount + order.reward).toFixed(2));
            // qty logic: agar missing ho toh hi fix karein
            if (!order.qty) order.qty = 1; 
            await order.save();
        }

        console.log("✅ All Orders (JSON & Mongo) Auto Fixed (Qty=1 Reward=5%)");
    } catch (err) {
        console.error("❌ Fix Orders Error:", err);
    }
}

// ⭐ Manual Repair API (Browser se bhi chala sakte ho)
app.get('/api/admin/repair-orders', async (req, res) => {
    await fixAllOrders();
    res.json({
        success: true,
        message: "All Orders Repaired in JSON and MongoDB Successfully"
    });
});


// --------------------- START SERVER ---------------------
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("Server Running on Port " + PORT));
