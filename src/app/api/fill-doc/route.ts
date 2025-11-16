import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs/promises";
import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import Docxtemplater from "docxtemplater";
import PizZip from "pizzip";
import { curricula, Curriculum } from '../../../config/curricula';
import { transformAndFormatAnswersCHC33021 } from '../../../lib/curriculum-logic/CHC33021';
import { transformAndFormatAnswersCHC30121 } from '../../../lib/curriculum-logic/CHC30121';

export const runtime = "nodejs"; // Required to use 'fs' in Next.js App Router

// Define a type for the nested answer structure
type Answers = Record<string, any>;

/**
 * Sanitizes a string to be used as a valid filename.
 * @param name The original name string.
 * @returns A safe filename string.
 */
function sanitizeFilename(name: string): string {
    return (name || "").replace(/[\\/:*?"<>|]+/g, "_").trim() || "Student";
}

/**
 * Transforms the nested AI response into a flat object suitable for the DOCX template.
 * It uses a master schema to ensure all expected placeholders are created,
 * preventing crashes from incomplete AI responses.
 *
 * @param aiAnswers The potentially incomplete JSON object from the AI.
 * @param studentName The name of the student to inject.
 * @param masterSchema The complete schema object read from schema.json.
 * @returns A flat object with keys like 'CHCCCS038_1' guaranteed for every question in the master schema.
 */


export async function POST(req: NextRequest) {
    try {
        const { studentName, gender, answers, curriculumId } = (await req.json()) as {
            studentName?: string;
            gender?: string;
            answers?: Answers;
            curriculumId?: string;
        };

        if (!studentName || !gender || !answers || typeof answers !== "object" || !curriculumId) {
            return NextResponse.json(
                { ok: false, error: "studentName, gender, answers, and curriculumId are required." },
                { status: 400 }
            );
        }

        const selectedCurriculum = curricula.find((c: Curriculum) => c.id === curriculumId);
        if (!selectedCurriculum) {
            return NextResponse.json(
                { ok: false, error: `Curriculum with ID ${curriculumId} not found.` },
                { status: 400 }
            );
        }

        // Use /tmp for temporary file storage in serverless environments like Vercel
        const tempDir = "/tmp";
        
        // Handle both absolute and relative template paths
        let templatePath: string;
        if (path.isAbsolute(selectedCurriculum.templatePath)) {
            templatePath = selectedCurriculum.templatePath;
        } else {
            templatePath = path.join(process.cwd(), selectedCurriculum.templatePath);
        }
        
        const schemaJsonText = await fs.readFile(selectedCurriculum.schemaPath, 'utf-8');
        const masterSchema = JSON.parse(schemaJsonText);

        if (!existsSync(templatePath)) {
            return NextResponse.json(
                { ok: false, error: `${templatePath} not found.` },
                { status: 404 }
            );
        }

        let dataForDocx: Record<string, any>;
        if (selectedCurriculum.id === "CHC33021") {
            dataForDocx = transformAndFormatAnswersCHC33021(answers, studentName, masterSchema);
        } else if (selectedCurriculum.id === "CHC30121") {
            dataForDocx = transformAndFormatAnswersCHC30121(answers, studentName, masterSchema);
        } else {
            // Fallback or error for unsupported curriculum types
            return NextResponse.json(
                { ok: false, error: `Unsupported curriculum ID for document filling: ${curriculumId}` },
                { status: 400 }
            );
        }
        console.log(`Data for DOCX template for ${curriculumId}:`, JSON.stringify(dataForDocx, null, 2)); // Log DOCX data

        const templateBuf = await fs.readFile(templatePath);

        const zip = new PizZip(templateBuf);

        const nullGetter = (part: any) => {
            return `{{${part.value}}}`;
        };

        const doc = new Docxtemplater(zip, {
            paragraphLoop: true,
            linebreaks: true,
            delimiters: {
                start: "{{",
                end: "}}",
            },
            nullGetter,
        });

        doc.setData(dataForDocx);
        doc.render();

        const rendered = doc.getZip().generate({
            type: "nodebuffer",
            compression: "DEFLATE",
        });

        const outDir = path.join(tempDir, "output");
        if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });

        const filename = `${sanitizeFilename(studentName)}_${curriculumId}.docx`;
        const outPath = path.join(outDir, filename);
        await fs.writeFile(outPath, rendered);

        const base64Docx = Buffer.from(rendered).toString("base64");
        return NextResponse.json({
            ok: true,
            filename,
            savedPath: `output/${filename}`,
            base64Docx,
        });
    } catch (err: any) {
        console.error("Doc Gen Error:", err);

        // Enhanced logging for Docxtemplater errors
        if (err.properties && err.properties.errors) {
            console.error("Docxtemplater detailed errors:");
            err.properties.errors.forEach((e: any, index: number) => {
                console.error(`Error #${index + 1}:`);
                console.error(`  Explanation: ${e.explanation}`);
                console.error(`  Tag ID: ${e.properties?.id || "unknown"}`);
                console.error(`  Offending placeholder: ${e.properties?.tag || "N/A"}`);
                console.error(`  Full error object:`, JSON.stringify(e, null, 2));
            });
        } else {
            console.error("No detailed Docxtemplater error properties found. Full error object:", err);
        }

        // Return detailed error info in response for debugging
        return NextResponse.json(
            {
                ok: false,
                error: err?.message || "Failed to fill doc",
                details: err?.properties?.errors?.map((e: any) => ({
                    explanation: e.explanation || "No explanation available",
                    tag: e.properties?.tag || e.properties?.id || "Unknown tag",
                    full: e,
                })) || [{ message: "No detailed error info available", fullError: err }],
            },
            { status: 500 }
        );
    }
}
