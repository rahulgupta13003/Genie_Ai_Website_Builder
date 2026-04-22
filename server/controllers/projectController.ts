import { Request, Response } from "express";
import Anthropic from "@anthropic-ai/sdk";
import prisma from "../lib/prisma.js";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const BEST_CLAUDE_CODING_MODEL = "claude-sonnet-4-6";

// ─── Prompt Templates ────────────────────────────────────────────────────────

const ENHANCE_SYSTEM = `You are a senior product designer translating vague user requests into precise frontend implementation specs.

Output a JSON object with this shape:
{
  "instruction": "<1-2 sentence actionable implementation directive>",
  "scope": "<one of: layout | typography | color | component | content | animation | responsive>",
  "priority": "<one of: low | medium | high>",
  "risks": "<any elements that might break if changed carelessly, or null>"
}

Rules:
- instruction must be action-oriented and unambiguous (use imperative: "Replace...", "Add...", "Adjust...")
- Preserve technical accuracy — mention specific Tailwind classes or HTML elements when appropriate
- Return ONLY the JSON object. No markdown, no preamble.`;

const CODE_SYSTEM = `You are an elite frontend engineer specializing in Tailwind CSS and vanilla JS.
Your task: apply a targeted change to an existing HTML document.

Hard rules:
1. Return ONLY the complete updated HTML document — no markdown fences, no explanations, no comments.
2. Touch ONLY what the instruction specifies. Preserve all other code exactly.
3. Maintain Tailwind utility-class conventions. Never write raw inline styles unless unavoidable.
4. All JavaScript must remain functional. Do not remove or rewrite JS unless the instruction explicitly targets it.
5. Preserve semantic HTML structure and accessibility attributes (aria-*, role, alt text).
6. Keep responsive classes (sm:, md:, lg:, xl:) intact.
7. Output must be a valid, self-contained HTML document starting with <!DOCTYPE html>.`;

const SUMMARISE_SYSTEM = `You are a concise changelog writer. Given a change instruction, write a single past-tense sentence (max 12 words) describing what was changed. No filler words. Start with a verb. Example: "Updated hero section background to dark navy with gradient overlay."`;

// ─── Helpers ─────────────────────────────────────────────────────────────────

function stripCodeFences(raw: string): string {
  return raw.replace(/^```[\w]*\n?/gm, "").replace(/```\s*$/gm, "").trim();
}

async function createConversationEntry(
  projectId: string,
  role: "user" | "assistant",
  content: string
) {
  return prisma.conversation.create({ data: { role, content, projectId } });
}

async function refundCredits(userId: string, amount = 2) {
  return prisma.user.update({
    where: { id: userId },
    data: { credits: { increment: amount } },
  });
}

// ─── makeRevision ─────────────────────────────────────────────────────────────

