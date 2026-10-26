// Ảnh thương hiệu lấy từ mẫu phiếu công ty (ĐNTU/ĐNTT/ĐNHTU-CS.2024).
// Mọi file tài chính xuất ra (Báo giá, IC, AC, các phiếu đề nghị) đều phải gắn logo,
// kể cả khi file Excel gốc không có.
export const BRAND_ASSETS = {
  /** Logo đầy đủ kèm dòng "WE CREATE EMOTIONS" (2500 × 690). */
  logo: "/brand/creative-station-logo.png",
  /** Dải xanh có logo nhỏ và tên miền, đặt ở đầu/chân phiếu (2000 × 337). */
  headerBand: "/brand/creative-station-header-band.png",
} as const;

export const COMPANY_WEBSITE = "creativestation.com.vn";
