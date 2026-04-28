"use client";

import { cn } from "@/lib/utils";
import { cjk } from "@streamdown/cjk";
import { code } from "@streamdown/code";
import { math } from "@streamdown/math";
import { mermaid } from "@streamdown/mermaid";
import type { ComponentProps } from "react";
import { memo } from "react";
import { Streamdown } from "streamdown";

export type ResponseProps = ComponentProps<typeof Streamdown>;

export const Response = memo(
  ({ className, ...props }: ResponseProps) => (
    <Streamdown
      className={cn(
        "text-sm text-zinc-200 leading-relaxed",
        "[&>*:first-child]:mt-0 [&>*:last-child]:mb-0",
        "[&_h1]:text-lg [&_h1]:font-semibold [&_h1]:text-white [&_h1]:mt-3 [&_h1]:mb-2",
        "[&_h2]:text-base [&_h2]:font-semibold [&_h2]:text-white [&_h2]:mt-3 [&_h2]:mb-2",
        "[&_h3]:text-sm [&_h3]:font-semibold [&_h3]:text-white [&_h3]:mt-2 [&_h3]:mb-1.5",
        "[&_h4]:text-sm [&_h4]:font-semibold [&_h4]:text-white [&_h4]:mt-2 [&_h4]:mb-1",
        "[&_p]:my-2",
        "[&_ul]:my-2 [&_ul]:pl-5 [&_ul]:list-disc",
        "[&_ol]:my-2 [&_ol]:pl-5 [&_ol]:list-decimal",
        "[&_li]:my-0.5 [&_li]:marker:text-zinc-500",
        "[&_strong]:text-white [&_strong]:font-semibold",
        "[&_em]:italic",
        "[&_a]:text-indigo-300 [&_a]:underline [&_a]:underline-offset-2 hover:[&_a]:text-indigo-200",
        "[&_hr]:my-3 [&_hr]:border-white/10",
        "[&_blockquote]:border-l-2 [&_blockquote]:border-white/20 [&_blockquote]:pl-3 [&_blockquote]:italic [&_blockquote]:text-zinc-300",
        "[&_code]:bg-white/5 [&_code]:px-1 [&_code]:py-0.5 [&_code]:rounded [&_code]:text-[0.85em] [&_code]:font-mono [&_code]:text-zinc-100",
        "[&_pre]:bg-black/40 [&_pre]:border [&_pre]:border-white/10 [&_pre]:rounded [&_pre]:p-2 [&_pre]:my-2 [&_pre]:overflow-x-auto",
        "[&_pre_code]:bg-transparent [&_pre_code]:p-0",
        "[&_table]:my-2 [&_table]:border-collapse [&_th]:border [&_th]:border-white/10 [&_th]:px-2 [&_th]:py-1 [&_th]:text-left [&_td]:border [&_td]:border-white/10 [&_td]:px-2 [&_td]:py-1",
        className
      )}
      plugins={[cjk, code, math, mermaid]}
      {...props}
    />
  ),
  (prev, next) => prev.children === next.children
);

Response.displayName = "Response";
