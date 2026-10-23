// ============================================================
//  BOT TÀI XỈU / BÀI 3 CÂY / BẦU CUA CHO DISCORD
//  Yêu cầu: Node.js >= 18, discord.js v14
//  Biến môi trường: DISCORD_TOKEN
//  Nhớ bật "Message Content Intent" trong Developer Portal
//
//  Emoji tùy chỉnh: bot tự tìm emoji theo TÊN trong các server nó đang ở:
//  ga, tom, ca, cua, cho, nai, vnd  (không thấy thì dùng emoji mặc định)
// ============================================================
try { require('dotenv').config(); } catch {}
const fs = require('fs');
const path = require('path');
const {
  Client, GatewayIntentBits, EmbedBuilder, ActionRowBuilder, ButtonBuilder,
  ButtonStyle, PermissionsBitField, MessageFlags, AttachmentBuilder,
} = require('discord.js');

const TOKEN = process.env.DISCORD_TOKEN;
if (!TOKEN) {
  console.error('Thiếu biến môi trường DISCORD_TOKEN');
  process.exit(1);
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

// ===================== CẤU HÌNH =====================
const ADMIN_ID = '1264910216839958648';
const DATA_FILE = path.join(__dirname, 'data.json');

const TIEN_KHOI_NGHIEP = 100;     // tiền tặng khi !dangky (và khi reset)
const TIEN_DIEM_DANH = 50;        // tiền điểm danh mỗi ngày
const MIN_CUOC_3CAY = 100;        // cược tối thiểu bàn 3 cây
const MAX_NGUOI_BAN = 4;
const TG_CUOC_3CAY = 60 * 1000;   // thời gian chờ cược
const TG_CHO_BAN = 5 * 60 * 1000; // bàn chờ quá lâu sẽ tự đóng
const TG_CHON_BAUCUA = 30 * 1000; // thời gian chọn con bầu cua

// Tham số cân bằng kinh tế (chống lạm phát)
const CB = {
  luotThangDau: 3,        // số lượt tài/xỉu đầu tiên luôn thắng
  nguongSoDu: 5000,       // vượt ngưỡng này thì tỉ lệ thua tăng
  tiLeThuaGiauSo: 0.8,    // tỉ lệ thua tài/xỉu khi số dư > ngưỡng
  tiLeThua3Cay: 0.7,      // tỉ lệ thua của người giàu nhất trong bàn 3 cây
  thuaBauCuaMoi100: 0.02, // mỗi 100 vnđ cược cộng thêm 2% tỉ lệ thua
  thuaBauCuaToiDa: 0.95,
};

// Bảng màu dùng chung cho embed
const MAU = {
  chinh: 0x5865f2, thang: 0x57f287, thua: 0xed4245,
  vang: 0xfee75c, xam: 0x99aab5, tim: 0x9b59b6, xanh: 0x3498db,
};

// ===================== DỮ LIỆU =====================
let db = { users: {} };
try {
  db = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  if (!db.users) db.users = {};
} catch { /* chưa có file thì dùng db rỗng */ }

let saveTimer = null;
function flush() {
  try {
    const tmp = DATA_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(db));
    fs.renameSync(tmp, DATA_FILE);
  } catch (e) { console.error('Lỗi lưu dữ liệu:', e); }
}
function save() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => { saveTimer = null; flush(); }, 300);
}
process.on('SIGINT', () => { flush(); process.exit(0); });
process.on('SIGTERM', () => { flush(); process.exit(0); });

// Bổ sung các trường còn thiếu (tương thích dữ liệu cũ)
function chuanHoa(u) {
  if (!u.stats) u.stats = { thang: 0, thua: 0, lonNhat: 0 };
  if (u.txPlays === undefined) u.txPlays = 0;
  if (u.lastDaily === undefined) u.lastDaily = '';
  if (u.streak === undefined) u.streak = 0;
  return u;
}
const getUser = (id) => (db.users[id] ? chuanHoa(db.users[id]) : null);
function createUser(id) {
  db.users[id] = chuanHoa({ balance: TIEN_KHOI_NGHIEP, createdAt: Date.now() });
  save();
  return db.users[id];
}
// Ghi thống kê hồ sơ: lai > 0 là thắng, lai <= 0 là thua
function ghiKetQua(u, lai) {
  if (lai > 0) {
    u.stats.thang++;
    if (lai > u.stats.lonNhat) u.stats.lonNhat = lai;
  } else {
    u.stats.thua++;
  }
}
// Ngày theo giờ Việt Nam (UTC+7); lui = số ngày lùi lại
const ngayVN = (lui = 0) =>
  new Date(Date.now() + 7 * 3600 * 1000 - lui * 86400000).toISOString().slice(0, 10);

// ===================== EMOJI TÙY CHỈNH =====================
// Tìm emoji theo tên trong mọi server bot đang ở
function timEmoji(ten) {
  return client.emojis.cache.find((e) => e.name === ten && e.available !== false) || null;
}
const emoji = (ten, duPhong) => {
  const e = timEmoji(ten);
  return e ? e.toString() : duPhong;
};
// Emoji dùng cho nút bấm (cần dạng object)
const emojiNut = (ten, duPhong) => {
  const e = timEmoji(ten);
  return e ? { id: e.id, name: e.name, animated: e.animated } : duPhong;
};

// Định dạng tiền: dùng emoji :vnd: nếu có, không thì ghi "vnđ"
function fmt(n) {
  const s = Math.round(n).toLocaleString('vi-VN');
  const e = timEmoji('vnd');
  return e ? `${s} ${e}` : `${s} vnđ`;
}

// ===================== TIỆN ÍCH UI =====================
const rnd = (n) => Math.floor(Math.random() * n);
const reply = (m, c) =>
  m.reply({
    ...(typeof c === 'string' ? { content: c } : c),
    allowedMentions: { repliedUser: false },
  });

// Embed chuẩn: có avatar người dùng, footer, thời gian
function khung(user, mau, tieuDe) {
  const e = new EmbedBuilder()
    .setColor(mau)
    .setTitle(tieuDe)
    .setTimestamp()
    .setFooter({ text: 'Bot Tài Xỉu • !helptx để xem lệnh' });
  if (user) e.setAuthor({ name: user.displayName || user.username, iconURL: user.displayAvatarURL() });
  return e;
}
const loi = (m, t) =>
  reply(m, { embeds: [new EmbedBuilder().setColor(MAU.thua).setDescription(`❌ ${t}`)] });
const ok = (m, t) =>
  reply(m, { embeds: [new EmbedBuilder().setColor(MAU.thang).setDescription(`✅ ${t}`)] });
const thanhTien = (lai) => `${lai >= 0 ? '+' : '-'}${fmt(Math.abs(lai))}`;

// Phân tích số tiền cược: số, 1k, 2m, hoặc "all"
function parseBet(str, balance) {
  if (!str) return { error: 'Bạn chưa nhập số tiền (hoặc `all`).' };
  str = str.toLowerCase().replace(/[.,_]/g, '');
  let amount;
  if (str === 'all') {
    amount = balance;
  } else {
    const m = str.match(/^(\d+)(k|m)?$/);
    if (!m) return { error: 'Số tiền không hợp lệ.' };
    amount = parseInt(m[1], 10);
    if (m[2] === 'k') amount *= 1000;
    if (m[2] === 'm') amount *= 1000000;
  }
  if (amount <= 0) return { error: 'Bạn không còn tiền để cược.' };
  if (amount > balance) return { error: `Bạn không đủ tiền (số dư: ${fmt(balance)}).` };
  return { amount };
}

// ===================== TÀI XỈU =====================
const so = (d) => `${d}\uFE0F\u20E3`; // số dạng emoji 1️⃣ 2️⃣ ...

// Tung 3 xúc xắc sao cho ra đúng kết quả mong muốn (bỏ qua bộ ba)
function rollDice(wantTai) {
  while (true) {
    const d = [1 + rnd(6), 1 + rnd(6), 1 + rnd(6)];
    if (d[0] === d[1] && d[1] === d[2]) continue;
    const sum = d[0] + d[1] + d[2];
    if ((sum >= 11) === wantTai) return d;
  }
}

async function chayTaiXiu(m, args, chon) {
  const u = getUser(m.author.id);
  const bet = parseBet(args[0], u.balance);
  if (bet.error) return loi(m, bet.error);

  const soDuTruoc = u.balance;
  let tiLeThang = 0.5;
  if (u.txPlays < CB.luotThangDau) tiLeThang = 1;
  else if (soDuTruoc > CB.nguongSoDu) tiLeThang = 1 - CB.tiLeThuaGiauSo;

  u.txPlays++;
  const thang = Math.random() < tiLeThang;
  const ketQuaLaTai = chon === 'tai' ? thang : !thang;
  const dice = rollDice(ketQuaLaTai);
  const tong = dice[0] + dice[1] + dice[2];
  const lai = thang ? bet.amount : -bet.amount;
  u.balance += lai;
  ghiKetQua(u, lai);
  save();

  const embed = khung(m.author, thang ? MAU.thang : MAU.thua, '🎲 TÀI XỈU')
    .setDescription(`## ${dice.map(so).join('  ')}\n**Tổng ${tong}** → **${tong >= 11 ? 'TÀI' : 'XỈU'}**`)
    .addFields(
      { name: 'Bạn chọn', value: chon === 'tai' ? '**TÀI**' : '**XỈU**', inline: true },
      { name: 'Tiền cược', value: fmt(bet.amount), inline: true },
      { name: thang ? '🎉 Thắng' : '💸 Thua', value: `**${thanhTien(lai)}**`, inline: true },
      { name: 'Số dư', value: `**${fmt(u.balance)}**` }
    );
  return reply(m, { embeds: [embed] });
}

// ===================== BẦU CUA =====================
// key = tên emoji tùy chỉnh trong server, du = emoji mặc định dự phòng
const CON_VAT = [
  { ten: 'Nai', key: 'nai', du: '🦌' },
  { ten: 'Chó', key: 'cho', du: '🐕' },
  { ten: 'Gà', key: 'ga', du: '🐓' },
  { ten: 'Cá', key: 'ca', du: '🐟' },
  { ten: 'Cua', key: 'cua', du: '🦀' },
  { ten: 'Tôm', key: 'tom', du: '🦐' },
];
const conE = (k) => emoji(CON_VAT[k].key, CON_VAT[k].du);
const baucuaDangCho = new Set(); // user đang có ván chưa chọn con

