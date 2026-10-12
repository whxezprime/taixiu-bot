const fs = require('fs');
const { Client, GatewayIntentBits, Partials, EmbedBuilder } = require('discord.js');

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers,
    ],
    partials: [Partials.Channel, Partials.Message, Partials.Reaction]
});

const DATA_FILE = './users.json';
const PREFIX = '!';

// Hàm đọc dữ liệu người dùng
function loadData() {
    if (!fs.existsSync(DATA_FILE)) {
        fs.writeFileSync(DATA_FILE, '{}');
    }
    try {
        const data = fs.readFileSync(DATA_FILE, 'utf8');
        return JSON.parse(data);
    } catch (err) {
        return {};
    }
}

// Hàm lưu dữ liệu người dùng
function saveData(data) {
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

// Hàm hỗ trợ tự xóa tin nhắn sau 10 giây
function sendAutoDeleteMessage(message, content) {
    message.reply(content).then(sentMsg => {
        setTimeout(() => {
            sentMsg.delete().catch(() => {});
        }, 10000);
    });
}

client.on('clientReady', () => {
    console.log(`Bot đã đăng nhập thành công với tên: ${client.user.tag}`);
});

client.on('messageCreate', async message => {
    if (message.author.bot) return;

    // Tự động xóa các tin nhắn không phải lệnh hoặc tin lỗi sau 10s (tùy chọn)
    let content = message.content.trim();
    if (!content.startsWith(PREFIX)) return;

    const args = content.slice(PREFIX.length).trim().split(/ +/);
    const command = args.shift().toLowerCase();

    let users = loadData();
    const userId = message.author.id;

    if (!users[userId]) {
        users[userId] = {
            balance: 100, // Tiền khởi đầu
            inventory: [],
            jobs: {
                policeMisses: 0
            },
            cooldowns: {
                anxin: 0,
                anxinCount: 0,
                dilam: 0
            }
        };
    }
    let user = users[userId];

    // 1. Lệnh kiểm tra số dư: !sodu hoặc !bal
    if (command === 'sodu' || command === 'bal') {
        return message.reply(`💰 Số dư hiện tại của bạn: **${user.balance} VNĐ**`);
    }

    // 2. Lệnh ăn xin: !anxin (5 lần / 2 tiếng, 5-10 VNĐ)
    if (command === 'anxin') {
        const now = Date.now();
        const twoHours = 2 * 60 * 60 * 1000;

        if (now - user.cooldowns.anxin > twoHours) {
            user.cooldowns.anxin = now;
            user.cooldowns.anxinCount = 0;
        }

        if (user.cooldowns.anxinCount >= 5) {
            return sendAutoDeleteMessage(message, `⏳ Bạn đã ăn xin quá 5 lần trong 2 giờ qua. Hãy nghỉ ngơi nhé!`);
        }

        user.cooldowns.anxinCount += 1;
        const earned = Math.floor(Math.random() * 6) + 5; // Từ 5 đến 10 VNĐ
        user.balance += earned;
        saveData(users);

        return message.reply(`乞 Bạn đi ăn xin và kiếm được **${earned} VNĐ**! (${user.cooldowns.anxinCount}/5 lần trong 2h qua).`);
    }

    // 3. Lệnh Shop: !shop
    if (command === 'shop') {
        return message.reply(
            `🛒 **CỬA HÀNG VẬT PHẨM**\n` +
            `1. **Mặt nạ** (mask) - Giá: 150 VNĐ\n` +
            `2. **Găng tay** (gloves) - Giá: 200 VNĐ\n` +
            `3. **Bộ phá khóa** (lockpick) - Giá: 300 VNĐ\n` +
            `4. **Xe máy** (motorbike) - Giá: 500 VNĐ (Cần để làm Shipper)\n\n` +
            `💡 Dùng lệnh: \`!mua [tên_vật_phẩm]\``
        );
    }

    // 4. Lệnh Mua đồ: !mua [item]
    if (command === 'mua') {
        const item = args[0]?.toLowerCase();
        const prices = { mask: 150, gloves: 200, lockpick: 300, motorbike: 500 };

        if (!prices[item]) {
            return sendAutoDeleteMessage(message, `❌ Vật phẩm không tồn tại! Các món có sẵn: mask, gloves, lockpick, motorbike.`);
        }

        const price = prices[item];
        if (user.balance < price) {
            return sendAutoDeleteMessage(message, `❌ Bạn không đủ tiền! Cần **${price} VNĐ** để mua ${item}.`);
        }

        if (user.inventory.includes(item)) {
            return sendAutoDeleteMessage(message, `⚠️ Bạn đã sở hữu vật phẩm này rồi!`);
        }

        user.balance -= price;
        user.inventory.push(item);
        saveData(users);

        return message.reply(`🛍️ Bạn đã mua thành công **${item}** với giá **${price} VNĐ**!`);
    }

    // 5. Lệnh Đi làm: !dilam [shipper / bacsi / congan / cuop]
    if (command === 'dilam') {
        const job = args[0]?.toLowerCase();
        const now = Date.now();
        const cooldownTime = 60 * 1000; // 1 phút cooldown mỗi lần làm việc

        if (now - user.cooldowns.dilam < cooldownTime) {
            const remaining = Math.ceil((cooldownTime - (now - user.cooldowns.dilam)) / 1000);
            return sendAutoDeleteMessage(message, `⏱️ Bạn đang mệt, hãy nghỉ ngơi thêm **${remaining} giây** nữa mới được đi làm!`);
        }

        if (!['shipper', 'bacsi', 'congan', 'cuop'].includes(job)) {
            return sendAutoDeleteMessage(message, `❌ Nghề nghiệp không hợp lệ! Các nghề có sẵn: \`shipper\`, \`bacsi\`, \`congan\`, \`cuop\`.`);
        }

        user.cooldowns.dilam = now;

        // Nghề Shipper: Cần xe máy, lương 100-200 VNĐ, rủi ro tai nạn mất 50 VNĐ
        if (job === 'shipper') {
            if (!user.inventory.includes('motorbike')) {
                return sendAutoDeleteMessage(message, `❌ Bạn cần phải mua **Xe máy (motorbike)** trong cửa hàng (\`!shop\`) mới có thể làm Shipper!`);
            }
            if (Math.random() < 0.2) { // 20% tai nạn
                user.balance = Math.max(0, user.balance - 50);
                saveData(users);
                return message.reply(`💥 Đang đi giao hàng thì xe bị tông thủng lốp! Bạn bị phạt viện phí và mất **50 VNĐ**.`);
            }
            const salary = Math.floor(Math.random() * 101) + 100; // 100 - 200 VNĐ
            user.balance += salary;
            saveData(users);
            return message.reply(`🛵 Bạn hoàn thành chuyến hàng shipper và nhận được **${salary} VNĐ**.`);
        }

        // Nghề Bác sĩ: Lương ổn định 120-250 VNĐ
        if (job === 'bacsi') {
            const salary = Math.floor(Math.random() * 131) + 120;
            user.balance += salary;
            saveData(users);
            return message.reply(`👨‍⚕️ Bạn trực ca tại bệnh viện cứu người và nhận được mức lương **${salary} VNĐ**.`);
        }

        // Nghề Công an: Bắt cướp
        if (job === 'congan') {
            // Tìm ngẫu nhiên xem có bắt được tên cướp nào đang hoạt động không
            const reward = 200;
            user.balance += reward;
            saveData(users);
            return message.reply(`👮‍♂️ Bạn đã tóm gọn thành công một tên tội phạm nguy hiểm và nhận thưởng **${reward} VNĐ**!`);
        }

        // Nghề Cướp: Kiếm nhiều tiền nhưng rủi ro cao
        if (job === 'cuop') {
            if (Math.random() < 0.4) { // 40% bị công an tóm
                user.balance = Math.max(0, user.balance - 100);
                saveData(users);
                return message.reply(`🚨 Bạn đi trộm cắp và bị công an bắt quả tang! Bạn bị phạt **100 VNĐ**.`);
            }
            const loot = Math.floor(Math.random() * 251) + 150; // 150 - 400 VNĐ
            user.balance += loot;
            saveData(users);
            return message.reply(`🦹‍♂️ Bạn đột nhập thành công và vơ vét được chiến lợi phẩm trị giá **${loot} VNĐ**!`);
        }
    }

    // 6. Lệnh Tài Xỉu: !taixiu [tai/xiu] [số_tiền]
    if (command === 'taixiu') {
        const choice = args[0]?.toLowerCase();
        const betAmount = parseInt(args[1]);

        if (!['tai', 'xiu'].includes(choice) || isNaN(betAmount) || betAmount <= 0) {
            return sendAutoDeleteMessage(message, `❌ Cú pháp không đúng! Sử dụng: \`!taixiu [tai/xiu] [số_tiền]\` (Ví dụ: \`!taixiu tai 50\`).`);
        }

        if (user.balance < betAmount) {
            return sendAutoDeleteManager ? null : sendAutoDeleteMessage(message, `❌ Bạn không đủ **${betAmount} VNĐ** để đặt cược!`);
        }

        // Tung 3 con xúc sắc (mỗi con từ 1 đến 6)
        const d1 = Math.floor(Math.random() * 6) + 1;
        const d2 = Math.floor(Math.random() * 6) + 1;
        const d3 = Math.floor(Math.random() * 6) + 1;
        const total = d1 + d2 + d3;
        const result = total >= 11 ? 'tai' : 'xiu';

        if (choice === result) {
            user.balance += betAmount;
            saveData(users);
            return message.reply(`🎲 Kết quả: **${d1} - ${d2} - ${d3}** (Tổng: **${total}** - **${result.toUpperCase()}**).\n🎉 Chúc mừng bạn đã thắng và nhận được **${betAmount} VNĐ**! Số dư mới: **${user.balance} VNĐ**.`);
        } else {
            user.balance -= betAmount;
            saveData(users);
            return message.reply(`🎲 Kết quả: **${d1} - ${d2} - ${d3}** (Tổng: **${total}** - **${result.toUpperCase()}**).\n😢 Rất tiếc, bạn đã thua **${betAmount} VNĐ**! Số dư mới: **${user.balance} VNĐ**.`);
        }
    }
});

// Thay token chuẩn của bạn vào đây (giữ nguyên cặp nháy đơn)
client.login('TOKEN_THAT_CUA_BAN');
