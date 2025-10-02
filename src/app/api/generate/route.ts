import { NextRequest, NextResponse } from 'next/server';
import { GoogleGenAI, Type } from '@google/genai';
import fs from 'fs/promises';
import path from 'path';

// Helper for SSE
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

// Helper to send SSE message with token usage
function sendSseMessage(controller: TransformStreamDefaultController, event: string, data: any) {
    const message = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    controller.enqueue(encoder.encode(message));
}

// --- Configuration ---
const API_KEY = process.env.GEMINI_API_KEY || ''; 
const MODEL_NAME = "gemini-2.5-pro"; 

// --- File Paths ---
const SCHEMA_PATH = path.join(process.cwd(), "schema.json");

/**
 * A helper function to read content from a file.
 * @param filePath The path to the file.
 * @returns The file content as a string.
 */
async function readFileContent(filePath: string): Promise<string> {
    try {
        return await fs.readFile(filePath, 'utf-8');
    } catch (error) {
        console.error(`Error: File not found or could not be read at path: ${filePath}`, error);
        return "";
    }
}

/**
 * Dynamically creates a JSON response schema for the AI model based on benchmark criteria.
 * @param instructions The specific 'instruction for roleplay' object for a single main question.
 * @returns A JSON schema object for the generative model.
 */