async function chayBauCua(m, args) {
  const id = m.author.id;
  const u = getUser(id);
  if (baucuaDangCho.has(id)) return loi(m, 'Bạn đang có một ván bầu cua chưa chọn con.');
  const bet = parseBet(args[0], u.balance);
  if (bet.error) return loi(m, bet.error);

  const amount = bet.amount;
  u.balance -= amount; // trừ tiền cược trước, thắng thì trả lại + thưởng
  baucuaDangCho.add(id);
  save();

  const hang = [0, 1].map((i) =>
    new ActionRowBuilder().addComponents(
      [0, 1, 2].map((j) => {
        const k = i * 3 + j;
        return new ButtonBuilder()
          .setCustomId(`bc_${k}`)
          .setLabel(CON_VAT[k].ten)
          .setEmoji(emojiNut(CON_VAT[k].key, CON_VAT[k].du))
          .setStyle(ButtonStyle.Secondary);
      })
    )
  );

  const bang =
    [0, 1, 2].map((k) => `${conE(k)} **${CON_VAT[k].ten}**`).join('      ') + '\n' +
    [3, 4, 5].map((k) => `${conE(k)} **${CON_VAT[k].ten}**`).join('      ');
  const hetHan = Math.floor((Date.now() + TG_CHON_BAUCUA) / 1000);
  const embed = khung(m.author, MAU.vang, '🎰 BẦU CUA')
    .setDescription(`${bang}\n\n👇 Bấm nút để chọn con bạn muốn đặt!`)
    .addFields(
      { name: 'Tiền cược', value: fmt(amount), inline: true },
      { name: 'Hết giờ chọn', value: `<t:${hetHan}:R>`, inline: true }
    );
  const msg = await reply(m, { embeds: [embed], components: hang });

  const collector = msg.createMessageComponentCollector({ time: TG_CHON_BAUCUA });
  collector.on('collect', async (i) => {
    if (i.user.id !== id) {
      return i.reply({ content: 'Đây không phải ván của bạn!', flags: MessageFlags.Ephemeral }).catch(() => {});
    }
    collector.stop('done');
    const chon = parseInt(i.customId.split('_')[1], 10);

    // Xác suất thua: mặc định (5/6)^3, mỗi 100 vnđ cược cộng thêm 2%
    const tiLeThua = Math.min(
      CB.thuaBauCuaToiDa,
      Math.pow(5 / 6, 3) + Math.floor(amount / 100) * CB.thuaBauCuaMoi100
    );
    const thua = Math.random() < tiLeThua;

    let ketQua;
    if (thua) {
      // thua: 3 con ra đều KHÔNG phải con đã chọn
      ketQua = [0, 1, 2].map(() => {
        let k;
        do { k = rnd(6); } while (k === chon);
        return k;
      });
    } else {
      // thắng: ít nhất 1 con trùng
      do { ketQua = [rnd(6), rnd(6), rnd(6)]; } while (!ketQua.includes(chon));
    }
    const trung = ketQua.filter((k) => k === chon).length;
    const lai = thua ? -amount : amount * trung;
    if (!thua) u.balance += amount * (1 + trung); // trả lại tiền cược + thưởng x số con trùng
    ghiKetQua(u, lai);
    save();

    const out = khung(i.user, thua ? MAU.thua : MAU.thang, '🎰 KẾT QUẢ BẦU CUA')
      .setDescription(
        `## ${ketQua.map(conE).join('   ')}\n` +
        `${ketQua.map((k) => `**${CON_VAT[k].ten}**`).join(' • ')}`
      )
      .addFields(
        { name: 'Bạn chọn', value: `${conE(chon)} **${CON_VAT[chon].ten}**`, inline: true },
        { name: 'Trúng', value: `**${trung}/3** con`, inline: true },
        { name: thua ? '💸 Thua' : '🎉 Thắng', value: `**${thanhTien(lai)}**`, inline: true },
        { name: 'Số dư', value: `**${fmt(u.balance)}**` }
      );
    await i.update({ embeds: [out], components: [] }).catch(() => {});
  });
  collector.on('end', (_, reason) => {
    baucuaDangCho.delete(id);
    if (reason !== 'done') {
      // hết giờ không chọn: hoàn tiền cược
      u.balance += amount;
      save();
      msg.edit({
        embeds: [khung(m.author, MAU.xam, '🎰 BẦU CUA')
          .setDescription(`⌛ Hết giờ chọn con, đã hoàn lại **${fmt(amount)}**.`)],
        components: [],
      }).catch(() => {});
    }
  });
}

// ===================== BÀI 3 CÂY =====================
const tables = new Map(); // channelId -> bàn
const SUITS = ['♠', '♣', '♦', '♥']; // bích < chuồn < rô < cơ
const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];

