const { Client, GatewayIntentBits } = require('discord.js');
const fs = require('fs');
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildModeration
    ]
});

// Đường dẫn file lưu trữ dữ liệu
const DATA_FILE = './users.json';

let usersData = {};
function loadData() {
    if (fs.existsSync(DATA_FILE)) {
        try {
            const data = fs.readFileSync(DATA_FILE, 'utf8');
            usersData = JSON.parse(data);
        } catch (err) {
            console.error('Lỗi đọc file dữ liệu:', err);
            usersData = {};
        }
    }
}

function saveData() {
    try {
        fs.writeFileSync(DATA_FILE, JSON.stringify(usersData, null, 2), 'utf8');
    } catch (err) {
        console.error('Lỗi ghi file dữ liệu:', err);
    }
}

loadData();

// Cấu hình thẻ ngân hàng
const cardTiers = {
    1: { name: 'Thẻ thành viên', maxLoan: 200, upgradeCost: 0 },
    2: { name: 'Thẻ Thông gia', maxLoan: 500, upgradeCost: 100 },
    3: { name: 'Thẻ gold', maxLoan: 1000, upgradeCost: 1000 },
    4: { name: 'Thẻ Infinite', maxLoan: 5000, upgradeCost: 2000 }
};

client.once('clientReady', () => {
    console.log(`Bot đã đăng nhập thành công với tên ${client.user.tag}!`);
});

