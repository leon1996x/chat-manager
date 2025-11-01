const express = require('express');
const cors = require('cors');
const path = require('path');
const app = express();

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Простые учетные данные (замени на свои!)
const ADMIN_USERNAME = 'admin';
const ADMIN_PASSWORD = 'password123'; // Смени этот пароль!

// Хранилище данных
let managerOnline = false;
let messages = {};
let sessions = {};

// Middleware для проверки авторизации
function requireAuth(req, res, next) {
    const token = req.headers.authorization;
    
    if (!token || !sessions[token]) {
        return res.status(401).json({ error: 'Не авторизован' });
    }
    
    next();
}

// Логин
app.post('/api/login', (req, res) => {
    const { username, password } = req.body;
    
    if (username === ADMIN_USERNAME && password === ADMIN_PASSWORD) {
        const token = 'token_' + Math.random().toString(36).substr(2, 9);
        sessions[token] = {
            username: username,
            loginTime: new Date().toISOString()
        };
        
        res.json({ 
            success: true, 
            token: token,
            message: 'Успешный вход'
        });
    } else {
        res.status(401).json({ 
            success: false, 
            message: 'Неверный логин или пароль' 
        });
    }
});

// Выход
app.post('/api/logout', requireAuth, (req, res) => {
    const token = req.headers.authorization;
    delete sessions[token];
    res.json({ success: true, message: 'Успешный выход' });
});

// API для получения статуса
app.get('/api/status', (req, res) => {
    res.json({ online: managerOnline });
});

// API для изменения статуса (требует авторизации)
app.post('/api/status', requireAuth, (req, res) => {
    managerOnline = req.body.online;
    res.json({ success: true, online: managerOnline });
});

// API для отправки сообщения от клиента
app.post('/api/message', (req, res) => {
    const { clientId, message } = req.body;
    
    if (!messages[clientId]) {
        messages[clientId] = [];
    }
    
    messages[clientId].push({
        sender: 'client',
        message: message,
        timestamp: new Date().toISOString()
    });
    
    console.log(`Сообщение от ${clientId}: ${message}`);
    
    res.json({ success: true });
});

// API для отправки сообщения от менеджера (требует авторизации)
app.post('/api/manager-message', requireAuth, (req, res) => {
    const { clientId, message } = req.body;
    
    if (!messages[clientId]) {
        messages[clientId] = [];
    }
    
    messages[clientId].push({
        sender: 'manager',
        message: message,
        timestamp: new Date().toISOString()
    });
    
    res.json({ success: true });
});

// API для получения сообщений (требует авторизации)
app.get('/api/messages/:clientId', requireAuth, (req, res) => {
    const clientId = req.params.clientId;
    res.json(messages[clientId] || []);
});

// API для получения списка клиентов (требует авторизации)
app.get('/api/clients', requireAuth, (req, res) => {
    const clientList = Object.keys(messages).map(clientId => {
        const clientMessages = messages[clientId] || [];
        const lastMessage = clientMessages[clientMessages.length - 1];
        return {
            clientId: clientId,
            lastActivity: lastMessage ? lastMessage.timestamp : new Date().toISOString(),
            messageCount: clientMessages.length
        };
    });
    
    res.json(clientList);
});

// Отдаем админку
app.get('/admin', (req, res) => {
    res.sendFile(path.join(__dirname, 'admin.html'));
});

// Проверка авторизации
app.get('/api/check-auth', requireAuth, (req, res) => {
    res.json({ success: true, username: sessions[req.headers.authorization].username });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    console.log(`Админ логин: ${ADMIN_USERNAME}`);
    console.log(`Админ пароль: ${ADMIN_PASSWORD}`);
});
