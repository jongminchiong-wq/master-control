import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { IntroducerCommissionClient } from "./_client";

export default async function PlayerIntroducerCommissionPage() {
  // Guard: if the admin disabled this player's introducer network, the
  // Introducer Commission nav tab is already hidden — but a direct URL hit
  // would still load this page. Bounce them back to Home.
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: player } = await supabase
    .from("players")
    .select("allow_introducer")
    .eq("user_id", user.id)
    .single();

  if (!player?.allow_introducer) {
    redirect("/dashboard");
  }

  return <IntroducerCommissionClient />;
}