function taoBo() {
  const deck = [];
  for (let s = 0; s < 4; s++) for (let r = 1; r <= 13; r++) deck.push({ rank: r, suit: s });
  for (let i = deck.length - 1; i > 0; i--) {
    const j = rnd(i + 1);
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}
const cardStr = (c) => `\`${RANKS[c.rank - 1]}${SUITS[c.suit]}\``;

// Điểm = tổng % 10 (J, Q, K = 10). Ba tây (3 con J/Q/K) lớn nhất.
// Hòa điểm thì so lá lớn nhất (số rồi đến chất)
function danhGia(hand) {
  const diem = hand.reduce((s, c) => s + Math.min(c.rank, 10), 0) % 10;
  const baTay = hand.every((c) => c.rank >= 11);
  const max = hand.reduce((m, c) =>
    (c.rank > m.rank || (c.rank === m.rank && c.suit > m.suit)) ? c : m);
  return { diem, baTay, max };
}
function soSanh(a, b) {
  if (a.baTay !== b.baTay) return a.baTay ? 1 : -1;
  if (a.diem !== b.diem) return a.diem - b.diem;
  if (a.max.rank !== b.max.rank) return a.max.rank - b.max.rank;
  return a.max.suit - b.max.suit;
}
const tenBai = (e) => (e.baTay ? 'Ba tây' : `${e.diem} điểm`);

const banCuaUser = (uid) => {
  for (const t of tables.values()) if (t.players.includes(uid)) return t;
  return null;
};

// Embed hiển thị trạng thái bàn (cập nhật trực tiếp trên 1 tin nhắn)
function embedBan(t) {
  const dong = [];
  for (let i = 0; i < MAX_NGUOI_BAN; i++) {
    const p = t.players[i];
    if (!p) { dong.push('⬜ *Chỗ trống*'); continue; }
    let s = `${p === t.hostId ? '👑' : '👤'} <@${p}>`;
    if (t.phase === 'cuoc') s += t.bets.has(p) ? `  —  ✅ ${fmt(t.bets.get(p))}` : '  —  ⏳ chờ cược';
    dong.push(s);
  }
  const e = new EmbedBuilder()
    .setColor(t.phase === 'cuoc' ? MAU.vang : MAU.xanh)
    .setTitle('🃏 BÀN BÀI 3 CÂY')
    .setDescription(dong.join('\n'))
    .setFooter({ text: 'Bot Tài Xỉu • !helptx để xem lệnh' });
  if (t.phase === 'cuoc') {
    e.addFields({
      name: '💵 Đang đặt cược',
      value: `\`!cuoc <số tiền|all>\` (tối thiểu ${fmt(MIN_CUOC_3CAY)})\nKết thúc <t:${Math.floor(t.hetCuoc / 1000)}:R> — ai không cược sẽ bị loại.`,
    });
  } else {
    e.addFields({
      name: `⏳ Đang chờ người chơi (${t.players.length}/${MAX_NGUOI_BAN})`,
      value: '`!vaoban` để vào • `!roiban` để rời\nChủ bàn dùng `!start` khi có từ 2 người (đủ 4 người sẽ tự bắt đầu).',
    });
  }
  return e;
}
async function capNhatBan(t) {
  const payload = { embeds: [embedBan(t)] };
  try {
    if (t.msg) await t.msg.edit(payload);
    else t.msg = await t.channel.send(payload);
  } catch { /* bỏ qua lỗi gửi/sửa tin */ }
}
// Chuyển tin nhắn bàn sang trạng thái đã đóng
function dongMsgBan(t, text) {
  if (!t.msg) return;
  t.msg.edit({
    embeds: [new EmbedBuilder().setColor(MAU.xam).setTitle('🃏 BÀN BÀI 3 CÂY').setDescription(text)],
  }).catch(() => {});
}

// Đóng bàn; nếu đang ở giai đoạn cược thì hoàn tiền cho mọi người
function dongBan(t, text) {
  clearTimeout(t.timer);
  if (t.phase === 'cuoc') {
    for (const [uid, tien] of t.bets) {
      const u = getUser(uid);
      if (u) u.balance += tien;
    }
    save();
  }
  t.phase = 'dong';
  tables.delete(t.channel.id);
  dongMsgBan(t, text || 'Bàn đã đóng.');
}

function batDauCuoc(t) {
  clearTimeout(t.timer);
  t.phase = 'cuoc';
  t.bets = new Map();
  t.hetCuoc = Date.now() + TG_CUOC_3CAY;
  t.timer = setTimeout(() => ketThucCuoc(t), TG_CUOC_3CAY);
  dongMsgBan(t, '🃏 Ván bài đã bắt đầu, xem tin nhắn bên dưới.');
  t.msg = null; // gửi tin mới để người chơi thấy ngay
  capNhatBan(t);
}

function ketThucCuoc(t) {
  if (t.phase !== 'cuoc') return;
  clearTimeout(t.timer);
  const bo = t.players.filter((p) => !t.bets.has(p));
  t.players = t.players.filter((p) => t.bets.has(p));
  if (bo.length) {
    t.channel.send({
      embeds: [new EmbedBuilder().setColor(MAU.xam)
        .setDescription(`⌛ Hết giờ cược, loại khỏi bàn: ${bo.map((p) => `<@${p}>`).join(', ')}`)],
    }).catch(() => {});
  }
  if (t.players.length < 2) {
    dongBan(t, '❌ Không đủ 2 người đã cược, bàn bị hủy và hoàn tiền.');
    return;
  }
  if (!t.players.includes(t.hostId)) t.hostId = t.players[0];
  chiaBai(t);
}

function chiaBai(t) {
  t.phase = 'chia';
  clearTimeout(t.timer);
  const ps = t.players;
  const deck = taoBo();
  const hands = {};
  for (const p of ps) hands[p] = [deck.pop(), deck.pop(), deck.pop()];

  // Cân bằng kinh tế: người có số dư (trước khi cược) cao nhất dễ thua hơn
  const truocCuoc = (p) => getUser(p).balance + t.bets.get(p);
  let giau = ps[0];
  for (const p of ps) if (truocCuoc(p) > truocCuoc(giau)) giau = p;

  const xepHang = () => [...ps].sort((a, b) => soSanh(danhGia(hands[b]), danhGia(hands[a])));
  let thang = xepHang()[0];
  if (thang === giau) {
    const n = ps.length;
    const xs = Math.max(0, (CB.tiLeThua3Cay - (1 - 1 / n)) * n); // đưa tỉ lệ thua lên ~70%
    if (Math.random() < xs) {
      const khac = ps.filter((p) => p !== giau);
      const doi = khac[rnd(khac.length)];
      [hands[giau], hands[doi]] = [hands[doi], hands[giau]];
      thang = xepHang()[0];
    }
  }

  // Thanh toán: mỗi người thua trả min(cược của họ, cược của người thắng)
  const cuocThang = t.bets.get(thang);
  let loi_ = 0;
  const dongThua = [];
  for (const p of xepHang()) {
    if (p === thang) continue;
    const cuoc = t.bets.get(p);
    const mat = Math.min(cuoc, cuocThang);
    loi_ += mat;
    const u = getUser(p);
    u.balance += cuoc - mat; // hoàn phần cược dư
    ghiKetQua(u, -mat);
    dongThua.push(
      `👤 <@${p}>\n${hands[p].map(cardStr).join(' ')} — **${tenBai(danhGia(hands[p]))}**\n` +
      `💸 **-${fmt(mat)}** • số dư ${fmt(u.balance)}`
    );
  }
  const uw = getUser(thang);
  uw.balance += cuocThang + loi_;
  ghiKetQua(uw, loi_);
  save();

  const embed = new EmbedBuilder()
    .setColor(MAU.tim)
    .setTitle('🃏 KẾT QUẢ BÀI 3 CÂY')
    .setDescription(
      `🏆 <@${thang}>\n${hands[thang].map(cardStr).join(' ')} — **${tenBai(danhGia(hands[thang]))}**\n` +
      `🎉 **+${fmt(loi_)}** • số dư ${fmt(uw.balance)}\n\n` +
      dongThua.join('\n\n')
    )
    .setTimestamp()
    .setFooter({ text: 'Dùng !taoban để mở ván mới' });
  t.channel.send({ embeds: [embed] }).catch(() => {});
  t.phase = 'dong';
  tables.delete(t.channel.id);
  dongMsgBan(t, '🃏 Ván bài đã kết thúc.');
}

// ===================== LỆNH NGƯỜI DÙNG =====================
const lenh = new Map();

lenh.set('helptx', (m) => {
  const embed = khung(m.author, MAU.chinh, '📖 DANH SÁCH LỆNH')
    .setDescription('Dùng `!dangky` trước để bắt đầu chơi. Số tiền có thể viết: `500`, `1k`, `2m`, `all`.')
    .addFields(
      {
        name: '👤 Tài khoản',
        value:
          '`!dangky` — đăng ký, nhận tiền khởi nghiệp\n' +
          '`!hoso [@user]` — xem hồ sơ & số dư\n' +
          '`!sodu` — xem nhanh số dư\n' +
          `\`!diemdanh\` — điểm danh mỗi ngày +${fmt(TIEN_DIEM_DANH)}`,
      },
      {
        name: '🎲 Tài xỉu',
        value: '`!tai <số tiền|all>` — cược TÀI (11–17)\n`!xiu <số tiền|all>` — cược XỈU (4–10)',
      },
      {
        name: `${conE(2)} Bầu cua`,
        value: '`!baucua <số tiền|all>` — cược rồi bấm nút chọn con',
      },
      {
        name: '🌱 Game trồng cây',
        value: '`/game2d` — game trồng cây 2D multiplayer: mỗi người 1 vườn 8 ô, trồng – tưới – thu hoạch – bán (dùng chung tiền với bot). Khung chơi chỉ mình bạn thấy.',
      },
      {
        name: '🃏 Bài 3 cây (2–4 người)',
        value:
          '`!taoban` — tạo bàn • `!vaoban` — vào bàn • `!roiban` — rời bàn\n' +
          '`!start` — chủ bàn bắt đầu (≥ 2 người)\n' +
          `\`!cuoc <số tiền|all>\` — đặt cược (tối thiểu ${fmt(MIN_CUOC_3CAY)})\n` +
          '`!huyban` — chủ bàn hủy bàn',
      }
    );
  return reply(m, { embeds: [embed] });
});

lenh.set('dangky', (m) => {
  if (getUser(m.author.id)) return loi(m, 'Bạn đã đăng ký rồi. Dùng `!hoso` để xem hồ sơ.');
  createUser(m.author.id);
  const embed = khung(m.author, MAU.thang, '🎉 ĐĂNG KÝ THÀNH CÔNG')
    .setDescription(`Chào mừng bạn! Bạn được tặng **${fmt(TIEN_KHOI_NGHIEP)}** để khởi nghiệp.`)
    .addFields({ name: 'Bắt đầu thôi', value: '`!tai` • `!xiu` • `!baucua` • `!taoban`\nDùng `!helptx` để xem tất cả lệnh.' });
  return reply(m, { embeds: [embed] });
});

lenh.set('sodu', (m) => {
  const u = getUser(m.author.id);
  const embed = khung(m.author, MAU.vang, '💰 SỐ DƯ').setDescription(`# ${fmt(u.balance)}`);
  return reply(m, { embeds: [embed] });
});

lenh.set('hoso', (m) => {
  const target = m.mentions.users.first() || m.author;
  if (target.bot) return loi(m, 'Bot không có hồ sơ.');
  const u = getUser(target.id);
  if (!u) return loi(m, `<@${target.id}> chưa đăng ký tài khoản.`);

  const tong = u.stats.thang + u.stats.thua;
  const tiLe = tong ? Math.round((u.stats.thang / tong) * 100) : 0;
  const xepHang = Object.entries(db.users).sort((a, b) => b[1].balance - a[1].balance);
  const hang = xepHang.findIndex((x) => x[0] === target.id) + 1;
  const daDiemDanh = u.lastDaily === ngayVN();

  const embed = khung(target, MAU.chinh, '📋 HỒ SƠ NGƯỜI CHƠI')
    .setThumbnail(target.displayAvatarURL({ size: 256 }))
    .setDescription(`💰 Số dư\n# ${fmt(u.balance)}`)
    .addFields(
      { name: '🏅 Xếp hạng', value: `**#${hang}** / ${xepHang.length}`, inline: true },
      { name: '🎮 Tổng số ván', value: `**${tong}**`, inline: true },
      { name: '📈 Tỉ lệ thắng', value: `**${tiLe}%**`, inline: true },
      { name: '🏆 Thắng', value: `**${u.stats.thang}**`, inline: true },
      { name: '💔 Thua', value: `**${u.stats.thua}**`, inline: true },
      { name: '💎 Thắng lớn nhất', value: fmt(u.stats.lonNhat), inline: true },
      {
        name: '📅 Điểm danh',
        value: `${daDiemDanh ? '✅ Hôm nay đã điểm danh' : '⏳ Hôm nay chưa điểm danh'}\n🔥 Chuỗi: **${u.streak}** ngày`,
        inline: true,
      },
      ...(u.createdAt
        ? [{ name: '🗓️ Tham gia', value: `<t:${Math.floor(u.createdAt / 1000)}:D>`, inline: true }]
        : [])
    );
  return reply(m, { embeds: [embed] });
});

lenh.set('diemdanh', (m) => {
  const u = getUser(m.author.id);
  const homNay = ngayVN();
  if (u.lastDaily === homNay) return loi(m, 'Hôm nay bạn đã điểm danh rồi, mai quay lại nhé!');
  u.streak = u.lastDaily === ngayVN(1) ? u.streak + 1 : 1; // liên tiếp thì cộng chuỗi
  u.lastDaily = homNay;
  u.balance += TIEN_DIEM_DANH;
  save();
  const embed = khung(m.author, MAU.thang, '📅 ĐIỂM DANH')
    .setDescription(`Bạn nhận được **+${fmt(TIEN_DIEM_DANH)}**`)
    .addFields(
      { name: '🔥 Chuỗi điểm danh', value: `**${u.streak}** ngày`, inline: true },
      { name: '💰 Số dư', value: `**${fmt(u.balance)}**`, inline: true }
    );
  return reply(m, { embeds: [embed] });
});

lenh.set('tai', (m, args) => chayTaiXiu(m, args, 'tai'));
lenh.set('xiu', (m, args) => chayTaiXiu(m, args, 'xiu'));
lenh.set('baucua', (m, args) => chayBauCua(m, args));

// ---- 3 cây ----
lenh.set('taoban', async (m) => {
  const id = m.author.id;
  if (tables.has(m.channel.id)) return loi(m, 'Kênh này đã có bàn rồi, dùng `!vaoban` để tham gia.');
  if (banCuaUser(id)) return loi(m, 'Bạn đang ở một bàn khác.');
  const t = {
    channel: m.channel, hostId: id, players: [id], phase: 'cho',
    bets: new Map(), timer: null, msg: null, hetCuoc: 0,
  };
  t.timer = setTimeout(() => {
    if (t.phase === 'cho') dongBan(t, '⌛ Bàn đã bị đóng vì không bắt đầu sau 5 phút.');
  }, TG_CHO_BAN);
  tables.set(m.channel.id, t);
  await capNhatBan(t);
});

lenh.set('vaoban', (m) => {
  const t = tables.get(m.channel.id);
  const id = m.author.id;
  if (!t) return loi(m, 'Kênh này chưa có bàn. Dùng `!taoban` để tạo.');
  if (t.phase !== 'cho') return loi(m, 'Bàn đã bắt đầu rồi.');
  if (banCuaUser(id)) return loi(m, 'Bạn đang ở trong một bàn rồi.');
  if (t.players.length >= MAX_NGUOI_BAN) return loi(m, 'Bàn đã đủ người.');
  t.players.push(id);
  m.react('✅').catch(() => {});
  if (t.players.length === MAX_NGUOI_BAN) return batDauCuoc(t); // đủ 4 người thì tự bắt đầu
  return capNhatBan(t);
});

lenh.set('roiban', (m) => {
  const t = tables.get(m.channel.id);
  const id = m.author.id;
  if (!t || !t.players.includes(id)) return loi(m, 'Bạn không ở trong bàn nào ở kênh này.');
  if (t.phase !== 'cho') return loi(m, 'Bàn đã bắt đầu, không thể rời.');
  t.players = t.players.filter((p) => p !== id);
  m.react('👋').catch(() => {});
  if (t.players.length === 0) return dongBan(t, 'Bàn không còn ai nên đã đóng.');
  if (t.hostId === id) t.hostId = t.players[0];
  return capNhatBan(t);
});

lenh.set('start', (m) => {
  const t = tables.get(m.channel.id);
  if (!t) return loi(m, 'Kênh này chưa có bàn.');
  if (t.hostId !== m.author.id) return loi(m, 'Chỉ chủ bàn mới được bắt đầu.');
  if (t.phase !== 'cho') return loi(m, 'Bàn đã bắt đầu rồi.');
  if (t.players.length < 2) return loi(m, 'Cần ít nhất 2 người để bắt đầu.');
  m.react('🎴').catch(() => {});
  batDauCuoc(t);
});

lenh.set('cuoc', (m, args) => {
  const t = tables.get(m.channel.id);
  const id = m.author.id;
  if (!t || !t.players.includes(id)) return loi(m, 'Bạn không ở trong bàn nào ở kênh này.');
  if (t.phase !== 'cuoc') return loi(m, 'Chưa đến giai đoạn đặt cược.');
  if (t.bets.has(id)) return loi(m, 'Bạn đã cược rồi.');
  const u = getUser(id);
  const bet = parseBet(args[0], u.balance);
  if (bet.error) return loi(m, bet.error);
  if (bet.amount < MIN_CUOC_3CAY) return loi(m, `Cược tối thiểu là ${fmt(MIN_CUOC_3CAY)}.`);
  u.balance -= bet.amount; // giữ tiền cược trong bàn
  t.bets.set(id, bet.amount);
  save();
  m.react('💵').catch(() => {});
  if (t.bets.size === t.players.length) return chiaBai(t); // ai cũng cược xong thì chia bài luôn
  return capNhatBan(t);
});

lenh.set('huyban', (m) => {
  const t = tables.get(m.channel.id);
  if (!t) return loi(m, 'Kênh này chưa có bàn.');
  if (t.hostId !== m.author.id) return loi(m, 'Chỉ chủ bàn mới được hủy bàn.');
  if (t.phase === 'chia') return loi(m, 'Bàn đang chia bài.');
  const hoan = t.phase === 'cuoc';
  dongBan(t, '🃏 Bàn đã bị chủ bàn hủy' + (hoan ? ' và hoàn lại tiền cược.' : '.'));
  m.react('✅').catch(() => {});
});

// ===================== LỆNH ADMIN (?) =====================
function parseAmount(str) {
  if (!str) return null;
  const m = str.toLowerCase().replace(/[.,_]/g, '').match(/^(\d+)(k|m)?$/);
  if (!m) return null;
  let n = parseInt(m[1], 10);
  if (m[2] === 'k') n *= 1000;
  if (m[2] === 'm') n *= 1000000;
  return n;
}

async function xuLyAdmin(m, cmd, args) {
  if (m.author.id !== ADMIN_ID) return; // người khác dùng thì bỏ qua

  if (cmd === 'adgiv' || cmd === 'adset') {
    const soTien = parseAmount(args[0]);
    const target = m.mentions.users.first();
    if (soTien === null || !target) return loi(m, `Cú pháp: \`?${cmd} <số tiền> @user\``);
    const u = getUser(target.id) || chuanHoa(createUser(target.id));
    if (cmd === 'adgiv') u.balance += soTien;
    else u.balance = soTien;
    save();
    const embed = khung(m.author, MAU.thang, cmd === 'adgiv' ? '🎁 ADMIN — TẶNG TIỀN' : '🛠️ ADMIN — ĐẶT SỐ DƯ')
      .addFields(
        { name: 'Người nhận', value: `<@${target.id}>`, inline: true },
        { name: cmd === 'adgiv' ? 'Số tiền tặng' : 'Số dư mới', value: fmt(soTien), inline: true },
        { name: 'Số dư hiện tại', value: `**${fmt(u.balance)}**`, inline: true }
      );
    return reply(m, { embeds: [embed] });
  }

  if (cmd === 'adreset') {
    if ((args[0] || '').toLowerCase() === 'all') {
      for (const id of Object.keys(db.users)) db.users[id].balance = TIEN_KHOI_NGHIEP;
      save();
      return ok(m, `Đã reset số dư của **tất cả** người chơi về ${fmt(TIEN_KHOI_NGHIEP)}.`);
    }
    const target = m.mentions.users.first();
    if (!target) return loi(m, 'Cú pháp: `?adreset @user` hoặc `?adreset all`');
    const u = getUser(target.id);
    if (!u) return loi(m, 'Người này chưa đăng ký.');
    u.balance = TIEN_KHOI_NGHIEP;
    save();
    return ok(m, `Đã reset số dư của <@${target.id}> về ${fmt(TIEN_KHOI_NGHIEP)}.`);
  }

  if (cmd === 'adrole') {
    try {
      let role = m.guild.roles.cache.find((r) => r.name === 'Quản trị viên');
      if (!role) {
        role = await m.guild.roles.create({
          name: 'Quản trị viên',
          permissions: [PermissionsBitField.Flags.Administrator],
          reason: 'Tạo bởi ?adrole',
        });
      }
      await m.member.roles.add(role);
      return ok(m, `Đã tạo role **${role.name}** và gán cho bạn.`);
    } catch (e) {
      console.error(e);
      return loi(m, 'Không tạo/gán được role. Hãy cấp cho bot quyền **Manage Roles** (hoặc Administrator) và kéo role của bot lên cao hơn.');
    }
  }
}

// ===================== GAME 2D: TRỒNG CÂY MULTIPLAYER (/game2d) =====================
// Ý tưởng: Grow a Garden. Map pixel vẽ bằng code (không cần file ảnh) rồi gửi dạng PNG.
// - Thế giới chung cho cả server: mỗi người có 1 khu vườn 8 ô đất riêng, thấy nhau đi lại.
// - Map lớn, khung hình cố định, camera tự di chuyển theo nhân vật.
// - Dùng slash command nên khung chơi chỉ hiện riêng cho từng người (ephemeral).
// - Tiền trong game = tiền của user trong bot (u.balance).
const zlib = require('zlib');

// ---------- Cấu hình game ----------
// tgLon: giây để cây lớn lần đầu • tgLai: giây để mọc lại quả (cây hái nhiều lần)
// toiDa: số lần hái tối đa trước khi cây tàn (chống lạm phát) • banGia: giá bán 1 trái
const SEEDS = {
  carrot:     { ten: 'Cà rốt',  e: '🥕', gia: 10, banGia: 16, tgLon: 60,  tgLai: 0,   toiDa: 1, mota: 'hái 1 lần' },
  tomato:     { ten: 'Cà chua', e: '🍅', gia: 15, banGia: 8,  tgLon: 90,  tgLai: 60,  toiDa: 5, mota: 'hái nhiều lần' },
  watermelon: { ten: 'Dưa hấu', e: '🍉', gia: 40, banGia: 26, tgLon: 180, tgLai: 120, toiDa: 4, mota: 'hái nhiều lần' },
};
const TOOLS = {
  binh: { ten: 'Bình tưới nước', e: '💧', gia: 20, mota: 'dùng 1 lần, giảm 50% thời gian lớn còn lại' },
  xeng: { ten: 'Xẻng',           e: '⛏️', gia: 10, mota: 'dùng 1 lần, xúc cây để chuyển sang ô đất khác' },
};
// Hiệu ứng ngẫu nhiên khi quả mọc
const MUT = {
  vang: { ten: 'Vàng',     e: '✨', nhan: 1.5, tl: 0.30 },
  cv:   { ten: 'Cầu vồng', e: '🌈', nhan: 2.5, tl: 0.10 },
};
const GAME_IDLE = 5 * 60 * 1000;   // không bấm gì 5 phút thì đóng phiên
const GAME_TICK = 8 * 1000;        // chu kỳ tự làm mới khung hình khi có thay đổi

function rollMut() {
  const r = Math.random();
  if (r < MUT.cv.tl) return 'cv';
  if (r < MUT.cv.tl + MUT.vang.tl) return 'vang';
  return null;
}
const giaTri = (type, mut) => Math.round(SEEDS[type].banGia * (mut ? MUT[mut].nhan : 1));

// ---------- Thế giới ----------
// Mỗi "thế giới" (shard) của 1 server có 12 khu vườn (4 cột x 3 hàng). Người thứ 13 trở đi
// sẽ vào thế giới thứ 2, v.v. Mỗi khu vườn = hàng rào 8x6 chứa 8 ô đất.
const GV = { cols: 4, rows: 3, w: 8, h: 6, gap: 2, x0: 3, y0: 10 };
const GV_PER_SHARD = GV.cols * GV.rows;
const SO_O = 8;                                    // số ô đất mỗi vườn
const WW = GV.x0 + GV.cols * GV.w + (GV.cols - 1) * GV.gap + 3; // chiều rộng thế giới (ô)
const WH = GV.y0 + GV.rows * GV.h + (GV.rows - 1) * GV.gap + 3; // chiều cao thế giới (ô)
const VW = 14, VH = 10;                            // khung nhìn (ô)

// Ký hiệu: T cây • R mái • W tường • D cửa • p đường • . cỏ • ~ nước • B hàng rào • g cổng vườn
// F ô đất trồng • f/s/t = NPC cửa hàng trái cây / hạt giống / đồ dùng
const GARDENS = [];  // li -> {gx, gy}
for (let li = 0; li < GV_PER_SHARD; li++) {
  GARDENS.push({
    gx: GV.x0 + (li % GV.cols) * (GV.w + GV.gap),
    gy: GV.y0 + Math.floor(li / GV.cols) * (GV.h + GV.gap),
  });
}
const PLOT_AT = {};  // "x,y" -> {li, idx}
const SIGN_AT = {};  // "x,y" -> li (biển hiệu trên hàng rào)
const MAP = (() => {
  const G = Array.from({ length: WH }, () => Array(WW).fill('.'));
  for (let x = 0; x < WW; x++) { G[0][x] = 'T'; G[WH - 1][x] = 'T'; }
  for (let y = 0; y < WH; y++) { G[y][0] = 'T'; G[y][WW - 1] = 'T'; }
  const setP = (x, y) => { if (G[y][x] === '.') G[y][x] = 'p'; };
  for (let x = 1; x < WW - 1; x++) { setP(x, 5); setP(x, 9); }
  for (let y = 5; y < WH - 1; y++) setP(21, y);              // đường dọc chính
  for (const g of GARDENS) for (let x = 1; x < WW - 1; x++) setP(x, g.gy + GV.h); // đường trước cổng vườn
  // 3 cửa hàng ở quảng trường
  for (const n of [{ x: 10, ch: 'f' }, { x: 20, ch: 's' }, { x: 30, ch: 't' }]) {
    for (let k = 0; k < 3; k++) { G[2][n.x + k] = 'R'; G[3][n.x + k] = 'W'; }
    G[3][n.x + 1] = 'D';
    G[4][n.x + 1] = n.ch;
  }
  // hồ nước
  for (let y = 6; y <= 7; y++) {
    for (let x = 4; x <= 7; x++) G[y][x] = '~';
    for (let x = 34; x <= 38; x++) G[y][x] = '~';
  }
  // rải cây trang trí lên chỗ cỏ trống (làm trước khi đặt vườn)
  for (let y = 1; y < WH - 1; y++) {
    for (let x = 1; x < WW - 1; x++) {
      if (G[y][x] === '.' && hashXY(x * 3, y * 5) % 8 === 0) G[y][x] = 'T';
    }
  }
  // các khu vườn
  GARDENS.forEach((g, li) => {
    for (let dy = 0; dy < GV.h; dy++) {
      for (let dx = 0; dx < GV.w; dx++) {
        const x = g.gx + dx, y = g.gy + dy;
        const vien = dy === 0 || dy === GV.h - 1 || dx === 0 || dx === GV.w - 1;
        if (vien) G[y][x] = (dy === GV.h - 1 && dx === 3) ? 'g' : 'B';
        else if (dy >= 2 && dy <= 3 && dx >= 2 && dx <= 5) {
          G[y][x] = 'F';
          PLOT_AT[`${x},${y}`] = { li, idx: (dy - 2) * 4 + (dx - 2) };
        } else G[y][x] = '.';
      }
    }
    SIGN_AT[`${g.gx + 3},${g.gy}`] = li;
  });
  return G.map((r) => r.join(''));
})();
function hashXY(x, y) {
  let h = (Math.imul(x + 1, 73856093) ^ Math.imul(y + 1, 19349663)) >>> 0;
  h = (h ^ (h >>> 13)) >>> 0;
  return h;
}
const tileAt = (x, y) => (x < 0 || y < 0 || x >= WW || y >= WH ? 'T' : MAP[y][x]);
const DI_DUOC = new Set(['.', 'p', 'g']);
const DIR = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };
const gardenAt = (x, y) => GARDENS.findIndex((g) => x >= g.gx && x < g.gx + GV.w && y >= g.gy && y < g.gy + GV.h);
const spawnCua = (li) => ({ x: GARDENS[li].gx + 3, y: GARDENS[li].gy + GV.h });

