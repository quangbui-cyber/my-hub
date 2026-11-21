import type { Metadata } from "next";
import { Be_Vietnam_Pro } from "next/font/google";
import { Sidebar } from "@/components/Sidebar";
import { StoreProvider } from "@/lib/store";
import "./globals.css";

const font = Be_Vietnam_Pro({
  variable: "--font-be-vietnam",
  subsets: ["latin", "vietnamese"],
  weight: ["400", "500", "600", "700"],
});

export const metadata: Metadata = {
  title: "My Hub",
  description: "Quản lý công việc, tài chính và recap meeting bằng AI",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="vi" className={font.variable}>
      <body className={`${font.className} font-sans antialiased`}>
        <StoreProvider>
          <div className="flex min-h-screen flex-col md:flex-row">
            <Sidebar />
            <main className="mx-auto w-full max-w-6xl flex-1 p-4 md:p-8">{children}</main>
          </div>
        </StoreProvider>
      </body>
    </html>
  );
}
