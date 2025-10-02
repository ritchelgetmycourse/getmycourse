import { TranscriptForm } from '@/components/transcript-form';
import { FlaskConical } from 'lucide-react';

export default function Home() {
  return (
    <main className="flex min-h-screen flex-col items-center bg-background p-4 sm:p-8 font-body">
      <div className="w-full max-w-4xl py-3">
        <header className="mb-2 text-center">
          <div className="inline-flex items-center justify-center rounded-full bg-primary/10 p-4 mb-2">
            <FlaskConical className="h-10 w-10 text-primary" />
          </div>
          <h1 className="text-2xl sm:text-3xl font-headline font-bold text-foreground">
            Transcript Alchemist
          </h1>
        </header>
        <TranscriptForm />
      </div>
    </main>
  );
}