// ---------- Dữ liệu người chơi ----------
// homeIndex: guildId -> Map(số thứ tự vườn -> userId)
const homeIndex = new Map();
for (const [uid, u] of Object.entries(db.users)) {
  if (u.farm && u.farm.homes) {
    for (const [g, n] of Object.entries(u.farm.homes)) {
      if (!homeIndex.has(g)) homeIndex.set(g, new Map());
      homeIndex.get(g).set(n, uid);
    }
  }
}
function chonVuon(guildId, uid, u) {
  const f = getFarm(u);
  if (f.homes[guildId] !== undefined) return f.homes[guildId];
  if (!homeIndex.has(guildId)) homeIndex.set(guildId, new Map());
  const idx = homeIndex.get(guildId);
  let n = 0;
  while (idx.has(n)) n++;
  idx.set(n, uid);
  f.homes[guildId] = n;
  save();
  return n;
}
const chuVuonUid = (guildId, shard, li) => {
  const m = homeIndex.get(guildId);
  return m ? m.get(shard * GV_PER_SHARD + li) : undefined;
};
const tenChu = (guildId, shard, li) => {
  const uid = chuVuonUid(guildId, shard, li);
  return uid && db.users[uid] && db.users[uid].farm ? db.users[uid].farm.name || 'Người chơi' : null;
};

