export interface AuthorAchievement {
  icon: "award" | "agency" | "book";
  title: string;
  desc: string;
}

export interface AuthorBookDetail {
  code: string;
  title: string;
  sub: string;
}

export interface AuthorProfile {
  slug: string;
  name: string;
  initials: string;
  image: string;
  badge: string;
  specialty: string;
  specialtyHeadline: string;
  role: string;
  location: string;
  origin: string;
  style: string;
  headline: string;
  quote: string;
  intro: string;
  bio: string[];
  perspective: string;
  achievements: AuthorAchievement[];
  milestones: [string, string][];
  books: string[];
  bookDetails: AuthorBookDetail[];
  source: string;
  sourceLabel: string;
}

export const authorProfiles: AuthorProfile[] = [
  {
    slug: "dave-trott",
    name: "Dave Trott",
    initials: "DT",
    image: "/authors/dave-trott.jpg",
    badge: "Huyền thoại quảng cáo Anh Quốc",
    specialty: "Tư duy sáng tạo",
    specialtyHeadline: "Bậc thầy lật ngược tư duy & Nghệ thuật kể chuyện cô đọng",
    role: "Copywriter · Giám đốc sáng tạo · Tác giả",
    location: "Anh Quốc",
    origin: "Đông London & Pratt Institute, New York",
    style: "Ngắn gọn, đòn bẩy, lật ngược vấn đề",
    headline: "Nhìn điều quen thuộc.\nNghĩ điều khác biệt.",
    quote: "Nhìn điều quen thuộc. Nghĩ điều khác biệt.",
    intro: "Những câu chuyện nhỏ, những góc nhìn bất ngờ và một niềm tin: sáng tạo bắt đầu từ cách ta nhìn thế giới.",
    bio: [
      "Được đào tạo tại trường nghệ thuật danh tiếng Pratt Institute (New York) trong cao trào của làn sóng sáng tạo Mỹ thập niên 70, Dave Trott mang tư duy thực chiến trở về London và đồng sáng lập những tên tuổi huyền thoại như BMP và Gold Greenlees Trott (GGT).",
      "Ông nổi tiếng toàn cầu với triết lý Predatory Thinking (Tư duy săn mồi) — biến sự thua thiệt thành lợi thế cạnh tranh áp đảo bằng cách tái định nghĩa câu hỏi cốt lõi thay vì chạy theo lối mòn.",
    ],
    perspective:
      "Các bài viết của Dave Trott không lý thuyết suông. Mỗi câu chuyện chỉ mất vài phút đọc, được ngắt dòng cô đọng, nhưng kết thúc bằng một góc nhìn bất ngờ khiến bạn suy ngẫm cả ngày.",
    achievements: [
      {
        icon: "award",
        title: "D&AD President’s Award (2004)",
        desc: "Giải thưởng cống hiến trọn đời cao quý nhất ngành quảng cáo Anh Quốc vinh danh tư duy sáng tạo đương đại.",
      },
      {
        icon: "agency",
        title: "Đồng sáng lập GGT & BMP",
        desc: "Đưa GGT trở thành “Agency hiệu quả nhất thế giới” (Advertising Age bình chọn) với các chiến dịch kinh điển cho Toshiba, Ariston, Cadbury.",
      },
      {
        icon: "book",
        title: "Tác giả loạt sách kinh điển về tư duy sáng tạo",
        desc: "Tác giả của Predatory Thinking, One Plus One Equals Three và Creative Blindness (And How To Cure It).",
      },
    ],
    milestones: [
      ["Khởi đầu", "Từ Đông London đến trường nghệ thuật Pratt Institute ở New York."],
      ["Làm nghề", "Đồng sáng lập Gold Greenlees Trott (GGT) và các agency sáng tạo hàng đầu."],
      ["2004", "Nhận giải thưởng trọn đời D&AD President’s Award."],
    ],
    books: ["Predatory Thinking", "One Plus One Equals Three", "Creative Blindness (And How To Cure It)"],
    bookDetails: [
      { code: "PT", title: "Predatory Thinking", sub: "Chiến lược & Cạnh tranh" },
      { code: "1+1", title: "One Plus One Equals Three", sub: "Sáng tạo bất quy tắc" },
      { code: "CB", title: "Creative Blindness", sub: "Chữa bệnh mù sáng tạo" },
    ],
    source: "https://www.panmacmillan.com/authors/dave-trott/6788",
    sourceLabel: "Pan Macmillan",
  },
  {
    slug: "john-hegarty",
    name: "Sir John Hegarty",
    initials: "JH",
    image: "/authors/john-hegarty.jpg",
    badge: "Hiệp sĩ Sáng tạo Hoàng gia Anh",
    specialty: "Sáng tạo & thương hiệu",
    specialtyHeadline: "Sự đơn giản táo bạo & Sức mạnh kể chuyện thương hiệu",
    role: "Đồng sáng lập · Bartle Bogle Hegarty (BBH)",
    location: "Anh Quốc",
    origin: "London, Anh Quốc",
    style: "Đi ngược đám đông (When the world zigs, zag)",
    headline: "Một ý tưởng lớn.\nMột cách kể riêng.",
    quote: "Một ý tưởng lớn. Một cách kể riêng.",
    intro: "Một góc nhìn về sự đơn giản, lòng can đảm và sức mạnh của sáng tạo trong xây dựng thương hiệu.",
    bio: [
      "Sir John Hegarty là một trong những tượng đài lớn nhất của ngành quảng cáo thế giới và là đối tác sáng tạo sáng lập của Bartle Bogle Hegarty (BBH) từ năm 1982, đưa hình ảnh Cừu Đen thành biểu tượng của sự khác biệt.",
      "Ông được Nữ hoàng Anh phong tước Hiệp sĩ năm 2007 và là bộ óc đứng sau những chiến dịch bất hủ như “Vorsprung durch Technik” (Audi) và “When the world zigs, zag” (Levi’s).",
    ],
    perspective:
      "Bắt đầu bằng việc làm rõ ý tưởng cốt lõi. Sau đó tự hỏi: mình có thể bỏ bớt điều gì để ý tưởng ấy được nhìn thấy rõ hơn?",
    achievements: [
      {
        icon: "award",
        title: "Tước hiệu Hiệp sĩ Hoàng gia Anh & Cannes Lion of St. Mark",
        desc: "Được phong tước Hiệp sĩ (2007), nhận D&AD President’s Award và giải Sư tử Thánh Mark đầu tiên tại Cannes Lions (2011).",
      },
      {
        icon: "agency",
        title: "Sáng lập đế chế sáng tạo toàn cầu BBH (1982)",
        desc: "Xây dựng Bartle Bogle Hegarty thành một trong những mạng lưới agency sáng tạo danh tiếng nhất thế giới.",
      },
      {
        icon: "book",
        title: "Tác giả Hegarty on Advertising & Hegarty on Creativity",
        desc: "Đúc kết 50 nguyên tắc vàng khuyến khích người làm sáng tạo bỏ bớt sự rườm rà để ý tưởng cốt lõi tỏa sáng.",
      },
    ],
    milestones: [
      ["1982", "Đồng sáng lập Bartle Bogle Hegarty (BBH) tại London."],
      ["Ghi nhận", "Phong tước Hiệp sĩ Hoàng gia Anh, D&AD President’s Award và Cannes Lion of St. Mark."],
      ["2014", "Xuất bản Hegarty on Creativity: There Are No Rules."],
    ],
    books: ["Hegarty on Creativity", "Hegarty on Advertising"],
    bookDetails: [
      { code: "HC", title: "Hegarty on Creativity", sub: "There Are No Rules" },
      { code: "HA", title: "Hegarty on Advertising", sub: "Turning Intelligence Into Magic" },
    ],
    source: "https://www.thamesandhudson.com/products/hegarty-on-creativity",
    sourceLabel: "Thames & Hudson",
  },
  {
    slug: "rory-sutherland",
    name: "Rory Sutherland",
    initials: "RS",
    image: "/authors/rory-sutherland.jpg",
    badge: "Nhà giả kim Khoa học Hành vi",
    specialty: "Khoa học hành vi",
    specialtyHeadline: "Tâm lý học tiêu dùng & Sức mạnh của những giải pháp phi logic",
    role: "Phó Chủ tịch Ogilvy UK · Đồng sáng lập Ogilvy Behavioural Science",
    location: "Anh Quốc",
    origin: "Anh Quốc · Đại học Cambridge",
    style: "Hài hước, sắc sảo, giải quyết vấn đề bằng tâm lý học",
    headline: "Đổi một góc nhìn.\nMở một khả năng.",
    quote: "Đổi một góc nhìn. Mở một khả năng.",
    intro: "Khám phá những thay đổi nhỏ trong bối cảnh có thể tạo ra khác biệt lớn trong cách con người lựa chọn.",
    bio: [
      "Gia nhập Ogilvy từ năm 1988, Rory Sutherland có hơn hai thập kỷ làm copywriter và Tổng giám đốc sáng tạo trước khi sáng lập bộ phận Khoa học Hành vi tại Ogilvy.",
      "Ông chứng minh rằng những thay đổi nhỏ về bối cảnh, ngôn ngữ hay cảm nhận tâm lý thường tạo ra giá trị lớn hơn nhiều so với những cải tiến kỹ thuật tốn kém.",
    ],
    perspective:
      "Trước khi thay đổi sản phẩm, thử thay đổi cách người dùng cảm nhận nó. Một vấn đề tưởng như kỹ thuật đôi khi có thêm một lời giải tâm lý đầy bất ngờ.",
    achievements: [
      {
        icon: "agency",
        title: "Sáng lập thực hành Khoa học Hành vi tại Ogilvy",
        desc: "Tiên phong ứng dụng kinh tế học hành vi và tâm lý học thực nghiệm vào chiến lược thương hiệu toàn cầu.",
      },
      {
        icon: "award",
        title: "Chủ tịch IPA & Diễn giả TED Talks hơn 7 triệu lượt xem",
        desc: "Cựu Chủ tịch Viện Thực hành Quảng cáo Anh Quốc (IPA) và cây bút chuyên mục nổi tiếng “The Wiki Man” trên tạp chí The Spectator.",
      },
      {
        icon: "book",
        title: "Tác giả cuốn sách Bestseller “Alchemy”",
        desc: "Khám phá sức mạnh đáng kinh ngạc của những ý tưởng tưởng chừng phi lý trí trong kinh doanh và đời sống.",
      },
    ],
    milestones: [
      ["1988", "Gia nhập Ogilvy với vai trò thực tập sinh sau khi tốt nghiệp Đại học Cambridge."],
      ["Hành vi", "Đồng sáng lập bộ phận Khoa học Hành vi (Behavioural Science) tại Ogilvy."],
      ["Sách", "Xuất bản hai tác phẩm nổi tiếng The Wiki Man và Alchemy."],
    ],
    books: ["Alchemy", "The Wiki Man"],
    bookDetails: [
      { code: "AL", title: "Alchemy", sub: "Sức mạnh của ý tưởng phi logic" },
      { code: "WM", title: "The Wiki Man", sub: "Tuyển tập góc nhìn hành vi" },
    ],
    source: "https://www.marketingsociety.com/rory-sutherland",
    sourceLabel: "The Marketing Society",
  },
  {
    slug: "bob-hoffman",
    name: "Bob Hoffman",
    initials: "BH",
    image: "/authors/bob-hoffman.jpg",
    badge: "Tiếng nói phản biện ngành quảng cáo",
    specialty: "Góc nhìn phản biện",
    specialtyHeadline: "Lột trần ảo tưởng tiếp thị số & Trở về giá trị thật",
    role: "Tác giả · Diễn giả · The Ad Contrarian",
    location: "Hoa Kỳ",
    origin: "San Francisco, Hoa Kỳ",
    style: "Thẳng thắn, châm biếm sắc bén, dựa trên sự thật",
    headline: "Đặt câu hỏi tốt.\nNhìn quảng cáo rõ hơn.",
    quote: "Đặt câu hỏi tốt. Nhìn quảng cáo rõ hơn.",
    intro: "Một tiếng nói thẳng thắn, liên tục chất vấn những điều ngành marketing thường coi là hiển nhiên.",
    bio: [
      "Bob Hoffman là tác giả và diễn giả hàng đầu về quảng cáo, nổi tiếng toàn cầu với blog The Ad Contrarian. Ông từng là CEO của hai agency độc lập và hoạt động tại Mỹ của một mạng lưới quảng cáo quốc tế.",
      "Các bài viết và buổi diễn thuyết của ông đặt ra những câu hỏi trực diện về sự minh bạch của quảng cáo kỹ thuật số và cách ngành marketing vận hành.",
    ],
    perspective:
      "Dùng mỗi bài viết như một lời nhắc kiểm tra giả định: điều mình đang tin có bằng chứng thực tế hay chỉ được lặp lại đủ nhiều?",
    achievements: [
      {
        icon: "award",
        title: "Diễn giả tại Quốc hội Anh (2021) & Nghị viện Châu Âu (2023)",
        desc: "Chuyên gia độc lập được mời phát biểu về sự minh bạch của hệ sinh thái quảng cáo trực tuyến và dữ liệu người dùng.",
      },
      {
        icon: "agency",
        title: "Cựu CEO Hoffman/Lewis & Sáng lập The Ad Contrarian",
        desc: "Được Business Insider vinh danh là một trong những tiếng nói phản biện có tầm ảnh hưởng sâu rộng nhất ngành quảng cáo.",
      },
      {
        icon: "book",
        title: "Tác giả 6 cuốn sách phản biện quảng cáo",
        desc: "Tiêu biểu với Advertising for Skeptics, BadMen và 101 Contrarian Ideas About Advertising.",
      },
    ],
    milestones: [
      ["Điều hành", "Làm CEO tại agency độc lập Hoffman/Lewis và Mojo USA."],
      ["Viết", "Xây dựng blog phản biện nổi tiếng thế giới The Ad Contrarian."],
      ["2023", "Phát biểu tại Quốc hội Anh (2021) và Nghị viện châu Âu tại Brussels (2023)."],
    ],
    books: ["The Ad Contrarian", "Advertising for Skeptics"],
    bookDetails: [
      { code: "AC", title: "The Ad Contrarian", sub: "Góc nhìn ngược dòng" },
      { code: "AS", title: "Advertising for Skeptics", sub: "Quảng cáo cho người hoài nghi" },
    ],
    source: "https://www.bobhoffmanswebsite.com/",
    sourceLabel: "Website Bob Hoffman",
  },
  {
    slug: "george-lois",
    name: "George Lois",
    initials: "GL",
    image: "/authors/george-lois.jpg",
    badge: "Bố già Cách mạng Sáng tạo Mỹ",
    specialty: "Ý tưởng & thị giác",
    specialtyHeadline: "Ngôn ngữ thị giác táo bạo & Ý tưởng tạo chấn động văn hóa",
    role: "Art Director · Nhà thiết kế · Tác giả",
    location: "Hoa Kỳ",
    origin: "New York, Hoa Kỳ",
    style: "Táo bạo, trực diện, kết hợp hình ảnh và thông điệp sắc lẹm",
    headline: "Ý tưởng táo bạo.\nDấu ấn khó quên.",
    quote: "Ý tưởng táo bạo. Dấu ấn khó quên.",
    intro: "Gặp gỡ một tiếng nói sáng tạo nổi bật của Mỹ qua cách ông kết nối ý tưởng, hình ảnh và thông điệp.",
    bio: [
      "George Lois là huyền thoại dẫn dắt cuộc Cách mạng Sáng tạo trên đại lộ Madison Avenue, người đã định hình văn hóa đại chúng Mỹ qua chiến dịch “I Want My MTV!” và 92 trang bìa tạp chí Esquire trong thập niên 1960–1970.",
      "Trong cuốn cẩm nang Damn Good Advice (For People with Talent!), Lois truyền lửa sáng tạo không thỏa hiệp, đúc kết từ hơn nửa thế kỷ làm nghề.",
    ],
    perspective:
      "Thử diễn đạt ý tưởng bằng một hình ảnh duy nhất. Nếu hình ảnh chưa đủ sức kể chuyện, hãy quay lại với ý tưởng thay vì thêm trang trí.",
    achievements: [
      {
        icon: "award",
        title: "92 bìa tạp chí Esquire trưng bày tại Bảo tàng MoMA",
        desc: "Những trang bìa mang tính biểu tượng thập niên 1960–1970 được Bảo tàng Nghệ thuật Hiện đại New York (MoMA) đưa vào bộ sưu tập vĩnh viễn.",
      },
      {
        icon: "agency",
        title: "Art Directors Hall of Fame & AIGA Lifetime Medal",
        desc: "Người trẻ nhất lịch sử được vinh danh tại Đại sảnh Danh vọng Art Directors cùng giải Thành tựu trọn đời Clio.",
      },
      {
        icon: "book",
        title: "Tác giả cuốn cẩm nang “Damn Good Advice”",
        desc: "Cuốn sách truyền cảm hứng sáng tạo táo bạo cho hàng triệu nhà thiết kế, giám đốc nghệ thuật và người làm truyền thông.",
      },
    ],
    milestones: [
      ["Thiết kế", "Đồng sáng lập Papert Koenig Lois (PKL), tiên phong cuộc Cách mạng Sáng tạo Madison Avenue."],
      ["Esquire", "Thiết kế 92 trang bìa tạp chí Esquire chấn động văn hóa Mỹ (1962–1973)."],
      ["Sách", "Đúc kết bài học sự nghiệp trong Damn Good Advice (For People with Talent!)."],
    ],
    books: ["Damn Good Advice (For People with Talent!)", "$ellebrity"],
    bookDetails: [
      { code: "DG", title: "Damn Good Advice", sub: "For People with Talent!" },
      { code: "$E", title: "$ellebrity", sub: "Nghệ thuật tạo biểu tượng" },
    ],
    source:
      "https://www.phaidon.com/en-int/products/damn-good-advice-for-people-with-talent-how-to-unleash-your-creative-potential-by-americas-master-communicator",
    sourceLabel: "Phaidon",
  },
  {
    slug: "paul-arden",
    name: "Paul Arden",
    initials: "PA",
    image: "/authors/paul-arden.jpg",
    badge: "Phù thủy Sáng tạo Saatchi & Saatchi",
    specialty: "Tư duy khác biệt",
    specialtyHeadline: "Tư duy ngược dòng & Khát vọng vươn tới đỉnh cao",
    role: "Cựu Giám đốc sáng tạo điều hành · Saatchi & Saatchi",
    location: "Anh Quốc",
    origin: "Anh Quốc (1940–2008)",
    style: "Tối giản, khiêu khích tư duy, biến điều không thể thành có thể",
    headline: "Dám nghĩ ngược.\nDám tiến xa hơn.",
    quote: "Dám nghĩ ngược. Dám tiến xa hơn.",
    intro: "Những trang sách ngắn gọn mở ra một cuộc trò chuyện về tham vọng, lựa chọn và sự can đảm khi làm sáng tạo.",
    bio: [
      "Paul Arden (1940–2008) là Giám đốc sáng tạo điều hành huyền thoại làm việc suốt 15 năm tại Saatchi & Saatchi, đưa agency này lên đỉnh cao quyền lực của ngành quảng cáo toàn cầu.",
      "Hai tác phẩm kinh điển của ông — It’s Not How Good You Are, It’s How Good You Want to Be và Whatever You Think, Think the Opposite — gợi mở góc nhìn táo bạo về tham vọng, sai lầm và lòng can đảm nghĩ ngược lại số đông.",
    ],
    perspective:
      "Khi đứng trước một lựa chọn quen thuộc, thử viết ra phương án ngược lại. Không phải để luôn chọn nó, mà để hiểu mình có thể đi xa đến đâu.",
    achievements: [
      {
        icon: "agency",
        title: "15 năm kiến tạo thời kỳ hoàng kim của Saatchi & Saatchi",
        desc: "Đứng sau các chiến dịch biểu tượng quốc gia của Anh Quốc cho British Airways, Silk Cut, Toyota, Anchor và The Independent.",
      },
      {
        icon: "book",
        title: "Tác giả Bestseller triệu bản toàn cầu",
        desc: "Cuốn sách It’s Not How Good You Are, It’s How Good You Want to Be trở thành sách gối đầu giường của giới sáng tạo.",
      },
      {
        icon: "award",
        title: "Triết lý “Think the Opposite” (Nghĩ ngược lại)",
        desc: "Truyền cảm hứng đón nhận rủi ro và dùng sự táo bạo để vượt qua giới hạn thông thường trong công việc.",
      },
    ],
    milestones: [
      ["1940–2008", "Hành trình cuộc đời của một trong những giám đốc sáng tạo có tầm ảnh hưởng lớn nhất Anh Quốc."],
      ["Saatchi", "15 năm giữ vai trò Giám đốc sáng tạo điều hành tại Saatchi & Saatchi."],
      ["2003–2006", "Xuất bản It’s Not How Good You Are... và Whatever You Think, Think the Opposite."],
    ],
    books: ["It’s Not How Good You Are, It’s How Good You Want to Be", "Whatever You Think, Think the Opposite"],
    bookDetails: [
      { code: "HG", title: "It’s Not How Good You Are...", sub: "It’s How Good You Want to Be" },
      { code: "TO", title: "Whatever You Think...", sub: "Think the Opposite" },
    ],
    source: "https://en.wikipedia.org/wiki/Paul_Arden",
    sourceLabel: "Tiểu sử Paul Arden",
  },
];

export function getAuthorProfile(slug: string | null | undefined): AuthorProfile | undefined {
  if (!slug) return undefined;
  return authorProfiles.find((p) => p.slug === slug);
}
