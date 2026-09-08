export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-surface px-6 pb-[10vh] pt-12">
      {children}
    </div>
  );
}
