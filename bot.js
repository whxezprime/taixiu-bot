const { Client, GatewayIntentBits, EmbedBuilder } = require('discord.js');
const fs = require('fs');

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildModeration
    ]
});

// ─── Lưu trữ dữ liệu ─────────────────────────────────────────────────────────
const DATA_FILE = './users.json';
let usersData = {};

function loadData() {
    if (fs.existsSync(DATA_FILE)) {
        try {
            usersData = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
        } catch (err) {
            console.error('Lỗi đọc file:', err);
            usersData = {};
        }
    }
}

function saveData() {
    try {
        fs.writeFileSync(DATA_FILE, JSON.stringify(usersData, null, 2), 'utf8');
    } catch (err) {
        console.error('Lỗi ghi file:', err);
    }
}

loadData();

// ─── Cấu hình thẻ ngân hàng ──────────────────────────────────────────────────
const cardTiers = {
    1: { name: 'Thẻ Thành Viên',  maxLoan: 200,  upgradeCost: 0,    emoji: '🪪', color: 0x95a5a6 },
    2: { name: 'Thẻ Thông Gia',   maxLoan: 500,  upgradeCost: 100,  emoji: '💳', color: 0x4fc3f7 },
    3: { name: 'Thẻ Gold',        maxLoan: 1000, upgradeCost: 1000, emoji: '🥇', color: 0xffd700 },
    4: { name: 'Thẻ Infinite',    maxLoan: 5000, upgradeCost: 2000, emoji: '💎', color: 0xc084fc }
};

// ─── Cửa hàng vật phẩm ───────────────────────────────────────────────────────
const shopItems = {
    mask:      { name: 'Mặt Nạ',      emoji: '🎭', price: 200,   stackable: false, desc: 'Giảm 15% tỷ lệ bị bắt khi ăn cướp' },
    gloves:    { name: 'Găng Tay',     emoji: '🧤', price: 300,   stackable: false, desc: 'Tăng 15% số tiền cướp được' },
    lockpick:  { name: 'Bộ Phá Khóa', emoji: '🔓', price: 500,   stackable: true,  desc: '30% thoát tù sớm — thất bại mất 1 cái' },
    motorbike: { name: 'Xe Máy',       emoji: '🛵', price: 10000, stackable: false, desc: 'Mở khóa nghề Shipper' }
};

// ─── Hằng màu embed ───────────────────────────────────────────────────────────
const C = {
    SUCCESS: 0x57f287,
    ERROR:   0xed4245,
    WARN:    0xfee75c,
    INFO:    0x5865f2,
    GOLD:    0xffd700,
    PURPLE:  0xc084fc,
};

// ─── Emoji xúc xắc ───────────────────────────────────────────────────────────
const diceEmoji = { 1: '⚀', 2: '⚁', 3: '⚂', 4: '⚃', 5: '⚄', 6: '⚅' };

// ─── Emoji trường đại học ─────────────────────────────────────────────────────
const uniEmoji = {
    'Đại học Bách Khoa':         '🏆',
    'Đại học Ngoại Thương':      '🥈',
    'Đại học Kinh Tế Quốc Dân': '🥉',
    'Đại học Quốc Gia':          '🎓',
    'Cao đẳng Nghề':             '📜'
};

// ─── Bonus lương & tỷ lệ bắt theo trường ─────────────────────────────────────
const uniBonus = {
    'Đại học Bách Khoa':         { mult: 1.15, label: '+15% | ĐH Bách Khoa',    catchRate: 0.20 },
    'Đại học Ngoại Thương':      { mult: 1.10, label: '+10% | ĐH Ngoại Thương', catchRate: 0.35 },
    'Đại học Kinh Tế Quốc Dân': { mult: 1.05, label: '+5%  | ĐH KTQD',          catchRate: 0.50 },
    'Đại học Quốc Gia':          { mult: 1.00, label: '±0%  | ĐH Quốc Gia',     catchRate: 0.50 },
    'Cao đẳng Nghề':             { mult: 0.95, label: '-5%  | Cao đẳng Nghề',    catchRate: 0.60 },
};
const DEFAULT_BONUS = { mult: 1.0, label: '', catchRate: 0.50 };

// ─── Hàm tiện ích ─────────────────────────────────────────────────────────────
function progressBar(current, max, length = 10) {
    const filled = Math.round((current / max) * length);
    return `[${'█'.repeat(filled) + '░'.repeat(length - filled)}]`;
}

function debtIndicator(debt, max) {
    const r = debt / max;
    if (r >= 1)   return '🔴';
    if (r >= 0.7) return '🟠';
    if (r >= 0.4) return '🟡';
    return '🟢';
}

// Đảm bảo user có inventory và injuredTime (tương thích với dữ liệu cũ)
function ensureInventory(user) {
    if (!user.inventory) {
        user.inventory = { mask: false, gloves: false, motorbike: false, lockpick: 0 };
    }
    if (typeof user.inventory.lockpick !== 'number') user.inventory.lockpick = 0;
    if (typeof user.injuredTime !== 'number') user.injuredTime = 0;
}