function createDynamicJsonSchema(instructions: any): any | null {
    const properties: { [key: string]: any } = {};
    const required: string[] = [];

    try {
        if (!instructions) {
            console.warn("Warning: 'instructions' object provided to createDynamicJsonSchema is null or undefined.");
            return null;
        }

        // Find all keys that are numbers (representing the benchmark criteria)
        const benchmarkKeys = Object.keys(instructions).filter(k => !isNaN(Number(k))).sort((a, b) => Number(a) - Number(b));
        
        if (benchmarkKeys.length === 0) {
            console.warn("Warning: No numbered benchmark criteria found in the instructions object.");
            return null;
        }

        // Build properties and required fields for each benchmark criterion
        for (const key of benchmarkKeys) {
            const perfKey = `performance_observed_${key}`;
            const actionKey = `example_action_${key}`;

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
        
        // Add the conclusion to the schema
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


/**
 * Main API handler for POST requests.
 */
export async function POST(req: NextRequest) {
    if (!API_KEY) {
        return new NextResponse(encoder.encode(JSON.stringify({ error: "Gemini API key not configured." })), { status: 500 });
    }

    const { studentName, transcript, gender } = await req.json();

    if (!transcript) {
        return new NextResponse(encoder.encode(JSON.stringify({ error: "Missing 'transcript' in request body." })), { status: 400 });
    }

    const readableStream = new ReadableStream({
        async start(controller) {
            try {
                const ai = new GoogleGenAI({ apiKey: API_KEY });
                const model = MODEL_NAME;

                const schemaJsonText = await readFileContent(SCHEMA_PATH);
                if (!schemaJsonText) {
                    controller.enqueue(encoder.encode(`event: error\ndata: ${JSON.stringify({ message: "schema.json could not be read." })}\n\n`));
                    controller.close();
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

Reference the Assessment Guide:
Locate the corresponding question in the Assessment Guide to understand the required criteria.
Pay close attention to the structure, headings (e.g., "Performance to Observe," "Example Actions"), and the level of detail expected in a benchmark answer. The guide is your template for style and format.

Synthesize and Write the Benchmark Answer:
Begin writing the new benchmark answer.
Under headings like "Performance to Observe," describe what the student actually did in the transcript. Synthesize their performance into a professional evaluation. For example: "(student name) effectively demonstrated respect for cultural identity by asking the client about..."
Under headings like "Example Actions," provide direct examples or close paraphrases from the transcript to justify your evaluation. For instance: Example Action: (student name) stated, "I understand that your faith is important to you, so I ensured the art group is women-only and respects cultural attire." This directly addresses the criterion.
Write a concise "Conclusion" that summarizes whether the student's performance in the transcript successfully met the requirements of the unit.

Apply Mandatory Formatting and Placeholders:
Structure: Your generated answer must follow the structure of the benchmark examples in the Assessment Guide (e.g., numbered points, bold headings, etc.).
Placeholders:
Use the placeholder (student name) when referring to the student.
Use the gender-neutral pronouns (he/She) and (his/her) as needed.

Repeat for All Questions:
Follow this process for every question and corresponding transcript section provided.`;

                const allResults: { [key: string]: any } = {};

                for (const unitCode of Object.keys(parsedSchemaGuide)) {
                    const unitData = parsedSchemaGuide[unitCode];

                    for (const mainQuestionKey of Object.keys(unitData).filter(key => key !== 'assessment_guide')) {
                        console.log(`Processing Unit: ${unitCode}, Question Key: '${mainQuestionKey}'`);
                        controller.enqueue(encoder.encode(`event: processing\ndata: ${JSON.stringify({ unitCode, mainQuestionKey })}\n\n`));

                        const questionData = unitData[mainQuestionKey];
                        const instructions = questionData.rolePlayScenerio?.['instruction for roleplay'];

                        if (!instructions) {
                            console.warn(`Skipping ${unitCode} - Question ${mainQuestionKey} due to missing instructions.`);
                            controller.enqueue(encoder.encode(`event: error\ndata: ${JSON.stringify({ unitCode, mainQuestionKey, message: "Missing instructions." })}\n\n`));
                            continue;
                        }

                        const dynamicSchema = createDynamicJsonSchema(instructions);
                        if (!dynamicSchema) {
                            console.warn(`Skipping ${unitCode} - Question ${mainQuestionKey} due to schema generation failure.`);
                            controller.enqueue(encoder.encode(`event: error\ndata: ${JSON.stringify({ unitCode, mainQuestionKey, message: "Schema generation failed." })}\n\n`));
                            continue;
                        }

                        const finalUserPrompt = `${systemPromptText}


Here is the student's transcript:
--- TRANSCRIPT START ---
${transcript}
--- TRANSCRIPT END ---

Here is the JSON guide for the assessment structure and content:
--- JSON GUIDE START ---
${schemaJsonText}
--- JSON GUIDE END ---

Here is the assessment guide content from the JSON guide:
--- ASSESSMENT GUIDE CONTENT START ---
${questionData.assessmentGuideContent}
--- ASSESSMENT GUIDE CONTENT END ---

**Your Task:**
You must act as the VET Assessor. Your goal is to generate the final, real benchmark answer by analyzing the **transcript** and following the structure provided in the **JSON guide** above.

**Output Instructions:**
Your response MUST be a single, valid JSON object that strictly adheres to the following JSON Schema. Do NOT include any text, explanations, or markdown formatting outside of the JSON object itself.`;

                        const contents = [{
                            role: 'user',
                            parts: [{ text: finalUserPrompt }],
                        }];

                        const config = {
                            responseMimeType: 'application/json',
                            responseSchema: dynamicSchema,
                            temperature: 0.2,
                        };

                        console.log(`Generating response for ${unitCode}, Question ${mainQuestionKey}...`);

                        try {
                            const responseStream = await ai.models.generateContentStream({ model, config, contents });
                            let responseContent = '';
                            // Get response content from stream
                            for await (const chunk of responseStream) {
                                responseContent += chunk.text;
                            }
                            
                            // Estimate tokens based on text length (rough approximation)
                            const estimatedTokens = Math.ceil(responseContent.length / 4);
                            
                            // Send token usage event
                            controller.enqueue(encoder.encode(`event: token_usage\ndata: ${JSON.stringify({ 
                                section: `${unitCode}-${mainQuestionKey}`,
                                tokens: estimatedTokens
                            })}\n\n`));

                            if (!responseContent) {
                                console.error(`No valid response content from AI for ${unitCode}, Question ${mainQuestionKey}`);
                                controller.enqueue(encoder.encode(`event: error\ndata: ${JSON.stringify({ unitCode, mainQuestionKey, message: "No valid response content from AI." })}\n\n`));
                                continue;
                            }

                            const parsedAiJson = JSON.parse(responseContent);

                            const formattedEvaluation: { [key: string]: any } = {};
                            const benchmarkKeys = Object.keys(instructions).filter(k => !isNaN(Number(k)));

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

                            if (!allResults[unitCode]) {
                                allResults[unitCode] = {};
                            }
                            allResults[unitCode][mainQuestionKey] = result;

                            controller.enqueue(encoder.encode(`event: completed\ndata: ${JSON.stringify({ unitCode, mainQuestionKey, result })}\n\n`));

                        } catch (error: any) {
                            console.error(`Error generating content for ${unitCode}, Question ${mainQuestionKey}:`, error.message);
                            
                            // Check for 429 (Too Many Requests) error
                            if (error.status === 429 || (error.message && error.message.includes('429 Too Many Requests'))) {
                                controller.enqueue(encoder.encode(`event: error\ndata: ${JSON.stringify({ unitCode, mainQuestionKey, message: error.message, fatal: true })}\n\n`));
                                controller.close();
                                return; // Stop processing all further questions and exit
                            }

                            controller.enqueue(encoder.encode(`event: error\ndata: ${JSON.stringify({ unitCode, mainQuestionKey, message: error.message })}\n\n`));
                        }
                    }
                }
                controller.enqueue(encoder.encode(`event: done\ndata: ${JSON.stringify(allResults)}\n\n`));
                controller.close();

            } catch (error: any) {
                console.error("Error in API route:", error.message, error.stack);
                // Check for 429 (Too Many Requests) error at a higher level if it propagates here
                if (error.status === 429 || (error.message && error.message.includes('429 Too Many Requests'))) {
                    controller.enqueue(encoder.encode(`event: error\ndata: ${JSON.stringify({ message: error.message, fatal: true })}\n\n`));
                    controller.close();
                    return; // Stop processing all further questions and exit
                }
                controller.enqueue(encoder.encode(`event: error\ndata: ${JSON.stringify({ message: error.message || "An unexpected error occurred." })}\n\n`));
                controller.close();
            }
        },
    });

    return createSseResponse(readableStream);
}
