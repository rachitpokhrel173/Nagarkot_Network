import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const FB_VERIFY_TOKEN = Deno.env.get("FB_VERIFY_TOKEN")!;

function parseFacebookPost(entry: any) {
  const changes = entry.changes || [];
  for (const change of changes) {
    if (change.field === "feed") {
      const val = change.value;
      return {
        title: val.message?.split("\n")[0]?.slice(0, 150) || "Facebook Post",
        content: val.message || "Facebook post",
        image_url: val.photo || null,
        fb_post_id: val.post_id || null,
        fb_post_url: val.permalink_url || null,
        category: "समाचार",
        is_breaking: false,
        is_featured: false,
        source: "facebook",
        published_at: new Date().toISOString(),
      };
    }
  }
  return null;
}

Deno.serve(async (req: Request) => {
  const url = new URL(req.url);

  if (req.method === "GET") {
    const mode = url.searchParams.get("hub.mode");
    const token = url.searchParams.get("hub.verify_token");
    const challenge = url.searchParams.get("hub.challenge");
    if (mode === "subscribe" && token === FB_VERIFY_TOKEN) {
      console.log("✅ Webhook verified!");
      return new Response(challenge, { status: 200 });
    }
    return new Response("Forbidden", { status: 403 });
  }

  if (req.method === "POST") {
    try {
      const rawBody = await req.text();
      console.log("📨 Received:", rawBody);
      const body = JSON.parse(rawBody);
      if (body.object !== "page") {
        return new Response("OK", { status: 200 });
      }
      const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
      for (const entry of body.entry || []) {
        const post = parseFacebookPost(entry);
        if (!post || !post.content || post.content.length < 5) continue;
        if (post.fb_post_id) {
          const { data: existing } = await supabase
            .from("news").select("id")
            .eq("fb_post_id", post.fb_post_id).single();
          if (existing) { console.log("⏩ Duplicate skipped"); continue; }
        }
        const { error } = await supabase.from("news").insert([post]);
        if (error) console.error("❌ Insert error:", error.message);
        else console.log("✅ Published:", post.title);
      }
      return new Response("EVENT_RECEIVED", { status: 200 });
    } catch (err) {
      console.error("❌ Error:", err);
      return new Response("Error", { status: 500 });
    }
  }

  return new Response("OK", { status: 200 });
});