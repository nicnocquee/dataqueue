import { Separator } from '@/components/ui/separator';
import { ExternalLink } from 'lucide-react';

export function FeaturePage({
  title,
  description,
  docsLinks,
  children,
}: {
  title: string;
  description: string;
  docsLinks?: { label: string; url: string }[];
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
        <p className="text-muted-foreground mt-1">{description}</p>
        {docsLinks && docsLinks.length > 0 && (
          <div className="flex flex-wrap gap-3 mt-3">
            {docsLinks.map((link) => (
              <a
                key={link.url}
                href={link.url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline"
              >
                <ExternalLink className="h-3.5 w-3.5" />
                {link.label}
              </a>
            ))}
          </div>
        )}
      </div>
      <Separator />
      {children}
    </div>
  );
}
