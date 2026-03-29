import Anthropic from "@anthropic-ai/sdk";
import crypto from "node:crypto";
import Razorpay from "razorpay";
import Stripe from "stripe";
import prisma from "../lib/prisma.js";
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const stripe = process.env.STRIPE_SECRET_KEY
    ? new Stripe(process.env.STRIPE_SECRET_KEY)
    : null;
const razorpay = process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET
    ? new Razorpay({
        key_id: process.env.RAZORPAY_KEY_ID,
        key_secret: process.env.RAZORPAY_KEY_SECRET,
    })
    : null;
const CREDIT_PLANS = {
    basic: { name: "Basic", amountInCents: 500, credits: 100 },
    pro: { name: "Pro", amountInCents: 1900, credits: 400 },
    enterprise: { name: "Enterprise", amountInCents: 4900, credits: 1000 },
};
// ─── Prompt Templates ─────────────────────────────────────────────────────────
const ENHANCE_SYSTEM = `You are a senior product designer and UX strategist specializing in web design.
Transform the user's website request into a detailed, actionable brief for a frontend developer.

Enhance the prompt by covering:
1. Visual design direction (color palette, typography style, overall aesthetic)
2. Layout structure (hero, sections, navigation, footer)
3. Key features and interactive elements
4. Target audience and tone (professional, playful, minimal, bold, etc.)
5. Responsive design considerations
6. Any implied functionality (forms, galleries, pricing tables, etc.)

Return ONLY the enhanced prompt. 2-3 focused paragraphs. No preamble, no labels.`;
const CODE_SYSTEM = `You are an elite frontend engineer. Build a complete, production-ready single-page website.

TECHNICAL REQUIREMENTS:
- Output valid, complete HTML only — starting with <!DOCTYPE html>
- Include in <head>: <script src="https://cdn.jsdelivr.net/npm/@tailwindcss/browser@4"></script>
- Use Tailwind utility classes for ALL styling — no inline styles
- Responsive using Tailwind breakpoints (sm:, md:, lg:, xl:)
- Animations via Tailwind (animate-*, transition-*) and subtle CSS where needed
- JavaScript in a <script> tag before </body> — keep it functional and clean
- Google Fonts CDN for custom typography
- Placeholder images from https://placehold.co/WIDTHxHEIGHT (e.g. /1200x600)
- All meta tags included

DESIGN STANDARDS:
- Modern, beautiful UI with great visual hierarchy
- Consistent color palette using Tailwind color utilities
- Proper spacing, shadows, and rounded corners
- Hover states and micro-interactions on interactive elements
- Accessible markup (aria labels, semantic HTML, alt text)

HARD RULES:
1. Return ONLY the HTML document — no markdown fences, no explanations, no comments
2. The output must be self-contained and render perfectly as-is
3. Never truncate — output the complete document every time`;
// ─── Helpers ──────────────────────────────────────────────────────────────────
function stripCodeFences(raw) {
    return raw.replace(/^```[\w]*\n?/gm, "").replace(/```\s*$/gm, "").trim();
}
async function addMessage(projectId, role, content) {
    return prisma.conversation.create({ data: { role, content, projectId } });
}
// ─── getUserCredits ───────────────────────────────────────────────────────────
export const getUserCredits = async (req, res) => {
    try {
        const userId = req.userId;
        if (!userId)
            return res.status(401).json({ message: "Unauthorized" });
        const user = await prisma.user.findUnique({ where: { id: userId } });
        return res.json({ credits: user?.credits ?? 0 });
    }
    catch (error) {
        console.error("[getUserCredits]", error.message);
        return res.status(500).json({ message: error.message });
    }
};
// ─── createUserProject ────────────────────────────────────────────────────────
export const createUserProject = async (req, res) => {
    const userId = req.userId;
    try {
        const { initial_prompt } = req.body;
        if (!userId)
            return res.status(401).json({ message: "Unauthorized" });
        if (!initial_prompt?.trim())
            return res.status(400).json({ message: "Prompt cannot be empty" });
        const user = await prisma.user.findUnique({ where: { id: userId } });
        if (!user)
            return res.status(401).json({ message: "User not found" });
        if (user.credits < 2)
            return res.status(403).json({ message: "Not enough credits to create a project" });
        // ── Create project record ──────────────────────────────────────────────
        const project = await prisma.websiteProject.create({
            data: {
                name: initial_prompt.length > 50
                    ? initial_prompt.substring(0, 47) + "..."
                    : initial_prompt,
                initial_prompt,
                userId,
            },
        });
        await Promise.all([
            prisma.user.update({
                where: { id: userId },
                data: { totalCreation: { increment: 1 }, credits: { decrement: 2 } },
            }),
            addMessage(project.id, "user", initial_prompt),
        ]);
        // Respond to client immediately so UI can show the project
        res.json({ projectId: project.id });
        // ── Step 1: Enhance prompt ─────────────────────────────────────────────
        const enhanceRes = await anthropic.messages.create({
            model: "claude-sonnet-4-20250514",
            max_tokens: 512,
            temperature: 0.6,
            system: ENHANCE_SYSTEM,
            messages: [
                {
                    role: "user",
                    content: `Create a website for: ${initial_prompt}`,
                },
            ],
        });
        const enhancedPrompt = enhanceRes.content[0].text ||
            initial_prompt;
        await addMessage(project.id, "assistant", `✦ Here's my enhanced brief for your website:\n\n${enhancedPrompt}`);
        await addMessage(project.id, "assistant", "⚙ Generating your website...");
        // ── Step 2: Generate website code ─────────────────────────────────────
        const codeRes = await anthropic.messages.create({
            model: "claude-sonnet-4-20250514",
            max_tokens: 16000,
            temperature: 0.3,
            system: CODE_SYSTEM,
            messages: [
                {
                    role: "user",
                    content: `Build a complete website based on this brief:\n\n${enhancedPrompt}`,
                },
            ],
        });
        const rawCode = codeRes.content[0].text;
        const cleanCode = stripCodeFences(rawCode);
        if (!cleanCode || !/<!doctype\s+html>/i.test(cleanCode)) {
            await addMessage(project.id, "assistant", "⚠ I couldn't generate the website. Please try again with a different prompt.");
            await prisma.user.update({
                where: { id: userId },
                data: { credits: { increment: 2 } },
            });
            return;
        }
        // ── Persist version + update project ──────────────────────────────────
        const version = await prisma.version.create({
            data: {
                code: cleanCode,
                description: "Initial version",
                projectId: project.id,
            },
        });
        await prisma.websiteProject.update({
            where: { id: project.id },
            data: {
                current_code: cleanCode,
                current_version_index: version.id,
            },
        });
        await addMessage(project.id, "assistant", "✅ Your website is ready! You can preview it and request changes anytime.");
    }
    catch (error) {
        await prisma.user
            .update({
            where: { id: userId },
            data: { credits: { increment: 2 } },
        })
            .catch(() => { });
        console.error("[createUserProject]", error.message);
        // Only send error response if headers haven't been sent yet
        if (!res.headersSent) {
            res.status(500).json({ message: error.message });
        }
    }
};
// ─── getUserProject ───────────────────────────────────────────────────────────
export const getUserProject = async (req, res) => {
    try {
        const userId = req.userId;
        if (!userId)
            return res.status(401).json({ message: "Unauthorized" });
        let { projectId } = req.params;
        if (Array.isArray(projectId))
            projectId = projectId[0];
        if (typeof projectId !== "string")
            return res.status(400).json({ message: "Invalid projectId" });
        const project = await prisma.websiteProject.findUnique({
            where: { id: projectId, userId },
            include: {
                conversation: { orderBy: { timestamp: "asc" } },
                versions: { orderBy: { timestamp: "asc" } },
            },
        });
        if (!project)
            return res.status(404).json({ message: "Project not found" });
        return res.json({ project });
    }
    catch (error) {
        console.error("[getUserProject]", error.message);
        return res.status(500).json({ message: error.message });
    }
};
// ─── getUserProjects ──────────────────────────────────────────────────────────
export const getUserProjects = async (req, res) => {
    try {
        const userId = req.userId;
        if (!userId)
            return res.status(401).json({ message: "Unauthorized" });
        const projects = await prisma.websiteProject.findMany({
            where: { userId },
            select: {
                id: true,
                name: true,
                createdAt: true,
                updatedAt: true,
                current_version_index: true,
                isPublished: true,
            },
            orderBy: { createdAt: "desc" },
        });
        return res.json({ projects });
    }
    catch (error) {
        console.error("[getUserProjects]", error.message);
        return res.status(500).json({ message: error.message });
    }
};
// ─── togglePublish ────────────────────────────────────────────────────────────
export const togglePublish = async (req, res) => {
    try {
        const userId = req.userId;
        if (!userId)
            return res.status(401).json({ message: "Unauthorized" });
        let { projectId } = req.params;
        if (Array.isArray(projectId))
            projectId = projectId[0];
        if (typeof projectId !== "string")
            return res.status(400).json({ message: "Invalid projectId" });
        const project = await prisma.websiteProject.findUnique({
            where: { id: projectId, userId },
        });
        if (!project)
            return res.status(404).json({ message: "Project not found" });
        await prisma.websiteProject.update({
            where: { id: projectId },
            data: { isPublished: !project.isPublished },
        });
        return res.json({
            message: project.isPublished ? "Project unpublished" : "Project published",
            isPublished: !project.isPublished,
        });
    }
    catch (error) {
        console.error("[togglePublish]", error.message);
        return res.status(500).json({ message: error.message });
    }
};
// ─── purchaseCredits ──────────────────────────────────────────────────────────
export const purchaseCredits = async (req, res) => {
    try {
        const userId = req.userId;
        if (!userId)
            return res.status(401).json({ message: "Unauthorized" });
        const { credits } = req.body;
        if (!credits || credits <= 0)
            return res.status(400).json({ message: "Invalid credits amount" });
        const user = await prisma.user.update({
            where: { id: userId },
            data: { credits: { increment: credits } },
        });
        return res.json({
            message: `Successfully added ${credits} credits`,
            totalCredits: user.credits,
        });
    }
    catch (error) {
        console.error("[purchaseCredits]", error.message);
        return res.status(500).json({ message: error.message });
    }
};
// ─── createCheckoutSession ───────────────────────────────────────────────────
export const createCheckoutSession = async (req, res) => {
    try {
        const userId = req.userId;
        if (!userId)
            return res.status(401).json({ message: "Unauthorized" });
        if (!stripe)
            return res.status(500).json({ message: "Stripe is not configured" });
        const { planId } = req.body;
        const selectedPlanId = planId?.trim();
        if (!selectedPlanId)
            return res.status(400).json({ message: "Invalid plan" });
        const plan = CREDIT_PLANS[selectedPlanId];
        if (!plan)
            return res.status(400).json({ message: "Invalid plan" });
        const transaction = await prisma.transaction.create({
            data: {
                userId,
                planId: selectedPlanId,
                amount: plan.amountInCents / 100,
                credits: plan.credits,
                isPaid: false,
            },
        });
        const clientBaseUrl = process.env.CLIENT_URL ||
            process.env.TRUSTED_ORIGINS?.split(",")[0] ||
            "http://localhost:5173";
        const session = await stripe.checkout.sessions.create({
            mode: "payment",
            success_url: `${clientBaseUrl}/pricing?success=true&session_id={CHECKOUT_SESSION_ID}`,
            cancel_url: `${clientBaseUrl}/pricing?canceled=true`,
            payment_method_types: ["card"],
            metadata: {
                userId,
                transactionId: transaction.id,
            },
            line_items: [
                {
                    quantity: 1,
                    price_data: {
                        currency: "usd",
                        unit_amount: plan.amountInCents,
                        product_data: {
                            name: `${plan.name} Credits Pack`,
                            description: `${plan.credits} credits for AI website generation`,
                        },
                    },
                },
            ],
        });
        return res.json({ url: session.url });
    }
    catch (error) {
        console.error("[createCheckoutSession]", error.message);
        return res.status(500).json({ message: "Failed to create checkout session" });
    }
};
// ─── confirmCheckoutPayment ──────────────────────────────────────────────────
export const confirmCheckoutPayment = async (req, res) => {
    try {
        const userId = req.userId;
        if (!userId)
            return res.status(401).json({ message: "Unauthorized" });
        if (!stripe)
            return res.status(500).json({ message: "Stripe is not configured" });
        const { sessionId } = req.body;
        if (!sessionId)
            return res.status(400).json({ message: "sessionId is required" });
        const session = await stripe.checkout.sessions.retrieve(sessionId);
        if (session.payment_status !== "paid") {
            return res.status(400).json({ message: "Payment not completed" });
        }
        const transactionId = session.metadata?.transactionId;
        if (!transactionId) {
            return res.status(400).json({ message: "Missing transaction metadata" });
        }
        const transaction = await prisma.transaction.findUnique({
            where: { id: transactionId },
        });
        if (!transaction || transaction.userId !== userId) {
            return res.status(404).json({ message: "Transaction not found" });
        }
        if (transaction.isPaid) {
            const user = await prisma.user.findUnique({ where: { id: userId } });
            return res.json({
                message: "Payment already processed",
                totalCredits: user?.credits ?? 0,
            });
        }
        const updatedUser = await prisma.$transaction(async (tx) => {
            await tx.transaction.update({
                where: { id: transaction.id },
                data: { isPaid: true },
            });
            return tx.user.update({
                where: { id: userId },
                data: { credits: { increment: transaction.credits } },
            });
        });
        return res.json({
            message: `Payment successful. Added ${transaction.credits} credits`,
            totalCredits: updatedUser.credits,
        });
    }
    catch (error) {
        console.error("[confirmCheckoutPayment]", error.message);
        return res.status(500).json({ message: "Failed to confirm payment" });
    }
};
// ─── createRazorpayOrder ─────────────────────────────────────────────────────
export const createRazorpayOrder = async (req, res) => {
    try {
        const userId = req.userId;
        if (!userId)
            return res.status(401).json({ message: "Unauthorized" });
        if (!razorpay || !process.env.RAZORPAY_KEY_ID) {
            return res.status(500).json({ message: "Razorpay is not configured" });
        }
        const { planId } = req.body;
        const selectedPlanId = planId?.trim();
        if (!selectedPlanId) {
            return res.status(400).json({ message: "Invalid plan" });
        }
        const plan = CREDIT_PLANS[selectedPlanId];
        if (!plan) {
            return res.status(400).json({ message: "Invalid plan" });
        }
        const transaction = await prisma.transaction.create({
            data: {
                userId,
                planId: selectedPlanId,
                amount: plan.amountInCents / 100,
                credits: plan.credits,
                isPaid: false,
            },
        });
        const order = await razorpay.orders.create({
            amount: plan.amountInCents,
            currency: "INR",
            receipt: transaction.id,
            notes: {
                userId,
                transactionId: transaction.id,
                planId: selectedPlanId,
            },
        });
        return res.json({
            keyId: process.env.RAZORPAY_KEY_ID,
            orderId: order.id,
            transactionId: transaction.id,
            amount: plan.amountInCents,
            currency: order.currency,
            plan: {
                id: selectedPlanId,
                name: plan.name,
                credits: plan.credits,
            },
        });
    }
    catch (error) {
        console.error("[createRazorpayOrder]", error.message);
        return res.status(500).json({ message: "Failed to create Razorpay order" });
    }
};
// ─── verifyRazorpayPayment ───────────────────────────────────────────────────
export const verifyRazorpayPayment = async (req, res) => {
    try {
        const userId = req.userId;
        if (!userId)
            return res.status(401).json({ message: "Unauthorized" });
        const razorpaySecret = process.env.RAZORPAY_KEY_SECRET;
        if (!razorpaySecret) {
            return res.status(500).json({ message: "Razorpay is not configured" });
        }
        const { razorpay_payment_id, razorpay_order_id, razorpay_signature, transactionId, } = req.body;
        if (!razorpay_payment_id ||
            !razorpay_order_id ||
            !razorpay_signature ||
            !transactionId) {
            return res.status(400).json({ message: "Missing payment verification data" });
        }
        const expectedSignature = crypto
            .createHmac("sha256", razorpaySecret)
            .update(`${razorpay_order_id}|${razorpay_payment_id}`)
            .digest("hex");
        if (expectedSignature !== razorpay_signature) {
            return res.status(400).json({ message: "Invalid payment signature" });
        }
        const existingTransaction = await prisma.transaction.findUnique({
            where: { id: transactionId },
        });
        if (!existingTransaction || existingTransaction.userId !== userId) {
            return res.status(404).json({ message: "Transaction not found" });
        }
        if (existingTransaction.isPaid) {
            const user = await prisma.user.findUnique({ where: { id: userId } });
            return res.json({
                message: "Payment already processed",
                totalCredits: user?.credits ?? 0,
            });
        }
        const updatedUser = await prisma.$transaction(async (tx) => {
            await tx.transaction.update({
                where: { id: existingTransaction.id },
                data: { isPaid: true },
            });
            return tx.user.update({
                where: { id: userId },
                data: { credits: { increment: existingTransaction.credits } },
            });
        });
        return res.json({
            message: `Payment successful. Added ${existingTransaction.credits} credits`,
            totalCredits: updatedUser.credits,
        });
    }
    catch (error) {
        console.error("[verifyRazorpayPayment]", error.message);
        return res.status(500).json({ message: "Failed to verify Razorpay payment" });
    }
};
