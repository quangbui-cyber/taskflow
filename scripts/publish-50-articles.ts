/**
 * Cập nhật toàn bộ 50 bài viết Dave Trott sang trạng thái PUBLISHED
 * Bổ sung tiêu đề tiếng Việt in hoa sắc sảo cho tất cả 50 bài.
 */

import { prisma } from "../lib/prisma";

const TITLE_VI_MAP: Record<string, { titleVi: string; tags: string[] }> = {
  "the-first-lesson-is-no-ones-even-looking": {
    titleVi: "BÀI HỌC ĐẦU TIÊN: CHẲNG AI THÈM NHÌN CẢ",
    tags: ["sangtao", "tuduy", "quangcao"],
  },
  "turning-the-tables": {
    titleVi: "LẬT NGƯỢC THẾ CỜ",
    tags: ["sangtao", "tuduy", "thaimo"],
  },
  "wrong-problem-wrong-solution": {
    titleVi: "SAI VẤN ĐỀ = SAI GIẢI PHÁP",
    tags: ["tuduy", "gocnhin", "chienthuat"],
  },
  "knowing-everyone-elses-job-is-an-unfair-advantage": {
    titleVi: "HIỂU VIỆC CỦA NGƯỜI KHÁC LÀ MỘT LỢI THẾ BẤT CÔNG",
    tags: ["chuyennghiep", "tuduy", "hieuqua"],
  },
  "what-ai-cant-think-of": {
    titleVi: "THỨ MÀ AI KHÔNG THỂ NGHĨ RA",
    tags: ["sangtao", "tuduy", "congnghe"],
  },
  "whats-in-it-for-me": {
    titleVi: "TÔI ĐƯỢC LỢI GÌ Ở ĐÂY?",
    tags: ["tamly", "khachhang", "thaucam"],
  },
  "how-to-make-the-other-guy-lose": {
    titleVi: "CÁCH ĐỂ KHIẾN ĐỐI THỦ TỰ THUA TRẬN",
    tags: ["chienthuat", "canhtranh", "tuduy"],
  },
  "reason-is-the-slave-of-the-passions": {
    titleVi: "LÝ TRÍ LÀ NÔ LỆ CỦA CẢM XÚC",
    tags: ["tamly", "camxuc", "thuyetphuc"],
  },
  "machines-should-work-people-should-think": {
    titleVi: "MÁY MÓC ĐỂ LÀM VIỆC, CON NGƯỜI ĐỂ TƯ DUY",
    tags: ["congnghe", "tuduy", "sangtao"],
  },
  "get-the-competition-to-do-your-advertising": {
    titleVi: "BIẾN ĐỐI THỦ THÀNH KÊNH QUẢNG CÁO CHO BẠN",
    tags: ["quangcao", "canhtranh", "chienthuat"],
  },
  "real-creativity-is-upstream": {
    titleVi: "SÁNG TẠO ĐÍCH THỰC NẰM Ở THƯỢNG NGUỒN",
    tags: ["sangtao", "nguongoc", "tuduy"],
  },
  "visuals-beat-words": {
    titleVi: "HÌNH ẢNH LUÔN ĐÁNH BẠI TỪ NGỮ",
    tags: ["visual", "thietke", "truyenthong"],
  },
  "dont-just-fit-into-a-market-create-a-market": {
    titleVi: "ĐỪNG CHỈ CHEN VÀO THỊ TRƯỜNG. HÃY TẠO RA MỘT THỊ TRƯỜNG MỚI.",
    tags: ["thitruong", "chienthuoc", "dotpha"],
  },
  "writing-isnt-about-writing": {
    titleVi: "VIẾT LÁCH KHÔNG PHẢI LÀ CHUYỆN CÂU CHỮ",
    tags: ["copywriting", "vietlach", "sangtao"],
  },
  "leave-room-for-happy-accidents": {
    titleVi: "HÃY DÀNH CHỖ CHO NHỮNG TAI NẠN MAY MẮN",
    tags: ["mayman", "sangtao", "khambha"],
  },
  "lazy-thinking-costs-money": {
    titleVi: "LƯỜI SUY NGHĨ TỐN TIỀN LẮM",
    tags: ["tuduy", "tietkiem", "hieuqua"],
  },
  "different-beats-better": {
    titleVi: "KHÁC BIỆT ĐÁNH BẠI TỐT HƠN",
    tags: ["khacbiet", "dinhvi", "thuonghieu"],
  },
  "pure-creativity-v-applied-creativity": {
    titleVi: "SÁNG TẠO THUẦN TÚY VÀ SÁNG TẠO ỨNG DỤNG",
    tags: ["sangtao", "thuctien", "kinhdoanh"],
  },
  "every-country-speaks-the-same-language-common-sense": {
    titleVi: "MỌI QUỐC GIA ĐỀU NÓI CHUNG MỘT NGÔN NGỮ: LẼ THƯỜNG",
    tags: ["lethuong", "tamly", "toancau"],
  },
  "common-sense-beats-brains": {
    titleVi: "LẼ THƯỜNG ĐÁNH BẠI TRÍ THÔNG MINH",
    tags: ["lethuong", "thongminh", "thucte"],
  },
  "everything-is-just-someone-elses-opinion": {
    titleVi: "MỌI THỨ CHỈ LÀ QUAN ĐIỂM CỦA NGƯỜI KHÁC",
    tags: ["tuduy", "tudophantoan", "bantin"],
  },
  "creativity-begins-with-a-problem": {
    titleVi: "SÁNG TẠO BẮT ĐẦU TỪ MỘT BÀI TOÁN",
    tags: ["baitoan", "giaiphap", "sangtao"],
  },
  "how-to-market-a-revolution": {
    titleVi: "CÁCH TIẾP THỊ CHO MỘT CUỘC CÁCH MẠNG",
    tags: ["marketing", "cachmang", "dotpha"],
  },
  "dont-play-the-game-change-the-game": {
    titleVi: "ĐỪNG CHƠI THEO LUẬT, HÃY THAY ĐỔI LUẬT CHƠI.",
    tags: ["luatchoi", "chienthuoc", "chudong"],
  },
  "conveyor-belt-advertising": {
    titleVi: "QUẢNG CÁO DÂY CHUYỀN",
    tags: ["quangcao", "saomon", "sangtao"],
  },
  "its-easy-to-be-negative-anyone-can-do-it": {
    titleVi: "TIÊU CỰC THÌ DỄ, AI MÀ CHẲNG LÀM ĐƯỢC.",
    tags: ["thaimo", "tichcuc", "xaydung"],
  },
  "upstream-thinking": {
    titleVi: "TƯ DUY NGƯỢC DÒNG THƯỢNG NGUỒN",
    tags: ["tuduy", "gocrang", "chienthuoc"],
  },
  "it-takes-a-team-to-be-creative": {
    titleVi: "CẦN CẢ ĐỘI NGŨ MỚI CÓ SỰ SÁNG TẠO",
    tags: ["teamwork", "dongdoi", "sangtao"],
  },
  "corkscrew-thinking": {
    titleVi: "TƯ DUY MỞ NÚT CHAI",
    tags: ["tuduy", "linhhoat", "thongminh"],
  },
  "get-upstream": {
    titleVi: "ĐI VỀ PHÍA THƯỢNG NGUỒN",
    tags: ["tuduy", "nguyennhan", "baitoan"],
  },
  "the-squeaky-wheel-gets-the-oil": {
    titleVi: "BÁNH XE KÊU MỚI ĐƯỢC TRA DẦU",
    tags: ["lenhbang", "chudong", "giaotiep"],
  },
  "whos-a-naughty-boy-then": {
    titleVi: "RỐT CUỘC AI MỚI LÀ KẺ NGHỊCH NGỢM?",
    tags: ["quangcao", "haihuoc", "gocnhin"],
  },
  "please-dont-throw-me-in-the-briar-patch": {
    titleVi: "“LÀM ƠN ĐỪNG NÉM TÔI VÀO BỤI GAI”",
    tags: ["tamly", "chienthuat", "nguocdoi"],
  },
  "the-man-who-marketed-the-industrial-revolution": {
    titleVi: "NGƯỜI ĐÃ TIẾP THỊ CHO CUỘC CÁCH MẠNG CÔNG NGHIỆP",
    tags: ["lichsu", "marketing", "sangtao"],
  },
  "paid-for-owned-earned-media": {
    titleVi: "TRUYỀN THÔNG TRẢ PHÍ, SỞ HỮU VÀ LAN TỎA",
    tags: ["media", "truyenthong", "chientruoc"],
  },
  "when-do-ers-beat-thinkers": {
    titleVi: "KHI NGƯỜI HÀNH ĐỘNG ĐÁNH BẠI KẺ NGHĨ SUÔNG",
    tags: ["hanhdong", "thucthi", "ketqua"],
  },
  "inverting": {
    titleVi: "ĐẢO NGƯỢC TƯ DUY",
    tags: ["daonguoc", "tuduy", "sangtao"],
  },
  "common-sense-v-marketing": {
    titleVi: "LẼ THƯỜNG VÀ MARKETING",
    tags: ["lethuong", "marketing", "thucte"],
  },
  "should-i-just-repeat-the-same-blog-post-every-week": {
    titleVi: "TÔI CÓ NÊN LẶP LẠI CÙNG MỘT BÀI VIẾT MỖI TUẦN?",
    tags: ["noidung", "cotloi", "thongdiep"],
  },
  "new-media-isnt-even-new": {
    titleVi: "TRUYỀN THÔNG MỚI THỰC RA CHẲNG CÓ GÌ MỚI",
    tags: ["media", "banchat", "quangcao"],
  },
  "christmas-creativity": {
    titleVi: "SÁNG TẠO MÙA GIÁNG SINH",
    tags: ["muavu", "sangtao", "camhung"],
  },
  "strategy-is-sacrifice": {
    titleVi: "CHIẾN LƯỢC LÀ SỰ HY SINH",
    tags: ["chienluoc", "danhdoi", "trongtam"],
  },
  "our-job-is-impact": {
    titleVi: "VIỆC CỦA CHÚNG TA LÀ TẠO RA TÁC ĐỘNG",
    tags: ["tacdong", "hieuqua", "quangcao"],
  },
  "the-ploughmans-advertising": {
    titleVi: "MÓN QUẢNG CÁO BÁNH MÌ CÀY RUỘNG",
    tags: ["marketing", "dinhvi", "cauchuyen"],
  },
  "dont-regret-what-you-wish-youd-done": {
    titleVi: "ĐỪNG TIẾC NUỐI NHỮNG GÌ BẠN ĐÃ KHÔNG DÁM LÀM",
    tags: ["dandao", "hanhdong", "cuocsong"],
  },
  "move-the-problem-up-the-list": {
    titleVi: "ĐƯA VẤN ĐỀ LÊN ĐẦU DANH SÁCH",
    tags: ["uutien", "giaiquyet", "tuduy"],
  },
  "how-to-grow-your-own-market": {
    titleVi: "CÁCH TỰ NUÔI DƯỠNG THỊ TRƯỜNG CỦA CHÍNH BẠN",
    tags: ["thitruong", "phattrien", "chienthuat"],
  },
  "what-sort-of-planners-do-creatives-want-to-work-with": {
    titleVi: "DÂN SÁNG TẠO THÍCH LÀM VIỆC VỚI KIỂU PLANNER NÀO?",
    tags: ["planner", "creative", "hopnhac"],
  },
  "whats-life-like-outside-the-echo-chamber": {
    titleVi: "CUỘC SỐNG BÊN NGOÀI CĂN PHÒNG DỘI ÂM NHƯ THẾ NÀO?",
    tags: ["gocnhin", "thucte", "tuduy"],
  },
  "whats-in-it-for-me-50": {
    titleVi: "TÔI CÓ ĐƯỢC GÌ TỪ ĐÓ?",
    tags: ["tamly", "khachhang", "thaucam"],
  },
};

async function main() {
  console.log("🚀 Bắt đầu cập nhật toàn bộ 50 bài viết sang PUBLISHED...");

  const articles = await prisma.creativeArticle.findMany({
    orderBy: { createdAt: "asc" },
  });

  const baseDate = new Date();
  baseDate.setHours(0, 0, 0, 0);

  let updated = 0;

  for (let i = 0; i < articles.length; i++) {
    const article = articles[i];
    const info = TITLE_VI_MAP[article.slug] || {
      titleVi: article.originalTitle,
      tags: ["sangtao", "tuduy"],
    };

    // Đặt ngày phát hành lùi dần theo thứ tự (ngày hôm nay đến các ngày trước)
    const pubDate = new Date(baseDate);
    pubDate.setDate(pubDate.getDate() - (articles.length - 1 - i));

    await prisma.creativeArticle.update({
      where: { id: article.id },
      data: {
        status: "PUBLISHED",
        titleVi: info.titleVi,
        tags: info.tags,
        publishedDate: pubDate,
      },
    });

    updated++;
    console.log(`✅ [${i + 1}/${articles.length}] Đã publish: ${article.originalTitle} -> ${info.titleVi}`);
  }

  console.log(`\n🎉 Hoàn thành publish ${updated} bài viết!`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

