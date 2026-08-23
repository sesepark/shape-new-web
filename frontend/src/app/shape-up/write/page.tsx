"use client";

import { Suspense } from "react";
import { AuthGate } from "@/components/auth-gate";
import { PageShell } from "@/components/page-shell";
import { ShapeUpEditor } from "@/components/shape-up-editor";

export default function ShapeUpWritePage() {
  return (
    <PageShell eyebrow="SHAPE-UP RESULTS" title="소식" contentTitle="결과물 올리기">
      <AuthGate>
        {() => (
          <Suspense fallback={<p className="form-note">화면을 준비하고 있습니다.</p>}>
            <ShapeUpEditor />
          </Suspense>
        )}
      </AuthGate>
    </PageShell>
  );
}
