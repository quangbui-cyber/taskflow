/**
 * Script seed bản dịch mẫu cho 5 bài viết Dave Trott đầu tiên
 * Chuẩn staccato 1:1, giọng điệu sắc sảo, câu cú đanh thép.
 *
 * Chạy lệnh: npx tsx scripts/seed-initial-creative.ts
 */

import { prisma } from "../lib/prisma";
import { type ArticleLine, getWeekdaySchedule } from "../lib/creative";

interface SeedArticle {
  slug: string;
  titleVi: string;
  tags: string[];
  linesVi: ArticleLine[];
}

const ARTICLES_TO_SEED: SeedArticle[] = [
  {
    slug: "the-first-lesson-is-no-ones-even-looking",
    titleVi: "BÀI HỌC ĐẦU TIÊN: CHẲNG AI THÈM NHÌN CẢ",
    tags: ["sangtao", "tuduy", "quangcao"],
    linesVi: [
      { t: "Nhiều năm trước, hồi bố tôi còn rất trẻ, ông đi làm cảnh sát." },
      { t: "Ngay ngày tập huấn đầu tiên, họ tập trung tất cả tân binh vào một phòng học để làm bài kiểm tra." },
      { t: "Họ xếp mỗi người một bàn với một tờ giấy và một cây bút chì, viên trung sĩ đứng nghiêm trên bục giảng." },
      { t: "Trước khi bài thi bắt đầu, có một người đàn ông bước vào đưa món đồ gì đó cho viên trung sĩ." },
      { t: "Ngay khi người kia vừa bước ra, trung sĩ liền nói, **“Được rồi, bài kiểm tra bắt đầu.**" },
      { t: "**Hãy viết lại mô tả về người đàn ông vừa bước vào: cao bao nhiêu, tầm mấy tuổi, có để râu không, quần áo màu gì, có đeo cà vạt không, tóc màu gì, đi giày loại gì, từng chi tiết một.** **Bắt đầu đi.”**" },
      { t: "Bố tôi kể mọi người đều bồn chồn cựa quậy nhưng chẳng một ai đặt bút viết." },
      { t: "Họ chẳng nhận ra bất cứ điều gì về người đàn ông đó vì trước đó đâu có ai bảo họ phải chú ý." },
      { t: "Thế nên họ chẳng để ý thấy một thứ gì cả." },
      { t: "Họ không chú ý đơn giản vì chẳng ai dặn họ phải làm thế." },
      { t: "Cuối cùng viên trung sĩ cất giọng, **“Được rồi, các anh trượt hết vì các anh đang tư duy như dân thường. Người bình thường ra đường chẳng bao giờ để ý thứ gì không liên quan đến họ. Các anh không được phép làm như thế. Kể từ giờ các anh là cảnh sát, và điều đó có nghĩa là các anh phải để ý tuyệt đối *mọi thứ*.”**" },
      { t: "Tôi nghĩ đó là một bài học đắt giá cho những người làm quảng cáo." },
      { t: "Ước gì người ta dạy bài học này cho người mới vào nghề, nhưng theo chiều ngược lại." },
      { t: "Ước gì họ dạy cho những ai vừa chập chững bước chân vào ngành rằng: người bình thường chẳng bao giờ để ý thứ gì cả." },
      { t: "Và chắc chắn họ chẳng thèm để tâm đến quảng cáo." },
      { t: "Tôi thấy đa phần dân trong ngành cứ tin rằng người thường sẽ thấy mọi mẫu quảng cáo và nghiên cứu từng mẫu một cách cẩn thận." },
      { t: "Nhưng nhiều năm trước, những con số thực tế tôi nhận được là thế này:" },
      { t: "**Khoảng 20 TỶ BẢNG được chi cho mọi loại hình quảng cáo tại Anh mỗi năm.**" },
      { t: "**Nghĩa là trung bình mỗi người chúng ta va phải chừng 1.000 mẩu quảng cáo mỗi ngày.**" },
      { t: "**Trong số đó, 4% được nhớ theo hướng tích cực và 7% bị nhớ theo hướng tiêu cực.**" },
      { t: "**Nhưng con số cốt tử là – 89% quảng cáo không hề được chú ý hay nhớ tới.**" },
      { t: "Tức là cứ khoảng 9 trên 10 quảng cáo hoàn toàn vô hình, chúng chỉ là mớ giấy dán tường." },
      { t: "Đó chính xác là bài học bố tôi đã nhận ra trong buổi huấn luyện cảnh sát đầu tiên." },
      { t: "Chẳng có ai thèm nhìn cả." },
      { t: "Mấy cậu cảnh sát tập sự cứ đinh ninh khi nào được nhắc thì họ mới bắt đầu quan sát." },
      { t: "Điểm mấu chốt ở đây là chứng minh rằng vốn dĩ chẳng có ai *bao giờ* tự nhiên để ý cả." },
      { t: "Nhưng cảnh sát thì bắt buộc phải liên tục quan sát. Họ không thể hành xử như người thường." },
      { t: "Còn đối với chúng ta, bài học lại đi theo chiều ngược lại: người thường chẳng hề để ý như chúng ta ảo tưởng đâu." },
      { t: "Chúng ta cứ mặc định người ta sẽ nhìn thấy quảng cáo của mình, rồi dồn hết thời gian cãi nhau về ba cái chi tiết vụn vặt." },
      { t: "Bởi vì chẳng có ai dạy cho ta sự thật: người đời KHÔNG để ý quảng cáo." },
      { t: "Trừ khi chúng ta *bắt* họ phải chú ý." },
      { t: "Và ta bắt họ phải nhìn bằng cách đảm bảo quảng cáo của mình không giống bất cứ thứ gì khác, không lẫn vào đống giấy dán tường." },
      { t: "Bởi vì nếu họ không nhìn thấy, thì mọi tư duy chiến lược tài tình sẽ chẳng bao giờ được ai biết tới." },
      { t: "Mọi tư duy chiến lược đỉnh cao chỉ là thứ phí phạm thời gian." },
      { t: "*Trừ khi* mẩu quảng cáo đó thực sự bật hẳn lên khỏi phần còn lại." },
      { t: "Chúng ta vẫn chưa chịu học điều mà Bill Bernbach đã cố dạy từ nhiều năm trước:" },
      { t: "**“Nếu không ai để ý đến quảng cáo của bạn, thì mọi thứ khác chỉ là mớ lý thuyết suông.”**" },
    ],
  },
  {
    slug: "turning-the-tables",
    titleVi: "LẬT NGƯỢC THẾ CỜ",
    tags: ["sangtao", "tuduy", "thaimo"],
    linesVi: [
      { t: "Hồi Nick Wray làm giám đốc sáng tạo, cậu ấy nhận một cặp sinh viên nữ vào thực tập hai tuần." },
      { t: "Bình thường tôi không hay làm vậy, tôi chẳng bao giờ kỳ vọng nhiều vào mấy nhóm sinh viên." },
      { t: "Nhưng Nick nói đúng, Anna và Elaine rất khác biệt. Họ đến đây là để làm việc thực sự." },
      { t: "Trong suốt hai tuần đó, họ vồ lấy mọi đề bài có sẵn và họ thực sự đã bán được vài mẩu quảng cáo." },
      { t: "Chúng tôi chưa từng thấy chuyện đó bao giờ, nên chúng tôi đề nghị cho họ thực tập thêm hai tuần nữa." },
      { t: "Trong đợt tiếp theo này, họ thậm chí đã có những mẩu quảng cáo được *lên sóng* thực tế, mà lại là quảng cáo rất chất lượng." },
      { t: "Họ cho ra lò nhiều sản phẩm đến mức chúng tôi đã làm một việc chưa từng có tiền lệ: hỏi xem họ có muốn ở lại thêm *hai tuần nữa* không." },
      { t: "Lần này họ thậm chí còn bán được và sản xuất luôn cả một phim quảng cáo truyền hình. Họ làm việc như một cơn lốc." },
      { t: "Thế là chúng tôi lại đề nghị họ ở lại thực tập thêm *hai tuần nữa*." },
      { t: "Và chính lúc này, họ đã lật ngược thế cờ với chúng tôi." },
      { t: "Anna nói thẳng, **“Bọn em cũng muốn lắm, nhưng có vẻ công ty không có vị trí chính thức nào cho bọn em, nên bọn em sẽ sang thực tập ở chỗ khác. Và bọn em sẽ tiếp tục làm thế cho đến khi tìm được một agency trao cho bọn em hợp đồng chính thức.”**" },
      { t: "Khoan đã, câu nói đó thay đổi hoàn toàn cục diện." },
      { t: "Thay vì chỉ ban phát cho họ thêm hai tuần thực tập, giờ đây chúng tôi phải đối mặt với một thực tế: chúng tôi không thể để mất họ." },
      { t: "Họ tạo ra nhiều việc hiệu quả hơn cả mấy nhóm nhân viên toàn thời gian đang ngồi ở đây." },
      { t: "Bằng cách làm việc hết mình đến cháy máy, họ đã ném ngược một bài toán khó về phía chúng tôi." },
      { t: "Chúng tôi không thể để Anna và Elaine rời đi." },
      { t: "Tôi bàn lại với Gordon và cả hai đều đồng thuận: chính họ đã ép chúng tôi phải ký hợp đồng chính thức bằng cách lật ngược thế cờ." },
      { t: "Đó chính là điều chúng tôi trân trọng nhất: thái độ của Anna và Elaine." },
      { t: "Họ không coi mình là mấy cô sinh viên ngây thơ đi xin xỏ ân huệ, họ định vị mình là dân chuyên nghiệp và họ chẳng xin xỏ bất cứ điều gì." },
      { t: "Họ chứng minh cho chúng tôi thấy năng lực của họ rồi cứ thế để chúng tôi tự quyết định." },
      { t: "Họ lật ngược tình thế từ chỗ họ phải xin thực tập thành việc chúng tôi phải nài nỉ họ ở lại." },
      { t: "Quảng cáo đỉnh cao nhất cũng phải như vậy." },
      { t: "Lật ngược thế cờ chính là điều Bill Bernbach đã dạy chúng ta, đó là nơi niềm vui bắt đầu." },
      { t: "Đó là điều những người giỏi nhất trong ngành này luôn luôn làm." },
      { t: "Kẻ tí hon thách thức gã khổng lồ." },
      { t: "Thương hiệu thách thức đối đầu trực diện với kẻ dẫn đầu thị trường." },
      { t: "Đó mới là cái thú, chứ không phải chuyện giữ khư khư hiện trạng an toàn hay chỉ biết đá quả bóng trách nhiệm đi xa thêm một chút. Làm thế thì chẳng có gì thú vị cho bất kỳ ai." },
      { t: "Thái độ của những mẩu quảng cáo xuất sắc nhất phải giống hệt như Anna và Elaine." },
      { t: "Bởi vì điểm quyến rũ nhất ở một con người chính là sự tự tin. Và sự tự tin tạo nên khí chất." },
      { t: "Như Beyoncé từng cất giọng hát:" },
      { t: "“IF YOU LIKE IT THEN YOU SHOULD HAVE PUT A RING ON IT.”" },
      { gap: true },
      { t: "(nhân tiện: vài năm sau đó, chúng tôi đã cất nhắc Anna lên làm giám đốc sáng tạo)" },
    ],
  },
  {
    slug: "wrong-problem-wrong-solution",
    titleVi: "SAI VẤN ĐỀ = SAI GIẢI PHÁP",
    tags: ["tuduy", "gocnhin", "chienthuat"],
    linesVi: [
      { t: "Khi trẻ con bắt đầu biết nói, một trong những câu đầu tiên chúng hỏi liên tục là: **“Tại sao?”**" },
      { t: "Và khi bạn đưa ra câu trả lời, phản ứng tiếp theo của chúng lại là: **“Tại sao?”**" },
      { t: "Dường như chẳng có điểm dừng cho số lần chúng cất tiếng hỏi: **“Tại sao?”**" },
      { t: "Điều đó thật phiền toái, nên khi lớn lên chúng ta học cách ngừng làm việc đó." },
      { t: "Thế nhưng có một giá trị cực lớn nằm trong câu hỏi đơn giản này." },
      { t: "Sakichi Toyoda, nhà sáng lập hãng Toyota, đã phát triển hệ thống **‘5 Câu Hỏi Tại Sao’**, biến nó thành cốt lõi của quy trình sản xuất nhằm tìm ra nguyên nhân gốc rễ của các trục trặc kỹ thuật và chất lượng." },
      { t: "Sức mạnh thực sự của phương pháp này là nó không đưa ra những giải pháp đối phó tức thời trước các triệu chứng ngắn hạn, mà nó bóc trần nguyên nhân gốc rễ." },
      { t: "Một ví dụ điển hình cho cách hoạt động này là Đài tưởng niệm Jefferson, khi công trình bắt đầu xuống cấp và Cục Quản lý Công viên Quốc gia quyết định áp dụng 5 Tại Sao:" },
      { t: "Hỏi) **“*Tại sao* đài tưởng niệm lại bắt đầu xuống cấp?”**" },
      { t: "Đáp) Do các loại hoá chất tẩy rửa mạnh." },
      { t: "Hỏi) **“*Tại sao* đài tưởng niệm lại phải tẩy rửa thường xuyên đến thế?”**" },
      { t: "Đáp) Vì nó liên tục bị phủ đầy phân chim." },
      { t: "Hỏi) **“*Tại sao* lại có nhiều phân chim đến vậy?”**" },
      { t: "Đáp) Vì lũ chim bị thu hút đến đây." },
      { t: "Hỏi) **“*Tại sao* lũ chim lại bị thu hút đến đây?”**" },
      { t: "Đáp) Vì có hàng đàn côn trùng bu kín quanh đó." },
      { t: "Hỏi) **“*Tại sao* lại có nhiều côn trùng bu quanh đến thế?”**" },
      { t: "Đáp) Vì dàn đèn pha chiếu sáng thu hút chúng." },
      { t: "Hóa ra nguyên nhân gốc rễ của vấn đề là do dàn đèn pha thu hút côn trùng vào lúc chạng vạng tối, đúng thời điểm côn trùng bay ra giao phối." },
      { t: "Thế là họ dời giờ bật đèn trễ hơn nửa tiếng, sau khi trời đã tối hẳn và lũ côn trùng đã tản đi hết." },
      { t: "**Ngay lập tức lượng phân chim giảm tới 85%.**" },
      { t: "Hết côn trùng – hết chim." },
      { t: "Hết chim – hết phân chim." },
      { t: "Hết phân chim – không cần hoá chất tẩy rửa mạnh." },
      { t: "Không tẩy rửa – không còn bào mòn hư hại." },
      { t: "Và câu trả lời chính xác chỉ xuất hiện nhờ việc kiên trì liên tục hỏi “Tại sao?”" },
      { t: "Hỏi tại sao không trực tiếp mang lại giải pháp ngay cho bạn, nhưng nó đảm bảo bạn xác định đúng vấn đề cốt lõi cần giải quyết." },
      { t: "Chúng ta rất cần sự tinh giản, kỷ luật và rõ ràng của 5 Câu Hỏi Tại Sao trong công việc của mình." },
      { t: "Hiện tại chúng ta toàn nhảy bổ ngay vào kết luận và bỏ qua tiến trình logic từng bước." },
      { t: "*Chúng ta thà sai cho thật nhanh còn hơn là đúng một cách cẩn trọng.*" },
      { t: "Bởi vì chúng ta coi câu trả lời là sức mạnh, còn câu hỏi là sự yếu đuối." },
      { t: "Nhiệm vụ của người làm chiến lược là chỉ ra đúng vấn đề, tìm ra nguyên nhân gốc rễ, rồi mới trao đề bài đó cho bộ phận sáng tạo." },
      { t: "Chứ không phải nhảy bổ vào ‘insight thương hiệu’ theo phản xạ – cùng một công thức sáo mòn như mọi chuyên gia chiến lược khác." },
      { t: "Dùng 5 Tại Sao buộc người làm chiến lược phải nghĩ ra giải pháp thực sự hiệu quả thay vì chỉ sao chép trào lưu nhất thời." },
      { t: "Đúng như Albert Einstein từng nói:" },
      { t: "**“Nếu có một giờ để giải quyết một vấn đề, tôi sẽ dành 55 phút để nghĩ về vấn đề và 5 phút cho giải pháp.”**" },
      { t: "Bởi vì nếu bạn xác định đúng vấn đề, giải pháp sẽ vô cùng đơn giản và hiệu quả." },
      { t: "Còn nếu bạn xác định sai vấn đề, thì chẳng có giải pháp nào cứu vãn nổi." },
    ],
  },
  {
    slug: "knowing-everyone-elses-job-is-an-unfair-advantage",
    titleVi: "HIỂU VIỆC CỦA NGƯỜI KHÁC LÀ MỘT LỢI THẾ BẤT CÔNG",
    tags: ["chuyennghiep", "tuduy", "hieuqua"],
    linesVi: [
      { t: "Năm 1965, Jim Clark đang dẫn đầu giải đua xe Công thức 1 British Grand Prix." },
      { t: "Ông luôn thích tạo ra khoảng cách dẫn đầu thật lớn càng nhanh càng tốt. Ông chẳng thích giữ lại chút sức nào cho khúc sau." },
      { t: "Ông thừa hiểu những chiếc xe Công thức 1 phải chịu áp lực kinh khủng thế nào, và chỉ sau vài chục vòng đua hết ga hết số, máy móc sẽ bắt đầu hỏng hóc hoặc mài mòn." },
      { t: "Vì thế ông luôn cố gắng tạo khoảng cách ngay từ vạch xuất phát, khi chiếc xe vẫn còn ở phong độ tốt nhất." },
      { t: "Và điều đó đã cứu ông, bởi khi ông đang dẫn trước đối thủ tới 35 giây ở khoảng giữa chặng đua, rắc rối bắt đầu ập tới." },
      { t: "Động cơ của ông bắt đầu bị rò rỉ dầu nhớt, với máy Công thức 1 thì đây là hung tin." },
      { t: "Lý do những chiếc xe đó gầm rú như thét xé tai là vì động cơ quay nhanh hơn gấp nhiều lần động cơ xe thông thường." },
      { t: "Điều đó nghĩa là nó chạy ở nhiệt độ cực nóng, và thứ duy nhất bôi trơn mọi chi tiết quay tít chính là dầu nhớt." },
      { t: "Không có bôi trơn, các linh kiện quay sẽ quá nhiệt, giãn nở và động cơ sẽ kẹt cứng ngay lập tức." },
      { t: "Clark hiểu rất rõ điều này khi nhìn kim đồng hồ áp suất dầu tụt dốc thê thảm. Nhưng khác với đa số tay đua khác, Clark hiểu tường tận động cơ từ trong ra ngoài." },
      { t: "Và ông nhận thấy kim áp suất dầu tụt sâu nhất ở các khúc cua." },
      { t: "Clark lớn lên từ công việc lái máy cày trên trang trại của gia đình ở Scotland. Ông biết nếu áp suất tụt ở khúc cua, nghĩa là lực ly tâm đang đẩy dầu văng xa khỏi ống hút dầu." },
      { t: "Thế nên ông tính toán rằng mình phải tìm cách nâng niu chiếc xe khi vào cua." },
      { t: "Và đó là lúc lợi thế dẫn trước 35 giây mà ông tích lũy từ đầu phát huy tác dụng sống còn." },
      { t: "Ông bắt đầu về số 0 (mo) mỗi khi vào cua, để động cơ chỉ quay cầm chừng và không đòi hỏi quá nhiều áp suất dầu." },
      { t: "Rồi ông lại đạp mạnh vào số ở những đoạn đường thẳng, nơi lực ly tâm không còn tác động và dầu lại ùa về ống nạp." },
      { t: "Tất nhiên chiến thuật này khiến ông mất thời gian, ông ôm cua mà không có lực kéo động cơ, mất đứt hai giây mỗi vòng và Graham Hill trên chiếc BRM đang rút ngắn khoảng cách từng vòng một." },
      { t: "Khi còn 6 vòng đua, khoảng cách dẫn đầu của Clark chỉ còn 19 giây." },
      { t: "Khi còn 2 vòng đua, khoảng cách rút xuống còn 9,6 giây." },
      { t: "Đến vòng cuối cùng, khoảng cách chỉ còn đúng 6 giây." },
      { t: "Và Clark đã cán đích trước Graham Hill vỏn vẹn 3,2 giây." },
      { t: "Nhờ sự am hiểu chi tiết đến mức đó, năm ấy Clark giành chức Vô địch Thế giới Công thức 1 và sau đó ẵm luôn giải Indianapolis 500." },
      { t: "Trong danh sách những tay đua Công thức 1 xuất sắc nhất mọi thời đại, tờ The Times đã xếp Clark ở vị trí số một vĩ đại nhất." },
      { t: "Không chỉ vì kỹ năng cầm lái xuất chúng của ông." },
      { t: "Thứ giúp ông lái được như vậy là vì ông nắm rõ từng chi tiết cơ khí của cỗ xe. Ông không chỉ biết việc của mình, ông biết tường tận việc của những người khác, đó chính là lợi thế của ông." },
      { t: "Trong khi một tay đua khác sẽ tấp xe vào trạm kỹ thuật bỏ cuộc, Clark biết mình có thể về số 0 khi vào cua vì ông hiểu động cơ chẳng kém gì bất kỳ người thợ máy nào." },
      { t: "Đó luôn là vũ khí bí mật của chúng ta: am hiểu công việc của bất kỳ ai có tác động đến sản phẩm của mình." },
      { t: "Đối với chúng ta, dĩ nhiên đó là đạo diễn, nhiếp ảnh gia, chuyên gia thiết kế chữ, họa sĩ diễn hoạt, họa sĩ minh họa." },
      { t: "Nhưng nếu chúng ta khôn ngoan, đó còn là chuyên gia chiến lược, chuyên viên truyền thông, quản lý khách hàng và cả chính khách hàng." },
      { t: "Nếu ta hiểu việc của họ, ta sẽ chủ động đưa ra những quyết định tác động trực tiếp đến bản thân và sản phẩm của mình, thay vì phó mặc hoàn toàn cho họ." },
      { t: "Tôi đã chứng kiến điều này vô số lần, chúng tôi thường đánh bại các agency khác vì chúng tôi chịu nhìn vào những ngóc ngách mà họ bỏ qua." },
      { t: "Họ không thèm nhìn vào những ngóc ngách đó vì họ nghĩ đó chẳng phải phận sự của họ." },
      { t: "Thì họ nói đúng đấy, đó đâu phải việc của họ." },
      { t: "Và đó chính là lý do việc am hiểu nó đem lại cho chúng ta một lợi thế hoàn toàn bất công." },
    ],
  },
  {
    slug: "what-ai-cant-think-of",
    titleVi: "THỨ MÀ AI KHÔNG THỂ NGHĨ RA",
    tags: ["sangtao", "tuduy", "congnghe"],
    linesVi: [
      { t: "Năm 1981, MTV ra đời: một kênh truyền hình cáp không có gì ngoài âm nhạc thịnh hành, chủ yếu là rock & roll." },
      { t: "Vấn đề là thời đó video âm nhạc chưa hề tồn tại, chẳng ai sản xuất chúng vì làm gì có chỗ nào để phát. Cho nên một kênh truyền hình chiếu những video không tồn tại là một ý tưởng ngớ ngẩn, chẳng ai thèm ngó ngàng." },
      { t: "Các nhà xuất bản âm nhạc thì bảo kênh này sẽ bóp chết việc kinh doanh của họ, ai mà thèm mua đĩa hát nữa nếu họ có thể xem miễn phí trên tivi?" },
      { t: "Các hãng thu âm cười nhạo ý tưởng phải sản xuất video ca nhạc không công." },
      { t: "Khách hàng và các công ty quảng cáo thì không thấy có lý do gì để đặt quảng cáo trên một kênh chỉ toàn phát bài hát." },
      { t: "Các nhà đài truyền hình cáp thì bảo nó chẳng có lợi ích gì hơn đài phát thanh ca nhạc, ai lại rỗi hơi ngồi một chỗ để ngắm âm nhạc?" },
      { t: "MTV đã chi cả một gia tài cho quảng cáo nhưng chẳng có mẩu nào hiệu quả. Sau một năm MTV hấp hối vì các công ty truyền hình cáp kiên quyết không thèm tiếp sóng." },
      { t: "Đó là lúc họ cầu cứu George Lois." },
      { t: "Đối với Lois, quảng cáo không phải là ngành kinh doanh một chiều đơn điệu như đa số chúng ta vẫn nghĩ. Với ông, quảng cáo hoạt động ở bất cứ ngóc ngách nào bạn có thể tưởng tượng ra." },
      { t: "Phần sáng tạo là phải nghĩ ra một thứ mà không một ai khác dám bén mảng nghĩ tới." },
      { t: "Ông định nghĩa lại bài toán của MTV: *Các anh đang có nguồn cung mà không có nguồn cầu. Chúng ta cần tạo ra một lực cầu khủng khiếp đến mức các nhà đài truyền hình cáp buộc phải cung cấp.*" },
      { t: "MTV lúc đó chẳng có lấy một mống khách hàng. Lois liền bảo: đó chính là ý tưởng." },
      { t: "Ông sẽ dùng chính những người-chưa-phải-là-khách-hàng để làm quảng cáo." },
      { t: "Lũ trẻ không thể xem MTV vì các nhà đài cáp không chịu tiếp sóng. Thế là Lois quyết định khẩu hiệu hiệu triệu sẽ là: **“I want my MTV”** (Tôi muốn kênh MTV của tôi)." },
      { t: "Ông quyết định đánh thẳng vào đỉnh cao nhất, và trong làng rock & roll, đỉnh cao nhất chính là Mick Jagger." },
      { t: "Lois mời ông ấy đóng một đoạn quảng cáo ra mắt, nhưng Jagger gạt phắt: **“Không đời nào, ban nhạc The Stones không bao giờ đi làm quảng cáo”.**" },
      { t: "Lois liền giải thích rằng đây đâu phải việc ban nhạc The Stones đi quảng cáo cho ai khác. MTV sẽ phát nhạc của The Stones, nghĩa là đây là quảng cáo cho chính The Stones, và nó sẽ bán được hàng đống đĩa hát của The Stones." },
      { t: "Và tất cả những gì ông cần Jagger làm chỉ là nói đúng 4 từ." },
      { t: "Thế là Mick Jagger đồng ý đọc lại đúng câu đó trước ống kính máy quay, chỉ thế thôi, không thêm bất cứ thứ gì." },
      { t: "Rồi họ tung mẩu quảng cáo với lời dẫn:" },
      { t: "Giọng đọc: **“Nếu nơi bạn ở chưa có MTV, hãy nhấc máy gọi cho nhà đài truyền hình cáp và hét lên…**" },
      { t: "Mick Jagger (hét thẳng vào ống nghe:) **“I want my MTV”**" },
      { t: "Ngay khi thấy Mick Jagger làm điều đó, tất cả các ngôi sao nhạc rock khác đều muốn nhảy vào tham gia: Pete Townshend, David Bowie, Sting, George Michael, Michael Jackson, Madonna, Dire Straits, Pat Benatar, Stevie Nicks, Lionel Richie, Hall & Oates, Tears for Fears, Cyndi Lauper, ZZ Topp, Eurythmics, Billy Idol, Boy George, The Thunderbirds, Van Halen, Huey Lewis and the News, The Cars…." },
      { t: "Tất cả bọn họ đều đồng thanh bảo lũ trẻ hãy gọi ngay cho nhà đài truyền hình cáp và gào lên: **“I want my MTV”.**" },
      { t: "Ngay lập tức, hàng triệu đứa trẻ bắt đầu gọi điện dồn dập đến các nhà đài cáp đến mức nghẽn toàn bộ đường dây. Các giám đốc đài cáp bắt đầu gọi ngược lại cho MTV van nài: **“Chúng tôi sẽ tiếp sóng kênh của các anh, làm ơn dừng phát mấy mẩu quảng cáo chết tiệt đó đi!”**" },
      { t: "Chỉ trong vài tháng ngắn ngủi, MTV đã phủ sóng tới 80% mọi hộ gia đình." },
      { t: "Các hãng thu âm đổ xô tranh nhau làm video âm nhạc để được phát trên kênh." },
      { t: "Các thương hiệu và công ty quảng cáo coi MTV là kênh bắt buộc phải mua sóng nếu muốn tiếp cận đối tượng khán giả từ 14 đến 28 tuổi." },
      { t: "Rồi ban nhạc Dire Straits phát hành đĩa đơn ‘Money for Nothing’ mở đầu và kết thúc bằng giọng hát da diết của Sting với câu: **“I want my MTV”.**" },
      { t: "Bản nhạc đó bán được 4,8 triệu bản và được phát đi phát lại không biết bao nhiêu lần trên sóng phát thanh, và mỗi lần phát như thế lại là một mẩu quảng cáo hoàn toàn miễn phí cho MTV." },
      { t: "Tạp chí Time gọi MTV là **“hiện tượng văn hóa đại chúng ngoạn mục nhất kể từ khi truyền hình cáp xuất hiện – và có lẽ, kể từ khi chính chiếc tivi được phát minh.”**" },
      { t: "Và MTV chỉ tồn tại được là nhờ George Lois đã tạo ra một cơn bão quảng cáo miễn phí khổng lồ." },
      { t: "Một thứ quảng cáo mà thoạt nhìn còn chẳng giống quảng cáo." },
      { t: "Và tôi dám cam đoan với bạn, AI sẽ không bao giờ có thể nghĩ ra nổi một nước đi như thế." },
    ],
  },
];

