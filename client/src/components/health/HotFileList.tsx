import { FileCode } from "lucide-react";

interface Props {
  files: string[];
}

export function HotFileList({ files }: Props) {
  if (files.length === 0) return null;

  return (
    <div className="clay-card p-5">
      <div className="flex items-baseline justify-between mb-3">
        <div>
          <p className="text-[12px] font-medium">Blast-radius files</p>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            High centrality + frequent churn — changes here ripple widely.
          </p>
        </div>
        <span className="text-[11px] text-muted-foreground font-mono tabular-nums">
          {files.length}
        </span>
      </div>

      <ul className="mt-3 divide-y divide-border border-t border-border">
        {files.map((f) => (
          <li key={f} className="py-2 flex items-center gap-2.5">
            <FileCode className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
            <span className="text-[12.5px] font-mono text-foreground truncate">
              {f}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
