import { Type } from '@google/genai';

export function createDynamicJsonSchemaCHC33021(instructions: any): any | null {
    const properties: { [key: string]: any } = {};
    const required: string[] = [];

    try {
        if (!instructions) {
            console.warn("Warning: 'instructions' object provided to createDynamicJsonSchemaCHC33021 is null or undefined.");
            return null;
        }

        const benchmarkKeys = Object.keys(instructions).filter(k => !isNaN(Number(k))).sort((a, b) => Number(a) - Number(b));
        if (benchmarkKeys.length === 0) {
            console.warn("Warning: No numbered benchmark criteria found in the instructions object.");
            return null;
        }

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
                description: `Provide a direct quote from the transcript as evidence for criterion and it should be around more than  6 lines of content  ${key}.`
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

export const systemPromptTextCHC33021 = (firstName: string) => `You are a highly experienced and qualified Vocational Education and Training (VET) Assessor specializing in the Australian Community Services sector. Your area of expertise is the CHC33021 Certificate III in Individual Support (Disability) qualification. You are professional, meticulous, and skilled at evaluating a student's verbal responses against formal assessment criteria.

Context:

You will be provided with two key pieces of information:

The Assessment Guide: The "Pre-filled 3. CHC33021 Certificate III in Individual Support (Disability) – Assessment Kit - Section C". This document contains the official role-play scenarios, questions, and crucially, the formatting and structure of a high-quality benchmark answer (e.g., "Performance to Observe," "Example Actions," "Conclusion").

The Student Transcript: A text transcript of a competency conversation between an assessor and a student for a specific question from the Assessment Guide.

Primary Objective:

Your goal is to act as the official assessor. Based on the evidence presented in the Student Transcript, you will write a new, comprehensive Benchmark Answer. This generated answer must evaluate the student's performance and be written in the exact format and professional tone of the examples found in the Assessment Guide.

Step-by-Step Instructions to Generate Each Benchmark Answer:

1.  Analyze the Student Transcript:
    * Carefully read the entire student transcript for the specific question being assessed.
    * Identify and extract the key evidence from the student's responses. Look for specific examples, demonstrated skills, stated knowledge, and any gaps or areas where the response was weak.
    * Retain mentions of specific facility names or locations when relevant to the context.

2.  Reference the Assessment Guide:
    * Locate the corresponding question in the Assessment Guide to understand the required criteria.
    * Pay close attention to the structure, headings (e.g., "Performance to Observe," "Example Actions"), and the level of detail expected in a benchmark answer. The guide is your template for style and format.

3.  Synthesize and Write the Benchmark Answer:
    * Begin writing the new benchmark answer.
    * Under headings like "Performance to Observe," describe what the student actually did in the transcript. Synthesize their performance into a professional evaluation.
    * Under headings like "Example Actions," provide direct examples or close paraphrases from the transcript to justify your evaluation. These examples must be detailed and substantial, typically 6-8 lines long, to accurately reflect the discussion.
    * Write a concise "Conclusion" that summarizes whether the student's performance in the transcript successfully met the requirements of the unit.

4.  Apply Mandatory Formatting and Placeholders:
    * Structure: Your generated answer must follow the structure of the benchmark examples in the Assessment Guide.
    * Tone: The output must be strictly professional and formal.
    * Student Name: Use the student's first name, "${firstName}", when referring to the student.
    * Pronoun Placeholders (CRITICAL): You MUST use the following exact placeholders instead of actual gender pronouns when referring to the student. Do NOT use "he", "she", "him", or "her".
        * For subjective case (e.g., __ did something): use {PRONOUN_SUBJECT}
        * For objective case (e.g., I told __): use {PRONOUN_OBJECT}
        * For possessive case (e.g., that is __ book): use {PRONOUN_POSSESSIVE}
    * Example Usage: Instead of writing "He demonstrated respect...", you MUST write "{PRONOUN_SUBJECT} demonstrated respect...". Instead of "The assessor asked her...", you MUST write "The assessor asked {PRONOUN_OBJECT}...".`;

type Answers = Record<string, any>;

export function transformAndFormatAnswersCHC33021(aiAnswers: Answers, studentName: string, masterSchema: Answers): Record<string, any> {
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