async function main() {
  console.log("🚀 Bắt đầu seed 5 bài viết Dave Trott mẫu...");

  // Tạo lịch phát hành các ngày làm việc (Thứ 2 - Thứ 6)
  // Bài 1 là hôm nay (PUBLISHED)
  // Các bài sau là SCHEDULED
  const scheduleDates = getWeekdaySchedule(new Date(), ARTICLES_TO_SEED.length);

  for (let i = 0; i < ARTICLES_TO_SEED.length; i++) {
    const item = ARTICLES_TO_SEED[i];
    const pubDate = scheduleDates[i];
    const status = i === 0 ? "PUBLISHED" : "SCHEDULED";

    const article = await prisma.creativeArticle.findUnique({
      where: { slug: item.slug },
    });

    if (!article) {
      console.warn(`Không tìm thấy bài với slug: ${item.slug}. Vui lòng chạy ingest trước.`);
      continue;
    }

    const origLines = article.originalLines as unknown as ArticleLine[];
    if (origLines.length !== item.linesVi.length) {
      console.warn(
        `⚠️ Cảnh báo số dòng bài ${item.slug}: Gốc ${origLines.length} dòng, Dịch ${item.linesVi.length} dòng`
      );
    }

    await prisma.creativeArticle.update({
      where: { slug: item.slug },
      data: {
        titleVi: item.titleVi,
        linesVi: item.linesVi as unknown as object[],
        tags: item.tags,
        status,
        publishedDate: pubDate,
      },
    });

    console.log(
      `✅ [${status}] Đã cập nhật "${item.titleVi}" (Ngày: ${pubDate.toISOString().slice(0, 10)}) - ${item.linesVi.length} dòng`
    );
  }

  console.log("\n🎉 Seed 5 bài viết thành công!");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

