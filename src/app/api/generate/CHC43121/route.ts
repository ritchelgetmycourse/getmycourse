import { NextRequest, NextResponse } from 'next/server';
import { GoogleGenAI, Type } from '@google/genai';
import fs from 'fs/promises';
import path from 'path';
import pLimit from 'p-limit';
import { curricula, Curriculum } from '../../../../config/curricula';
import { createDynamicJsonSchemaCHC43121, systemPromptTextCHC43121 } from '../../../../lib/curriculum-logic/CHC43121';

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
    const message = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    controller.enqueue(encoder.encode(message));
}

// --- Configuration ---
export const runtime = "nodejs";
const API_KEY = process.env.GEMINI_API_KEY || '';
const MODEL_NAME = "models/gemini-flash-latest";
const CONCURRENCY_LIMIT = 10;

// Utils
async function readFileContent(filePath: string): Promise<string> {
    try {
        // If path is already absolute, use it directly
        if (path.isAbsolute(filePath)) {
            try {
                return await fs.readFile(filePath, 'utf-8');
            } catch (absError) {
                console.error(`Error reading absolute path: ${filePath}`, absError);
                return "";
            }
        }
        // If path is relative, prepend process.cwd()
        const rootPath = path.join(process.cwd(), filePath);
        try {
            return await fs.readFile(rootPath, 'utf-8');
        } catch (rootError) {
            console.error(`Error reading relative path: ${rootPath}`, rootError);
            return "";
        }
    } catch (error) {
        console.error(`Error: File not found or could not be read at paths tried:`, error);
        return "";
    }
}

// ====== POST: start generation (SSE) ======
export async function POST(req: NextRequest) {
    const curriculumId = "CHC43121"; // Hardcode for this specific route

    if (!API_KEY) {
        return new NextResponse(encoder.encode(JSON.stringify({ error: "Gemini API key not configured." })), { status: 500 });
    }

    const headerGenId = req.headers.get("x-generation-id") || undefined;
    const { studentName, transcript, gender, generationId: bodyGenId } = await req.json();
    const generationId: string = headerGenId || bodyGenId || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const firstName = studentName?.split(' ')[0] || studentName;
    // const pronouns = {
    //     subject: gender?.toLowerCase() === 'female' ? 'she' : 'he',
    //     object: gender?.toLowerCase() === 'female' ? 'her' : 'him',
    //     possessive: gender?.toLowerCase() === 'female' ? 'her' : 'his',
    // };

    // Find the selected curriculum configuration
    const selectedCurriculum = curricula.find((c: Curriculum) => c.id === curriculumId);
    if (!selectedCurriculum) {
        return new NextResponse(encoder.encode(JSON.stringify({ error: `Curriculum with ID ${curriculumId} not found.` })), { status: 400 });
    }

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

                const schemaJsonText = await readFileContent(selectedCurriculum.schemaPath);
                if (!schemaJsonText) {
                    sendSseMessage(controller as any, "error", { message: `${selectedCurriculum.schemaPath} could not be read.` });
                    controller.close();
                    clearGeneration(generationId);
                    return;
                }

                const parsedSchemaGuide = JSON.parse(schemaJsonText);

                const systemPromptText = selectedCurriculum.systemPromptOverride || systemPromptTextCHC43121(firstName);

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
                            const benchMarkAns = questionData?.benchMarkAns;

                            if (!benchMarkAns) {
                                console.warn(`Skipping ${unitCode} - ${mainQuestionKey}: missing benchMarkAns.`);
                                sendSseMessage(controller as any, "error", { unitCode, mainQuestionKey, message: "Missing benchMarkAns." });
                                return;
                            }

                            const dynamicSchema = createDynamicJsonSchemaCHC43121(questionData);
                            if (!dynamicSchema) {
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

**Your Task:**
You must act as the VET Assessor. Your goal is to generate a new, comprehensive answer for the question by analyzing the **transcript** and using the provided **benchMarkAns** as a style guide.

**Output Instructions:**
Your response MUST be a single, valid JSON object that strictly adheres to the following JSON Schema. Do NOT include any text, explanations, or markdown formatting outside of the JSON object itself.`;

                            const contents = [{ role: 'user', parts: [{ text: finalUserPrompt }] }];
                            const config = {
                                thinkingConfig: {
                                thinkingBudget: -1,
                             },
                                systemInstruction:[
                                    {
                                        text: systemPromptText,
                                    }
                                ],
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

                                // --- Retry + Timeout Wrapper ---
                                async function withTimeout<T>(promise: Promise<T>, ms: number, onTimeout: () => void): Promise<T> {
                                    return Promise.race([
                                        promise,
                                        new Promise<T>((_, reject) => setTimeout(() => {
                                            onTimeout();
                                            reject(new Error(`Timeout after ${ms}ms`));
                                        }, ms))
                                    ]);
                                }

                                async function retry<T>(fn: () => Promise<T>, retries = 3, delay = 2000): Promise<T> {
                                    for (let attempt = 1; attempt <= retries; attempt++) {
                                        try {
                                            if (attempt > 1) {
                                                sendSseMessage(controller as any, "retry", { unitCode, mainQuestionKey, attempt });
                                            }
                                            return await fn();
                                        } catch (err) {
                                            if (attempt === retries) throw err;
                                            console.warn(`Retry ${attempt} failed for ${unitCode}:${mainQuestionKey}, retrying in ${delay}ms...`);
                                            await new Promise(res => setTimeout(res, delay));
                                            // Fixed delay of 2 seconds (no exponential backoff)
                                        }
                                    }
                                    throw new Error("Max retries reached");
                                }

                                const responseStream: any = await retry(() =>
                                    withTimeout(
                                        aiClient.models.generateContentStream({
                                            model,
                                            config,
                                            contents,
                                            // @ts-ignore
                                            httpOptions: { signal: callAbort.signal },
                                        }),
                                        120000, // 2-minute timeout per question
                                        () => callAbort.abort()
                                    )
                                );

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
                                        // No placeholder replacement here, AI is instructed to use actual pronouns
                                        console.log(`AI Generated JSON for ${unitCode}:${mainQuestionKey}:`, JSON.stringify(parsedAiJson, null, 2)); // Log AI output

                                    } else {
                                        throw new Error("Could not find a valid JSON object in the response.");
                                    }
                                } catch (e: any) {
                                    console.error(`Failed to parse JSON for ${unitCode}, ${mainQuestionKey}.`, e?.message);
                                    sendSseMessage(controller as any, "error", { unitCode, mainQuestionKey, message: "Failed to parse JSON response from AI." });
                                    return;
                                }

                                const result = {
                                    main_question: questionData.question,
                                    generatedAnswer: parsedAiJson.generatedAnswer || "No answer generated."
                                };

                                console.log('AI Result:', JSON.stringify(result, null, 2));

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
