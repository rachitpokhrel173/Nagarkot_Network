// ============================================================
// Nagarkot Network — Facebook Webhook (Supabase Edge Function)
// ============================================================
// Deploy this to: supabase/functions/facebook-webhook/index.ts
// Then run: supabase functions deploy facebook-webhook
// ============================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const FB_VERIFY_TOKEN = Deno.env.get("FB_VERIFY_TOKEN")!;   // You create this (any random string)
const FB_APP_SECRET = Deno.env.get("FB_APP_SECRET")!;       // From your Facebook App dashboard

// ──────────────────────────────────────────────
// Verify Facebook's HMAC signature for security
// ──────────────────────────────────────────────
async function verifySignature(body: string, signature: string): Promise<boolean> {
  try {
    const key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(FB_APP_SECRET),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["verify"]
    );

    const expectedSig = signature.replace("sha256=", "");
    const bodyBuffer = new TextEncoder().encode(body);
    const sigBuffer = hexToBytes(expectedSig);

    return await crypto.subtle.verify("HMAC", key, sigBuffer, bodyBuffer);
  } catch {
    return false;
  }
}

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.slice(i, i + 2), 16);
  }
  return bytes;
}

// ──────────────────────────────────────────────
// Extract useful info from a Facebook post
// ──────────────────────────────────────────────
function parseFacebookPost(entry: any) {
  const changes = entry.changes || [];
  for (const change of changes) {
    if (change.field === "feed" && change.value?.item === "post") {
      const val = change.value;
      return {
        title: val.message?.split("\n")[0]?.slice(0, 150) || "Facebook Post",
        content: val.message || "",
        image_url: val.photo || val.link || null,
        fb_post_id: val.post_id || null,
        fb_post_url: val.permalink_url || null,
        category: "समाचार",         // Default category — change if you want
        is_breaking: false,
        is_featured: false,
        source: "facebook",
        published_at: new Date(val.created_time * 1000).toISOString(),
      };
    }
  }
  return null;
}

// ──────────────────────────────────────────────
// Main handler
// ──────────────────────────────────────────────
Deno.serve(async (req: Request) => {
  const url = new URL(req.url);

  // ── GET: Facebook webhook verification ──
  if (req.method === "GET") {
    const mode = url.searchParams.get("hub.mode");
    const token = url.searchParams.get("hub.verify_token");
    const challenge = url.searchParams.get("hub.challenge");

    if (mode === "subscribe" && token === FB_VERIFY_TOKEN) {
      console.log("✅ Facebook webhook verified!");
      return new Response(challenge, { status: 200 });
    }
    return new Response("Forbidden", { status: 403 });
  }

  // ── POST: Incoming Facebook post notification ──
  if (req.method === "POST") {
    const rawBody = await req.text();
    const signature = req.headers.get("x-hub-signature-256") || "";

    // Verify it really came from Facebook
    const isValid = await verifySignature(rawBody, signature);
    if (!isValid) {
      console.error("❌ Invalid Facebook signature!");
      return new Response("Unauthorized", { status: 401 });
    }

    const body = JSON.parse(rawBody);

    // Only handle Page feed events
    if (body.object !== "page") {
      return new Response("OK", { status: 200 });
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

    for (const entry of body.entry || []) {
      const post = parseFacebookPost(entry);
      if (!post) continue;

      // Skip empty posts (just photo uploads with no text, etc.)
      if (!post.content || post.content.length < 10) continue;

      // Check for duplicate (same fb_post_id)
      if (post.fb_post_id) {
        const { data: existing } = await supabase
          .from("news")
          .select("id")
          .eq("fb_post_id", post.fb_post_id)
          .single();

        if (existing) {
          console.log(`⏩ Skipping duplicate post: ${post.fb_post_id}`);
          continue;
        }
      }

      // Insert into your news table
      const { error } = await supabase.from("news").insert([post]);

      if (error) {
        console.error("❌ Supabase insert error:", error.message);
      } else {
        console.log(`✅ Auto-published from Facebook: ${post.title}`);
      }
    }

    return new Response("EVENT_RECEIVED", { status: 200 });
  }

  return new Response("Method Not Allowed", { status: 405 });
});