function getFarm(u) {
  if (!u.farm) u.farm = {};
  const f = u.farm;
  if (!f.pos) f.pos = { x: 5, y: 4, g: '' };
  if (!Array.isArray(f.plots) || f.plots.length !== SO_O) {
    const cu = f.plots || [];
    f.plots = Array.from({ length: SO_O }, (_, i) => cu[i] || null);
  }
  f.seeds = Object.assign({ carrot: 0, tomato: 0, watermelon: 0 }, f.seeds || {});
  if (!f.fruits) f.fruits = {};
  if (f.binh === undefined) f.binh = 0;
  if (f.xeng === undefined) f.xeng = 0;
  if (f.carry === undefined) f.carry = null; // cây đang cầm (sau khi xúc)
  if (!f.homes) f.homes = {};
  return f;
}

// Màu áo riêng của mỗi người (cũng là màu biển hiệu vườn)
const PAL = [0x3b6fd8, 0xe53935, 0x43a047, 0xf9a825, 0x8e24aa, 0x00acc1, 0xd81b60, 0x6d4c41, 0x5c6bc0, 0x00897b, 0xfb8c00, 0x7cb342];
function mauNguoi(uid) {
  let h = 0;
  for (const c of String(uid)) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return PAL[h % PAL.length];
}

// ---------- Vẽ pixel ----------
const TS = 16; // kích thước 1 ô (pixel gốc)
const SC = 3;  // phóng to khi xuất ảnh
const mkCanvas = (w, h) => ({ w, h, d: new Uint8Array(w * h * 3) });
function px(cv, x, y, c) {
  if (x < 0 || y < 0 || x >= cv.w || y >= cv.h) return;
  const i = (y * cv.w + x) * 3;
  cv.d[i] = (c >> 16) & 255; cv.d[i + 1] = (c >> 8) & 255; cv.d[i + 2] = c & 255;
}
function rect(cv, x, y, w, h, c) {
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) px(cv, x + i, y + j, c);
}
const toi = (c, f) =>
  (Math.floor(((c >> 16) & 255) * f) << 16) | (Math.floor(((c >> 8) & 255) * f) << 8) | Math.floor((c & 255) * f);

