import { TranscriptForm } from '@/components/transcript-form';
import { FlaskConical } from 'lucide-react';

export default function Home() {
  return (
    <main className="flex min-h-screen flex-col items-center bg-background p-4 sm:p-8 font-body">
      <div className="w-full max-w-4xl py-12">
        <header className="mb-10 text-center">
          <div className="inline-flex items-center justify-center rounded-full bg-primary/10 p-4 mb-4">
            <FlaskConical className="h-10 w-10 text-primary" />
          </div>
          <h1 className="text-4xl sm:text-5xl font-headline font-bold text-foreground">
            Transcript Alchemist
          </h1>
          <p className="mt-4 text-lg text-muted-foreground max-w-2xl mx-auto">
            Transform raw transcripts into structured, insightful docs with the power of AI.
          </p>
        </header>
        <TranscriptForm />
      </div>
    </main>
  );
}
