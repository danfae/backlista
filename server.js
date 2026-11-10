import express from "express";
import cors from "cors";
import { createClient } from "@supabase/supabase-js";

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const TABLE = "tasks";
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

let supabase;

function getSupabase() {
  if (!supabase) {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_PUBLISHABLE_KEY;

    if (!url || !key) {
      throw new Error(
        "Configure SUPABASE_URL e SUPABASE_PUBLISHABLE_KEY nas variáveis de ambiente.",
      );
    }

    supabase = createClient(url, key, {
      auth: {
        autoRefreshToken: false,
        detectSessionInUrl: false,
        persistSession: false,
      },
    });
  }

  return supabase;
}

const configuredOrigins = (process.env.CORS_ORIGIN || "*").trim();
const corsOrigin =
  configuredOrigins === "*"
    ? "*"
    : configuredOrigins.split(",").map((origin) => origin.trim());

app.disable("x-powered-by");
app.use(cors({ origin: corsOrigin }));
app.use(express.json({ limit: "10kb" }));

function databaseError(res, action, error) {
  console.error(`Erro ao ${action}:`, error);
  return res.status(500).json({
    error: `Não foi possível ${action}. Confira a tabela tasks, o acesso à Data API e as políticas RLS.`,
  });
}

function validateTaskFields(body) {
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    return { error: "O corpo deve ser um objeto JSON." };
  }

  const allowedFields = ["title", "completed"];
  const unknownFields = Object.keys(body).filter(
    (field) => !allowedFields.includes(field),
  );

  if (unknownFields.length > 0) {
    return { error: `Campo(s) não permitido(s): ${unknownFields.join(", ")}.` };
  }

  const values = {};

  if (Object.hasOwn(body, "title")) {
    if (typeof body.title !== "string") {
      return { error: "title deve ser um texto." };
    }

    const title = body.title.trim();
    if (!title || title.length > 500) {
      return { error: "title deve ter entre 1 e 500 caracteres." };
    }

    values.title = title;
  }

  if (Object.hasOwn(body, "completed")) {
    if (typeof body.completed !== "boolean") {
      return { error: "completed deve ser true ou false." };
    }

    values.completed = body.completed;
  }

  if (Object.keys(values).length === 0) {
    return { error: "Informe title e/ou completed." };
  }

  return { values };
}

app.get("/", (_req, res) => {
  res.json({ message: "API de tarefas ativa", endpoints: "/api/tasks" });
});

// Lista todas as tarefas
app.get("/api/tasks", async (_req, res) => {
  const { data, error } = await getSupabase()
    .from(TABLE)
    .select("*")
    .order("created_at", { ascending: false });

  if (error) return databaseError(res, "listar as tarefas", error);
  return res.json(data);
});

// Busca uma tarefa pelo id
app.get("/api/tasks/:id", async (req, res) => {
  const { id } = req.params;

  if (!UUID_PATTERN.test(id)) {
    return res.status(400).json({ error: "O id deve ser um UUID válido." });
  }

  const { data, error } = await getSupabase()
    .from(TABLE)
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (error) return databaseError(res, "buscar a tarefa", error);
  if (!data) return res.status(404).json({ error: "Tarefa não encontrada." });

  return res.json(data);
});

// Cria uma tarefa: { "title": "Estudar", "completed": false }
app.post("/api/tasks", async (req, res) => {
  const validation = validateTaskFields(req.body);

  if (validation.error) {
    return res.status(400).json({ error: validation.error });
  }

  if (!Object.hasOwn(validation.values, "title")) {
    return res.status(400).json({ error: "title é obrigatório." });
  }

  const { data, error } = await getSupabase()
    .from(TABLE)
    .insert({
      title: validation.values.title,
      completed: validation.values.completed ?? false,
    })
    .select("*")
    .single();

  if (error) return databaseError(res, "criar a tarefa", error);
  return res.status(201).json(data);
});

// Atualiza parcialmente uma tarefa: { "completed": true }
app.patch("/api/tasks/:id", async (req, res) => {
  const { id } = req.params;

  if (!UUID_PATTERN.test(id)) {
    return res.status(400).json({ error: "O id deve ser um UUID válido." });
  }

  const validation = validateTaskFields(req.body);

  if (validation.error) {
    return res.status(400).json({ error: validation.error });
  }

  const { data, error } = await getSupabase()
    .from(TABLE)
    .update({
      ...validation.values,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .select("*")
    .maybeSingle();

  if (error) return databaseError(res, "atualizar a tarefa", error);
  if (!data) return res.status(404).json({ error: "Tarefa não encontrada." });

  return res.json(data);
});

// Exclui uma tarefa pelo id
app.delete("/api/tasks/:id", async (req, res) => {
  const { id } = req.params;

  if (!UUID_PATTERN.test(id)) {
    return res.status(400).json({ error: "O id deve ser um UUID válido." });
  }

  const { data, error } = await getSupabase()
    .from(TABLE)
    .delete()
    .eq("id", id)
    .select("id")
    .maybeSingle();

  if (error) return databaseError(res, "excluir a tarefa", error);
  if (!data) return res.status(404).json({ error: "Tarefa não encontrada." });

  return res.json({
    message: "Tarefa excluída com sucesso.",
    id: data.id,
  });
});

app.use((_req, res) => {
  res.status(404).json({ error: "Rota não encontrada." });
});

app.use((err, _req, res, _next) => {
  console.error("Erro na requisição:", err);

  if (err instanceof SyntaxError && Object.hasOwn(err, "body")) {
    return res.status(400).json({ error: "JSON inválido." });
  }

  if (err?.type === "entity.too.large") {
    return res.status(413).json({ error: "O corpo da requisição é muito grande." });
  }

  return res.status(500).json({ error: "Erro interno do servidor." });
});

// A Vercel usa o app exportado.
// Localmente, `node server.js` inicia o servidor na porta configurada ou 3000.
if (process.env.VERCEL !== "1") {
  app.listen(PORT, () => {
    console.log(`API de tarefas rodando em http://localhost:${PORT}`);
  });
}

export default app;