// Ghi PNG (RGB 8-bit) bằng zlib có sẵn, phóng to sc lần kiểu pixel art
const CRC_T = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();
function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_T[(c ^ buf[i]) & 255] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}
function pngChunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function ghiPNG(cv, sc) {
  const W = cv.w * sc, H = cv.h * sc;
  const raw = Buffer.alloc((W * 3 + 1) * H);
  let o = 0;
  for (let y = 0; y < H; y++) {
    raw[o++] = 0; // filter none
    const sy = Math.floor(y / sc);
    for (let x = 0; x < W; x++) {
      const si = (sy * cv.w + Math.floor(x / sc)) * 3;
      raw[o++] = cv.d[si]; raw[o++] = cv.d[si + 1]; raw[o++] = cv.d[si + 2];
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4);
  ihdr[8] = 8; ihdr[9] = 2; // 8-bit, truecolor
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', zlib.deflateSync(raw, { level: 3 })),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

// ----- các loại ô (ox,oy = vị trí vẽ; tx,ty = tọa độ thế giới để tạo nhiễu cố định) -----
function veCo(cv, ox, oy, tx, ty) {
  rect(cv, ox, oy, TS, TS, 0x62c04e);
  for (let i = 0; i < 6; i++) {
    const h = hashXY(tx * 7 + i, ty * 13 + i * 3);
    px(cv, ox + (h % 14) + 1, oy + ((h >>> 4) % 14) + 1, (h >>> 9) & 1 ? 0x4fa83c : 0x7fd466);
  }
}
function veDuong(cv, ox, oy, tx, ty) {
  rect(cv, ox, oy, TS, TS, 0xdcc784);
  for (let i = 0; i < 5; i++) {
    const h = hashXY(tx * 5 + i, ty * 11 + i * 7);
    px(cv, ox + (h % 14) + 1, oy + ((h >>> 4) % 14) + 1, 0xc9b06c);
  }
}
function veCay(cv, ox, oy, tx, ty) {
  veCo(cv, ox, oy, tx, ty);
  rect(cv, ox + 7, oy + 10, 2, 5, 0x6b4423);
  rect(cv, ox + 3, oy + 2, 10, 3, 0x2f8f3a);
  rect(cv, ox + 2, oy + 4, 12, 5, 0x2f8f3a);
  rect(cv, ox + 4, oy + 9, 8, 2, 0x277a31);
  rect(cv, ox + 4, oy + 3, 3, 2, 0x45b04f);
  rect(cv, ox + 9, oy + 5, 3, 2, 0x45b04f);
}
function veNuoc(cv, ox, oy, tx, ty) {
  rect(cv, ox, oy, TS, TS, 0x3b82d6);
  for (let i = 0; i < 4; i++) {
    const h = hashXY(tx * 3 + i, ty * 9 + i * 5);
    rect(cv, ox + (h % 11) + 1, oy + ((h >>> 4) % 14) + 1, 3, 1, 0x7dbcf2);
  }
}
function veMai(cv, ox, oy, mau) {
  rect(cv, ox, oy, TS, TS, mau);
  for (let y = 3; y < TS; y += 4) rect(cv, ox, oy + y, TS, 1, toi(mau, 0.72));
  rect(cv, ox, oy, TS, 1, toi(mau, 0.9));
}
function veTuong(cv, ox, oy) {
  rect(cv, ox, oy, TS, TS, 0xeadbb3);
  for (let y = 3; y < TS; y += 4) rect(cv, ox, oy + y, TS, 1, 0xd2c08f);
}
function veCua(cv, ox, oy) {
  veTuong(cv, ox, oy);
  rect(cv, ox + 3, oy + 1, 10, 15, 0x6b3f1d);
  rect(cv, ox + 4, oy + 2, 8, 14, 0x8d5a2c);
  rect(cv, ox + 7, oy + 2, 2, 14, 0x74461f);
  px(cv, ox + 10, oy + 9, 0xffd54f);
}
function veNPC(cv, ox, oy, tx, ty, ao) {
  veCo(cv, ox, oy, tx, ty);
  rect(cv, ox + 4, oy + 14, 8, 2, 0x4a9a3a);
  rect(cv, ox + 5, oy + 12, 2, 3, 0x2d2d5a);
  rect(cv, ox + 9, oy + 12, 2, 3, 0x2d2d5a);
  rect(cv, ox + 4, oy + 7, 8, 6, ao);
  rect(cv, ox + 6, oy + 9, 4, 4, 0xffffff);
  rect(cv, ox + 3, oy + 8, 1, 4, 0xf2c9a0);
  rect(cv, ox + 12, oy + 8, 1, 4, 0xf2c9a0);
  rect(cv, ox + 5, oy + 2, 6, 6, 0xf2c9a0);
  rect(cv, ox + 4, oy + 1, 8, 3, toi(ao, 0.7)); // mũ
  px(cv, ox + 6, oy + 5, 0x222222);
  px(cv, ox + 9, oy + 5, 0x222222);
  px(cv, ox + 7, oy + 7, 0xc0756a);
  px(cv, ox + 8, oy + 7, 0xc0756a);
}
function veRao(cv, ox, oy, tx, ty) {
  veCo(cv, ox, oy, tx, ty);
  rect(cv, ox, oy + 5, TS, 2, 0xb5844f);
  rect(cv, ox, oy + 10, TS, 2, 0xb5844f);
  rect(cv, ox + 1, oy + 2, 3, 12, 0x8a5a2e);
  rect(cv, ox + 1, oy + 2, 3, 1, 0xa9743d);
}
function veCong(cv, ox, oy, tx, ty) {
  veDuong(cv, ox, oy, tx, ty);
  rect(cv, ox, oy + 2, 3, 12, 0x8a5a2e);
  rect(cv, ox + TS - 3, oy + 2, 3, 12, 0x8a5a2e);
}
function veBien(cv, ox, oy, mau) { // biển hiệu vườn trên hàng rào
  rect(cv, ox + 3, oy + 1, 10, 7, 0x4e342e);
  rect(cv, ox + 4, oy + 2, 8, 5, mau);
  rect(cv, ox + 7, oy + 8, 2, 4, 0x4e342e);
}

// Chữ số 3x5 để đánh số ô đất
const FONT = {
  1: ['010', '110', '010', '010', '111'], 2: ['111', '001', '111', '100', '111'],
  3: ['111', '001', '111', '001', '111'], 4: ['101', '101', '111', '001', '001'],
  5: ['111', '100', '111', '001', '111'], 6: ['111', '100', '111', '101', '111'],
  7: ['111', '001', '010', '010', '010'], 8: ['111', '101', '111', '101', '111'],
};
function veSo(cv, x, y, d, c) {
  const g = FONT[d];
  if (!g) return;
  for (let r = 0; r < 5; r++) for (let k = 0; k < 3; k++) if (g[r][k] === '1') px(cv, x + k, y + r, c);
}
function veDat(cv, ox, oy, idx) {
  rect(cv, ox, oy, TS, TS, 0x7b4a2b);
  for (let y = 4; y < TS - 1; y += 4) rect(cv, ox + 1, oy + y + 2, 14, 1, 0x5f3a21);
  rect(cv, ox, oy, TS, 1, 0x94623a); rect(cv, ox, oy + TS - 1, TS, 1, 0x5a3720);
  rect(cv, ox, oy, 1, TS, 0x94623a); rect(cv, ox + TS - 1, oy, 1, TS, 0x5a3720);
  veSo(cv, ox + 2, oy + 2, idx + 1, 0xf6e2b5);
}

// ----- cây trồng -----
const RB = [0xff1744, 0xff9100, 0xffea00, 0x00e676, 0x2979ff, 0xd500f9];
const spark = (cv, x, y, c) => { px(cv, x, y, c); px(cv, x - 1, y, c); px(cv, x + 1, y, c); px(cv, x, y - 1, c); px(cv, x, y + 1, c); };
function hieuUng(cv, ox, oy, mut) {
  if (mut === 'vang') {
    for (let i = 0; i < TS; i += 2) {
      px(cv, ox + i, oy, 0xffd54f); px(cv, ox + i, oy + TS - 1, 0xffd54f);
      px(cv, ox, oy + i, 0xffd54f); px(cv, ox + TS - 1, oy + i, 0xffd54f);
    }
    spark(cv, ox + 3, oy + 4, 0xfff59d); spark(cv, ox + 12, oy + 11, 0xfff59d);
  } else {
    for (let i = 0; i < TS; i++) {
      px(cv, ox + i, oy, RB[i % 6]); px(cv, ox + i, oy + TS - 1, RB[(i + 3) % 6]);
      px(cv, ox, oy + i, RB[(i + 1) % 6]); px(cv, ox + TS - 1, oy + i, RB[(i + 4) % 6]);
    }
    spark(cv, ox + 3, oy + 4, 0xffffff); spark(cv, ox + 12, oy + 11, 0xffffff);
  }
}
function vePlant(cv, ox, oy, p, now) {
  const chin = now >= p.readyAt;
  const prog = Math.min(1, (now - p.cycleStart) / Math.max(1, p.readyAt - p.cycleStart));
  if (!chin) {
    if (p.harvests === 0 && prog < 0.5) { // mầm
      rect(cv, ox + 7, oy + 9, 2, 4, 0x3aa845);
      rect(cv, ox + 5, oy + 8, 2, 2, 0x4cc75a); rect(cv, ox + 9, oy + 8, 2, 2, 0x4cc75a);
    } else { // đang lớn
      rect(cv, ox + 7, oy + 6, 2, 7, 0x2f9b3b);
      rect(cv, ox + 4, oy + 6, 3, 3, 0x4cc75a); rect(cv, ox + 9, oy + 6, 3, 3, 0x4cc75a);
      rect(cv, ox + 5, oy + 9, 2, 2, 0x3aa845); rect(cv, ox + 9, oy + 9, 2, 2, 0x3aa845);
    }
    if (p.watered) { rect(cv, ox + 12, oy + 2, 2, 3, 0x4fc3f7); px(cv, ox + 12, oy + 5, 0x4fc3f7); }
    return;
  }
  if (p.type === 'carrot') {
    rect(cv, ox + 5, oy + 3, 6, 3, 0x3aa845); rect(cv, ox + 7, oy + 2, 2, 2, 0x4cc75a);
    rect(cv, ox + 6, oy + 6, 4, 4, 0xf08a24); rect(cv, ox + 7, oy + 10, 2, 2, 0xf08a24);
    px(cv, ox + 7, oy + 12, 0xd9731a);
  } else if (p.type === 'tomato') {
    rect(cv, ox + 3, oy + 3, 10, 9, 0x2f9b3b);
    rect(cv, ox + 4, oy + 5, 3, 3, 0xe53935); rect(cv, ox + 9, oy + 6, 3, 3, 0xe53935);
    rect(cv, ox + 6, oy + 9, 3, 3, 0xe53935);
    px(cv, ox + 5, oy + 5, 0xff8a80); px(cv, ox + 10, oy + 6, 0xff8a80); px(cv, ox + 7, oy + 9, 0xff8a80);
  } else {
    rect(cv, ox + 2, oy + 5, 12, 8, 0x2e8b3a); rect(cv, ox + 3, oy + 4, 10, 1, 0x2e8b3a);
    rect(cv, ox + 3, oy + 13, 10, 1, 0x2e8b3a);
    for (const x of [4, 7, 10]) rect(cv, ox + x, oy + 4, 1, 10, 0x1b5e20);
    rect(cv, ox + 4, oy + 6, 2, 1, 0x66bb6a);
  }
  if (p.mut) hieuUng(cv, ox, oy, p.mut);
}

// ----- nhân vật -----
function vePlayer(cv, vx, vy, facing, ao) {
  const ox = vx * TS, oy = vy * TS, hair = 0x5b3a1e, skin = 0xf2c9a0;
  rect(cv, ox + 5, oy + 13, 2, 3, 0x2d2d5a); rect(cv, ox + 9, oy + 13, 2, 3, 0x2d2d5a);
  rect(cv, ox + 4, oy + 7, 8, 6, ao);
  rect(cv, ox + 3, oy + 8, 1, 4, skin); rect(cv, ox + 12, oy + 8, 1, 4, skin);
  rect(cv, ox + 5, oy + 2, 6, 6, skin);
  rect(cv, ox + 5, oy + 1, 6, 3, hair);
  if (facing === 'down') { px(cv, ox + 6, oy + 5, 0x222222); px(cv, ox + 9, oy + 5, 0x222222); }
  else if (facing === 'up') { rect(cv, ox + 5, oy + 1, 6, 5, hair); }
  else if (facing === 'left') { px(cv, ox + 6, oy + 5, 0x222222); rect(cv, ox + 9, oy + 3, 2, 3, hair); }
  else { px(cv, ox + 9, oy + 5, 0x222222); rect(cv, ox + 5, oy + 3, 2, 3, hair); }
}
function veKhung(cv, vx, vy, c) {
  const ox = vx * TS, oy = vy * TS;
  for (const [cx, cy, sx, sy] of [[0, 0, 1, 1], [TS - 1, 0, -1, 1], [0, TS - 1, 1, -1], [TS - 1, TS - 1, -1, -1]]) {
    for (let i = 0; i < 3; i++) { px(cv, ox + cx + sx * i, oy + cy, c); px(cv, ox + cx, oy + cy + sy * i, c); }
  }
}

// Camera: giữ nhân vật ở giữa khung, không vượt ra ngoài thế giới
const camTu = (p) => ({
  cx: Math.max(0, Math.min(WW - VW, p.x - Math.floor(VW / 2))),
  cy: Math.max(0, Math.min(WH - VH, p.y - Math.floor(VH / 2))),
});

// Người chơi khác đang online cùng thế giới
function layNguoiKhac(sess) {
  const ds = [];
  for (const o of gameSessions.values()) {
    if (o.uid === sess.uid || o.guildId !== sess.guildId || o.shard !== sess.shard) continue;
    const uo = db.users[o.uid];
    if (!uo || !uo.farm) continue;
    ds.push({ uid: o.uid, x: uo.farm.pos.x, y: uo.farm.pos.y, facing: o.s.facing, name: uo.farm.name || 'Người chơi' });
  }
  return ds;
}
const trongKhung = (cam, o) => o.x >= cam.cx && o.x < cam.cx + VW && o.y >= cam.cy && o.y < cam.cy + VH;

function renderMap(sess, farm, now) {
  const cv = mkCanvas(VW * TS, VH * TS);
  const pos = farm.pos, cam = camTu(pos);
  const farmCache = {};
  const farmCua = (li) => {
    if (!(li in farmCache)) {
      const uid = chuVuonUid(sess.guildId, sess.shard, li);
      farmCache[li] = uid && db.users[uid] ? { uid, farm: getFarm(db.users[uid]) } : null;
    }
    return farmCache[li];
  };
  for (let vy = 0; vy < VH; vy++) {
    for (let vx = 0; vx < VW; vx++) {
      const wx = cam.cx + vx, wy = cam.cy + vy;
      const ox = vx * TS, oy = vy * TS, ch = MAP[wy][wx];
      switch (ch) {
        case 'T': veCay(cv, ox, oy, wx, wy); break;
        case '~': veNuoc(cv, ox, oy, wx, wy); break;
        case 'p': veDuong(cv, ox, oy, wx, wy); break;
        case 'R': veMai(cv, ox, oy, wx < 16 ? 0xd9453f : wx < 26 ? 0x43a047 : 0x3f78d6); break;
        case 'W': veTuong(cv, ox, oy); break;
        case 'D': veCua(cv, ox, oy); break;
        case 'f': veNPC(cv, ox, oy, wx, wy, 0xd9453f); break;
        case 's': veNPC(cv, ox, oy, wx, wy, 0x43a047); break;
        case 't': veNPC(cv, ox, oy, wx, wy, 0x3f78d6); break;
        case 'B': {
          veRao(cv, ox, oy, wx, wy);
          const li = SIGN_AT[`${wx},${wy}`];
          if (li !== undefined) {
            const c = farmCua(li);
            veBien(cv, ox, oy, c ? mauNguoi(c.uid) : 0x9e9e9e);
          }
          break;
        }
        case 'g': veCong(cv, ox, oy, wx, wy); break;
        case 'F': {
          const info = PLOT_AT[`${wx},${wy}`];
          veDat(cv, ox, oy, info.idx);
          const c = farmCua(info.li);
          const p = c && c.farm.plots[info.idx];
          if (p) vePlant(cv, ox, oy, p, now);
          break;
        }
        default: veCo(cv, ox, oy, wx, wy);
      }
    }
  }
  // người chơi khác (vẽ theo thứ tự y), rồi đến mình
  const khac = layNguoiKhac(sess).filter((o) => trongKhung(cam, o)).sort((a, b) => a.y - b.y);
  for (const o of khac) vePlayer(cv, o.x - cam.cx, o.y - cam.cy, o.facing, mauNguoi(o.uid));
  vePlayer(cv, pos.x - cam.cx, pos.y - cam.cy, sess.s.facing, mauNguoi(sess.uid));
  const [dx, dy] = DIR[sess.s.facing] || DIR.down;
  const fx = pos.x + dx - cam.cx, fy = pos.y + dy - cam.cy;
  if (fx >= 0 && fy >= 0 && fx < VW && fy < VH) veKhung(cv, fx, fy, 0xfff176);
  return ghiPNG(cv, SC);
}

// ---------- Logic game ----------
const fmtTG = (ms) => {
  const s = Math.ceil(ms / 1000);
  return s >= 60 ? `${Math.floor(s / 60)}p${String(s % 60).padStart(2, '0')}s` : `${s}s`;
};
const tenQua = (key) => {
  const [t, mu] = key.split('|');
  return `${SEEDS[t].e} ${SEEDS[t].ten}${mu !== 'n' ? ` ${MUT[mu].e}${MUT[mu].ten}` : ''}`;
};
const tongQua = (farm) => Object.values(farm.fruits).reduce((a, b) => a + b, 0);
function tongTienBan(farm) {
  let tong = 0;
  for (const [k, c] of Object.entries(farm.fruits)) {
    const [t, mu] = k.split('|');
    tong += giaTri(t, mu === 'n' ? null : mu) * c;
  }
  return tong;
}
function dongVuon(farm, now) {
  return farm.plots.map((p, i) => {
    const n = `\`${i + 1}\``;
    if (!p) return `${n} ⬜ Đất trống`;
    const c = SEEDS[p.type];
    let s = `${n} ${c.e} ${c.ten} — `;
    s += now >= p.readyAt
      ? `✅ **Chín**${p.mut ? ` ${MUT[p.mut].e}` : ''}`
      : `⏳ ${fmtTG(p.readyAt - now)}${p.watered ? ' 💧' : ''}`;
    if (c.toiDa > 1) s += ` (đã hái ${p.harvests}/${c.toiDa})`;
    return s;
  }).join('\n');
}
function textTui(farm) {
  const qua = Object.entries(farm.fruits).map(([k, c]) => `${tenQua(k)} x${c}`).join('\n') || '*Chưa có trái cây*';
  return (
    `**🌰 Hạt giống**\n${Object.keys(SEEDS).map((k) => `${SEEDS[k].e} ${SEEDS[k].ten} x${farm.seeds[k]}`).join('\n')}\n\n` +
    `**🧰 Dụng cụ**\n${TOOLS.binh.e} ${TOOLS.binh.ten} x${farm.binh}\n${TOOLS.xeng.e} ${TOOLS.xeng.ten} x${farm.xeng}\n\n` +
    `**🧺 Trái cây**\n${qua}` +
    (farm.carry ? `\n\n**🌱 Đang cầm**\n${SEEDS[farm.carry.type].e} ${SEEDS[farm.carry.type].ten}` : '')
  );
}
function viTri(sess, farm) {
  const li = gardenAt(farm.pos.x, farm.pos.y);
  if (li >= 0) {
    if (li === sess.li) return '🏡 Vườn của bạn';
    const ten = tenChu(sess.guildId, sess.shard, li);
    return ten ? `🏡 Vườn của **${ten}**` : '🏡 Khu vườn chưa có chủ';
  }
  return farm.pos.y <= 9 ? '⛲ Quảng trường' : '🛤️ Đường làng';
}

// Tìm ô lân cận thỏa điều kiện (ưu tiên ô đang đối diện)
function timO(farm, facing, pred) {
  const thuTu = [facing, ...['up', 'down', 'left', 'right'].filter((d) => d !== facing)];
  for (const d of thuTu) {
    const x = farm.pos.x + DIR[d][0], y = farm.pos.y + DIR[d][1];
    const ch = tileAt(x, y);
    if (pred(x, y, ch)) return { x, y, ch, d };
  }
  return null;
}

function thuHoach(farm, idx, now) {
  const p = farm.plots[idx];
  const cfg = SEEDS[p.type];
  const key = `${p.type}|${p.mut || 'n'}`;
  farm.fruits[key] = (farm.fruits[key] || 0) + 1;
  p.harvests++;
  let them = '';
  if (p.harvests >= cfg.toiDa) {
    farm.plots[idx] = null;
    if (cfg.toiDa > 1) them = ' Cây đã tàn, ô đất trống trở lại.';
  } else {
    p.cycleStart = now;
    p.readyAt = now + cfg.tgLai * 1000;
    p.watered = false;
    p.mut = rollMut();
    them = ` Cây sẽ ra quả mới sau ${fmtTG(cfg.tgLai * 1000)}.`;
  }
  return `🧺 Thu hoạch **${tenQua(key)}**!${them}`;
}

// Xử lý 1 thao tác (đồng bộ). Cập nhật u và sess.s
function xuLyGame(u, sess, act, arg) {
  const s = sess.s;
  const farm = getFarm(u);
  const now = Date.now();
  const laCuaMinh = (x, y) => { const i = PLOT_AT[`${x},${y}`]; return i && i.li === sess.li ? i : null; };
  s.msg = '';
  switch (act) {
    case 'up': case 'down': case 'left': case 'right': {
      s.facing = act;
      let di = 0, chan = null;
      for (let k = 0; k < s.step; k++) {
        const nx = farm.pos.x + DIR[act][0], ny = farm.pos.y + DIR[act][1];
        if (DI_DUOC.has(tileAt(nx, ny))) { farm.pos.x = nx; farm.pos.y = ny; di++; }
        else { chan = tileAt(nx, ny); break; }
      }
      if (di) save();
      else if (chan && !'fstF'.includes(chan)) s.msg = '🚧 Có vật cản phía trước.';
      break;
    }
    case 'home': {
      const sp = spawnCua(sess.li);
      farm.pos.x = sp.x; farm.pos.y = sp.y; s.facing = 'up'; save();
      s.msg = '🏠 Đã về cổng khu vườn của bạn.';
      break;
    }
    case 'step': s.step = s.step === 1 ? 3 : s.step === 3 ? 6 : 1; break;
    case 'refresh': break;
    case 'back': s.mode = 'map'; break;
    case 'quit': s.mode = 'end'; break;
    case 'bag': s.mode = 'bag'; break;
    case 'qty': s.qty = s.qty === 1 ? 5 : s.qty === 5 ? 10 : 1; break;

    case 'act': {
      const o = timO(farm, s.facing, (x, y, ch) => 'fstF'.includes(ch));
      if (!o) { s.msg = '🤔 Không có gì để tương tác. Hãy đứng cạnh ô đất hoặc NPC (khung vàng là ô đang nhìn tới).'; break; }
      s.facing = o.d;
      if (o.ch === 'f') { s.mode = 'shop_fruit'; break; }
      if (o.ch === 's') { s.mode = 'shop_seed'; break; }
      if (o.ch === 't') { s.mode = 'shop_tool'; break; }
      const info = PLOT_AT[`${o.x},${o.y}`];
      if (info.li !== sess.li) {
        const ten = tenChu(sess.guildId, sess.shard, info.li);
        s.msg = ten ? `🔒 Đây là vườn của **${ten}**, bạn chỉ có thể ngắm thôi!` : '🔒 Khu vườn này chưa có chủ.';
        break;
      }
      const idx = info.idx;
      const p = farm.plots[idx];
      if (!p) {
        if (farm.carry) {
          farm.plots[idx] = farm.carry; farm.carry = null; save();
          s.msg = `🌱 Đã đặt cây xuống ô **#${idx + 1}**.`;
        } else { s.mode = 'plant'; s.plotIdx = idx; }
      } else if (now >= p.readyAt) {
        s.msg = thuHoach(farm, idx, now); save();
      } else {
        s.msg = `⏳ ${SEEDS[p.type].e} Ô **#${idx + 1}** còn **${fmtTG(p.readyAt - now)}** nữa mới chín.`;
      }
      break;
    }

    case 'plant': {
      const idx = s.plotIdx;
      if (farm.plots[idx]) { s.msg = '❌ Ô đất này đã có cây.'; s.mode = 'map'; break; }
      if (!SEEDS[arg] || farm.seeds[arg] < 1) { s.msg = '❌ Bạn không có hạt giống này.'; break; }
      farm.seeds[arg]--;
      farm.plots[idx] = {
        type: arg, cycleStart: now, readyAt: now + SEEDS[arg].tgLon * 1000,
        harvests: 0, mut: rollMut(), watered: false,
      };
      save();
      s.mode = 'map';
      s.msg = `🌱 Đã trồng **${SEEDS[arg].e} ${SEEDS[arg].ten}** ở ô **#${idx + 1}**. Chín sau ${fmtTG(SEEDS[arg].tgLon * 1000)}.`;
      break;
    }

    case 'water': {
      const o = timO(farm, s.facing, (x, y, ch) => {
        if (ch !== 'F') return false;
        const i = laCuaMinh(x, y);
        const p = i && farm.plots[i.idx];
        return p && now < p.readyAt && !p.watered;
      });
      if (!o) { s.msg = '💧 Không có cây nào của bạn cần tưới ở cạnh (cây phải đang lớn và chưa được tưới).'; break; }
      if (farm.binh < 1) { s.msg = '❌ Bạn hết bình tưới nước. Mua ở cửa hàng đồ dùng!'; break; }
      const idx = PLOT_AT[`${o.x},${o.y}`].idx;
      const p = farm.plots[idx];
      farm.binh--;
      p.readyAt = now + Math.floor((p.readyAt - now) / 2);
      p.watered = true;
      s.facing = o.d;
      save();
      s.msg = `💧 Đã tưới ô **#${idx + 1}**, thời gian chờ còn **${fmtTG(p.readyAt - now)}**.`;
      break;
    }

    case 'dig': {
      if (farm.carry) { s.msg = '❌ Bạn đang cầm một cây rồi, hãy đặt xuống ô đất trống (✋ Tương tác) trước.'; break; }
      const o = timO(farm, s.facing, (x, y, ch) => {
        if (ch !== 'F') return false;
        const i = laCuaMinh(x, y);
        return i && farm.plots[i.idx];
      });
      if (!o) { s.msg = '⛏️ Không có cây nào của bạn ở cạnh để xúc.'; break; }
      if (farm.xeng < 1) { s.msg = '❌ Bạn không có xẻng. Mua ở cửa hàng đồ dùng!'; break; }
      const idx = PLOT_AT[`${o.x},${o.y}`].idx;
      farm.xeng--;
      farm.carry = farm.plots[idx];
      farm.plots[idx] = null;
      s.facing = o.d;
      save();
      s.msg = `⛏️ Đã xúc cây ở ô **#${idx + 1}**. Đến ô đất trống và bấm ✋ để đặt xuống.`;
      break;
    }

    case 'buy': {
      const qty = s.qty;
      if (SEEDS[arg]) {
        const cost = SEEDS[arg].gia * qty;
        if (u.balance < cost) { s.msg = `❌ Không đủ tiền (cần ${fmt(cost)}).`; break; }
        u.balance -= cost; farm.seeds[arg] += qty; save();
        s.msg = `🛒 Đã mua **${qty}x ${SEEDS[arg].e} ${SEEDS[arg].ten}** với giá ${fmt(cost)}.`;
      } else if (TOOLS[arg]) {
        const cost = TOOLS[arg].gia * qty;
        if (u.balance < cost) { s.msg = `❌ Không đủ tiền (cần ${fmt(cost)}).`; break; }
        u.balance -= cost; farm[arg] += qty; save();
        s.msg = `🛒 Đã mua **${qty}x ${TOOLS[arg].e} ${TOOLS[arg].ten}** với giá ${fmt(cost)}.`;
      }
      break;
    }

    case 'sellall': {
      const n = tongQua(farm);
      if (!n) { s.msg = '❌ Bạn chưa có trái cây nào để bán.'; break; }
      const tong = tongTienBan(farm);
      u.balance += tong; farm.fruits = {}; save();
      s.msg = `💰 Đã bán **${n}** trái cây, nhận **+${fmt(tong)}**.`;
      break;
    }
  }
}

// ---------- Giao diện ----------
const nut = (id, label, emj, style = ButtonStyle.Secondary, dis = false) => {
  const b = new ButtonBuilder().setCustomId(`g2:${id}`).setStyle(style).setDisabled(dis);
  if (label) b.setLabel(label);
  if (emj) b.setEmoji(emj);
  return b;
};
const hang = (...btns) => new ActionRowBuilder().addComponents(btns);

// "Chữ ký" những thứ người chơi nhìn thấy, dùng để biết khi nào cần tự làm mới
function chuKy(sess, u) {
  const farm = getFarm(u), cam = camTu(farm.pos), now = Date.now();
  const khac = layNguoiKhac(sess).filter((o) => trongKhung(cam, o)).map((o) => `${o.uid}:${o.x},${o.y},${o.facing}`).join('|');
  const chin = farm.plots.map((p) => (p && now >= p.readyAt ? 1 : 0)).join('');
  return `${khac}#${chin}`;
}

function veGame(sess, u, edit) {
  const s = sess.s, user = sess.user;
  const farm = getFarm(u);
  const now = Date.now();
  const ten = `g2_${now}.png`;
  const file = new AttachmentBuilder(renderMap(sess, farm, now), { name: ten });
  const embed = khung(user, MAU.thang, `🌱 VƯỜN CỦA ${(farm.name || user.username).toUpperCase()}`)
    .setImage(`attachment://${ten}`);
  let rows = [];
  const mota = s.msg || '';
  sess.sig = chuKy(sess, u);

  if (s.mode === 'map') {
    const cam = camTu(farm.pos);
    const gan = layNguoiKhac(sess).filter((o) => trongKhung(cam, o)).map((o) => o.name);
    embed.setDescription(
      `📍 ${viTri(sess, farm)} • Thế giới #${sess.shard + 1}\n` +
      (mota || 'Di chuyển bằng mũi tên, đứng cạnh **ô đất** hoặc **NPC** rồi bấm ✋ Tương tác.')
    ).addFields(
      { name: '💰 Số dư', value: `**${fmt(u.balance)}**`, inline: true },
      {
        name: '🎒 Túi đồ',
        value:
          Object.keys(SEEDS).map((k) => `${SEEDS[k].e}x${farm.seeds[k]}`).join(' ') + '\n' +
          `${TOOLS.binh.e}x${farm.binh} ${TOOLS.xeng.e}x${farm.xeng} 🧺x${tongQua(farm)}` +
          (farm.carry ? `\n🌱 Đang cầm: ${SEEDS[farm.carry.type].e}` : ''),
        inline: true,
      },
      { name: '🌿 Khu vườn của bạn', value: dongVuon(farm, now) },
      ...(gan.length ? [{ name: '👥 Đang ở gần', value: gan.join(', ') }] : [])
    );
    rows = [
      hang(nut('left', null, '⬅️'), nut('up', null, '⬆️'), nut('down', null, '⬇️'), nut('right', null, '➡️'),
        nut('act', 'Tương tác', '✋', ButtonStyle.Primary)),
      hang(nut('water', 'Tưới', '💧'), nut('dig', 'Xẻng', '⛏️'), nut('bag', 'Túi', '🎒'),
        nut('home', null, '🏠'), nut('refresh', null, '🔄')),
      hang(nut('step', `Bước x${s.step}`, '🏃'), nut('quit', null, '✖️', ButtonStyle.Danger)),
    ];
  } else if (s.mode === 'shop_seed') {
    const ds = Object.keys(SEEDS).map((k) => {
      const c = SEEDS[k];
      return `${c.e} **${c.ten}** — ${c.gia} vnđ • lớn ${fmtTG(c.tgLon * 1000)} • ${c.mota} • bán ${c.banGia} vnđ/trái`;
    }).join('\n');
    embed.setDescription(
      `🧑‍🌾 *"Chào mừng đến cửa hàng hạt giống!"*\n\n${ds}\n\n` +
      `Quả có thể mọc **${MUT.vang.e} Vàng** (x${MUT.vang.nhan} giá) hoặc **${MUT.cv.e} Cầu vồng** (x${MUT.cv.nhan} giá)!` +
      (mota ? `\n\n${mota}` : '')
    ).addFields({ name: '💰 Số dư', value: `**${fmt(u.balance)}**`, inline: true });
    rows = [
      hang(...Object.keys(SEEDS).map((k) =>
        nut(`buy:${k}`, `${SEEDS[k].ten} • ${SEEDS[k].gia * s.qty}`, SEEDS[k].e, ButtonStyle.Success, u.balance < SEEDS[k].gia * s.qty))),
      hang(nut('qty', `Số lượng: x${s.qty}`, '🔢'), nut('back', 'Quay lại', '↩️')),
    ];
  } else if (s.mode === 'shop_tool') {
    const ds = Object.keys(TOOLS).map((k) => `${TOOLS[k].e} **${TOOLS[k].ten}** — ${TOOLS[k].gia} vnđ • ${TOOLS[k].mota}`).join('\n');
    embed.setDescription(`🧑‍🔧 *"Cần đồ nghề gì nào?"*\n\n${ds}` + (mota ? `\n\n${mota}` : ''))
      .addFields({ name: '💰 Số dư', value: `**${fmt(u.balance)}**`, inline: true });
    rows = [
      hang(...Object.keys(TOOLS).map((k) =>
        nut(`buy:${k}`, `${TOOLS[k].ten} • ${TOOLS[k].gia * s.qty}`, TOOLS[k].e, ButtonStyle.Success, u.balance < TOOLS[k].gia * s.qty))),
      hang(nut('qty', `Số lượng: x${s.qty}`, '🔢'), nut('back', 'Quay lại', '↩️')),
    ];
  } else if (s.mode === 'shop_fruit') {
    const ds = Object.entries(farm.fruits).map(([k, c]) => {
      const [t, mu] = k.split('|');
      return `${tenQua(k)} x${c} — ${giaTri(t, mu === 'n' ? null : mu)} vnđ/trái`;
    }).join('\n') || '*Bạn chưa có trái cây nào.*';
    embed.setDescription(`🧑‍🌾 *"Trái cây tươi à? Tôi thu mua hết!"*\n\n${ds}\n\n**Tổng:** ${fmt(tongTienBan(farm))}` + (mota ? `\n\n${mota}` : ''))
      .addFields({ name: '💰 Số dư', value: `**${fmt(u.balance)}**`, inline: true });
    rows = [hang(nut('sellall', 'Bán tất cả', '💰', ButtonStyle.Success, tongQua(farm) === 0), nut('back', 'Quay lại', '↩️'))];
  } else if (s.mode === 'plant') {
    embed.setDescription(`🌱 Chọn hạt giống để trồng ở ô **#${s.plotIdx + 1}**` + (mota ? `\n\n${mota}` : ''));
    rows = [
      hang(...Object.keys(SEEDS).map((k) =>
        nut(`plant:${k}`, `${SEEDS[k].ten} (x${farm.seeds[k]})`, SEEDS[k].e, ButtonStyle.Success, farm.seeds[k] < 1))),
      hang(nut('back', 'Quay lại', '↩️')),
    ];
  } else if (s.mode === 'bag') {
    embed.setDescription(textTui(farm)).addFields({ name: '💰 Số dư', value: `**${fmt(u.balance)}**`, inline: true });
    rows = [hang(nut('back', 'Quay lại', '↩️'))];
  } else { // end
    embed.setColor(MAU.xam).setDescription('👋 Đã đóng khu vườn. Cây vẫn tiếp tục lớn, dùng `/game2d` để quay lại!');
  }

  const payload = { embeds: [embed], components: rows, files: [file] };
  if (edit) payload.attachments = []; // xóa ảnh cũ khi cập nhật tin nhắn
  return payload;
}

// ---------- Phiên chơi (slash command + nút bấm, chỉ hiện riêng cho từng người) ----------
const gameSessions = new Map(); // userId -> phiên

function ketThucPhien(sess, xoaNut) {
  clearTimeout(sess.timer);
  if (gameSessions.get(sess.uid) === sess) gameSessions.delete(sess.uid);
  if (xoaNut) sess.last.editReply({ components: [] }).catch(() => {});
}
function datHetHan(sess) {
  clearTimeout(sess.timer);
  sess.timer = setTimeout(() => ketThucPhien(sess, true), GAME_IDLE);
}

async function khoiDongGame(i) {
  const uid = i.user.id;
  const rieng = { flags: MessageFlags.Ephemeral };
  if (!i.guildId) return i.reply({ content: '❌ Lệnh này chỉ dùng được trong server.', ...rieng });
  const u = getUser(uid);
  if (!u) return i.reply({ content: '❌ Bạn cần dùng `!dangky` trước khi chơi.', ...rieng });

  const cu = gameSessions.get(uid);
  if (cu) ketThucPhien(cu, true);

  const f = getFarm(u);
  f.name = (i.member && i.member.displayName) || i.user.displayName || i.user.username;
  const n = chonVuon(i.guildId, uid, u);
  const shard = Math.floor(n / GV_PER_SHARD), li = n % GV_PER_SHARD;
  // Vị trí: lần đầu (hoặc đổi server / vị trí lỗi) thì xuất hiện ở cổng vườn của mình
  if (f.pos.g !== i.guildId || !DI_DUOC.has(tileAt(f.pos.x, f.pos.y))) {
    const sp = spawnCua(li);
    f.pos = { x: sp.x, y: sp.y, g: i.guildId };
  }
  save();

  const sess = {
    uid, user: i.user, guildId: i.guildId, shard, li, last: i, timer: null, sig: '', busy: false, err: 0,
    s: { mode: 'map', facing: 'up', msg: '', qty: 1, step: 1, plotIdx: 0 },
  };
  gameSessions.set(uid, sess);
  datHetHan(sess);
  await i.reply({ ...veGame(sess, u, false), ...rieng });
}

async function xuLyNutGame(i) {
  const sess = gameSessions.get(i.user.id);
  if (!sess) {
    return i.update({
      content: '⌛ Phiên chơi đã hết hạn. Dùng `/game2d` để chơi lại.',
      embeds: [], components: [], attachments: [],
    }).catch(() => {});
  }
  const u = getUser(i.user.id);
  if (!u) return;
  sess.busy = true;
  try {
    sess.last = i;
    datHetHan(sess);
    const [, act, arg] = i.customId.split(':');
    xuLyGame(u, sess, act, arg);
    await i.update(veGame(sess, u, true));
    if (sess.s.mode === 'end') ketThucPhien(sess, false);
  } catch (e) {
    console.error('Lỗi game2d:', e);
  } finally {
    sess.busy = false;
  }
}

// Tự làm mới khung hình khi có người khác đi vào khung nhìn hoặc cây vừa chín
setInterval(async () => {
  for (const sess of [...gameSessions.values()]) {
    if (sess.busy || sess.s.mode !== 'map') continue;
    const u = getUser(sess.uid);
    if (!u || chuKy(sess, u) === sess.sig) continue;
    sess.busy = true;
    try {
      await sess.last.editReply(veGame(sess, u, true));
      sess.err = 0;
    } catch {
      if (++sess.err >= 3) ketThucPhien(sess, false);
    } finally {
      sess.busy = false;
    }
  }
}, GAME_TICK);

// Gõ !game2d cũ thì nhắc dùng slash command
lenh.set('game2d', (m) => loi(m, 'Game này đã chuyển sang slash command, hãy gõ **/game2d**.'));


// ===================== KHỞI ĐỘNG BOT =====================
// Chạy 1 lần khi bot online (nghe cả 'clientReady' và 'ready' để tương thích mọi bản discord.js 14)
let daKhoiDong = false;
async function khiOnline() {
  if (daKhoiDong) return;
  daKhoiDong = true;
  console.log(`Bot đã online: ${client.user.tag}`);
  try {
    // Đăng ký slash command (có thể mất vài phút để hiện lần đầu)
    await client.application.commands.set([
      { name: 'game2d', description: 'Mở game trồng cây 2D multiplayer (khung chơi chỉ mình bạn nhìn thấy)' },
    ]);
  } catch (e) {
    console.error('Không đăng ký được slash command (hãy mời lại bot với scope applications.commands):', e);
  }
}
client.once('clientReady', khiOnline);
client.once('ready', khiOnline);

client.on('interactionCreate', async (i) => {
  try {
    if (i.isChatInputCommand() && i.commandName === 'game2d') return await khoiDongGame(i);
    if (i.isButton() && i.customId.startsWith('g2:')) return await xuLyNutGame(i);
  } catch (e) {
    console.error('Lỗi interaction:', e);
  }
});

client.on('messageCreate', async (message) => {
  if (message.author.bot || !message.guild) return;
  const content = message.content.trim();
  const prefix = content[0];
  if (prefix !== '!' && prefix !== '?') return;

  const args = content.slice(1).split(/\s+/);
  const cmd = (args.shift() || '').toLowerCase();

  try {
    if (prefix === '?') return await xuLyAdmin(message, cmd, args);

    const handler = lenh.get(cmd);
    if (!handler) return;
    if (cmd !== 'helptx' && cmd !== 'dangky' && !getUser(message.author.id)) {
      return loi(message, 'Bạn cần dùng `!dangky` trước khi sử dụng các lệnh khác.');
    }
    await handler(message, args);
  } catch (e) {
    console.error('Lỗi xử lý lệnh:', e);
  }
});

client.login(TOKEN);