export const makeRevision = async (req: Request, res: Response) => {
  const userId = req.userId;

  try {
    const projectId = Array.isArray(req.params.projectId)
      ? req.params.projectId[0]
      : req.params.projectId;
    const { message } = req.body;

    // ── Auth & validation ──────────────────────────────────────────────────
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!userId || !user)
      return res.status(401).json({ message: "Unauthorized" });
    if (user.credits < 2)
      return res.status(403).json({ message: "Insufficient credits" });
    if (!message?.trim())
      return res.status(400).json({ message: "Prompt cannot be empty" });

    // ── Load project ───────────────────────────────────────────────────────
    const project = await prisma.websiteProject.findFirst({
      where: { id: projectId, userId },
      include: { versions: { take: 5 } },
    });
    if (!project) return res.status(404).json({ message: "Project not found" });

    // ── Log user message & deduct credits ──────────────────────────────────
    await createConversationEntry(projectId, "user", message);
    await prisma.user.update({
      where: { id: userId },
      data: { credits: { decrement: 2 } },
    });

    // ── Step 1: Enhance + classify the prompt ──────────────────────────────
    const enhanceRes = await anthropic.messages.create({
      model: BEST_CLAUDE_CODING_MODEL,
      max_tokens: 256,
      temperature: 0.3,
      system: ENHANCE_SYSTEM,
      messages: [{ role: "user", content: `User request: "${message}"` }],
    });

    let enhancement = {
      instruction: message,
      scope: "component",
      priority: "medium",
      risks: null as string | null,
    };
    try {
      const raw = (enhanceRes.content[0] as { type: "text"; text: string }).text;
      enhancement = JSON.parse(raw);
    } catch {
      // fallback — use original message
    }

    await createConversationEntry(
      projectId,
      "assistant",
      `✦ Enhanced instruction: *"${enhancement.instruction}"*\n` +
        `Scope: **${enhancement.scope}** · Priority: **${enhancement.priority}**` +
        (enhancement.risks ? `\n⚠ Watch out for: ${enhancement.risks}` : "")
    );

    // ── Step 2: Generate updated code ──────────────────────────────────────
    const codeRes = await anthropic.messages.create({
      model: BEST_CLAUDE_CODING_MODEL,
      max_tokens: 16000, // higher output budget to avoid truncated HTML
      temperature: 0.2, // low temp = precise, deterministic edits
      system: CODE_SYSTEM,
      messages: [
        {
          role: "user",
          content: `CURRENT CODE:\n${project.current_code}\n\nINSTRUCTION: ${enhancement.instruction}`,
        },
      ],
    });

    const rawCode = (codeRes.content[0] as { type: "text"; text: string }).text;
    const cleanCode = stripCodeFences(rawCode);

    if (!cleanCode || !/<!doctype\s+html>/i.test(cleanCode)) {
      await createConversationEntry(
        projectId,
        "assistant",
        "⚠ Code generation failed — no valid HTML returned. Please try rephrasing your request."
      );
      await refundCredits(userId);
      return res.status(500).json({ message: "Code generation failed" });
    }

    // ── Step 3: Generate version description ──────────────────────────────
    const summaryRes = await anthropic.messages.create({
      model: "claude-haiku-4-5-20251001", // cheap model for simple task
      max_tokens: 64,
      system: SUMMARISE_SYSTEM,
      messages: [
        { role: "user", content: `Change made: "${enhancement.instruction}"` },
      ],
    });
    const versionDescription = (
      summaryRes.content[0] as { type: "text"; text: string }
    ).text.trim();

    // ── Persist version + update project ──────────────────────────────────
    const version = await prisma.version.create({
      data: {
        code: cleanCode,
        description: versionDescription,
        projectId,
      },
    });

    await prisma.websiteProject.update({
      where: { id: projectId },
      data: {
        current_code: cleanCode,
        current_version_index: version.id,
      },
    });

    await createConversationEntry(
      projectId,
      "assistant",
      `✅ Done! ${versionDescription}`
    );

    return res.json({
      message: "Changes applied successfully",
      versionId: version.id,
      description: versionDescription,
      scope: enhancement.scope,
    });
  } catch (error: any) {
    await refundCredits(userId!).catch(() => {});
    console.error("[makeRevision]", error?.status, error?.message);

    const status = error?.status === 429 ? 429 : 500;
    const msg =
      error?.status === 429
        ? "AI service rate limit hit — please wait a moment and retry."
        : "An unexpected error occurred.";

    return res.status(status).json({ message: msg });
  }
};

// ─── rollbackToVersion ────────────────────────────────────────────────────────

export const rollbackToVersion = async (req: Request, res: Response) => {
  try {
    const userId = req.userId;
    if (!userId) return res.status(401).json({ message: "Unauthorized" });

    const projectId = Array.isArray(req.params.projectId)
      ? req.params.projectId[0]
      : req.params.projectId;
    const versionId = Array.isArray(req.params.versionId)
      ? req.params.versionId[0]
      : req.params.versionId;

    const project = await prisma.websiteProject.findFirst({
      where: { id: projectId, userId },
      include: { versions: true },
    });
    if (!project) return res.status(404).json({ message: "Project not found" });

    const version = project.versions.find((v: any) => v.id === versionId);
    if (!version) return res.status(404).json({ message: "Version not found" });

    await prisma.websiteProject.update({
      where: { id: projectId },
      data: { current_code: version.code, current_version_index: version.id },
    });

    await createConversationEntry(
      projectId,
      "assistant",
      `↩ Rolled back to: *"${version.description || "previous version"}"*`
    );

    return res.json({
      message: "Rollback successful",
      versionId: version.id,
      description: version.description,
    });
  } catch (error: any) {
    console.error("[rollbackToVersion]", error?.message);
    return res.status(500).json({ message: error.message });
  }
};

