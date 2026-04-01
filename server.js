const express = require('express');
const cors = require('cors');
const path = require('path');
const app = express();

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Настройки Telegram
const TELEGRAM_BOT_TOKEN = '8546543199:AAFBSDOa2D27wk9Nsmg8YF8BTWu6U4_8aJo';
const TELEGRAM_CHAT_ID = '519789698';

// Простые учетные данные
const ADMIN_USERNAME = 'admin';
const ADMIN_PASSWORD = 'password123';

// Хранилище данных
let managerOnline = false;
let messages = {};
let sessions = {};
let activeClients = {};
let telegramSessions = {};

// Middleware для проверки авторизации
function requireAuth(req, res, next) {
    const token = req.headers.authorization;
    
    if (!token || !sessions[token]) {
        return res.status(401).json({ error: 'Не авторизован' });
    }
    
    next();
}

// Функция для отправки в Telegram
async function sendToTelegram(message, chatId = TELEGRAM_CHAT_ID) {
    try {
        const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage?chat_id=${chatId}&text=${encodeURIComponent(message)}`;
        const response = await fetch(url);
        return await response.json();
    } catch (error) {
        console.error('Ошибка отправки в Telegram:', error);
        return null;
    }
}

// Функция для отправки сообщения от менеджера клиенту
function sendManagerMessageToClient(clientId, message) {
    if (!messages[clientId]) {
        messages[clientId] = [];
    }
    
    messages[clientId].push({
        sender: 'manager',
        message: message,
        timestamp: new Date().toISOString(),
        fromTelegram: true
    });
    
    console.log(`Сообщение менеджера для ${clientId}: ${message}`);
}

// Webhook для приема сообщений из Telegram
app.post('/webhook/telegram', express.json(), (req, res) => {
    const update = req.body;
    
    if (update.message && update.message.text && update.message.chat.id == TELEGRAM_CHAT_ID) {
        const managerMessage = update.message.text;
        
        console.log('Сообщение от менеджера в Telegram:', managerMessage);
        
        if (managerMessage.startsWith('/')) {
            handleTelegramCommand(managerMessage, update.message.chat.id);
            return res.json({ ok: true });
        }
        
        const currentSession = telegramSessions[TELEGRAM_CHAT_ID];
        
        if (currentSession && currentSession.activeClient) {
            const clientId = currentSession.activeClient;
            sendManagerMessageToClient(clientId, managerMessage);
            
            const clientInfo = getClientInfo(clientId);
            const replyMessage = `✅ Сообщение отправлено клиенту:\n${clientInfo}\n\n💬 Ваш ответ: ${managerMessage}`;
            sendToTelegram(replyMessage);
        } else {
            showClientsList(update.message.chat.id);
        }
    }
    
    res.json({ ok: true });
});

// Обработка команд Telegram
function handleTelegramCommand(command, chatId) {
    switch(command) {
        case '/start':
        case '/clients':
            showClientsList(chatId);
            break;
        case '/help':
            sendToTelegram(
                `📋 Доступные команды:\n\n` +
                `/clients - Список активных клиентов\n` +
                `/help - Показать справку\n\n` +
                `💡 Чтобы ответить клиенту:\n` +
                `1. Нажмите /clients\n` +
                `2. Выберите клиента (например, /select_client123)\n` +
                `3. Пишите сообщения - они будут отправляться выбранному клиенту`,
                chatId
            );
            break;
        default:
            if (command.startsWith('/select_')) {
                const clientId = command.replace('/select_', '');
                selectClientForChat(clientId, chatId);
            } else {
                sendToTelegram('❌ Неизвестная команда. Используйте /help', chatId);
            }
    }
}

// Показать список клиентов в Telegram
function showClientsList(chatId) {
    const activeList = Object.keys(activeClients)
        .map(clientId => {
            const clientMessages = messages[clientId] || [];
            const lastMessage = clientMessages[clientMessages.length - 1];
            const lastActivity = new Date(activeClients[clientId]);
            const timeAgo = Math.floor((new Date() - lastActivity) / 60000);
            
            return {
                clientId,
                lastActivity: activeClients[clientId],
                messageCount: clientMessages.length,
                lastMessage: lastMessage ? lastMessage.message : 'Нет сообщений',
                timeAgo
            };
        })
        .sort((a, b) => new Date(b.lastActivity) - new Date(a.lastActivity))
        .slice(0, 10);

    if (activeList.length === 0) {
        sendToTelegram('📭 Нет активных клиентов', chatId);
        return;
    }

    let message = `👥 Активные клиенты (${activeList.length}):\n\n`;
    
    activeList.forEach((client, index) => {
        const clientInfo = getClientInfo(client.clientId);
        const timeText = client.timeAgo < 1 ? 'только что' : 
                        client.timeAgo < 60 ? `${client.timeAgo} мин назад` : 
                        `${Math.floor(client.timeAgo/60)} ч назад`;
        
        message += `${index + 1}. ${clientInfo}\n`;
        message += `   📝 Сообщений: ${client.messageCount}\n`;
        message += `   ⏰ Активен: ${timeText}\n`;
        message += `   🔗 Выбрать: /select_${client.clientId}\n\n`;
    });

    message += `💡 Нажмите на команду /select_... чтобы выбрать клиента`;
    sendToTelegram(message, chatId);
}

// Выбор клиента для чата
function selectClientForChat(clientId, chatId) {
    if (!messages[clientId]) {
        sendToTelegram('❌ Клиент не найден', chatId);
        return;
    }

    if (!telegramSessions[chatId]) {
        telegramSessions[chatId] = {};
    }
    telegramSessions[chatId].activeClient = clientId;
    telegramSessions[chatId].selectedAt = new Date().toISOString();

    const clientInfo = getClientInfo(clientId);
    const clientMessages = messages[clientId] || [];
    
    let message = `✅ Выбран клиент:\n${clientInfo}\n\n`;
    message += `📋 История сообщений:\n`;
    
    const recentMessages = clientMessages.slice(-5);
    recentMessages.forEach(msg => {
        const sender = msg.sender === 'client' ? '👤 Клиент' : '💼 Вы';
        const time = new Date(msg.timestamp).toLocaleTimeString();
        message += `\n${sender} (${time}):\n${msg.message}\n`;
    });
    
    message += `\n💬 Теперь все ваши сообщения будут отправляться этому клиенту.`;
    sendToTelegram(message, chatId);
}

// Получить информацию о клиенте
function getClientInfo(clientId) {
    const clientMessages = messages[clientId] || [];
    const firstMessage = clientMessages.find(msg => msg.sender === 'client');
    
    if (firstMessage) {
        const lines = firstMessage.message.split('\n');
        const nameLine = lines.find(line => line.includes('Имя:'));
        const phoneLine = lines.find(line => line.includes('Телефон:'));
        
        if (nameLine && phoneLine) {
            const name = nameLine.replace('Имя:', '').trim();
            const phone = phoneLine.replace('Телефон:', '').trim();
            return `👤 ${name} 📞 ${phone}`;
        }
    }
    
    return `👤 Клиент: ${clientId}`;
}

// ========== НОВЫЙ ЭНДПОИНТ ДЛЯ ЗАЯВКИ ==========
app.post('/api/order', async (req, res) => {
    const { name, phone, email, interest, contactMethod } = req.body;
    
    const message = `📋 НОВАЯ ЗАЯВКА С САЙТА\n\nИмя: ${name}\nТелефон: ${phone}\nEmail: ${email || 'не указан'}\nИнтерес: ${interest}\nСпособ связи: ${contactMethod}\nВремя: ${new Date().toLocaleString()}`;
    
    await sendToTelegram(message);
    res.json({ success: true });
});

// ========== ОБНОВЛЕННЫЙ ЭНДПОИНТ ДЛЯ СООБЩЕНИЙ ==========
app.post('/api/message', async (req, res) => {
    const { clientId, message, userName, userPhone } = req.body;
    
    if (!messages[clientId]) {
        messages[clientId] = [];
    }
    
    messages[clientId].push({
        sender: 'client',
        message: message,
        timestamp: new Date().toISOString()
    });
    
    console.log(`Сообщение от ${clientId}: ${message}`);
    
    // Сохраняем как активного клиента
    activeClients[clientId] = new Date().toISOString();
    
    // Отправляем уведомление в Telegram
    const clientName = userName || clientId;
    const phone = userPhone || 'телефон не указан';
    const telegramMessage = `💬 НОВОЕ СООБЩЕНИЕ\n\n👤 ${clientName}\n📞 ${phone}\n\n📝 Сообщение:\n${message}\n\n💡 Ответьте на это сообщение или используйте /clients для выбора клиента`;
    await sendToTelegram(telegramMessage);
    
    res.json({ success: true });
});

// ========== ОСТАЛЬНЫЕ ЭНДПОИНТЫ ==========
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

app.post('/api/logout', requireAuth, (req, res) => {
    const token = req.headers.authorization;
    delete sessions[token];
    res.json({ success: true, message: 'Успешный выход' });
});

app.get('/api/status', (req, res) => {
    res.json({ online: managerOnline });
});

app.post('/api/status', requireAuth, (req, res) => {
    managerOnline = req.body.online;
    res.json({ success: true, online: managerOnline });
});

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

app.get('/api/messages/:clientId', (req, res) => {
    const clientId = req.params.clientId;
    res.json(messages[clientId] || []);
});

app.get('/api/clients', requireAuth, (req, res) => {
    const clientList = Object.keys(messages).map(clientId => {
        const clientMessages = messages[clientId] || [];
        const lastMessage = clientMessages[clientMessages.length - 1];
        return {
            clientId: clientId,
            lastActivity: lastMessage ? lastMessage.timestamp : new Date().toISOString(),
            messageCount: clientMessages.length,
            lastMessage: lastMessage ? lastMessage.message : 'Нет сообщений'
        };
    });
    
    clientList.sort((a, b) => new Date(b.lastActivity) - new Date(a.lastActivity));
    res.json(clientList);
});

app.delete('/api/chat/:clientId', requireAuth, (req, res) => {
    const clientId = req.params.clientId;
    
    if (messages[clientId]) {
        delete messages[clientId];
        delete activeClients[clientId];
        console.log(`Чат с клиентом ${clientId} удален`);
        
        sendToTelegram(`🗑️ Чат удален\n\nКлиент: ${clientId}`);
        res.json({ success: true, message: 'Чат удален' });
    } else {
        res.status(404).json({ success: false, message: 'Чат не найден' });
    }
});

app.get('/admin', (req, res) => {
    res.sendFile(path.join(__dirname, 'admin.html'));
});

app.get('/api/check-auth', requireAuth, (req, res) => {
    res.json({ success: true, username: sessions[req.headers.authorization].username });
});

app.get('/health', (req, res) => {
    res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

async function setupWebhook() {
    try {
        const webhookUrl = `https://chat-manager.onrender.com/webhook/telegram`;
        const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/setWebhook?url=${webhookUrl}`;
        
        const response = await fetch(url);
        const result = await response.json();
        
        console.log('Webhook setup result:', result);
    } catch (error) {
        console.error('Error setting up webhook:', error);
    }
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    console.log(`Админка: http://localhost:${PORT}/admin`);
    console.log(`Админ логин: ${ADMIN_USERNAME}`);
    console.log(`Админ пароль: ${ADMIN_PASSWORD}`);
    console.log(`Telegram бот настроен`);
    
    setupWebhook();
});
