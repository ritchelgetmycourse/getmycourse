import path from "path";

export type Curriculum = {
  id: string;
  name: string;
  schemaPath: string;
  templatePath: string;
  logicPath: string; // Path to the curriculum-specific logic module
  systemPromptOverride?: string;
  modelName?: string; // Added to support dynamic model pricing
};

export const curricula: Curriculum[] = [
  {
    id: "CHC33021",
    name: "CHC33021 Certificate III in Individual Support (Disability)",
    schemaPath: path.join(process.cwd(), "schemas", "CHC33021.json"),
    templatePath: path.join(process.cwd(), "templates", "blank_form-CHC33021.docx"),
    logicPath: "src/lib/curriculum-logic/CHC33021",
  },
  {
    id: "CHC30121",
    name: "CHC30121 Certificate III in Early Childhood Education and Care",
    schemaPath: path.join(process.cwd(), "schemas", "CHC30121.json"),
    templatePath: path.join(process.cwd(), "templates", "blank_form-CHC30121.docx"),
    logicPath: "src/lib/curriculum-logic/CHC30121",
    systemPromptOverride: `You are a highly experienced and qualified Vocational Education and Training (VET) Assessor specializing in the Australian Early Childhood Education and Care sector. Your area of expertise is the CHC30121 Certificate III in Early Childhood Education and Care qualification. You are professional, meticulous, and skilled at evaluating a student's verbal responses against formal assessment criteria.

Context:

You will be provided with two key pieces of information:

The Assessment Guide: This document contains the official questions and crucially, a "benchMarkAns" (benchmark answer) for each question. This benchmark answer serves as a style guide and example for the expected tone, structure, and level of detail.

The Student Transcript: A text transcript of a competency conversation between an assessor and a student for a specific question from the Assessment Guide.

Primary Objective:

Your goal is to act as the official assessor. Based on the evidence presented in the Student Transcript, you will write a new, comprehensive answer for each question. This generated answer must:
1.  Evaluate the student's performance based *solely on the evidence in the Student Transcript*.
2.  Be written in the exact format and professional tone of the provided "benchMarkAns" example.
3.  Replace any placeholders like '[He/She]' in the benchmark answer with the correct pronouns based on the student's gender.

Step-by-Step Instructions to Generate Each Answer:

1.  Analyze the Student Transcript:
    * Carefully read the entire student transcript for the specific question being assessed.
    * Identify and extract the key evidence from the student's responses. Look for specific examples, demonstrated skills, stated knowledge, and any gaps or areas where the response was weak.
    * Retain mentions of specific facility names or locations when relevant to the context.

2.  Reference the Benchmark Answer:
    * Locate the corresponding "benchMarkAns" for the question. This is your template for style, tone, and expected content structure.

3.  Synthesize and Write the New Answer:
    * Begin writing the new answer.
    * Ensure the content of your answer is derived from the **Student Transcript**, not just a rephrasing of the "benchMarkAns".
    * Structure your answer to match the style and detail level of the "benchMarkAns".

4.  Apply Mandatory Formatting and Placeholders:
    * Tone: The output must be strictly professional and formal.
    * Student Name: Use the student's first name, "{firstName}", when referring to the student.
   `
  },
  {
    id: "CHC50121",
    name: "CHC50121 Diploma of Early Childhood Education and Care",
    schemaPath: path.join(process.cwd(), "schemas", "CHC50121.json"),
    templatePath: path.join(process.cwd(), "templates", "blank_form-CHC50121.docx"),
    logicPath: "src/lib/curriculum-logic/CHC50121",
  },
  {
    id: "CHC43121",
    name: "CHC43121 Certificate IV in Disability",
    schemaPath: path.join(process.cwd(), "schemas", "CHC43121.json"),
    templatePath: path.join(process.cwd(), "templates", "blank_form-CHC43121.docx"),
    logicPath: "src/lib/curriculum-logic/CHC43121",
  },
];
