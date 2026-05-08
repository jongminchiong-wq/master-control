import { createClient } from "@/lib/supabase/server";

export type Role = "admin" | "player" | "investor";

export async function getRoleServer(): Promise<Role | null> {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return null;
    const { data } = await supabase
      .from("users")
      .select("role")
      .eq("id", user.id)
      .single();
    return (data?.role as Role | undefined) ?? null;
  } catch {
    return null;
  }
}