client.on('messageCreate', async message => {
    if (message.author.bot) return;

    const args = message.content.trim().split(/ +/);
    let rawCommand = args.shift().toLowerCase();
    // Tự động bỏ dấu ! nếu người dùng gõ kèm vào lệnh để tránh lệch cú pháp
    const command = rawCommand.startsWith('!') ? rawCommand.slice(1) : rawCommand;
    const userId = message.author.id;

    // 1. Lệnh helptaixiu
    if (command === 'helptaixiu') {
        return message.reply(
            `📖 **HƯỚNG DẪN HỆ THỐNG GAME & HỌC TẬP** 📖\n` +
            `• \`!dangky\` - Đăng ký tài khoản (Nhận 100 vnđ).\n` +
            `• \`!dihoc\` - Đi học / làm bài tập thăng cấp học vấn.\n` +
            `• \`!traloi [đáp án]\` - Trả lời câu hỏi bài tập.\n` +
            `• \`!taixiu [tai/xiu] [số tiền]\` - Đặt cược Tài hoặc Xỉu.\n` +
            `• \`!hoso\` hoặc \`!hoso @user\` - Xem hồ sơ, bằng cấp, đại học.\n` +
            `• \`!vaynganhang\` & \`!tranganhang\` - Ngân hàng & trả nợ.\n` +
            `• \`!nangcapthenganhang\` - Nâng cấp thẻ ngân hàng.\n` +
            `• \`!bank @user [số tiền]\` - Chuyển tiền cho người khác.\n` +
            `• \`!dilam [anxin/ancuop]\` - Đi làm kiếm tiền (buff theo trường ĐH).`
        );
    }

    // 2. Lệnh dangky
    if (command === 'dangky') {
        if (usersData[userId]) {
            return message.reply('❌ Bạn đã có tài khoản rồi!');
        }

        usersData[userId] = {
            balance: 100,
            username: message.author.username,
            tier: 1,
            debt: 0,
            jailTime: 0,
            eduLevel: 1,
            eduProgress: 0,
            activeQuestion: null,
            university: null
        };
        saveData();

        return message.reply('✅ Đăng ký thành công! Bạn nhận được **100 vnđ** và bắt đầu ở **Cấp học 1**.');
    }

    const restrictedCommands = ['taixiu', 'vaynganhang', 'tranganhang', 'nangcapthenganhang', 'bank', 'dilam', 'dihoc', 'traloi', 'hoso'];
    
    if (restrictedCommands.includes(command)) {
        if (!usersData[userId]) {
            return message.reply('⚠️ Bạn chưa có tài khoản! Vui lòng dùng lệnh `!dangky` trước.');
        }
    }

    const user = usersData[userId];

    // Kiểm tra đi tù
    if (user.jailTime && Date.now() < user.jailTime) {
        const remainingMinutes = Math.ceil((user.jailTime - Date.now()) / 60000);
        return message.reply(`🔒 Bạn đang ngồi tù! Còn khoảng **${remainingMinutes} phút** nữa mới được thả.`);
    }

    // 3. Lệnh dihoc
    if (command === 'dihoc') {
        if (user.eduLevel > 3) {
            return message.reply(`🎓 Bạn đã tốt nghiệp toàn bộ các cấp và học tại **${user.university}** rồi! Không cần đi học nữa.`);
        }

        if (user.activeQuestion) {
            return message.reply(`📝 Bạn đang có câu hỏi: **${user.activeQuestion.question}**\nHãy dùng lệnh \`!traloi <đáp án>\` để trả lời!`);
        }

        let num1, num2, answer, qText;

        if (user.eduLevel === 1) {
            num1 = Math.floor(Math.random() * 10) + 1;
            num2 = Math.floor(Math.random() * 10) + 1;
            answer = num1 + num2;
            qText = `${num1} + ${num2} = ?`;
        } else if (user.eduLevel === 2) {
            const isMul = Math.random() < 0.5;
            if (isMul) {
                num1 = Math.floor(Math.random() * 9) + 2;
                num2 = Math.floor(Math.random() * 9) + 2;
                answer = num1 * num2;
                qText = `${num1} × ${num2} = ?`;
            } else {
                num2 = Math.floor(Math.random() * 8) + 2;
                const multiplier = Math.floor(Math.random() * 8) + 2;
                num1 = num2 * multiplier;
                answer = multiplier;
                qText = `${num1} ÷ ${num2} = ?`;
            }
        } else if (user.eduLevel === 3) {
            num1 = Math.floor(Math.random() * 20) + 5;
            num2 = Math.floor(Math.random() * 10) + 2;
            const num3 = Math.floor(Math.random() * 10) + 1;
            answer = num1 + num2 * num3;
            qText = `${num1} + ${num2} × ${num3} = ?`;
        }

        user.activeQuestion = { question: qText, answer: answer };
        saveData();

        return message.reply(
            `🏫 **BÀI HỌC CẤP ${user.eduLevel}** (Tiến độ: ${user.eduProgress}/5 câu đúng)\n` +
            `❓ Câu hỏi: **${qText}**\n` +
            `👉 Dùng lệnh \`!traloi [đáp án]\` để trả lời!`
        );
    }

    // 4. Lệnh traloi
    if (command === 'traloi') {
        if (!user.activeQuestion) {
            return message.reply('❌ Bạn không có câu hỏi nào cần trả lời lúc này! Dùng `!dihoc` để lấy bài tập.');
        }

        const userAnswer = parseInt(args[0]);
        if (isNaN(userAnswer)) {
            return message.reply('❌ Vui lòng nhập số hợp lệ làm đáp án!');
        }

        const correct = user.activeQuestion.answer;
        if (userAnswer === correct) {
            user.activeQuestion = null;
            user.eduProgress += 1;

            let replyText = `✅ **Chính xác!** Tiến độ cấp ${user.eduLevel}: **${user.eduProgress}/5**`;

            if (user.eduProgress >= 5) {
                user.eduProgress = 0;
                user.eduLevel += 1;

                if (user.eduLevel > 3) {
                    const roll = Math.random();
                    if (roll < 0.05) {
                        user.university = 'Đại học Bách Khoa';
                    } else if (roll < 0.17) {
                        user.university = 'Đại học Ngoại Thương';
                    } else if (roll < 0.40) {
                        user.university = 'Đại học Kinh Tế Quốc Dân';
                    } else if (roll < 0.70) {
                        user.university = 'Đại học Quốc Gia';
                    } else {
                        user.university = 'Cao đẳng Nghề';
                    }

                    replyText += `\n\n🎉🎉 **CHÚC MỪNG BẠN ĐÃ TỐT NGHIỆP 3 CẤP HỌC!** 🎉🎉\n` +
                                 `🎓 Kết quả quay số trúng tuyển trường đại học:\n` +
                                 `🏛️ Bạn đã đậu vào: **${user.university}**!`;
                } else {
                    replyText += `\n🎉 Chúc mừng bạn lên **Cấp học ${user.eduLevel}**! Gõ \`!dihoc\` tiếp tục học.`;
                }
            } else {
                replyText += `\n👉 Gõ tiếp \`!dihoc\` để làm câu tiếp theo.`;
            }

            saveData();
            return message.reply(replyText);
        } else {
            user.activeQuestion = null;
            saveData();
            return message.reply(`❌ **Sai rồi!** Đáp án đúng là **${correct}**. Gõ \`!dihoc\` để làm bài mới.`);
        }
    }

    // 5. Lệnh taixiu
    if (command === 'taixiu') {
        const currentTierInfo = cardTiers[user.tier];
        if (user.debt >= currentTierInfo.maxLoan && user.debt > 0) {
            return message.reply(`🚫 **BẠN ĐÃ BỊ TƯỚC QUYỀN CHƠI TÀI XỈU!** Đang nợ kịch trần thẻ **${currentTierInfo.name}**. Hãy trả nợ bằng \`!tranganhang\`!`);
        }

        const choice = args[0] ? args[0].toLowerCase() : '';
        const betAmount = parseInt(args[1]);

        if (!['tai', 'xiu'].includes(choice) || isNaN(betAmount) || betAmount <= 0) {
            return message.reply('❌ Cú pháp: `!taixiu tai <số tiền>` hoặc `!taixiu xiu <số tiền>`');
        }

        if (user.balance < betAmount) {
            return message.reply(`❌ Không đủ tiền mặt! Số dư: **${user.balance.toLocaleString()} vnđ**.`);
        }

        user.balance -= betAmount;

        const dice1 = Math.floor(Math.random() * 6) + 1;
        const dice2 = Math.floor(Math.random() * 6) + 1;
        const dice3 = Math.floor(Math.random() * 6) + 1;
        const total = dice1 + dice2 + dice3;
        const result = total >= 11 ? 'tai' : 'xiu';

        let replyMsg = `🎲 Xúc xắc: **${dice1} - ${dice2} - ${dice3}** (Tổng: **${total}** -> **${result.toUpperCase()}**)\n`;

        if (choice === result) {
            const winAmount = betAmount * 2;
            user.balance += winAmount;
            replyMsg += `🎉 Chúc mừng bạn **THẮNG** nhận **${winAmount.toLocaleString()} vnđ**!`;
        } else {
            replyMsg += `😢 Rất tiếc, bạn đã **THUA** ván này.`;
        }

        saveData();
        replyMsg += `\n💰 Số dư: **${user.balance.toLocaleString()} vnđ**`;
        return message.reply(replyMsg);
    }

    // 6. Lệnh hoso
    if (command === 'hoso') {
        let targetUser = message.mentions.users.first() || message.author;
        let targetId = targetUser.id;

        if (!usersData[targetId]) {
            return message.reply(`⚠️ Người dùng ${targetUser.username} chưa đăng ký tài khoản.`);
        }

        const targetData = usersData[targetId];
        const tierInfo = cardTiers[targetData.tier];
        
        let eduStatus = `Cấp ${targetData.eduLevel} (Tiến độ: ${targetData.eduProgress}/5)`;
        if (targetData.eduLevel > 3) {
            eduStatus = `Tốt nghiệp (${targetData.university})`;
        }

        return message.reply(
            `📊 **HỒ SƠ NGƯỜI CHƠI: ${targetData.username}** 📊\n` +
            `• Học vấn: **${eduStatus}**\n` +
            `• Số dư tiền mặt: **${targetData.balance.toLocaleString()} vnđ**\n` +
            `• Cấp thẻ ngân hàng: **${tierInfo.name} (Cấp ${targetData.tier})**\n` +
            `• Tiền đang nợ: **${targetData.debt.toLocaleString()}/${tierInfo.maxLoan.toLocaleString()} vnđ**`
        );
    }

    // 7. Lệnh vaynganhang
    if (command === 'vaynganhang') {
        const loanAmount = parseInt(args[0]);
        if (isNaN(loanAmount) || loanAmount <= 0) return message.reply('❌ Nhập số tiền vay hợp lệ!');

        const tierInfo = cardTiers[user.tier];
        if (user.debt + loanAmount > tierInfo.maxLoan) {
            return message.reply(`❌ Vượt hạn mức thẻ! Tối đa vay thêm: **${(tierInfo.maxLoan - user.debt).toLocaleString()} vnđ**.`);
        }

        user.debt += loanAmount;
        user.balance += loanAmount;
        saveData();
        return message.reply(`✅ Vay thành công **${loanAmount.toLocaleString()} vnđ**! Tổng nợ: **${user.debt}/${tierInfo.maxLoan} vnđ**`);
    }

    // 8. Lệnh tranganhang
    if (command === 'tranganhang') {
        const payAmount = parseInt(args[0]);
        if (isNaN(payAmount) || payAmount <= 0) return message.reply('❌ Nhập số tiền trả hợp lệ!');
        if (user.debt <= 0) return message.reply('🎉 Bạn không nợ ngân hàng!');
        if (user.balance < payAmount) return message.reply('❌ Không đủ tiền mặt để trả!');

        const actualPay = Math.min(payAmount, user.debt);
        user.balance -= actualPay;
        user.debt -= actualPay;
        const tierInfo = cardTiers[user.tier];
        saveData();
        
        let msg = `✅ Đã trả **${actualPay.toLocaleString()} vnđ** tiền nợ. Nợ còn: **${user.debt} vnđ**`;
        if (user.debt < tierInfo.maxLoan) msg += `\n🔓 Khôi phục quyền chơi Tài Xỉu!`;
        return message.reply(msg);
    }

    // 9. Lệnh nangcapthenganhang
    if (command === 'nangcapthenganhang') {
        if (user.tier >= 4) return message.reply('🏆 Thẻ đã đạt cấp tối đa (Infinite)!');
        const nextTier = user.tier + 1;
        const nextTierInfo = cardTiers[nextTier];

        if (user.balance < nextTierInfo.upgradeCost) {
            return message.reply(`❌ Cần **${nextTierInfo.upgradeCost.toLocaleString()} vnđ** để lên ${nextTierInfo.name}.`);
        }

        user.balance -= nextTierInfo.upgradeCost;
        user.tier = nextTier;
        saveData();
        return message.reply(`🎉 Nâng cấp thành công lên **${nextTierInfo.name}**! Hạn mức mới: **${nextTierInfo.maxLoan} vnđ**.`);
    }

    // 10. Lệnh bank
    if (command === 'bank') {
        const targetUser = message.mentions.users.first();
        const transferAmount = parseInt(args[1]);

        if (!targetUser || !usersData[targetUser.id] || isNaN(transferAmount) || transferAmount <= 0) {
            return message.reply('❌ Cú pháp: `!bank @user <số tiền>`');
        }
        if (targetUser.id === userId) return message.reply('❌ Không thể chuyển cho chính mình!');
        if (user.balance < transferAmount) return message.reply('❌ Không đủ số dư để chuyển!');

        user.balance -= transferAmount;
        usersData[targetUser.id].balance += transferAmount;
        saveData();
        return message.reply(`✅ Đã chuyển **${transferAmount.toLocaleString()} vnđ** cho **${targetUser.username}**!`);
    }

    // 11. Lệnh dilam
    if (command === 'dilam') {
        const job = args[0] ? args[0].toLowerCase() : '';
        if (!['anxin', 'ancuop'].includes(job)) {
            return message.reply('❌ Chọn nghề: `!dilam anxin` hoặc `!dilam ancuop`');
        }

        let bonusMultiplier = 1.0;
        let schoolInfoText = '';

        if (user.university === 'Đại học Bách Khoa') {
            bonusMultiplier = 1.15;
            schoolInfoText = ' *(+15% lương - ĐH Bách Khoa)*';
        } else if (user.university === 'Đại học Ngoại Thương') {
            bonusMultiplier = 1.10;
            schoolInfoText = ' *(+10% lương - ĐH Ngoại Thương)*';
        } else if (user.university === 'Đại học Kinh Tế Quốc Dân') {
            bonusMultiplier = 1.05;
            schoolInfoText = ' *(+5% lương - ĐH KTQD)*';
        } else if (user.university === 'Cao đẳng Nghề') {
            bonusMultiplier = 0.95;
            schoolInfoText = ' *(-5% lương - Cao đẳng Nghề)*';
        }

        if (job === 'anxin') {
            let baseEarned = Math.floor(Math.random() * 21) + 10;
            let earned = Math.floor(baseEarned * bonusMultiplier);
            user.balance += earned;
            saveData();
            return message.reply(`🥣 Bạn đi ăn xin và kiếm được **${earned} vnđ**${schoolInfoText}.`);
        }

        if (job === 'ancuop') {
            let catchRate = 0.5;
            if (user.university === 'Đại học Bách Khoa') catchRate = 0.2;
            else if (user.university === 'Đại học Ngoại Thương') catchRate = 0.35;
            else if (user.university === 'Cao đẳng Nghề') catchRate = 0.6;

            const isCaught = Math.random() < catchRate;

            if (isCaught) {
                const oneHour = 60 * 60 * 1000;
                user.jailTime = Date.now() + oneHour;
                saveData();
                try {
                    const member = await message.guild.members.fetch(userId);
                    await member.timeout(oneHour, 'Đi ăn cướp bị bắt');
                } catch (err) {}
                return message.reply(`🚨 **CÔNG AN TÓM GỌN!** Bạn bị bắt vào tù 1 giờ và bị mute!`);
            } else {
                let baseLooted = Math.floor(Math.random() * 201) + 100;
                let looted = Math.floor(baseLooted * bonusMultiplier);
                user.balance += looted;
                saveData();
                return message.reply(`🦹‍♂️ Ăn cướp trót lọt! Kiếm được **${looted.toLocaleString()} vnđ**${schoolInfoText}.`);
            }
        }
    }
});

// Đăng nhập bot (giữ nguyên token trực tiếp của bạn vào đây)
client.login('MTU1Mjk3NjYwMzIyMTMzMjAwOA.GAHFJU.mbwMNVGByXz3qEcavt7BGFvdG8PbGQk2usYK3Q');
        
