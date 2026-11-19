import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, ArrowRight, ArrowUpRight, Award, BookOpen, Building2, MapPin, Sparkles } from "lucide-react";
import { authorProfiles } from "./profiles";
import styles from "./profiles.module.css";

export const metadata: Metadata = {
  title: "Những người truyền cảm hứng · Góc Đọc myCreative",
  description: "Tiểu sử, thành tựu, hành trình và những cuốn sách của sáu tác giả về quảng cáo và sáng tạo.",
  robots: { index: false, follow: false },
};

export default async function AuthorsPage({ searchParams }: { searchParams: Promise<{ author?: string }> }) {
  const { author: slug } = await searchParams;
  const author = authorProfiles.find((profile) => profile.slug === slug) ?? authorProfiles[0];
  const index = authorProfiles.indexOf(author);
  const next = authorProfiles[(index + 1) % authorProfiles.length];
  return (
    <div className={styles.page}>
      <a href="#author-profile" className={styles.skip}>Đến hồ sơ tác giả</a>
      <header className={styles.header}>
        <Link href="/creative" className={styles.logo}>myCreative<span>/</span><span>Góc Đọc</span></Link>
        <Link href="/creative" className={styles.back}><ArrowLeft size={15} /> Về thư viện</Link>
      </header>
      <main className={styles.main}>
        <div className={styles.prelude}>
          <p className={styles.eyebrow}><span /> GẶP GỠ NHỮNG BỘ ÓC SÁNG TẠO</p>
          <h1>Những người<br className={styles.mobileBreak} /> truyền cảm hứng<span>.</span></h1>
          <p>Hiểu con người phía sau những ý tưởng bạn yêu thích.</p>
        </div>
        <div className={styles.layout}>
          <aside className={styles.sidebar}>
            <div className={styles.sideTitle}>TÁC GIẢ <span>06</span></div>
            <nav aria-label="Chọn tác giả" className={styles.authorList}>
              {authorProfiles.map((profile) => (
                <Link key={profile.slug} href={`/creative/authors?author=${profile.slug}`} scroll={false} aria-current={profile.slug === author.slug ? "page" : undefined} className={`${styles.authorLink} ${profile.slug === author.slug ? styles.selected : ""}`}>
                  <img
                    src={profile.image}
                    alt={profile.name}
                    className="h-9 w-9 shrink-0 rounded-[10px] border border-zinc-200 object-cover"
                  />
                  <span><strong>{profile.name}</strong><small>{profile.specialty}</small></span>
                  {profile.slug === author.slug && <ArrowRight size={15} aria-hidden="true" />}
                </Link>
              ))}
            </nav>
            <div className={styles.sideNote}><BookOpen size={19} /><p>Một góc nhìn mới.<br />Một ý tưởng cho ngày mai.</p><Link href="/creative">Khám phá thư viện <ArrowUpRight size={13} /></Link></div>
          </aside>
          <article id="author-profile" className={styles.profile}>
            <section className={styles.hero} aria-labelledby="author-name">
              <div className={styles.heroCopy}>
                <p className={styles.eyebrow}>CHÂN DUNG TÁC GIẢ <span className={styles.number}>0{index + 1} / 06</span></p>
                <h2 id="author-name">{author.name}</h2>
                <p className={styles.role}>{author.role}</p>
                <p className={styles.intro}>{author.intro}</p>
                <div className={styles.heroActions}><Link href={`/creative?tac-gia=${author.slug}`} className={styles.primary}>Đọc bài của tác giả <ArrowUpRight size={16} /></Link><span className={styles.location}><MapPin size={13} /> {author.location}</span></div>
              </div>
              <div className="relative min-h-[260px] overflow-hidden rounded-[14px] border border-zinc-200 bg-zinc-900">
                <img
                  src={author.image}
                  alt={author.name}
                  style={{ objectPosition: "center 20%" }}
                  className="h-full w-full object-cover"
                />
                <div className="absolute inset-0 flex flex-col justify-end bg-gradient-to-t from-zinc-950/85 via-transparent to-transparent p-3.5">
                  <span className="rounded-full bg-brand-100 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-brand-900 self-start">
                    {author.badge}
                  </span>
                </div>
              </div>
            </section>
            <nav className={styles.sectionNav} aria-label="Nội dung hồ sơ"><a href="#biography">Tiểu sử</a><a href="#achievements">Thành tựu nổi bật</a><a href="#journey">Hành trình</a><a href="#books">Sách tiêu biểu</a></nav>
            <div className={styles.readingGrid}>
              <section id="biography" className={styles.biography}><p className={styles.eyebrow}>VỀ TÁC GIẢ</p><h3>{author.headline.split("\n").map((line) => <span key={line}>{line}<br /></span>)}</h3>{author.bio.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}<a className={styles.source} href={author.source} target="_blank" rel="noreferrer">Nguồn: {author.sourceLabel} <ArrowUpRight size={12} /></a></section>
              <aside className={styles.perspective}><Sparkles size={20} strokeWidth={1.5} /><p className={styles.eyebrow}>MỘT GỢI Ý KHI ĐỌC</p><p>{author.perspective}</p><span>Góc nhìn từ ban biên tập</span></aside>
            </div>
            <section id="achievements" className={styles.books}>
              <div className={styles.sectionHeading}><h3>Thành tựu & Dấu ấn nổi bật</h3><span>DI SẢN SÁNG TẠO</span></div>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                {author.achievements.map((ac) => (
                  <div key={ac.title} className="flex flex-col gap-2.5 rounded-[14px] border border-zinc-200 bg-zinc-50/70 p-4">
                    <span className="flex h-9 w-9 items-center justify-center rounded-[10px] bg-brand-100 text-brand-900">
                      {ac.icon === "award" ? <Award size={18} /> : ac.icon === "agency" ? <Building2 size={18} /> : <BookOpen size={18} />}
                    </span>
                    <h4 className="text-sm font-bold text-zinc-950">{ac.title}</h4>
                    <p className="text-xs leading-relaxed text-zinc-600">{ac.desc}</p>
                  </div>
                ))}
              </div>
            </section>
            <section id="journey" className={styles.journey}><div className={styles.sectionHeading}><h3>Dấu mốc hành trình</h3><span>CON NGƯỜI & SỰ NGHIỆP</span></div><ol>{author.milestones.map(([year, text]) => <li key={year}><span className={styles.dot} /><strong>{year}</strong><p>{text}</p></li>)}</ol></section>
            <section id="books" className={styles.books}><div className={styles.sectionHeading}><h3>Trên kệ sách</h3><span>MỘT ĐIỂM BẮT ĐẦU</span></div><div className={styles.bookGrid}>{author.books.map((book, bookIndex) => <div key={book} className={styles.book}><span className={styles.bookNumber}>0{bookIndex + 1}</span><BookOpen size={21} strokeWidth={1.3} /><h4>{book}</h4><p>{author.name}</p></div>)}</div></section>
            <footer className={styles.profileFooter}><p>Tiếp tục gặp gỡ</p><Link href={`/creative/authors?author=${next.slug}`}>{next.name}<ArrowRight size={19} /></Link></footer>
          </article>
        </div>
        <footer className={styles.footer}><span>myCreative <span>·</span> Nuôi dưỡng một góc nhìn mới mỗi ngày.</span><span>Hồ sơ tác giả</span></footer>
      </main>
    </div>
  );
}
