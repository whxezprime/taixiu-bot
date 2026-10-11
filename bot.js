const { Client, GatewayIntentBits } = require('discord.js');
const fs = require('fs');

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers
    ]
});

const DATA_FILE = './users.json';

// Đọc dữ liệu người dùng
function loadData() {
    try {
        if (fs.existsSync(DATA_FILE)) {
            return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
        }
    } catch (e) {
        console.error("Lỗi đọc file dữ liệu:", e);
    }
    return {};
}

// Lưu dữ liệu người dùng
function saveData(data) {
    try {
        fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
    } catch (e) {
        console.error("Lỗi ghi file dữ liệu:", e);
    }
}

// Hàm gửi tin nhắn và tự động xóa sau 10 giây
function sendAutoDeleteMessage(message, content, time = 10000) {
    message.reply(content).then(sentMessage => {
        setTimeout(() => {
            sentMessage.delete().catch(() => {});
        }, time);
    }).catch(() => {});
}

// Lưu vết vụ cướp gần nhất để Công an bắt
let activeRobbery = null;

client.once('ready', () => {
    console.log(`Bot đã đăng nhập thành công với tên: ${client.user.tag}`);
});

client.on('messageCreate', async message => {
    if (message.author.bot) return;

    // Tự động bỏ qua prefix (hỗ trợ cả có dấu ! hoặc không)
    let content = message.content.trim();
    if (content.startsWith('!')) {
        content = content.slice(1);
    }

    const args = content.split(/ +/);
    const command = args.shift().toLowerCase();

    let users = loadData();
    const userId = message.author.id;

    if (!users[userId]) {
        users[userId] = {
            balance: 100, // Tiền khởi đầu
            job: null,
            inventory: {
                mask: 0,
                gloves: false,
                lockpick: 0,
                motorbike: false
            },
            begData: { count: 0, resetTime: 0 },
            missedRobberies: 0,
            jailed: false
        };
    }
    let user = users[userId];

    // --- LỆNH KIỂM TRA SỐ DƯ ---
    if (command === 'sodu' || command === 'bal') {
        return message.reply(`💰 Số dư tài khoản của bạn: **${user.balance} VNĐ**\n💼 Nghề nghiệp: **${user.job || 'Chưa có'}**`);
    }

    // --- LỆNH ĂN XIN (Tối đa 5 lần/2h, nhận 5-10 VNĐ) ---
    if (command === 'anxin') {
        const now = Date.now();
        const COOLDOWN_TIME = 2 * 60 * 60 * 1000; // 2 giờ
        const MAX_BEG_USES = 5;

        if (now > user.begData.resetTime) {
            user.begData.count = 0;
            user.begData.resetTime = now + COOLDOWN_TIME;
        }

        if (user.begData.count >= MAX_BEG_USES) {
            const timeLeft = Math.ceil((user.begData.resetTime - now) / 60000);
            return sendAutoDeleteMessage(message, `乞 Bạn đã ăn xin quá số lần cho phép! Vui lòng đợi thêm **${timeLeft} phút** nữa.`);
        }

        const earned = Math.floor(Math.random() * (10 - 5 + 1)) + 5;
        user.balance += earned;
        user.begData.count++;
        saveData(users);

        return message.reply(`乞 Bạn đi ăn xin và kiếm được **${earned} VNĐ**! (Đã dùng ${user.begData.count}/${MAX_BEG_USES} lần trong 2h qua).`);
    }

    // --- CỬA HÀNG (!shop) ---
    if (command === 'shop') {
        return message.reply(
            `🛒 **CỬA HÀNG VẬT PHẨM & NGHỀ NGHIỆP**\n` +
            `1. **Mặt nạ** - Giá: **200 VNĐ** *(Giảm tỉ lệ bị bắt vào tù)*\n` +
            `2. **Găng tay** - Giá: **300 VNĐ** *(Tăng 10% số tiền cướp được)*\n` +
            `3. **Bẻ khóa** - Giá: **500 VNĐ/cái** *(Tỉ lệ 30% vượt ngục khi bị bắt)*\n` +
            `4. **Xe máy** - Giá: **10,000 VNĐ** *(Mở khóa nghề Shipper, tối đa 1 chiếc)*\n\n` +
            `👉 Dùng lệnh: \`!mua [matna / gangtay / bekhoa / xemay]\``
        );
    }

    // --- MUA ĐỒ (!mua) ---
    if (command === 'mua') {
        const item = args[0]?.toLowerCase();
        if (!item) return sendAutoDeleteMessage(message, `⚠️ Vui lòng nhập tên món đồ cần mua! VD: \`!mua matna\``);

        if (item === 'matna') {
            if (user.balance < 200) return sendAutoDeleteMessage(message, `❌ Bạn không đủ 200 VNĐ để mua Mặt nạ!`);
            user.balance -= 200;
            user.inventory.mask = (user.inventory.mask || 0) + 1;
            saveData(users);
            return message.reply(`✅ Bạn đã mua thành công **Mặt nạ**!`);
        }
        else if (item === 'gangtay') {
            if (user.balance < 300) return sendAutoDeleteMessage(message, `❌ Bạn không đủ 300 VNĐ để mua Găng tay!`);
            user.balance -= 300;
            user.inventory.gloves = true;
            saveData(users);
            return message.reply(`✅ Bạn đã mua thành công **Găng tay**! (Tăng 10% tiền cướp).`);
        }
        else if (item === 'bekhoa') {
            if (user.balance < 500) return sendAutoDeleteMessage(message, `❌ Bạn không đủ 500 VNĐ để mua Bẻ khóa!`);
            user.balance -= 500;
            user.inventory.lockpick = (user.inventory.lockpick || 0) + 1;
            saveData(users);
            return message.reply(`✅ Bạn đã mua thành công **1x Bẻ khóa**!`);
        }
        else if (item === 'xemay') {
            if (user.inventory.motorbike) return sendAutoDeleteMessage(message, `❌ Bạn đã sở hữu xe máy rồi, mỗi user chỉ sở hữu được 1 chiếc!`);
            if (user.balance < 10000) return sendAutoDeleteMessage(message, `❌ Bạn không đủ 10,000 VNĐ để mua Xe máy!`);
            user.balance -= 10000;
            user.inventory.motorbike = true;
            saveData(users);
            return message.reply(`🏍️ Chúc mừng bạn đã sở hữu **Xe máy**! Giờ đây bạn có thể dùng lệnh \`!dilam shipper\` để làm nghề Shipper.`);
        } else {
            return sendAutoDeleteMessage(message, `❌ Vật phẩm không tồn tại trong cửa hàng!`);
        }
    }

    // --- ĐI LÀM / NHẬN NGHỀ (!dilam [nghề]) ---
    if (command === 'dilam') {
        const targetJob = args[0]?.toLowerCase();
        const validJobs = ['shipper', 'bacsi', 'congan', 'cuop'];

        if (!targetJob || !validJobs.includes(targetJob)) {
            return sendAutoDeleteMessage(message, `⚠️ Vui lòng chọn nghề hợp lệ để làm! Các nghề có sẵn: \`!dilam shipper\`, \`!dilam bacsi\`, \`!dilam congan\`, \`!dilam cuop\``);
        }

        // Kiểm tra điều kiện riêng cho Shipper
        if (targetJob === 'shipper' && !user.inventory.motorbike) {
            return sendAutoDeleteMessage(message, `❌ Bạn chưa có xe máy! Hãy ra \`!shop\` mua xe máy trước khi nhận nghề Shipper.`);
        }

        user.job = targetJob;
        saveData(users);

        if (targetJob === 'shipper') {
            // Thực hiện công việc Shipper ngay khi gõ !dilam shipper
            const isAccident = Math.random() < 0.10; // 10% rủi ro tai nạn
            if (isAccident) {
                const fine = 50;
                user.balance = Math.max(0, user.balance - fine);
                saveData(users);
                return message.reply(`💥 Ôi không! Trên đường giao hàng Shipper, bạn không may gặp tai nạn giao thông nhẹ và mất **${fine} VNĐ** viện phí.`);
            }
            const salary = Math.floor(Math.random() * (200 - 100 + 1)) + 100;
            user.balance += salary;
            saveData(users);
            return message.reply(`📦 Bạn đã nhận nghề **Shipper** và hoàn thành chuyến giao hàng an toàn, nhận được **${salary} VNĐ** tiền lương ổn định!`);
        }
        else if (targetJob === 'bacsi') {
            const salary = Math.floor(Math.random() * (500 - 300 + 1)) + 300; // Lương rất cao
            user.balance += salary;
            saveData(users);
            return message.reply(`🩺 Bạn đã nhận nghề **Bác sĩ** và hoàn thành ca trực cứu người, nhận được **${salary} VNĐ** lương cao (Rủi ro: 0%)!`);
        }
        else if (targetJob === 'congan') {
            return message.reply(`👮‍♂️ Bạn đã chính thức gia nhập lực lượng **Công an**! Hãy chú ý theo dõi tội phạm và dùng lệnh \`!bat [@user]\` để bắt trộm.`);
        }
        else if (targetJob === 'cuop') {
            return message.reply(`🦹‍♂️ Bạn đã chọn con đường phạm tội (**Cướp giật**)!`);
        }
    }

    // --- LỆNH CƯỚP (!cuop) ---
    if (command === 'cuop') {
        if (user.job !== 'cuop') {
            return sendAutoDeleteMessage(message, `❌ Bạn phải dùng lệnh \`!dilam cuop\` để nhận nghề cướp trước khi đi hành động!`);
        }

        const targetUser = message.mentions.users.first();
        if (!targetUser || targetUser.id === userId) {
            return sendAutoDeleteMessage(message, `⚠️ Vui lòng tag một người chơi khác để cướp! VD: \`!cuop @username\``);
        }

        let targetData = users[targetUser.id];
        if (!targetData || targetData.balance <= 0) {
            return sendAutoDeleteMessage(message, `❌ Người này không có xu nào để bạn cướp cả!`);
        }

        // Tỉ lệ cướp thành công (có thể ảnh hưởng bởi mặt nạ/găng tay)
        let baseSteal = Math.floor(Math.random() * 150) + 50;
        if (user.inventory.gloves) {
            baseSteal = Math.floor(baseSteal * 1.1); // Tăng 10% tiền cướp được
        }

        targetData.balance = Math.max(0, targetData.balance - baseSteal);
        user.balance += baseSteal;
        saveData(users);

        message.reply(`🦹‍♂️ Bạn đã đột nhập và cướp thành công **${baseSteal} VNĐ** từ <@${targetUser.id}>!`);

        // Kích hoạt báo động cho Công an
        let policeIds = Object.keys(users).filter(id => users[id].job === 'congan');
        if (policeIds.length > 0) {
            activeRobbery = { thiefId: userId, caught: false };
            message.channel.send(`🚨 **BÁO ĐỘNG!** Kẻ gian <@${userId}> vừa thực hiện một vụ cướp! Các đồng chí Công an (${policeIds.map(id => `<@${id}>`).join(', ')}) hãy dùng lệnh \`!bat <@${userId}>\` ngay lập tức!`);

            // Sau 30 giây nếu công an không bắt -> phạt công an
            setTimeout(() => {
                let currentUsers = loadData();
                if (activeRobbery && activeRobbery.thiefId === userId && !activeRobbery.caught) {
                    policeIds.forEach(pId => {
                        let cop = currentUsers[pId];
                        if (cop && cop.job === 'congan') {
                            cop.balance = Math.max(0, cop.balance - 100); // Trừ 100 VNĐ
                            cop.missedRobberies = (cop.missedRobberies || 0) + 1;

                            let notice = `⚠️ Công an <@${pId}> đã để tên trộm tẩu thoát và bị phạt **100 VNĐ**! (Bỏ sót: ${cop.missedRobberies}/10 lần).`;

                            if (cop.missedRobberies >= 10) {
                                cop.job = null; // Tước việc
                                cop.missedRobberies = 0;
                                notice += `\n❌ Do bỏ sót quá 10 lần, bạn đã **bị tước quyền công an**!`;
                            }
                            message.channel.send(notice);
                        }
                    });
                    saveData(currentUsers);
                }
            }, 30000);
        }
        return;
    }

    // --- CÔNG AN BẮT TỘI PHẠM (!bat) ---
    if (command === 'bat') {
        if (user.job !== 'congan') {
            return sendAutoDeleteMessage(message, `❌ Bạn không phải là Công an nên không có quyền bắt người!`);
        }

        const targetUser = message.mentions.users.first();
        if (!targetUser) return sendAutoDeleteMessage(message, `⚠️ Vui lòng tag tên trộm cần bắt! VD: \`!bat @username\``);

        if (activeRobbery && activeRobbery.thiefId === targetUser.id && !activeRobbery.caught) {
            activeRobbery.caught = true;
            const reward = 200;
            user.balance += reward;
            saveData(users);
            return message.reply(`👮‍♂️ Bạn đã tóm gọn tên tội phạm <@${targetUser.id}> kịp thời và nhận được **${reward} VNĐ** tiền thưởng xuất sắc!`);
        } else {
            return sendAutoDeleteMessage(message, `❌ Người này không phạm tội gần đây hoặc đã chạy trốn mất tăm!`);
        }
    }
});

// Đăng nhập bot trực tiếp bằng token của bạn
client.login('TOKEN_THAT_CUA_BAN');