// ─── deleteProject ────────────────────────────────────────────────────────────

export const deleteProject = async (req: Request, res: Response) => {
  try {
    const userId = req.userId;
    if (!userId) return res.status(401).json({ message: "Unauthorized" });

    const projectId = Array.isArray(req.params.projectId)
      ? req.params.projectId[0]
      : req.params.projectId;

    const project = await prisma.websiteProject.findFirst({
      where: { id: projectId, userId },
    });
    if (!project) return res.status(404).json({ message: "Project not found" });

    await prisma.websiteProject.delete({ where: { id: projectId } });

    return res.json({ message: "Project deleted" });
  } catch (error: any) {
    console.error("[deleteProject]", error?.message);
    return res.status(500).json({ message: error.message });
  }
};

// ─── getProjectPreview ────────────────────────────────────────────────────────

export const getProjectPreview = async (req: Request, res: Response) => {
  try {
    const userId = req.userId;
    if (!userId) return res.status(401).json({ message: "Unauthorized" });

    const projectId = Array.isArray(req.params.projectId)
      ? req.params.projectId[0]
      : req.params.projectId;

    const project = await prisma.websiteProject.findFirst({
      where: { id: projectId, userId },
      include: { versions: { take: 10 } },
    });
    if (!project) return res.status(404).json({ message: "Project not found" });

    return res.json({
      code: project.current_code,
      currentVersionId: project.current_version_index,
      versions: (project as any).versions.map((v: any) => ({
        id: v.id,
        description: v.description,
      })),
    });
  } catch (error: any) {
    console.error("[getProjectPreview]", error?.message);
    return res.status(500).json({ message: error.message });
  }
};

// ─── getPublishedProjects ─────────────────────────────────────────────────────

export const getPublishedProjects = async (req: Request, res: Response) => {
  try {
    const { page = "1", limit = "20" } = req.query;
    const skip = (parseInt(page as string) - 1) * parseInt(limit as string);

    const [projects, total] = await Promise.all([
      prisma.websiteProject.findMany({
        where: { isPublished: true },
        include: { user: { select: { id: true, name: true } } },
        orderBy: { updatedAt: "desc" },
        skip,
        take: parseInt(limit as string),
      }),
      prisma.websiteProject.count({ where: { isPublished: true } }),
    ]);

    return res.json({ projects, total, page: parseInt(page as string) });
  } catch (error: any) {
    console.error("[getPublishedProjects]", error?.message);
    return res.status(500).json({ message: error.message });
  }
};

// ─── getProjectById ───────────────────────────────────────────────────────────

export const getProjectById = async (req: Request, res: Response) => {
  try {
    const projectId = Array.isArray(req.params.projectId)
      ? req.params.projectId[0]
      : req.params.projectId;

    const project = await prisma.websiteProject.findFirst({
      where: { id: projectId, isPublished: true },
    });
    if (!project) return res.status(404).json({ message: "Project not found" });

    return res.json({ code: project.current_code });
  } catch (error: any) {
    console.error("[getProjectById]", error?.message);
    return res.status(500).json({ message: error.message });
  }
};

// ─── saveProjectCode ──────────────────────────────────────────────────────────

export const saveProjectCode = async (req: Request, res: Response) => {
  try {
    const userId = req.userId;
    if (!userId) return res.status(401).json({ message: "Unauthorized" });

    const projectId = Array.isArray(req.params.projectId)
      ? req.params.projectId[0]
      : req.params.projectId;
    const { code } = req.body;

    if (!code?.trim())
      return res.status(400).json({ message: "Code is required" });

    const project = await prisma.websiteProject.findFirst({
      where: { id: projectId, userId },
    });
    if (!project) return res.status(404).json({ message: "Project not found" });

    // Save as a named manual version too
    const version = await prisma.version.create({
      data: { code, description: "Manual save", projectId },
    });

    await prisma.websiteProject.update({
      where: { id: projectId },
      data: { current_code: code, current_version_index: version.id },
    });

    return res.json({ message: "Saved", versionId: version.id });
  } catch (error: any) {
    console.error("[saveProjectCode]", error?.message);
    return res.status(500).json({ message: error.message });
  }
};