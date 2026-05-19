interface Props {
  repoName?: string;
}

export function EmptyHealth({ repoName }: Props) {
  return (
    <div className="clay-card flex flex-col items-center text-center py-16 px-6">
      <div className="w-10 h-10 rounded-md border border-border flex items-center justify-center mb-5">
        <div className="w-4 h-4 border border-muted-foreground/40 rounded-sm" />
      </div>
      <h3 className="text-[15px] font-semibold tracking-tight">
        No health data yet
      </h3>
      <p className="mt-2 text-[13px] text-muted-foreground max-w-sm leading-relaxed">
        {repoName
          ? `Strata will index ${repoName} on the next push to the default branch and post a score here.`
          : "Strata will index this repo on the next push to the default branch and post a score here."}
      </p>
      <p className="mt-4 text-[11.5px] text-muted-foreground/80">
        Or trigger a manual index from the Repos page.
      </p>
    </div>
  );
}
