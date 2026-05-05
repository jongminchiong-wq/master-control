import { AccountShell } from "@/components/account-shell";

export default function SecurityLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <AccountShell>{children}</AccountShell>;
}
