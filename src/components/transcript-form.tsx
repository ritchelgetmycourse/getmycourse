"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import * as z from "zod";
import { useState, useEffect } from "react";
import { Loader2, Download, CheckCircle, XCircle, CircleDashed } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Form, FormControl, FormField, FormItem, FormLabel, FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";

const formSchema = z.object({
  studentName: z.string().min(2, "Student name must be at least 2 characters."),
  transcript: z.string().min(50, "Transcript must be at least 50 characters."),
  gender: z.enum(["male", "female"], {
    required_error: "You need to select a gender.",
  }),
});

export function TranscriptForm() {
  const [isGenerating, setIsGenerating] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  const [generatedReport, setGeneratedReport] = useState<any>(null);
  const [processingStatus, setProcessingStatus] = useState<Record<string, Record<string, { status: 'idle' | 'processing' | 'completed' | 'error'; message?: string }>>>({});
  const [shouldStop, setShouldStop] = useState(false);
  const [tokenUsage, setTokenUsage] = useState<Record<string, number>>({});
  const totalTokens = Object.values(tokenUsage).reduce((a: number, b: number) => a + b, 0);
  const { toast } = useToast();

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      studentName: "",
      transcript: "",
      gender: "male",
    },
  });

  // Helper function to trigger the download from a base64 string
  function downloadBase64Docx(base64: string, filename: string) {
    const binary = atob(base64);
    const len = binary.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i += 1) bytes[i] = binary.charCodeAt(i);
    const blob = new Blob([bytes], {
      type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename || "output.docx";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  // Step 1: Generate the JSON report from the transcript
  async function onGenerate(values: z.infer<typeof formSchema>) {
    // TODO: Verify stream handling after server/browser refresh
    setIsGenerating(true);
    setGeneratedReport(null);
    setProcessingStatus({}); // Clear previous processing status
    setShouldStop(false);
    setTokenUsage({});

    let accumulatedResults: any = {};

    try {
      const genRes = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(values),
      });

      if (!genRes.ok || !genRes.body) {
        const err = await genRes.json().catch(() => ({}));
        throw new Error(err?.error || "Failed to initiate report generation or no stream available.");
      }

      const reader = genRes.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }

        buffer += decoder.decode(value, { stream: true });

        console.log("Buffer content:", buffer); // Log buffer content

        const events = buffer.split('\n\n');
        buffer = events.pop() || '';

        for (const eventString of events) {
          if (eventString.trim() === '') continue;

          const lines = eventString.split('\n');
          let eventType = 'message';
          let eventData = '';

          for (const line of lines) {
            if (line.startsWith('event: ')) {
              eventType = line.substring('event: '.length);
            } else if (line.startsWith('data: ')) {
              eventData += line.substring('data: '.length);
            }
          }

          try {
            const data = JSON.parse(eventData);
            console.log("SSE Message:", eventType, data);

            if (eventType === "token_usage") {
              setTokenUsage(prev => ({
                ...prev,
                [data.section]: (prev[data.section] || 0) + data.tokens
              }));
            } else if (eventType === "processing") {
              setProcessingStatus(prev => ({
                ...prev,
                [data.unitCode]: {
                  ...(prev[data.unitCode] || {}),
                  [data.mainQuestionKey]: { status: 'processing' }
                }
              }));
            } else if (eventType === "completed") {
              setProcessingStatus(prev => ({
                ...prev,
                [data.unitCode]: {
                  ...(prev[data.unitCode] || {}),
                  [data.mainQuestionKey]: { status: 'completed' }
                }
              }));
              if (!accumulatedResults[data.unitCode]) {
                accumulatedResults[data.unitCode] = {};
              }
              accumulatedResults[data.unitCode][data.mainQuestionKey] = data.result;
            } else if (eventType === "error") {
              setProcessingStatus(prev => ({
                ...prev,
                [data.unitCode]: {
                  ...(prev[data.unitCode] || {}),
                  [data.mainQuestionKey]: { status: 'error', message: data.message }
                }
              }));
              toast({
                variant: "destructive",
                title: `Error for ${data.unitCode} - ${data.mainQuestionKey}`,
                description: data.message, // Use the message from the backend directly
              });
              if (data.fatal) {
                setIsGenerating(false); // Stop loading on fatal error
                reader.cancel(); // Cancel the reader to stop the stream
                break; // Exit the loop
              }
            } else if (eventType === "done") {
              setGeneratedReport(accumulatedResults);
              setIsGenerating(false);
              toast({
                title: "Report Generated Successfully!",
                description: "You can now review the JSON and download the DOCX file.",
              });
              // Automatically trigger download after successful generation
              if (Object.keys(accumulatedResults).length > 0) {
                await onDownload();
              }
              break;
            }
          } catch (parseError) {
            console.error("Failed to parse SSE data:", parseError, eventData);
          }
        }
      }
      // After the while loop, ensure final state is set if 'done' event wasn't received or processed
      if (isGenerating) {
          setIsGenerating(false);
          toast({
              variant: "destructive",
              title: "Generation Interrupted",
              description: "The streaming connection ended unexpectedly.",
          });
      }

    } catch (error) {
      const msg = error instanceof Error ? error.message : "An unexpected error occurred.";
      toast({
        variant: "destructive",
        title: "Generation Failed",
        description: msg,
      });
      setIsGenerating(false);
    }
  }

  // Step 2: Fill the DOCX with the generated JSON and download it
  async function onDownload() {
    if (!generatedReport) {
      toast({
        variant: "destructive",
        title: "No Report Data",
        description: "Please generate a report first before downloading.",
      });
      return;
    }

    setIsDownloading(true);
    try {
      const fillRes = await fetch("/api/fill-doc", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          studentName: form.getValues().studentName,
          answers: generatedReport, // Use the JSON stored in state
        }),
      });

      if (!fillRes.ok) {
        const err = await fillRes.json().catch(() => ({}));
        throw new Error(err?.error || "Failed to create the DOCX file.");
      }

      const fillData = await fillRes.json();
      if (!fillData?.ok || !fillData?.base64Docx) {
        throw new Error("API response was missing the document data.");
      }

      downloadBase64Docx(fillData.base64Docx, fillData.filename);

      toast({
        title: "Download Successful",
        description: `${fillData.filename} has been downloaded.`,
      });
    } catch (error) {
      const msg = error instanceof Error ? error.message : "An unexpected error occurred.";
      toast({
        variant: "destructive",
        title: "Download Failed",
        description: msg,
      });
    } finally {
      setIsDownloading(false);
    }
  }

  return (
    <Card className="w-full shadow-lg border-2 border-transparent hover:border-primary/20 transition-all duration-300">
      <CardHeader>
        <CardTitle className="font-headline text-2xl">Enter Student Details</CardTitle>
        <CardDescription>
          First, generate the report data from the transcript. Then, download the completed DOCX file.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onGenerate)} className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
              {/* Student Name and Gender FormFields remain the same */}
               <FormField
                control={form.control}
                name="studentName"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="font-headline">Student Name</FormLabel>
                    <FormControl>
                      <Input placeholder="e.g. John Doe" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="gender"
                render={({ field }) => (
                  <FormItem className="space-y-3">
                    <FormLabel className="font-headline">Gender</FormLabel>
                    <FormControl>
                      <RadioGroup
                        onValueChange={field.onChange}
                        defaultValue={field.value}
                        className="flex items-center space-x-6 pt-2"
                      >
                        <FormItem className="flex items-center space-x-3 space-y-0">
                          <FormControl>
                            <RadioGroupItem value="male" />
                          </FormControl>
                          <FormLabel className="font-normal font-body">Male</FormLabel>
                        </FormItem>
                        <FormItem className="flex items-center space-x-3 space-y-0">
                          <FormControl>
                            <RadioGroupItem value="female" />
                          </FormControl>
                          <FormLabel className="font-normal font-body">Female</FormLabel>
                        </FormItem>
                      </RadioGroup>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
            
            <FormField
              control={form.control}
              name="transcript"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="font-headline">Transcript</FormLabel>
                  <FormControl>
                    <Textarea
                      placeholder="Paste the full student transcript here..."
                      className="min-h-[350px] resize-y font-body"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="flex flex-col sm:flex-row justify-end pt-4 gap-4">
              {isGenerating ? (
                <Button
                  type="button"
                  onClick={() => setShouldStop(true)}
                  className="w-full sm:w-auto"
                  size="lg"
                  variant="destructive"
                >
                  Stop Generation
                </Button>
              ) : (
                <Button
                  type="submit"
                  disabled={isDownloading}
                  className="w-full sm:w-auto"
                  size="lg"
                >
                  Generate Report
                </Button>
              )}

              <Button
                type="button" // Important: prevents form submission
                onClick={onDownload}
                disabled={!generatedReport || isGenerating || isDownloading}
                className="w-full sm:w-auto bg-accent text-accent-foreground hover:bg-accent/90"
                size="lg"
              >
                {isDownloading ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Preparing Download…
                  </>
                ) : (
                  <>
                    <Download className="mr-2 h-4 w-4" />
                    Download DOCX
                  </>
                )}
              </Button>
            </div>
          </form>
        </Form>

        {generatedReport && (
          <div className="mt-8 p-6 bg-gray-100 dark:bg-gray-800 rounded-lg shadow-inner">
            <h3 className="font-headline text-xl mb-4">Generated Report (JSON)</h3>
            <pre className="bg-gray-50 dark:bg-gray-900 p-4 rounded-md overflow-auto text-sm">
              <code>{JSON.stringify(generatedReport, null, 2)}</code>
            </pre>
          </div>
        )}

        {/* Token Usage Display */}
        {Object.keys(tokenUsage).length > 0 && (
          <div className="mt-8 p-6 bg-gray-100 dark:bg-gray-800 rounded-lg shadow-inner">
            <h3 className="font-headline text-xl mb-4">Token Usage</h3>
            <ul className="space-y-2">
              {Object.entries(tokenUsage).map(([section, tokens]) => (
                <li key={section} className="font-body">
                  {section}: {tokens} tokens
                </li>
              ))}
              <li className="font-body font-semibold">
                Total: {totalTokens} tokens
              </li>
            </ul>
          </div>
        )}

        {Object.keys(processingStatus).length > 0 && (
          <div className="mt-8 p-6 bg-gray-100 dark:bg-gray-800 rounded-lg shadow-inner">
            <h3 className="font-headline text-xl mb-4">LLM Processing Status</h3>
            {Object.entries(processingStatus).map(([unitCode, questions]) => (
              <div key={unitCode} className="mb-4">
                <h4 className="font-semibold text-lg mb-2">{unitCode}</h4>
                <ul className="space-y-2">
                  {Object.entries(questions).map(([questionKey, statusData]) => (
                    <li key={questionKey} className="flex items-center space-x-2">
                      {statusData.status === 'processing' && <Loader2 className="h-4 w-4 animate-spin text-blue-500" />}
                      {statusData.status === 'completed' && <CheckCircle className="h-4 w-4 text-green-500" />}
                      {statusData.status === 'error' && <XCircle className="h-4 w-4 text-red-500" />}
                      {statusData.status === 'idle' && <CircleDashed className="h-4 w-4 text-gray-500" />}
                      <span className="font-body">
                        Question {questionKey}: {statusData.status.charAt(0).toUpperCase() + statusData.status.slice(1)}
                        {statusData.message && ` - ${statusData.message}`}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