// Gửi reply rồi tự xóa sau delay ms (mặc định 10 giây)
async function replyAndDelete(message, payload, delay = 10000) {
    try {
        const msg = await message.reply(payload);
        setTimeout(() => msg.delete().catch(() => {}), delay);
    } catch {}
}

// ─── Khởi động bot ────────────────────────────────────────────────────────────
client.once('clientReady', () => {
    console.log(`✅ Bot đăng nhập: ${client.user.tag}`);
});

// ─── Xử lý tin nhắn ──────────────────────────────────────────────────────────
client.on('messageCreate', async message => {
    if (message.author.bot) return;

    const args = message.content.trim().split(/ +/);
    let rawCommand = args.shift().toLowerCase();
    const command = rawCommand.startsWith('!') ? rawCommand.slice(1) : rawCommand;
    const userId = message.author.id;

    // ══════════════════════════════════════════════════════════════════════════
    //  CÁC LỆNH KHÔNG YÊU CẦU TÀI KHOẢN
    // ══════════════════════════════════════════════════════════════════════════

    // ── 1. HELPTAIXIU ──────────────────────────────────────────────────────────
    if (command === 'helptaixiu') {
        const embed = new EmbedBuilder()
            .setColor(C.INFO)
            .setTitle('📖  Hướng Dẫn Bot Tài Xỉu')
            .setDescription('> Tất cả lệnh bắt đầu bằng `!`   •   **14 lệnh** tổng cộng')
            .addFields(
                { name: '🎮  Tài Xỉu',   value: '`!taixiu [tai/xiu] [tiền]`', inline: false },
                { name: '🎓  Học Tập',   value: '`!dihoc` — Lấy bài tập\n`!traloi [đáp án]` — Trả lời', inline: false },
                { name: '🏦  Ngân Hàng', value: '`!vaynganhang [tiền]`  `!tranganhang [tiền]`\n`!nangcapthenganhang`  `!bank @user [tiền]`', inline: false },
                { name: '💼  Kiếm Tiền', value: '`!dilam anxin` — Ăn xin\n`!dilam ancuop` — Ăn cướp\n`!dilam shipper` — Giao hàng 🛵 *(cần xe máy)*', inline: false },
                { name: '🛒  Cửa Hàng',  value: '`!shop` — Xem vật phẩm\n`!mua [id]` — Mua vật phẩm\n`!phakhoa` — Dùng bộ phá khóa thoát tù 🔓', inline: false },
                { name: '📋  Tài Khoản', value: '`!dangky` — Đăng ký (nhận 100 vnđ)\n`!hoso` / `!hoso @user` — Xem hồ sơ', inline: false }
            )
            .setFooter({ text: 'Thẻ NH: 🪪 Thành Viên → 💳 Thông Gia → 🥇 Gold → 💎 Infinite' })
            .setTimestamp();
        return message.reply({ embeds: [embed] });
    }

    // ── 2. DANGKY ─────────────────────────────────────────────────────────────
    if (command === 'dangky') {
        if (usersData[userId]) {
            return message.reply({ embeds: [
                new EmbedBuilder().setColor(C.ERROR).setDescription('❌  Bạn **đã có tài khoản** rồi!')
            ]});
        }

        usersData[userId] = {
            balance: 100,
            username: message.author.username,
            tier: 1,
            debt: 0,
            jailTime: 0,
            injuredTime: 0,
            eduLevel: 1,
            eduProgress: 0,
            activeQuestion: null,
            university: null,
            inventory: { mask: false, gloves: false, motorbike: false, lockpick: 0 }
        };
        saveData();

        const embed = new EmbedBuilder()
            .setColor(C.SUCCESS)
            .setTitle('✅  Đăng Ký Thành Công!')
            .setDescription(`Chào mừng **${message.author.username}** đến với hệ thống!`)
            .addFields(
                { name: '💰  Số Dư Khởi Đầu', value: '`100 vnđ`', inline: true },
                { name: '🎓  Cấp Học',          value: '`Cấp 1`',  inline: true },
                { name: '📌  Gợi Ý',            value: '`!dihoc` để đi học  •  `!dilam anxin` để kiếm tiền', inline: false }
            );
        return message.reply({ embeds: [embed] });
    }

    // ── 12. SHOP ──────────────────────────────────────────────────────────────
    if (command === 'shop') {
        const fields = Object.entries(shopItems).map(([id, item]) => ({
            name: `${item.emoji}  ${item.name}  —  **${item.price.toLocaleString()} vnđ**`,
            value: `> ${item.desc}\n> Mua: \`!mua ${id}\`${item.stackable ? '  *(có thể mua nhiều)*' : ''}`,
            inline: false
        }));

        const embed = new EmbedBuilder()
            .setColor(C.INFO)
            .setTitle('🏪  Cửa Hàng Vật Phẩm')
            .addFields(fields)
            .setFooter({ text: 'Dùng !mua [id] để mua  •  VD: !mua mask' });
        return message.reply({ embeds: [embed] });
    }

    // ══════════════════════════════════════════════════════════════════════════
    //  KIỂM TRA TÀI KHOẢN (áp dụng cho tất cả lệnh còn lại)
    // ══════════════════════════════════════════════════════════════════════════
    const restrictedCommands = [
        'taixiu', 'vaynganhang', 'tranganhang', 'nangcapthenganhang',
        'bank', 'dilam', 'dihoc', 'traloi', 'hoso', 'mua', 'phakhoa'
    ];
    if (restrictedCommands.includes(command) && !usersData[userId]) {
        return message.reply({ embeds: [
            new EmbedBuilder().setColor(C.WARN)
                .setDescription('⚠️  Bạn chưa có tài khoản! Dùng `!dangky` để đăng ký trước.')
        ]});
    }

    const user = usersData[userId];
    if (!user) return;

    // ══════════════════════════════════════════════════════════════════════════
    //  LỆNH ĐẶC BIỆT: xử lý TRƯỚC khi check tù (phakhoa cần chạy trong tù)
    // ══════════════════════════════════════════════════════════════════════════

    // ── 14. PHAKHOA ───────────────────────────────────────────────────────────
    if (command === 'phakhoa') {
        ensureInventory(user);

        if (!user.jailTime || Date.now() >= user.jailTime) {
            return message.reply({ embeds: [
                new EmbedBuilder().setColor(C.ERROR)
                    .setDescription('❌  Bạn không đang ngồi tù!')
            ]});
        }

        if (user.inventory.lockpick <= 0) {
            return message.reply({ embeds: [
                new EmbedBuilder().setColor(C.ERROR)
                    .setDescription('❌  Không có Bộ Phá Khóa!\nDùng `!mua lockpick` để mua **(500 vnđ/cái)**.')
            ]});
        }

        // Tiêu thụ 1 lockpick
        user.inventory.lockpick -= 1;

        if (Math.random() < 0.30) {
            // ✅ Thoát tù thành công
            user.jailTime = 0;
            saveData();
            return message.reply({ embeds: [
                new EmbedBuilder()
                    .setColor(C.SUCCESS)
                    .setTitle('🔓  Phá Khóa Thành Công!')
                    .setDescription('Bạn đã trốn thoát khỏi tù!')
                    .setFooter({ text: `Bộ phá khóa còn lại: ${user.inventory.lockpick} cái` })
            ]});
        } else {
            // ❌ Thất bại, mất lockpick
            saveData();
            const minsLeft = Math.ceil((user.jailTime - Date.now()) / 60000);
            return message.reply({ embeds: [
                new EmbedBuilder()
                    .setColor(C.ERROR)
                    .setTitle('🔒  Phá Khóa Thất Bại!')
                    .setDescription(`Bộ phá khóa bị gãy! Còn **${minsLeft} phút** nữa mới ra tù.`)
                    .setFooter({ text: `Bộ phá khóa còn lại: ${user.inventory.lockpick} cái` })
            ]});
        }
    }

    // ── Kiểm tra đi tù (block toàn bộ lệnh còn lại) ──────────────────────────
    if (user.jailTime && Date.now() < user.jailTime) {
        const mins = Math.ceil((user.jailTime - Date.now()) / 60000);
        return message.reply({ embeds: [
            new EmbedBuilder()
                .setColor(C.ERROR)
                .setTitle('🔒  Đang Ngồi Tù!')
                .setDescription(`Còn **${mins} phút** nữa mới được thả.`)
                .setFooter({ text: 'Dùng !phakhoa nếu có Bộ Phá Khóa 🔓' })
        ]});
    }

    // ══════════════════════════════════════════════════════════════════════════
    //  CÁC LỆNH THÔNG THƯỜNG (yêu cầu tài khoản + không bị tù)
    // ══════════════════════════════════════════════════════════════════════════

    // ── 3. DIHOC ──────────────────────────────────────────────────────────────
    if (command === 'dihoc') {
        if (user.eduLevel > 3) {
            return message.reply({ embeds: [
                new EmbedBuilder().setColor(C.SUCCESS)
                    .setDescription(`🎓  Bạn đã tốt nghiệp và đang học tại **${user.university}** rồi!`)
            ]});
        }

        if (user.activeQuestion) {
            return message.reply({ embeds: [
                new EmbedBuilder()
                    .setColor(C.WARN)
                    .setTitle(`📝  Câu Hỏi Đang Chờ — Cấp ${user.eduLevel}`)
                    .addFields(
                        { name: '❓  Câu Hỏi',     value: `**\`${user.activeQuestion.question}\`**`, inline: false },
                        { name: '💡  Cách Trả Lời', value: '`!traloi <đáp án>`',                     inline: false }
                    )
            ]});
        }

        let num1, num2, answer, qText;
        if (user.eduLevel === 1) {
            num1 = Math.floor(Math.random() * 10) + 1;
            num2 = Math.floor(Math.random() * 10) + 1;
            answer = num1 + num2;
            qText = `${num1} + ${num2} = ?`;
        } else if (user.eduLevel === 2) {
            if (Math.random() < 0.5) {
                num1 = Math.floor(Math.random() * 9) + 2;
                num2 = Math.floor(Math.random() * 9) + 2;
                answer = num1 * num2;
                qText = `${num1} × ${num2} = ?`;
            } else {
                num2 = Math.floor(Math.random() * 8) + 2;
                const mul = Math.floor(Math.random() * 8) + 2;
                num1 = num2 * mul;
                answer = mul;
                qText = `${num1} ÷ ${num2} = ?`;
            }
        } else {
            num1 = Math.floor(Math.random() * 20) + 5;
            num2 = Math.floor(Math.random() * 10) + 2;
            const num3 = Math.floor(Math.random() * 10) + 1;
            answer = num1 + num2 * num3;
            qText = `${num1} + ${num2} × ${num3} = ?`;
        }

        user.activeQuestion = { question: qText, answer };
        saveData();

        const embed = new EmbedBuilder()
            .setColor(C.INFO)
            .setTitle(`🏫  Bài Học Cấp ${user.eduLevel}`)
            .addFields(
                { name: '📊  Tiến Độ',      value: `\`${progressBar(user.eduProgress, 5)} ${user.eduProgress}/5\``, inline: false },
                { name: '❓  Câu Hỏi',      value: `**\`${qText}\`**`,                                              inline: false },
                { name: '💡  Cách Trả Lời', value: '`!traloi <đáp án>`',                                            inline: false }
            );
        return message.reply({ embeds: [embed] });
    }

    // ── 4. TRALOI ─────────────────────────────────────────────────────────────
    if (command === 'traloi') {
        if (!user.activeQuestion) {
            return message.reply({ embeds: [
                new EmbedBuilder().setColor(C.ERROR)
                    .setDescription('❌  Không có câu hỏi nào! Dùng `!dihoc` trước.')
            ]});
        }

        const userAns = parseInt(args[0]);
        if (isNaN(userAns)) {
            return message.reply({ embeds: [
                new EmbedBuilder().setColor(C.ERROR).setDescription('❌  Vui lòng nhập **số** làm đáp án!')
            ]});
        }

        const correct = user.activeQuestion.answer;
        user.activeQuestion = null;

        if (userAns === correct) {
            user.eduProgress += 1;

            if (user.eduProgress >= 5) {
                user.eduProgress = 0;
                user.eduLevel += 1;

                if (user.eduLevel > 3) {
                    const roll = Math.random();
                    if (roll < 0.05)       user.university = 'Đại học Bách Khoa';
                    else if (roll < 0.17)  user.university = 'Đại học Ngoại Thương';
                    else if (roll < 0.40)  user.university = 'Đại học Kinh Tế Quốc Dân';
                    else if (roll < 0.70)  user.university = 'Đại học Quốc Gia';
                    else                   user.university = 'Cao đẳng Nghề';
                    saveData();

                    return message.reply({ embeds: [
                        new EmbedBuilder()
                            .setColor(C.GOLD)
                            .setTitle('🎉🎉  TỐT NGHIỆP THÀNH CÔNG!  🎉🎉')
                            .setDescription('Chúc mừng bạn đã hoàn thành cả 3 cấp học!')
                            .addFields(
                                { name: '🏛️  Trường Bạn Vào Được', value: `${uniEmoji[user.university] || '🎓'}  **${user.university}**`,           inline: false },
                                { name: '📌  Lưu Ý',                value: 'Trường ĐH ảnh hưởng đến lương và tỷ lệ bị bắt khi `!dilam`!', inline: false }
                            )
                    ]});
                }

                saveData();
                return message.reply({ embeds: [
                    new EmbedBuilder()
                        .setColor(C.SUCCESS)
                        .setTitle('🎉  Lên Cấp!')
                        .setDescription(`Bạn đã lên **Cấp Học ${user.eduLevel}**! Gõ \`!dihoc\` để tiếp tục.`)
                ]});
            }

            saveData();
            return message.reply({ embeds: [
                new EmbedBuilder()
                    .setColor(C.SUCCESS)
                    .setDescription(`✅  **Chính xác!**\n\`${progressBar(user.eduProgress, 5)} ${user.eduProgress}/5\` — Gõ \`!dihoc\` tiếp tục.`)
            ]});

        } else {
            saveData();
            return message.reply({ embeds: [
                new EmbedBuilder()
                    .setColor(C.ERROR)
                    .setDescription(`❌  **Sai rồi!** Đáp án đúng là **${correct}**. Gõ \`!dihoc\` để làm bài mới.`)
            ]});
        }
    }

    // ── 5. TAIXIU ─────────────────────────────────────────────────────────────
    if (command === 'taixiu') {
        const tierInfo = cardTiers[user.tier];
        if (user.debt >= tierInfo.maxLoan && user.debt > 0) {
            return message.reply({ embeds: [
                new EmbedBuilder()
                    .setColor(C.ERROR)
                    .setTitle('🚫  Bị Tước Quyền Chơi!')
                    .setDescription(`Nợ kịch trần **${tierInfo.name}**. Dùng \`!tranganhang\` để trả nợ trước!`)
            ]});
        }

        const choice = args[0]?.toLowerCase() ?? '';
        const betAmount = parseInt(args[1]);

        if (!['tai', 'xiu'].includes(choice) || isNaN(betAmount) || betAmount <= 0) {
            return message.reply({ embeds: [
                new EmbedBuilder().setColor(C.ERROR)
                    .setDescription('❌  Cú pháp: `!taixiu tai <tiền>` hoặc `!taixiu xiu <tiền>`')
            ]});
        }
        if (user.balance < betAmount) {
            return message.reply({ embeds: [
                new EmbedBuilder().setColor(C.ERROR)
                    .setDescription(`❌  Không đủ tiền! Số dư: **${user.balance.toLocaleString()} vnđ**`)
            ]});
        }

        user.balance -= betAmount;

        const d1 = Math.floor(Math.random() * 6) + 1;
        const d2 = Math.floor(Math.random() * 6) + 1;
        const d3 = Math.floor(Math.random() * 6) + 1;
        const total = d1 + d2 + d3;
        const result = total >= 11 ? 'tai' : 'xiu';
        const win = choice === result;

        if (win) user.balance += betAmount * 2;
        saveData();

        const embed = new EmbedBuilder()
            .setColor(win ? C.SUCCESS : C.ERROR)
            .setTitle(win ? '🎉  THẮNG!' : '😢  THUA!')
            .addFields(
                { name: '🎲  Xúc Xắc',                  value: `${diceEmoji[d1]} ${diceEmoji[d2]} ${diceEmoji[d3]}   →   Tổng **${total}**   →   **${result.toUpperCase()}**`, inline: false },
                { name: '🃏  Bạn Chọn',                  value: choice.toUpperCase(),                                              inline: true },
                { name: win ? '💸  Thắng' : '💸  Thua', value: `${win ? '+' : '-'}${betAmount.toLocaleString()} vnđ`,            inline: true },
                { name: '💰  Số Dư',                     value: `${user.balance.toLocaleString()} vnđ`,                           inline: true }
            );
        return message.reply({ embeds: [embed] });
    }

    // ── 6. HOSO ───────────────────────────────────────────────────────────────
    if (command === 'hoso') {
        const target = message.mentions.users.first() || message.author;
        const td = usersData[target.id];

        if (!td) {
            return message.reply({ embeds: [
                new EmbedBuilder().setColor(C.ERROR)
                    .setDescription(`⚠️  **${target.username}** chưa đăng ký tài khoản!`)
            ]});
        }

        ensureInventory(td);
        const tierInfo = cardTiers[td.tier];

        // Học vấn
        const eduText = td.eduLevel > 3
            ? `${uniEmoji[td.university] || '🎓'}  **${td.university}** (Tốt nghiệp)`
            : `Cấp ${td.eduLevel}  \`${progressBar(td.eduProgress, 5)} ${td.eduProgress}/5\``;

        // Kho đồ
        const inv = td.inventory;
        const invParts = [];
        if (inv.mask)          invParts.push('🎭 Mặt Nạ');
        if (inv.gloves)        invParts.push('🧤 Găng Tay');
        if (inv.motorbike)     invParts.push('🛵 Xe Máy');
        if (inv.lockpick > 0)  invParts.push(`🔓 Phá Khóa ×${inv.lockpick}`);
        const inventoryText = invParts.length ? invParts.join('  •  ') : '*Trống*';

        const embed = new EmbedBuilder()
            .setColor(tierInfo.color)
            .setTitle(`📋  Hồ Sơ — ${td.username}`)
            .setThumbnail(target.displayAvatarURL())
            .addFields(
                { name: '🎓  Học Vấn',                                                 value: eduText,                                                                               inline: false },
                { name: '💰  Số Dư Tiền Mặt',                                          value: `\`${td.balance.toLocaleString()} vnđ\``,                                             inline: true  },
                { name: `${tierInfo.emoji}  Thẻ Ngân Hàng`,                           value: `${tierInfo.name} (Cấp ${td.tier})`,                                                   inline: true  },
                { name: `${debtIndicator(td.debt, tierInfo.maxLoan)}  Tình Trạng Nợ`, value: `\`${td.debt.toLocaleString()} / ${tierInfo.maxLoan.toLocaleString()} vnđ\``,          inline: false },
                { name: '🎒  Kho Đồ',                                                  value: inventoryText,                                                                          inline: false }
            )
            .setFooter({ text: 'Bot Tài Xỉu' })
            .setTimestamp();
        return message.reply({ embeds: [embed] });
    }

    // ── 7. VAYNGANHANG ────────────────────────────────────────────────────────
    if (command === 'vaynganhang') {
        const loanAmount = parseInt(args[0]);
        if (isNaN(loanAmount) || loanAmount <= 0) {
            return message.reply({ embeds: [
                new EmbedBuilder().setColor(C.ERROR).setDescription('❌  Cú pháp: `!vaynganhang <số tiền>`')
            ]});
        }

        const tierInfo = cardTiers[user.tier];
        const canBorrow = tierInfo.maxLoan - user.debt;
        if (loanAmount > canBorrow) {
            return message.reply({ embeds: [
                new EmbedBuilder()
                    .setColor(C.ERROR)
                    .setTitle('❌  Vượt Hạn Mức!')
                    .setDescription(`Tối đa có thể vay thêm: **${canBorrow.toLocaleString()} vnđ**`)
            ]});
        }

        user.debt += loanAmount;
        user.balance += loanAmount;
        saveData();

        const embed = new EmbedBuilder()
            .setColor(C.SUCCESS)
            .setTitle('🏦  Vay Thành Công!')
            .addFields(
                { name: '💸  Số Tiền Vay',   value: `\`+${loanAmount.toLocaleString()} vnđ\``,                                               inline: true  },
                { name: '💰  Số Dư Mới',     value: `\`${user.balance.toLocaleString()} vnđ\``,                                              inline: true  },
                { name: '📊  Tình Trạng Nợ', value: `\`${progressBar(user.debt, tierInfo.maxLoan)} ${user.debt}/${tierInfo.maxLoan} vnđ\``,  inline: false }
            );
        return message.reply({ embeds: [embed] });
    }

    // ── 8. TRANGANHANG ────────────────────────────────────────────────────────
    if (command === 'tranganhang') {
        if (user.debt <= 0) {
            return message.reply({ embeds: [
                new EmbedBuilder().setColor(C.SUCCESS).setDescription('🎉  Bạn không nợ ngân hàng đồng nào!')
            ]});
        }

        const payAmount = parseInt(args[0]);
        if (isNaN(payAmount) || payAmount <= 0) {
            return message.reply({ embeds: [
                new EmbedBuilder().setColor(C.ERROR).setDescription('❌  Cú pháp: `!tranganhang <số tiền>`')
            ]});
        }
        if (user.balance < payAmount) {
            return message.reply({ embeds: [
                new EmbedBuilder().setColor(C.ERROR).setDescription('❌  Không đủ tiền mặt để trả!')
            ]});
        }

        const actualPay = Math.min(payAmount, user.debt);
        user.balance -= actualPay;
        user.debt -= actualPay;
        const tierInfo = cardTiers[user.tier];
        saveData();

        const embed = new EmbedBuilder()
            .setColor(C.SUCCESS)
            .setTitle('✅  Trả Nợ Thành Công!')
            .addFields(
                { name: '💸  Đã Trả',     value: `\`${actualPay.toLocaleString()} vnđ\``,   inline: true },
                { name: '📉  Nợ Còn Lại', value: `\`${user.debt.toLocaleString()} vnđ\``,   inline: true },
                { name: '💰  Số Dư',      value: `\`${user.balance.toLocaleString()} vnđ\``, inline: true }
            );
        if (user.debt < tierInfo.maxLoan) embed.setFooter({ text: '🔓 Quyền chơi Tài Xỉu đã được khôi phục!' });
        return message.reply({ embeds: [embed] });
    }

    // ── 9. NANGCAPTHENGANHANG ─────────────────────────────────────────────────
    if (command === 'nangcapthenganhang') {
        if (user.tier >= 4) {
            return message.reply({ embeds: [
                new EmbedBuilder()
                    .setColor(C.PURPLE)
                    .setTitle('💎  Đã Đạt Tối Đa!')
                    .setDescription('Thẻ của bạn đã là **Infinite** — cấp cao nhất rồi!')
            ]});
        }

        const nextTier = user.tier + 1;
        const nextInfo = cardTiers[nextTier];

        if (user.balance < nextInfo.upgradeCost) {
            return message.reply({ embeds: [
                new EmbedBuilder()
                    .setColor(C.ERROR)
                    .setTitle('❌  Không Đủ Tiền!')
                    .setDescription(`Cần **${nextInfo.upgradeCost.toLocaleString()} vnđ** để nâng lên **${nextInfo.name}**.\nSố dư hiện tại: \`${user.balance.toLocaleString()} vnđ\``)
            ]});
        }

        user.balance -= nextInfo.upgradeCost;
        user.tier = nextTier;
        saveData();

        const embed = new EmbedBuilder()
            .setColor(nextInfo.color)
            .setTitle(`${nextInfo.emoji}  Nâng Cấp Thành Công!`)
            .setDescription(`Thẻ mới: **${nextInfo.name}**`)
            .addFields(
                { name: '🏦  Hạn Mức Mới', value: `\`${nextInfo.maxLoan.toLocaleString()} vnđ\``, inline: true },
                { name: '💰  Số Dư Còn',   value: `\`${user.balance.toLocaleString()} vnđ\``,     inline: true }
            );
        return message.reply({ embeds: [embed] });
    }

    // ── 10. BANK (chuyển tiền) ────────────────────────────────────────────────
    if (command === 'bank') {
        const targetUser = message.mentions.users.first();
        const transferAmount = parseInt(args[1]);

        if (!targetUser || !usersData[targetUser.id] || isNaN(transferAmount) || transferAmount <= 0) {
            return message.reply({ embeds: [
                new EmbedBuilder().setColor(C.ERROR).setDescription('❌  Cú pháp: `!bank @user <số tiền>`')
            ]});
        }
        if (targetUser.id === userId) {
            return message.reply({ embeds: [
                new EmbedBuilder().setColor(C.ERROR).setDescription('❌  Không thể chuyển tiền cho chính mình!')
            ]});
        }
        if (user.balance < transferAmount) {
            return message.reply({ embeds: [
                new EmbedBuilder().setColor(C.ERROR).setDescription('❌  Không đủ số dư để chuyển!')
            ]});
        }

        user.balance -= transferAmount;
        usersData[targetUser.id].balance += transferAmount;
        saveData();

        const embed = new EmbedBuilder()
            .setColor(C.SUCCESS)
            .setTitle('💸  Chuyển Tiền Thành Công!')
            .addFields(
                { name: '👤  Người Nhận', value: `**${targetUser.username}**`,                  inline: true },
                { name: '💵  Số Tiền',   value: `\`${transferAmount.toLocaleString()} vnđ\``,  inline: true },
                { name: '💰  Số Dư Còn', value: `\`${user.balance.toLocaleString()} vnđ\``,   inline: true }
            );
        return message.reply({ embeds: [embed] });
    }

    // ── 13. MUA ───────────────────────────────────────────────────────────────
    if (command === 'mua') {
        ensureInventory(user);
        const itemId = args[0]?.toLowerCase();

        // Vật phẩm không tồn tại → auto-delete sau 10 giây
        if (!itemId || !shopItems[itemId]) {
            return replyAndDelete(message, { embeds: [
                new EmbedBuilder()
                    .setColor(C.ERROR)
                    .setDescription(
                        `❌  Vật phẩm **"${itemId || '?'}"** không tồn tại!\n` +
                        `Dùng \`!shop\` để xem danh sách.\n` +
                        `*✦ Tin nhắn này tự xóa sau 10 giây.*`
                    )
            ]});
        }

        const item = shopItems[itemId];

        // Kiểm tra trùng lặp (chỉ với vật phẩm không stackable)
        if (!item.stackable && user.inventory[itemId]) {
            return message.reply({ embeds: [
                new EmbedBuilder().setColor(C.WARN)
                    .setDescription(`⚠️  Bạn đã có **${item.emoji} ${item.name}** rồi!`)
            ]});
        }

        // Kiểm tra số dư
        if (user.balance < item.price) {
            return message.reply({ embeds: [
                new EmbedBuilder()
                    .setColor(C.ERROR)
                    .setDescription(
                        `❌  Không đủ tiền!\n` +
                        `Cần **${item.price.toLocaleString()} vnđ**, bạn có **${user.balance.toLocaleString()} vnđ**.`
                    )
            ]});
        }

        // Xử lý mua hàng
        user.balance -= item.price;
        if (item.stackable) {
            user.inventory[itemId] = (user.inventory[itemId] || 0) + 1;
        } else {
            user.inventory[itemId] = true;
        }
        saveData();

        const embed = new EmbedBuilder()
            .setColor(C.SUCCESS)
            .setTitle(`${item.emoji}  Mua Thành Công!`)
            .addFields(
                { name: '🛒  Vật Phẩm',  value: `**${item.name}**`,                          inline: true },
                { name: '💸  Đã Trả',    value: `\`${item.price.toLocaleString()} vnđ\``,    inline: true },
                { name: '💰  Số Dư Còn', value: `\`${user.balance.toLocaleString()} vnđ\``,  inline: true },
                { name: '📦  Công Dụng', value: item.desc,                                    inline: false }
            );
        if (itemId === 'lockpick') {
            embed.setFooter({ text: `🔓 Tổng số Bộ Phá Khóa đang có: ${user.inventory.lockpick} cái` });
        }
        return message.reply({ embeds: [embed] });
    }

    // ── 11. DILAM ─────────────────────────────────────────────────────────────
    if (command === 'dilam') {
        const job = args[0]?.toLowerCase() ?? '';

        if (!['anxin', 'ancuop', 'shipper'].includes(job)) {
            return message.reply({ embeds: [
                new EmbedBuilder()
                    .setColor(C.ERROR)
                    .setDescription(
                        '❌  Chọn nghề:\n' +
                        '`!dilam anxin` — 🥣 Ăn xin\n' +
                        '`!dilam ancuop` — 🦹‍♂️ Ăn cướp\n' +
                        '`!dilam shipper` — 🛵 Giao hàng *(cần xe máy)*'
                    )
            ]});
        }

        ensureInventory(user);

        // Kiểm tra đang bị thương (block tất cả dilam)
        if (user.injuredTime && Date.now() < user.injuredTime) {
            const mins = Math.ceil((user.injuredTime - Date.now()) / 60000);
            return message.reply({ embeds: [
                new EmbedBuilder()
                    .setColor(C.WARN)
                    .setTitle('🤕  Đang Bị Thương!')
                    .setDescription(`Bạn đang hồi phục sau tai nạn. Còn **${mins} phút** nữa mới có thể làm việc.`)
            ]});
        }

        const bonus = (user.university && uniBonus[user.university])
            ? uniBonus[user.university]
            : DEFAULT_BONUS;

        // ── Ăn xin ────────────────────────────────────────────────────────────
        if (job === 'anxin') {
            const earned = Math.floor((Math.floor(Math.random() * 21) + 10) * bonus.mult);
            user.balance += earned;
            saveData();

            const embed = new EmbedBuilder()
                .setColor(C.WARN)
                .setTitle('🥣  Đi Ăn Xin')
                .addFields(
                    { name: '💵  Kiếm Được', value: `\`+${earned} vnđ\``,                         inline: true },
                    { name: '💰  Số Dư',     value: `\`${user.balance.toLocaleString()} vnđ\``,  inline: true }
                );
            if (bonus.label) embed.setFooter({ text: `🎓 Bonus lương: ${bonus.label}` });
            return message.reply({ embeds: [embed] });
        }

        // ── Ăn cướp ───────────────────────────────────────────────────────────
        if (job === 'ancuop') {
            // Tính tỷ lệ bị bắt — mặt nạ giảm 15%
            let effectiveCatchRate = bonus.catchRate;
            if (user.inventory.mask) effectiveCatchRate = Math.max(0, effectiveCatchRate - 0.15);

            if (Math.random() < effectiveCatchRate) {
                // Bị bắt
                const oneHour = 60 * 60 * 1000;
                user.jailTime = Date.now() + oneHour;
                saveData();
                try {
                    const member = await message.guild.members.fetch(userId);
                    await member.timeout(oneHour, 'Đi ăn cướp bị bắt');
                } catch {}

                return message.reply({ embeds: [
                    new EmbedBuilder()
                        .setColor(C.ERROR)
                        .setTitle('🚨  CÔNG AN TÓM ĐƯỢC!')
                        .setDescription('Bạn bị bắt tại hiện trường!')
                        .addFields({ name: '⏳  Thời Gian Ngồi Tù', value: '**1 giờ** (bị mute server)', inline: false })
                        .setFooter({ text: 'Dùng !phakhoa nếu có Bộ Phá Khóa 🔓' })
                ]});
            }

            // Thoát — găng tay tăng 15% tiền
            let looted = Math.floor((Math.floor(Math.random() * 201) + 100) * bonus.mult);
            if (user.inventory.gloves) looted = Math.floor(looted * 1.15);
            user.balance += looted;
            saveData();

            // Hiển thị buff đang hoạt động
            const buffs = [];
            if (user.inventory.mask)   buffs.push('🎭 Mặt Nạ (-15% bị bắt)');
            if (user.inventory.gloves) buffs.push('🧤 Găng Tay (+15% tiền)');
            if (bonus.label)           buffs.push(`🎓 ${bonus.label}`);

            const embed = new EmbedBuilder()
                .setColor(C.SUCCESS)
                .setTitle('🦹‍♂️  Ăn Cướp Thành Công!')
                .addFields(
                    { name: '💵  Cướp Được', value: `\`+${looted.toLocaleString()} vnđ\``,        inline: true },
                    { name: '💰  Số Dư',     value: `\`${user.balance.toLocaleString()} vnđ\``,  inline: true }
                );
            if (buffs.length) embed.setFooter({ text: buffs.join('  •  ') });
            return message.reply({ embeds: [embed] });
        }

        // ── Shipper ───────────────────────────────────────────────────────────
        if (job === 'shipper') {
            // Kiểm tra có xe máy không
            if (!user.inventory.motorbike) {
                return message.reply({ embeds: [
                    new EmbedBuilder()
                        .setColor(C.ERROR)
                        .setTitle('🛵  Thiếu Xe Máy!')
                        .setDescription('Bạn cần có **Xe Máy** để làm Shipper!')
                        .addFields({ name: '🛒  Mua Ngay', value: '`!mua motorbike` — **10,000 vnđ**', inline: false })
                ]});
            }

            // 20% tai nạn giao thông
            if (Math.random() < 0.20) {
                const thirtyMins = 30 * 60 * 1000;
                user.injuredTime = Date.now() + thirtyMins;
                user.balance = Math.max(0, user.balance - 200);
                saveData();

                return message.reply({ embeds: [
                    new EmbedBuilder()
                        .setColor(C.ERROR)
                        .setTitle('🚑  TAI NẠN GIAO THÔNG!')
                        .setDescription('Bạn bị tai nạn khi đang chạy hàng!')
                        .addFields(
                            { name: '🏥  Thiệt Hại',          value: '`-200 vnđ` *(sửa xe + cứu thương)*',       inline: false },
                            { name: '⏳  Thời Gian Hồi Phục', value: '**30 phút**',                               inline: true  },
                            { name: '💰  Số Dư Còn',          value: `\`${user.balance.toLocaleString()} vnđ\``, inline: true  }
                        )
                        .setFooter({ text: 'Dùng !dilam shipper sau khi hồi phục' })
                ]});
            }

            // Giao hàng thành công (50–100 vnđ, lương ổn định)
            const earned = Math.floor(Math.random() * 51) + 50;
            user.balance += earned;
            saveData();

            return message.reply({ embeds: [
                new EmbedBuilder()
                    .setColor(C.SUCCESS)
                    .setTitle('🛵  Giao Hàng Thành Công!')
                    .addFields(
                        { name: '💵  Tiền Công', value: `\`+${earned} vnđ\``,                         inline: true },
                        { name: '💰  Số Dư',     value: `\`${user.balance.toLocaleString()} vnđ\``,  inline: true }
                    )
                    .setFooter({ text: 'Lương ổn định 50–100 vnđ  •  Rủi ro tai nạn 20% 🏍️' })
            ]});
        }
    }
});

client.login('TOKEN_CUA_BAN_O_DAY');
