const VN_OFFSET_MS = 7 * 60 * 60 * 1000;

export const DAILY_INSPIRATIONS = [
  "Bắt đầu nhỏ, nhưng bắt đầu ngay.",
  "Hôm nay là một cơ hội mới để tiến lên.",
  "Làm tốt một việc quan trọng trước tiên.",
  "Mỗi bước nhỏ đều đưa bạn gần mục tiêu hơn.",
  "Tiến bộ đều đặn quan trọng hơn hoàn hảo.",
  "Sự tập trung hôm nay tạo nên kết quả ngày mai.",
  "Bạn không cần nhanh, bạn chỉ cần tiếp tục.",
  "Một ngày tốt bắt đầu bằng một việc có ý nghĩa.",
  "Hãy biến điều khó thành bước tiếp theo thật rõ ràng.",
  "Năng lượng tốt bắt đầu từ một hành động tích cực.",
  "Kiên trì thêm một chút, kết quả sẽ khác đi.",
  "Chọn điều quan trọng và dành trọn sự chú ý cho nó.",
  "Đi chậm vẫn tốt hơn là đứng yên.",
  "Mỗi việc hoàn thành đều là một lời hứa được giữ.",
  "Hôm nay, hãy tạo ra điều khiến bạn tự hào.",
  "Đừng chờ cảm hứng, hãy bắt đầu để tạo ra cảm hứng.",
  "Một quyết định rõ ràng có thể thay đổi cả ngày làm việc.",
  "Làm điều cần làm, rồi động lực sẽ theo sau.",
  "Tập trung vào điều bạn có thể làm ngay lúc này.",
  "Sự nhất quán âm thầm tạo nên thành quả lớn.",
  "Mỗi thử thách đều chứa một bài học hữu ích.",
  "Hôm nay tốt hơn hôm qua một chút là đủ.",
  "Hãy dành năng lượng cho giải pháp, không phải lo lắng.",
  "Một giờ tập trung có thể thay đổi cả ngày.",
  "Công việc ý nghĩa bắt đầu từ mục tiêu rõ ràng.",
  "Bạn đang xây dựng tương lai bằng những việc làm hôm nay.",
  "Đặt ưu tiên đúng sẽ giúp mọi thứ nhẹ nhàng hơn.",
  "Hãy cho ý tưởng của bạn một cơ hội được bắt đầu.",
  "Việc khó nhất thường chỉ cần một bước đầu tiên.",
  "Mỗi ngày kiên trì là một ngày bạn tiến xa hơn.",
  "Tập trung vào tiến trình, kết quả sẽ dần xuất hiện.",
  "Bạn có thể làm nhiều điều tốt từ một khởi đầu đơn giản.",
  "Chất lượng đến từ sự chú tâm trong từng chi tiết.",
  "Hôm nay là ngày phù hợp để làm điều còn dang dở.",
  "Bình tĩnh, rõ ràng và tiến từng bước một.",
  "Một việc hoàn thành tốt hơn nhiều việc chỉ mới bắt đầu.",
  "Khó khăn hôm nay có thể trở thành kinh nghiệm ngày mai.",
  "Đừng đánh giá thấp sức mạnh của mười phút tập trung.",
  "Hãy làm việc bằng sự chủ động, không bằng sự vội vàng.",
  "Bạn luôn có thể bắt đầu lại từ bước tiếp theo.",
  "Mỗi nỗ lực nghiêm túc đều để lại một giá trị.",
  "Kỷ luật nhỏ mỗi ngày tạo nên tự do lớn về sau.",
  "Hãy để mục tiêu dẫn đường, không để áp lực dẫn dắt.",
  "Tập trung vào điều cần thiết, phần còn lại có thể chờ.",
  "Một tinh thần cởi mở sẽ tìm thấy nhiều cách giải quyết.",
  "Hôm nay, hãy làm điều bạn đã hứa với chính mình.",
  "Sự rõ ràng là khởi đầu của một ngày hiệu quả.",
  "Cứ tiến lên, dù hôm nay chỉ là một bước ngắn.",
  "Kết quả tốt được tạo nên từ những lựa chọn nhỏ đúng đắn.",
  "Hãy biến mục tiêu lớn thành hành động nhỏ hôm nay.",
  "Bạn không cần biết mọi thứ để thực hiện bước đầu tiên.",
  "Một ngày có mục đích luôn đáng giá hơn một ngày bận rộn.",
  "Đôi khi, tiến bộ chỉ đơn giản là không bỏ cuộc.",
  "Hãy hoàn thành trước khi tìm cách hoàn hảo.",
  "Mỗi vấn đề được giải quyết giúp bạn mạnh mẽ hơn.",
  "Sự chuyên tâm biến thời gian thành giá trị.",
  "Hôm nay, hãy góp một điều tích cực cho đội của bạn.",
  "Một lời động viên đúng lúc có thể thay đổi cả ngày.",
  "Cùng nhau tiến lên luôn tốt hơn đi một mình thật nhanh.",
  "Thành công của đội bắt đầu từ trách nhiệm của mỗi người.",
  "Chia sẻ điều bạn biết cũng là một cách để trưởng thành.",
  "Hãy lắng nghe kỹ trước khi tìm lời giải.",
  "Một đồng đội được hỗ trợ sẽ tạo nên một tập thể mạnh hơn.",
  "Sự tử tế làm cho công việc khó trở nên nhẹ nhàng hơn.",
  "Hôm nay, hãy ghi nhận một người đã giúp bạn tiến lên.",
  "Cộng tác tốt bắt đầu bằng sự tin tưởng và rõ ràng.",
  "Ý tưởng tốt hơn khi được chia sẻ và cùng hoàn thiện.",
  "Mỗi đóng góp chân thành đều làm đội nhóm tốt hơn.",
  "Hãy mang đến giải pháp cùng với vấn đề bạn nhìn thấy.",
  "Sự chủ động của bạn có thể mở đường cho cả đội.",
  "Một cuộc trao đổi rõ ràng tiết kiệm rất nhiều thời gian.",
  "Hãy hỏi khi chưa rõ và chia sẻ khi đã hiểu.",
  "Cùng hướng về mục tiêu giúp khác biệt trở thành sức mạnh.",
  "Mỗi ngày làm việc cũng là một ngày học hỏi.",
  "Sai sót được nhìn nhận đúng sẽ trở thành kinh nghiệm.",
  "Hãy tò mò thêm một chút trước điều bạn chưa biết.",
  "Kỹ năng lớn lên khi bạn dám nhận việc khó hơn một chút.",
  "Phản hồi tốt là món quà cho sự tiến bộ.",
  "Mỗi câu hỏi đúng có thể mở ra một hướng đi mới.",
  "Đừng sợ thử cách mới khi cách cũ không còn hiệu quả.",
  "Học một điều nhỏ hôm nay sẽ tạo khác biệt về lâu dài.",
  "Sự linh hoạt giúp bạn đi tiếp khi kế hoạch thay đổi.",
  "Hãy dành thời gian nhìn lại để bước tới tốt hơn.",
  "Trưởng thành bắt đầu khi bạn biến bài học thành hành động.",
  "Một góc nhìn mới có thể làm vấn đề trở nên đơn giản.",
  "Bạn giỏi hơn mỗi khi kiên nhẫn sửa một điều chưa tốt.",
  "Hãy để sự tiến bộ nói thay cho sự nghi ngờ.",
  "Ngày hiệu quả vẫn cần những khoảng nghỉ đúng lúc.",
  "Bình tĩnh giúp bạn nhìn thấy điều vội vàng thường bỏ qua.",
  "Nghỉ một chút để trở lại với sự tập trung tốt hơn.",
  "Giữ nhịp bền vững quan trọng hơn cố gắng quá sức.",
  "Hãy làm việc hết lòng và dành thời gian hồi phục.",
  "Một tâm trí nhẹ nhàng tạo ra quyết định sáng suốt.",
  "Bạn không cần mang mọi việc cùng một lúc.",
  "Hôm nay, hãy chọn nhịp độ giúp bạn đi được đường dài.",
  "Sự cân bằng tốt giúp nỗ lực của bạn có ý nghĩa hơn.",
  "Đôi khi điều năng suất nhất là dừng lại để sắp xếp.",
  "Hãy kết thúc ngày với một điều đã hoàn thành trọn vẹn.",
  "Bạn đã đi xa hơn những gì mình thường nhận ra.",
  "Tin vào quá trình và tiếp tục làm tốt phần của mình.",
] as const;

function vietnamDateParts(date: Date) {
  const vietnamTime = new Date(date.getTime() + VN_OFFSET_MS);
  return {
    day: String(vietnamTime.getUTCDate()).padStart(2, "0"),
    month: String(vietnamTime.getUTCMonth() + 1).padStart(2, "0"),
    year: vietnamTime.getUTCFullYear(),
  };
}

function hashString(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function getDailyInspiration(userId: string, now = new Date()) {
  const { day, month, year } = vietnamDateParts(now);
  const dateKey = `${year}-${month}-${day}`;
  const seed = `${userId}:${dateKey}`;
  const quoteIndex = hashString(seed) % DAILY_INSPIRATIONS.length;
  const formattedDate = new Intl.DateTimeFormat("vi-VN", {
    weekday: "long",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: "Asia/Ho_Chi_Minh",
  }).format(now);

  return {
    quote: DAILY_INSPIRATIONS[quoteIndex],
    dateKey,
    dateLabel: formattedDate.charAt(0).toUpperCase() + formattedDate.slice(1),
    dismissKey: `tf-daily-inspiration:${hashString(`${seed}:dismiss`).toString(36)}`,
  };
}
