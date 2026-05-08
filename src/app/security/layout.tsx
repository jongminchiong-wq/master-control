import { AccountShell } from "@/components/account-shell";
import { getRoleServer } from "@/lib/auth/get-role-server";

export default async function SecurityLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const initialRole = await getRoleServer();
  return <AccountShell initialRole={initialRole}>{children}</AccountShell>;
}
