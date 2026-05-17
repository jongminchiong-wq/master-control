import { createClient } from "@/lib/supabase/server";
import { PlayerChrome } from "./_chrome";

export default async function PlayerLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Proxy.ts already gates this route group to authenticated players, so
  // `user` is guaranteed here. Fetch the per-player flag that decides
  // whether the Introducer Commission tab appears in the nav.
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  let allowIntroducer = false;
  if (user) {
    const { data } = await supabase
      .from("players")
      .select("allow_introducer")
      .eq("user_id", user.id)
      .single();
    allowIntroducer = data?.allow_introducer ?? false;
  }

  return (
    <PlayerChrome showIntroducer={allowIntroducer}>{children}</PlayerChrome>
  );
}
