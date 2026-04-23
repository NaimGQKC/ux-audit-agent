"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Loader2,
  Send,
  X,
  Wand2,
  ImageIcon,
  RefreshCw,
} from "lucide-react";
import type { FixStatus } from "@/lib/stitch/types";
import type { AuditIssue } from "@/types/audit";

export function StitchFixPanel({
  issue,
  isDismissed,
  onUpdate,
  onGenerateFix,
  onRefineFix,
  onGenerateVariants,
}: {
  issue: AuditIssue;
  isDismissed: boolean;
  onUpdate: (id: string, patch: Partial<AuditIssue>) => void;
  onGenerateFix: (issue: AuditIssue) => void;
  onRefineFix: (issue: AuditIssue, instruction: string) => void;
  onGenerateVariants: (issue: AuditIssue) => void;
}) {
  return (
    <div className="space-y-3 pt-2 border-t border-border">
      <div className="flex items-center gap-2">
        {issue.fixStatus === "none" && (
          <Button
            size="sm"
            className="bg-violet-600 hover:bg-violet-700 text-white"
            onClick={() => onGenerateFix(issue)}
            disabled={isDismissed}
          >
            <Wand2 className="w-3.5 h-3.5 mr-1.5" />
            Generate Fix
          </Button>
        )}
        {issue.fixStatus === "generating" && (
          <Button size="sm" className="bg-violet-600 text-white" disabled>
            <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
            Generating fix...
          </Button>
        )}
        {(issue.fixStatus === "generated" || issue.fixStatus === "refined") && (
          <>
            <Button
              size="sm"
              variant="outline"
              className="text-violet-600 border-violet-200 hover:bg-violet-50"
              onClick={() =>
                onUpdate(issue.id, {
                  refinePromptOpen: !issue.refinePromptOpen,
                  refinePrompt: "",
                })
              }
            >
              <RefreshCw className="w-3.5 h-3.5 mr-1.5" />
              Refine
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="text-violet-600 border-violet-200 hover:bg-violet-50"
              onClick={() => onGenerateVariants(issue)}
            >
              <ImageIcon className="w-3.5 h-3.5 mr-1.5" />
              Show Variants
            </Button>
            <Badge
              variant="outline"
              className="text-violet-600 border-violet-200"
            >
              <Wand2 className="w-3 h-3 mr-0.5" />
              {issue.fixStatus === "refined" ? "refined" : "fix generated"}
            </Badge>
          </>
        )}
        {issue.fixStatus === "error" && (
          <>
            <Button
              size="sm"
              className="bg-violet-600 hover:bg-violet-700 text-white"
              onClick={() => onGenerateFix(issue)}
            >
              <Wand2 className="w-3.5 h-3.5 mr-1.5" />
              Retry Fix
            </Button>
            <span className="text-xs text-red-500">
              Fix generation failed
              {issue.fixError ? `: ${issue.fixError}` : ""}
            </span>
          </>
        )}
      </div>

      {/* Fix preview */}
      {issue.fix &&
        (issue.fixStatus === "generated" || issue.fixStatus === "refined") && (
          <div className="space-y-2">
            <label className="text-xs font-medium text-violet-600 uppercase tracking-wide flex items-center gap-1">
              <Wand2 className="w-3 h-3" />
              Generated Fix Mockup
            </label>
            <div className="rounded-lg border-2 border-violet-200 overflow-hidden bg-violet-50/30">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={issue.fix.imageUrl}
                alt={`Fix mockup for: ${issue.title}`}
                className="w-full h-auto"
              />
            </div>
          </div>
        )}

      {/* Refine prompt */}
      {issue.refinePromptOpen && (
        <div className="p-3 bg-violet-50/50 rounded-lg border border-violet-200 space-y-2">
          <div className="flex items-center gap-2 text-xs text-violet-600">
            <RefreshCw className="w-3.5 h-3.5" />
            Describe how to refine this fix
          </div>
          <div className="flex items-center gap-2">
            <Input
              placeholder='e.g. "make the CTA bigger" or "use darker background"'
              value={issue.refinePrompt}
              onChange={(e) =>
                onUpdate(issue.id, { refinePrompt: e.target.value })
              }
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  if (issue.refinePrompt.trim())
                    onRefineFix(issue, issue.refinePrompt.trim());
                }
                if (e.key === "Escape") {
                  onUpdate(issue.id, {
                    refinePromptOpen: false,
                    refinePrompt: "",
                  });
                }
              }}
              className="flex-1 h-9 text-sm"
            />
            <Button
              size="sm"
              onClick={() => {
                if (issue.refinePrompt.trim())
                  onRefineFix(issue, issue.refinePrompt.trim());
              }}
              disabled={!issue.refinePrompt.trim()}
              className="h-9 px-3 bg-violet-600 hover:bg-violet-700"
            >
              <Send className="w-3.5 h-3.5" />
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() =>
                onUpdate(issue.id, {
                  refinePromptOpen: false,
                  refinePrompt: "",
                })
              }
              className="h-9 px-2"
            >
              <X className="w-3.5 h-3.5" />
            </Button>
          </div>
        </div>
      )}

      {/* Variants gallery */}
      {issue.variants && issue.variants.length > 0 && (
        <div className="space-y-2">
          <label className="text-xs font-medium text-violet-600 uppercase tracking-wide">
            Variants
          </label>
          <div className="grid grid-cols-3 gap-2">
            {issue.variants.map((variant, idx) => (
              <div
                key={variant.screenId}
                className="rounded-lg border border-violet-200 overflow-hidden cursor-pointer hover:border-violet-400 transition-colors"
                onClick={() =>
                  onUpdate(issue.id, {
                    fix: variant,
                    fixStatus: "generated" as FixStatus,
                  })
                }
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={variant.imageUrl}
                  alt={`Variant ${idx + 1}`}
                  className="w-full h-auto"
                />
                <div className="px-2 py-1 text-[10px] text-violet-600 text-center bg-violet-50">
                  Variant {idx + 1}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
