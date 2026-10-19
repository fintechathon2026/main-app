// Page title row used by every screen except Home (which has the dark band).

import type { ReactNode } from "react";
import { SampleTag } from "./primitives";

export function PageHeader({
  title,
  sample = false,
  children,
  sub,
}: {
  title: string;
  sample?: boolean;
  sub?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <header className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        <div className="flex items-center gap-3">
          <h1 className="text-[24px] font-semibold tracking-tight lg:text-[28px]">{title}</h1>
          {sample && <SampleTag />}
        </div>
        {sub && <p className="mt-1 text-[15px] text-muted">{sub}</p>}
      </div>
      {children}
    </header>
  );
}
