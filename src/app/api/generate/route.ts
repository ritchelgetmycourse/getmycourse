import { NextRequest, NextResponse } from 'next/server';
import { GoogleGenAI, Type } from '@google/genai';
import fs from 'fs/promises';
import path from 'path';
import pLimit from 'p-limit';

// ===== In-memory cancellation store (module-scoped) =====
type GenRecord = { canceled: boolean; controllers: Set<AbortController> };
const generationStore = new Map<string, GenRecord>();

function getOrCreateGen(id: string): GenRecord {
    const existing = generationStore.get(id);
    if (existing) return existing;
    const rec: GenRecord = { canceled: false, controllers: new Set() };
    generationStore.set(id, rec);
    return rec;
}
function registerController(id: string, ctrl: AbortController) {
    const rec = getOrCreateGen(id);
    rec.controllers.add(ctrl);
}
function cancelGeneration(id: string) {
    const rec = generationStore.get(id);
    if (!rec) return;
    rec.canceled = true;
    for (const c of rec.controllers) {
        try { c.abort(); } catch { }
    }
}
function isCanceled(id: string) {
    const rec = generationStore.get(id);
    return !!rec?.canceled;
}
function clearGeneration(id: string) {
    generationStore.delete(id);
}

// ===== SSE helpers =====
const encoder = new TextEncoder();
function createSseResponse(body: ReadableStream<Uint8Array>) {
    return new NextResponse(body, {
        headers: {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache, no-transform',
            'Connection': 'keep-alive',
        },
    });
}
function sendSseMessage(controller: TransformStreamDefaultController, event: string, data: any) {
    const message = `event: ${ event } \ndata: ${ JSON.stringify(data) } \n\n`;
    controller.enqueue(encoder.encode(message));
}

// --- Configuration ---
export const runtime = "nodejs";
const API_KEY = process.env.GEMINI_API_KEY || '';
const MODEL_NAME = "models/gemini-flash-latest";
const CONCURRENCY_LIMIT = 5;

// --- File Paths ---
const SCHEMA_PATH = path.join(process.cwd(), "schema.json");

// Utils
async function readFileContent(filePath: string): Promise<string> {
    try {
        return await fs.readFile(filePath, 'utf-8');
    } catch (error) {
        console.error(`Error: File not found or could not be read at path: ${ filePath } `, error);
        return "";
    }
}

function createDynamicJsonSchema(instructions: any): any | null {
    const properties: { [key: string]: any } = {};
    const required: string[] = [];

    try {
        if (!instructions) {
            console.warn("Warning: 'instructions' object provided to createDynamicJsonSchema is null or undefined.");
            return null;
        }

        const benchmarkKeys = Object.keys(instructions).filter(k => !isNaN(Number(k))).sort((a, b) => Number(a) - Number(b));
        if (benchmarkKeys.length === 0) {
            console.warn("Warning: No numbered benchmark criteria found in the instructions object.");
            return null;
        }

        for (const key of benchmarkKeys) {
            const perfKey = `performance_observed_${ key } `;
            const actionKey = `example_action_${ key } `;

            required.push(perfKey, actionKey);

            properties[perfKey] = {
                type: Type.STRING,
                description: `Evaluate student's performance for benchmark criterion ${key} based on the transcript.`
            };
properties[actionKey] = {
    type: Type.STRING,
    description: `Provide a direct quote from the transcript as evidence for criterion ${key}.`
};
        }

properties['conclusion'] = {
    type: Type.STRING,
    description: `Provide a final summary conclusion based on the overall performance in the transcript.`
};
required.push('conclusion');

return { type: Type.OBJECT, properties, required };

    } catch (e) {
    console.error(`Error: Could not create dynamic JSON schema: ${e}`);
    return null;
}
}

