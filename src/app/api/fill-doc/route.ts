import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs/promises";
import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import Docxtemplater from "docxtemplater";
import PizZip from "pizzip";

export const runtime = "nodejs"; // Required to use 'fs' in Next.js App Router

// Define a type for the nested answer structure
type Answers = Record<string, any>;

// Path to your master schema file, which is the source of truth
const SCHEMA_PATH = path.join(process.cwd(), "schema.json");

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
function transformAndFormatAnswers(aiAnswers: Answers, studentName: string, masterSchema: Answers): Record<string, any> {
    const transformedData: Record<string, any> = {};
    const studentNameRegex = /\(student name\)/gi;
    const maxQuestionNumber = 20; // Assuming no more than 20 questions per unit

    // Use the master schema as the source of truth for all unit codes
    const allUnitCodes = Object.keys(masterSchema);

    for (const unitCode of allUnitCodes) {
        for (let i = 1; i <= maxQuestionNumber; i++) {
            const questionKey = String(i);
            const placeholderKey = `${unitCode}_${questionKey}`;
            
            const aiQuestionData = aiAnswers?.[unitCode]?.[questionKey];

            if (aiQuestionData && aiQuestionData.evaluation) {
                let combinedContent = "";
                const evaluation = aiQuestionData.evaluation;

                for (const benchmarkKey in evaluation) {
                    const benchmark = evaluation[benchmarkKey];
                    const question = benchmark.question || '';
                    const performance = (benchmark.performance_observed || 'N/A').replace(studentNameRegex, studentName);
                    const action = (benchmark.example_action || 'N/A').replace(studentNameRegex, studentName);

                    combinedContent += `${benchmarkKey}. ${question}\n\n`; 
                    combinedContent += `Performance to Observe: ${performance}\n`;
                    combinedContent += `Example Action: ${action}\n\n`;
                }
                
                const conclusion = (aiQuestionData.conclusion || 'N/A').replace(studentNameRegex, studentName);
                combinedContent += `Conclusion\n${conclusion}`;

                transformedData[placeholderKey] = combinedContent;
            }
        }
    }
    
    transformedData["Student_Name"] = studentName;

    return transformedData;
}


export async function POST(req: NextRequest) {
    try {
        const { studentName, answers } = (await req.json()) as {
            studentName?: string;
            answers?: Answers;
        };

        if (!studentName || !answers || typeof answers !== "object") {
            return NextResponse.json(
                { ok: false, error: "studentName and answers are required." },
                { status: 400 }
            );
        }

        const root = process.cwd();

        const templatePath = path.join(root, "templates", "blank_form.docx");
        const schemaJsonText = await fs.readFile(SCHEMA_PATH, 'utf-8');
        const masterSchema = JSON.parse(schemaJsonText);

        if (!existsSync(templatePath)) {
            return NextResponse.json(
                { ok: false, error: "templates/blank_form.docx not found." },
                { status: 404 }
            );
        }

        const dataForDocx = transformAndFormatAnswers(answers, studentName, masterSchema);
        
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

        const outDir = path.join(root, "output");
        if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });

        const filename = `${sanitizeFilename(studentName)}_CHC33021.docx`;
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
        // Provide more detailed error logging for docxtemplater
        if (err.properties && err.properties.errors) {
            console.error("Docxtemplater errors:", err.properties.errors);
        }
        return NextResponse.json(
            { ok: false, error: err?.message || "Failed to fill doc" },
            { status: 500 }
        );
    }
}
