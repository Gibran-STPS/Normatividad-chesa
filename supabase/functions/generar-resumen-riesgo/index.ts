// Edge Function: generar-resumen-riesgo
// Recibe un centro_id, junta sus datos (estado, normas aplicables),
// le pide a Claude un resumen de riesgo en español, lo guarda en
// la tabla resumenes_riesgo y lo regresa al navegador.
//
// La ANTHROPIC_API_KEY vive SOLO aquí (como "secret" de Supabase),
// nunca en el HTML. El navegador nunca ve esta llave.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // Cliente con la llave del usuario que llamó, para verificar su sesión
    const authHeader = req.headers.get("Authorization") ?? "";
    const supabaseUser = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: authError } = await supabaseUser.auth.getUser();
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "No autenticado" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { centro_id } = await req.json();
    if (!centro_id) {
      return new Response(JSON.stringify({ error: "Falta centro_id" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Cliente con la llave de servicio (server-side, nunca expuesta al navegador)
    // para leer los datos completos del centro sin restricciones de RLS.
    const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const { data: centro, error: centroError } = await supabaseAdmin
      .from("centros_trabajo")
      .select("id, nombre, ubicacion, responsable, estado")
      .eq("id", centro_id)
      .single();
    if (centroError || !centro) {
      return new Response(JSON.stringify({ error: "Centro no encontrado" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: normasRel } = await supabaseAdmin
      .from("centro_normas")
      .select("norma_code, normas_catalogo(descripcion)")
      .eq("centro_id", centro_id);

    const normas = (normasRel ?? []).map((r: any) =>
      `${r.norma_code} — ${r.normas_catalogo?.descripcion ?? ""}`
    );

    // Historial reciente para dar contexto de tendencia (opcional, últimos 3)
    const { data: historial } = await supabaseAdmin
      .from("resumenes_riesgo")
      .select("nivel_riesgo, generado_en")
      .eq("centro_id", centro_id)
      .order("generado_en", { ascending: false })
      .limit(3);

    const prompt = `Eres un asistente de cumplimiento de seguridad e higiene (STPS/NOM) para una empresa automotriz mexicana.
Analiza este centro de trabajo y genera un resumen de riesgo breve.

Centro: ${centro.nombre} (${centro.id})
Ubicación: ${centro.ubicacion}
Responsable: ${centro.responsable}
Estado actual en el sistema: ${centro.estado}
Normas NOM-STPS aplicables asignadas: ${normas.length ? normas.join("; ") : "Ninguna asignada todavía"}
Historial de niveles de riesgo recientes: ${historial?.length ? historial.map(h => h.nivel_riesgo).join(", ") : "Sin historial previo"}

Responde ÚNICAMENTE en este formato JSON, sin texto antes ni después:
{
  "nivel_riesgo": "Bajo" | "Medio" | "Alto" | "Crítico",
  "resumen": "2-4 oraciones en español, concretas y accionables, dirigidas a un ingeniero de seguridad. Menciona qué vigilar o qué falta (p. ej. normas sin asignar, estado crítico/pendiente sin resolver)."
}`;

    const claudeResp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-5",
        max_tokens: 400,
        messages: [{ role: "user", content: prompt }],
      }),
    });

    if (!claudeResp.ok) {
      const errText = await claudeResp.text();
      throw new Error(`Error de la API de Claude: ${errText}`);
    }

    const claudeData = await claudeResp.json();
    const rawText = claudeData.content?.[0]?.text ?? "{}";

    let parsed;
    try {
      parsed = JSON.parse(rawText.replace(/```json|```/g, "").trim());
    } catch {
      parsed = { nivel_riesgo: "Medio", resumen: rawText };
    }

    const { data: inserted, error: insertError } = await supabaseAdmin
      .from("resumenes_riesgo")
      .insert({
        centro_id,
        resumen: parsed.resumen,
        nivel_riesgo: parsed.nivel_riesgo,
        generado_por: user.id,
      })
      .select()
      .single();

    if (insertError) throw insertError;

    return new Response(JSON.stringify(inserted), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
