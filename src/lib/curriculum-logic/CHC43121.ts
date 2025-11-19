import { Type } from '@google/genai';

export function createDynamicJsonSchemaCHC43121(questionData: any): any | null {
    try {
        if (!questionData || !questionData.benchMarkAns) {
            console.warn("Warning: 'questionData' or 'benchMarkAns' is missing for createDynamicJsonSchemaCHC43121.");
            return null;
        }

        // For this curriculum, the AI's output will be a single generated answer
        // that follows the style of the benchMarkAns.
        return {
            type: Type.OBJECT,
            properties: {
                generatedAnswer: {
                    type: Type.STRING,
                    description: `Generate a comprehensive answer for the question based on the student's transcript, using the provided 'benchMarkAns' as a style and format guide. Ensure all placeholders like '[He/She]' are replaced with appropriate pronouns based on the student's gender.`
                }
            },
            required: ['generatedAnswer'],
        };

    } catch (e) {
        console.error(`Error: Could not create dynamic JSON schema for CHC43121: ${e}`);
        return null;
    }
}

export const systemPromptTextCHC43121 = (firstName: string) => `You are a highly experienced and qualified Vocational Education and Training (VET) Assessor specializing in the Australian Disability Support sector. Your area of expertise is the CHC43121 Certificate IV in Disability Support qualification. You are professional, meticulous, and skilled at evaluating a student's verbal responses against formal assessment criteria.

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
    * Student Name: Use the student's first name, "${firstName}", when referring to the student.
    * Pronouns: Refer to the student using the correct pronouns based on their gender (e.g., "he", "she", "him", "her", "his", "her"). Do NOT use any placeholders like '[He/She]' or '{PRONOUN_SUBJECT}' in your generated answer. Use the actual pronouns directly.`;

type Answers = Record<string, any>;

export function transformAndFormatAnswersCHC43121(aiAnswers: Answers, studentName: string, masterSchema: Answers): Record<string, any> {
    const transformedData: Record<string, any> = {};
    const studentNameRegex = /\(student name\)/gi;
    const firstNameRegex = /{firstName}/gi;
    const maxQuestionNumber = 30;

    // Use the master schema as the source of truth for all unit codes
    const allUnitCodes = Object.keys(masterSchema);

    for (const unitCode of allUnitCodes) {
        for (let i = 1; i <= maxQuestionNumber; i++) {
            const questionKey = String(i);
            const placeholderKey = `${unitCode}_${questionKey}`;
            
            const aiQuestionData = aiAnswers?.[unitCode]?.[questionKey];

            if (aiQuestionData && aiQuestionData.generatedAnswer) {
                // For template-based curricula, the AI directly provides the generated answer
                transformedData[placeholderKey] = aiQuestionData.generatedAnswer
                    .replace(studentNameRegex, studentName)
                    .replace(firstNameRegex, studentName);
            }
        }
    }
    
    transformedData["Student_Name"] = studentName;

    return transformedData;
}
