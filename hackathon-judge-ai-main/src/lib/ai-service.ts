
import { GoogleGenerativeAI } from "@google/generative-ai";
import { SCORING_RUBRIC } from "./rubric";

// Initialize Gemini API
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');

interface EvaluationResult {
    scores: {
        problem_understanding: number;
        solution_approach: number;
        innovation: number;
        technical_feasibility: number;
        presentation_quality: number;
    };
    reasoning: {
        problem_understanding: string;
        solution_approach: string;
        innovation: string;
        technical_feasibility: string;
        presentation_quality: string;
    };
    citations: {
        problem_understanding: string;
        solution_approach: string;
        innovation: string;
        technical_feasibility: string;
        presentation_quality: string;
    };
    total_score: number;
    evaluation_id?: string;
    model_name?: string;
    timestamp?: string;
    missing_sections: string[];
    strengths: string[];
    weaknesses: string[];
    verdict: "SHORTLIST" | "REJECT";
    confidence: number;
}


export async function evaluatePPT(pptData: { text: string, images: any[] }, blueprint: any): Promise<EvaluationResult> {
    // Verified available models from logs (2026-01-04)
    // Prioritizing newer 2.5 models and latest aliases which might have better quotas
    const modelsToTry = [
        "gemini-2.5-flash",
        "gemini-2.5-pro",
        "gemini-flash-latest",
        "gemini-pro-latest",
        "gemini-2.0-flash-lite-preview-02-05",
        "gemini-2.0-flash",
        "gemini-2.0-flash-exp"
    ];

    const promptText = `
    You are an expert Hackathon Judge. Evaluate the following Hackathon PPT submission based strictly on the provided rubric.

    ${SCORING_RUBRIC}

    INSTRUCTIONS:
    1. READ the "PPT TEXT CONTENT" and analyze the provided SLIDE IMAGES carefully.
    2. THINK STEP-BY-STEP for each of the 5 criteria:
       - What evidence is present? (Quote specific text or describe specific image details)
       - MATCH against the discrete rubric levels (5, 15, 25, 30).
       - ASSIGN one of these exact scores. DO NOT invent scores like 18 or 24.
    3. Be critical. If a section is "Average", give 15. If it's merely "Good" but not "Strong", stick to 15.
    4. Provide a "citation" for every score. A citation must be specific.
    5. CRITICAL: Check for MISSING SECTIONS. If the PPT lacks a "Tech Stack", "Problem Statement", or "Future Scope", LIST THEM in the \`missing_sections\` array. Do not return an empty array if obvious sections are missing.
    6. Calculate total score out of 150.
    7. Provide a verdict: SHORTLIST if Total >= 100, else REJECT.
    8. Return ONLY valid JSON matching this schema:
    {
      "scores": { "problem_understanding": number, "solution_approach": number, "innovation": number, "technical_feasibility": number, "presentation_quality": number },
      "reasoning": { "problem_understanding": "string", "solution_approach": "string", "innovation": "string", "technical_feasibility": "string", "presentation_quality": "string" },
      "citations": { "problem_understanding": "string", "solution_approach": "string", "innovation": "string", "technical_feasibility": "string", "presentation_quality": "string" },
      "total_score": number,
      "missing_sections": string[],
      "strengths": string[],
      "weaknesses": string[],
      "verdict": "SHORTLIST" | "REJECT",
      "confidence": number (0-1)
    }
    `;

    const parts = [
        { text: promptText },
        { text: `PPT TEXT CONTENT:\n${pptData.text}` },
        ...pptData.images
    ];

    for (const modelName of modelsToTry) {
        console.log(`Attempting evaluation with model: ${modelName}`);
        const model = genAI.getGenerativeModel({
            model: modelName,
            generationConfig: {
                temperature: 0.0,
                responseMimeType: "application/json",
            }
        });

        const MAX_RETRIES = 2; // Reduced retries to fail fast
        let attempt = 0;

        while (attempt <= MAX_RETRIES) {
            try {
                // Determine timeout based on model priority (longer for better models)
                const timeoutMs = 30000; // Increased to 30s for multimodal

                // wrapper to add timeout to fetch
                const result = await Promise.race([
                    model.generateContent(parts),
                    new Promise((_, reject) => setTimeout(() => reject(new Error("Timeout")), timeoutMs))
                ]) as any;

                const response = await result.response;
                const text = response.text();

                // Clean up markdown code blocks if present
                const cleanText = text.replace(/```json/g, '').replace(/```/g, '').trim();
                const jsonResult = JSON.parse(cleanText);

                // Add Metadata for Trust
                return {
                    ...jsonResult,
                    evaluation_id: crypto.randomUUID(),
                    model_name: modelName,
                    timestamp: new Date().toISOString()
                };
            } catch (error: any) {
                console.error(`Model ${modelName} Attempt ${attempt + 1} failed:`, error.message);

                // Check for Rate Limit (429)
                if (error.message.includes("429") || error.message.includes("Too Many Requests")) {
                    attempt++;

                    // Parse retry delay from error message
                    const delayStr = error.message.match(/retry in ([\d\.]+)s/)?.[1];
                    const delayMs = delayStr ? Math.ceil(parseFloat(delayStr) * 1000) : 2000;

                    // CRITICAL: If delay is too long (> 5s), DO NOT WAIT. Skip to next model immediately.
                    // This is essential for free tier which often gives 60s+ cooldowns.
                    if (delayMs > 5000) {
                        console.warn(`Rate limit delay (${delayMs}ms) too high for model ${modelName}. Skipping directly to next model.`);
                        break; // Break inner loop, next model in outer loop will run
                    }

                    if (attempt > MAX_RETRIES) {
                        console.warn(`Model ${modelName} exhausted retries. Switching...`);
                        break;
                    }

                    console.log(`Waiting ${delayMs}ms before retry...`);
                    await new Promise(res => setTimeout(res, delayMs + 500));
                } else {
                    // Non-retriable error (e.g. 404, bad format, timeout)
                    console.warn(`Model ${modelName} failed with non-retriable error (or timeout). Switching...`);
                    break;
                }
            }
        }
    }

    throw new Error("All AI models failed or rate limited. Please try again later.");
}