// ====== POST: start generation (SSE) ======
export async function POST(req: NextRequest) {
    if (!API_KEY) {
        return new NextResponse(encoder.encode(JSON.stringify({ error: "Gemini API key not configured." })), { status: 500 });
    }

    const headerGenId = req.headers.get("x-generation-id") || undefined;
    const { studentName, transcript, gender, generationId: bodyGenId } = await req.json();
    const generationId: string = headerGenId || bodyGenId || `${Date.now()}-${Math.random().toString(36).slice(2)}`;

    const firstName = studentName?.split(' ')[0] || studentName;
    const pronouns = {
        subject: gender?.toLowerCase() === 'female' ? 'she' : 'he',
        object: gender?.toLowerCase() === 'female' ? 'her' : 'him',
        possessive: gender?.toLowerCase() === 'female' ? 'her' : 'his',
    };

    if (!transcript) {
        return new NextResponse(encoder.encode(JSON.stringify({ error: "Missing 'transcript' in request body." })), { status: 400 });
    }

    // Set up cancel record and auto-cancel if client disconnects
    getOrCreateGen(generationId);
    req.signal.addEventListener("abort", () => {
        cancelGeneration(generationId);
    });

    console.log(`INFO: Transcript length: ${transcript.length} chars. GenID=${generationId}`);

    const readableStream = new ReadableStream<Uint8Array>({
        async start(controller) {
            try {
                const ai = new GoogleGenAI({ apiKey: API_KEY });
                const model = MODEL_NAME;

                const schemaJsonText = await readFileContent(SCHEMA_PATH);
                if (!schemaJsonText) {
                    sendSseMessage(controller as any, "error", { message: "schema.json could not be read." });
                    controller.close();
                    clearGeneration(generationId);
                    return;
                }

                const parsedSchemaGuide = JSON.parse(schemaJsonText);

                const systemPromptText = `You are a highly experienced and qualified Vocational Education and Training (VET) Assessor specializing in the Australian Community Services sector. Your area of expertise is the CHC33021 Certificate III in Individual Support (Disability) qualification. You are professional, meticulous, and skilled at evaluating a student's verbal responses against formal assessment criteria.

Context:

You will be provided with two key pieces of information:

The Assessment Guide: The "Pre-filled 3. CHC33021 Certificate III in Individual Support (Disability) – Assessment Kit - Section C". This document contains the official role-play scenarios, questions, and crucially, the formatting and structure of a high-quality benchmark answer (e.g., "Performance to Observe," "Example Actions," "Conclusion").

The Student Transcript: A text transcript of a competency conversation between an assessor and a student for a specific question from the Assessment Guide.

Primary Objective:

Your goal is to act as the official assessor. Based on the evidence presented in the Student Transcript, you will write a new, comprehensive Benchmark Answer. This generated answer must evaluate the student's performance and be written in the exact format and professional tone of the examples found in the Assessment Guide.

Step-by-Step Instructions to Generate Each Benchmark Answer:

Analyze the Student Transcript:
Carefully read the entire student transcript for the specific question being assessed.
Identify and extract the key evidence from the student's responses. Look for specific examples, demonstrated skills, stated knowledge, and any gaps or areas where the response was weak.
Retain mentions of specific facility names or locations when relevant to the context.

Reference the Assessment Guide:
Locate the corresponding question in the Assessment Guide to understand the required criteria.
Pay close attention to the structure, headings (e.g., "Performance to Observe," "Example Actions"), and the level of detail expected in a benchmark answer. The guide is your template for style and format.

Synthesize and Write the Benchmark Answer:
Begin writing the new benchmark answer.
Under headings like "Performance to Observe," describe what the student actually did in the transcript. Synthesize their performance into a professional evaluation. For example: "${firstName} effectively demonstrated respect for cultural identity by asking the client about..."
Under headings like "Example Actions," provide direct examples or close paraphrases from the transcript to justify your evaluation. These examples must be detailed and substantial, typically 6-8 lines long, to accurately reflect the discussion. For instance: Example Action: ${firstName} stated, "I understand that your faith is important to you, so I ensured the art group is women-only and respects cultural attire." This directly addresses the criterion.
Write a concise "Conclusion" that summarizes whether the student's performance in the transcript successfully met the requirements of the unit.

Apply Mandatory Formatting and Placeholders:
Structure: Your generated answer must follow the structure of the benchmark examples in the Assessment Guide (e.g., numbered points, bold headings, etc.).
Tone: The output must be strictly professional and formal. Avoid conversational phrases, such as "The referee confirms..." or any other informal language.
Student Name: Use the student's first name, "${firstName}", when referring to the student. The full name "${studentName}" should only be used at the start of the document in the designated name section.
Pronouns: Use the pronouns "${pronouns.subject}/${pronouns.object}/${pronouns.possessive}" as needed for the student.

Repeat for All Questions:
Follow this process for every question and corresponding transcript section provided.`;

                const allResults: { [key: string]: any } = {};
                const limit = pLimit(CONCURRENCY_LIMIT);

                // Build tasks
                let totalApiCallCount = 0;
                for (const unitCode of Object.keys(parsedSchemaGuide)) {
                    const unitData = parsedSchemaGuide[unitCode];
                    totalApiCallCount += Object.keys(unitData).filter(k => k !== 'assessment_guide').length;
                }
                console.log(`INFO: Generation starting. Calls planned: ${totalApiCallCount}. GenID=${generationId}`);

                const tasks: Promise<void>[] = [];

                for (const unitCode of Object.keys(parsedSchemaGuide)) {
                    const unitData = parsedSchemaGuide[unitCode];

                    for (const mainQuestionKey of Object.keys(unitData).filter(k => k !== 'assessment_guide')) {
                        tasks.push(limit(async () => {
                            if (isCanceled(generationId)) return;

                            const timestamp = new Date().toISOString();
                            console.log(`INFO: [${timestamp}] Processing ${unitCode}:${mainQuestionKey} GenID=${generationId}`);
                            sendSseMessage(controller as any, "processing", { unitCode, mainQuestionKey });

                            const questionData = unitData[mainQuestionKey];
                            const instructions = questionData?.rolePlayScenerio?.['instruction for roleplay'];

                            if (!instructions) {
                                console.warn(`Skipping ${unitCode} - ${mainQuestionKey}: missing instructions.`);
                                sendSseMessage(controller as any, "error", { unitCode, mainQuestionKey, message: "Missing instructions." });
                                return;
                            }

                            const dynamicSchema = createDynamicJsonSchema(instructions);
                            if (!dynamicSchema) {
                                console.warn(`Skipping ${unitCode} - ${mainQuestionKey}: schema generation failed.`);
                                sendSseMessage(controller as any, "error", { unitCode, mainQuestionKey, message: "Schema generation failed." });
                                return;
                            }

                            const specificJsonGuide = { [unitCode]: { [mainQuestionKey]: questionData } };
                            const specificJsonGuideText = JSON.stringify(specificJsonGuide, null, 2);

                            const finalUserPrompt = `${systemPromptText}

Here is the student's transcript:
--- TRANSCRIPT START ---
${transcript}
--- TRANSCRIPT END ---

Here is the JSON guide for the assessment structure and content:
--- JSON GUIDE START ---
${specificJsonGuideText}
--- JSON GUIDE END ---

Here is the assessment guide content from the JSON guide:
--- ASSESSMENT GUIDE CONTENT START ---
${unitData.assessment_guide}
--- ASSESSMENT GUIDE CONTENT END ---

**Your Task:**
You must act as the VET Assessor. Your goal is to generate the final, real benchmark answer by analyzing the **transcript** and following the structure provided in the **JSON guide** above.

**Output Instructions:**
Your response MUST be a single, valid JSON object that strictly adheres to the following JSON Schema. Do NOT include any text, explanations, or markdown formatting outside of the JSON object itself.`;

                            const contents = [{ role: 'user', parts: [{ text: finalUserPrompt }] }];
                            const config = {
                                responseMimeType: 'application/json',
                                responseSchema: dynamicSchema,
                                temperature: 0.2,
                                // Some SDK builds support passing anAbort signal here:
                                // @ts-ignore
                                abortSignal: undefined as any,
                            };

                            const callAbort = new AbortController();
                            registerController(generationId, callAbort);
                            // Best-effort: attach to possible httpOptions AND config.abortSignal
                            // @ts-ignore
                            (config as any).abortSignal = callAbort.signal;

                            try {
                                if (isCanceled(generationId)) {
                                    callAbort.abort();
                                    return;
                                }

                                const aiClient = ai; // alias
                                // Many SDK versions take optional httpOptions with AbortSignal; keep as best-effort.
                                const responseStream: any = await aiClient.models.generateContentStream({
                                    model,
                                    config,
                                    contents,
                                    // @ts-ignore
                                    httpOptions: { signal: callAbort.signal },
                                });

                                let responseContent = '';

                                // Some SDKs expose an async iterator directly; others via responseStream.stream
                                const streamIterable = typeof responseStream?.[Symbol.asyncIterator] === 'function'
                                    ? responseStream
                                    : responseStream?.stream ?? responseStream;

                                for await (const chunk of streamIterable) {
                                    if (isCanceled(generationId)) {
                                        try { callAbort.abort(); } catch { }
                                        throw new Error("ClientCanceled");
                                    }
                                    const text = (chunk && (chunk.text ?? chunk.data?.toString?.())) || "";
                                    if (text) responseContent = responseContent + text;
                                }

                                const estimatedInputTokens = Math.ceil(finalUserPrompt.length / 4);
                                const estimatedOutputTokens = Math.ceil(responseContent.length / 4);
                                sendSseMessage(controller as any, "token_usage", {
                                    section: `${unitCode}-${mainQuestionKey}`,
                                    inputTokens: estimatedInputTokens,
                                    outputTokens: estimatedOutputTokens
                                });

                                if (!responseContent) {
                                    sendSseMessage(controller as any, "error", { unitCode, mainQuestionKey, message: "No valid response content from AI." });
                                    return;
                                }

                                let parsedAiJson: any;
                                try {
                                    const jsonStart = responseContent.indexOf('{');
                                    const jsonEnd = responseContent.lastIndexOf('}');
                                    if (jsonStart !== -1 && jsonEnd !== -1 && jsonEnd > jsonStart) {
                                        const jsonString = responseContent.substring(jsonStart, jsonEnd + 1);
                                        parsedAiJson = JSON.parse(jsonString);
                                    } else {
                                        throw new Error("Could not find a valid JSON object in the response.");
                                    }
                                } catch (e: any) {
                                    console.error(`Failed to parse JSON for ${unitCode}, ${mainQuestionKey}.`, e?.message);
                                    sendSseMessage(controller as any, "error", { unitCode, mainQuestionKey, message: "Failed to parse JSON response from AI." });
                                    return;
                                }

                                const formattedEvaluation: { [key: string]: any } = {};
                                const benchmarkKeys = Object.keys(instructions).filter((k: string) => !isNaN(Number(k)));

                                for (const key of benchmarkKeys) {
                                    formattedEvaluation[key] = {
                                        question: instructions[key].question,
                                        performance_observed: parsedAiJson[`performance_observed_${key}`] || "No observation generated.",
                                        example_action: parsedAiJson[`example_action_${key}`] || "No example action found."
                                    };
                                }

                                const result = {
                                    main_question: questionData.question,
                                    evaluation: formattedEvaluation,
                                    conclusion: parsedAiJson.conclusion || "No conclusion generated."
                                };

                                if (!allResults[unitCode]) allResults[unitCode] = {};
                                allResults[unitCode][mainQuestionKey] = result;

                                sendSseMessage(controller as any, "completed", { unitCode, mainQuestionKey, result });

                            } catch (error: any) {
                                const msg = String(error?.message || "");
                                if (msg === "ClientCanceled" || isCanceled(generationId)) {
                                    // Quietly stop this task
                                    return;
                                }

                                if (error?.status === 429 || /429/.test(msg)) {
                                    sendSseMessage(controller as any, "error", { unitCode, mainQuestionKey, message: error.message, fatal: true });
                                    try { controller.close(); } catch { }
                                    cancelGeneration(generationId);
                                    throw error; // bubble up to stop others
                                }

                                // Non-fatal error on this subtask
                                sendSseMessage(controller as any, "error", { unitCode, mainQuestionKey, message: `API call failed: ${error?.message || 'Unknown error'}` });
                            } finally {
                                // Remove this controller from the store
                                const rec = generationStore.get(generationId);
                                if (rec) rec.controllers.delete(callAbort);
                            }
                        }));
                    }
                }

                // Wait for all tasks
                await Promise.allSettled(tasks);

                if (isCanceled(generationId)) {
                    // If canceled, end silently (client aborted/DELETE called)
                    try { controller.close(); } catch { }
                    clearGeneration(generationId);
                    console.log(`INFO: Generation canceled. GenID=${generationId}`);
                    return;
                }

                // Otherwise, send final "done"
                sendSseMessage(controller as any, "done", allResults);
                try { controller.close(); } catch { }
                clearGeneration(generationId);
                console.log(`INFO: Generation completed. GenID=${generationId}`);

            } catch (error: any) {
                console.error("Error in API route:", error?.message, error?.stack);
                if (!isCanceled(generationId)) {
                    sendSseMessage(controller as any, "error", { message: error?.message || "An unexpected error occurred." });
                    try { controller.close(); } catch { }
                } else {
                    try { controller.close(); } catch { }
                }
                clearGeneration(generationId);
            }
        },
    });

    return createSseResponse(readableStream);
}

// ====== DELETE: cancel generation (stop backend work) ======
export async function DELETE(req: NextRequest) {
    try {
        const contentType = req.headers.get("content-type") || "";
        let body: any = {};
        if (contentType.includes("application/json")) {
            body = await req.json().catch(() => ({}));
        }
        const headerId = req.headers.get("x-generation-id") || undefined;
        const id = body?.generationId || headerId;

        if (!id) {
            return NextResponse.json({ ok: false, error: "generationId is required" }, { status: 400 });
        }

        cancelGeneration(id);
        return NextResponse.json({ ok: true, message: "Canceled" });
    } catch (e: any) {
        return NextResponse.json({ ok: false, error: e?.message || "Failed to cancel" }, { status: 500 });
    }
}